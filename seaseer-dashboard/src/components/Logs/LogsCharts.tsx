import React, { useRef, useState, useMemo, useCallback } from "react";
import { FiActivity, FiCompass, FiNavigation, FiLayers } from "react-icons/fi";
import type { ComputedTelemetryPoint, VideoItem } from "./types";
import { getVideoDuration } from "./types";
import { useTrajectoryLogSync } from "./hooks/useTrajectoryLogSync";

interface LogsChartsProps {
    points: ComputedTelemetryPoint[];
    videos?: VideoItem[];
    currentVideoIndex?: number;
    totalDuration?: number;
    activeIndex: number | null;
    hoveredIndex: number | null;
    onSelectIndex: (index: number) => void;
    onHoverIndex: (index: number | null) => void;
    onSeekTime?: (timeSec: number, videoIndex?: number) => void;
}

export const LogsCharts: React.FC<LogsChartsProps> = ({
    points,
    videos,
    currentVideoIndex,
    totalDuration: propTotalDuration,
    activeIndex,
    hoveredIndex,
    onSelectIndex,
    onHoverIndex,
    onSeekTime,
}) => {
    const [chartMode, setChartMode] = useState<"depth" | "altitude" | "speed" | "distance">("depth");
    const containerRef = useRef<HTMLDivElement>(null);
    const activeSyncPoint = useTrajectoryLogSync((state) => state.activePoint);

    // Compute combined duration and start offsets across all videos
    const videoTimeline = useMemo(() => {
        if (!videos || videos.length === 0) return null;
        const durations = videos.map(getVideoDuration);
        const offsets: number[] = [];
        let runningOffset = 0;
        for (let i = 0; i < videos.length; i++) {
            offsets.push(runningOffset);
            runningOffset += durations[i];
        }
        return {
            durations,
            offsets,
            totalDuration: runningOffset,
        };
    }, [videos]);

    const chartData = useMemo(() => {
        const hasPoints = Boolean(points && points.length > 0);
        const times = hasPoints ? points.map((p) => p.relativeTime) : [];
        const maxPointsTime = times.length > 0 ? Math.max(...times) : 0;

        // Total combined duration across all videos
        const combinedVideoDuration = videoTimeline ? videoTimeline.totalDuration : (propTotalDuration ?? 0);
        const minTime = 0;
        const maxTime = combinedVideoDuration > 0 ? combinedVideoDuration : Math.max(maxPointsTime, 1);
        const timeRange = Math.max(maxTime - minTime, 0.5);

        if (!hasPoints) {
            return {
                minTime,
                maxTime,
                timeRange,
                minDepth: 0,
                maxDepth: 10,
                depthRange: 10,
                minZ: 0,
                maxZ: 10,
                zRange: 10,
                maxSpeed: 1,
                maxDistance: 10,
                hasData: false,
            };
        }

        const depths = points.map((p) => p.depth);
        const minDepth = Math.min(...depths);
        const maxDepth = Math.max(...depths);
        const depthRange = Math.max(maxDepth - minDepth, 0.5);

        const zs = points.map((p) => p.z);
        const minZ = Math.min(...zs);
        const maxZ = Math.max(...zs);
        const zRange = Math.max(maxZ - minZ, 0.5);

        const speeds = points.map((p) => p.speed);
        const maxSpeed = Math.max(...speeds, 0.5);

        const distances = points.map((p) => p.distanceTravelled);
        const maxDistance = Math.max(...distances, 1.0);

        return {
            minTime,
            maxTime,
            timeRange,
            minDepth,
            maxDepth,
            depthRange,
            minZ,
            maxZ,
            zRange,
            maxSpeed,
            maxDistance,
            hasData: true,
        };
    }, [points, videoTimeline, propTotalDuration]);

    const svgWidth = 1000;
    const svgHeight = 280;
    const padding = { top: 28, right: 35, bottom: 45, left: 65 };
    const innerWidth = svgWidth - padding.left - padding.right;
    const innerHeight = svgHeight - padding.top - padding.bottom;

    const getCoords = useCallback(
        (point: ComputedTelemetryPoint) => {
            if (!chartData) return { x: 0, y: 0 };
            const { minTime, timeRange, minDepth, depthRange, minZ, zRange, maxSpeed, maxDistance } = chartData;

            const nx = (point.relativeTime - minTime) / timeRange;
            const x = padding.left + Math.max(0, Math.min(1, nx)) * innerWidth;

            let ny = 0;
            if (chartMode === "depth") {
                // Oceanographic depth profile: deeper = lower on canvas
                ny = (point.depth - minDepth) / depthRange;
                const y = padding.top + ny * innerHeight;
                return { x, y };
            } else if (chartMode === "altitude") {
                // Altitude / Z: higher Z = higher on canvas
                ny = (point.z - minZ) / zRange;
                const y = padding.top + (1 - ny) * innerHeight;
                return { x, y };
            } else if (chartMode === "speed") {
                ny = point.speed / maxSpeed;
                const y = padding.top + (1 - Math.max(0, Math.min(1, ny))) * innerHeight;
                return { x, y };
            } else {
                // Distance
                ny = point.distanceTravelled / maxDistance;
                const y = padding.top + (1 - Math.max(0, Math.min(1, ny))) * innerHeight;
                return { x, y };
            }
        },
        [chartData, chartMode, innerWidth, innerHeight, padding.left, padding.top]
    );

    const { linePath, areaPath, activeCoord, hoveredCoord } = useMemo(() => {
        if (!points || points.length === 0 || !chartData || !chartData.hasData) {
            let aCoord: { x: number; y: number } | null = null;
            if (activeSyncPoint && typeof activeSyncPoint.relativeTime === "number" && chartData) {
                const nx = (activeSyncPoint.relativeTime - chartData.minTime) / chartData.timeRange;
                if (nx >= 0 && nx <= 1) {
                    const x = padding.left + nx * innerWidth;
                    aCoord = { x, y: padding.top + innerHeight / 2 };
                }
            }
            return { linePath: "", areaPath: "", activeCoord: aCoord, hoveredCoord: null };
        }

        const validCoords = points.map(getCoords).filter((c) => Number.isFinite(c.x) && Number.isFinite(c.y));
        if (validCoords.length === 0) return { linePath: "", areaPath: "", activeCoord: null, hoveredCoord: null };

        let lPath = `M ${validCoords[0].x.toFixed(2)} ${validCoords[0].y.toFixed(2)}`;
        for (let i = 1; i < validCoords.length; i++) {
            lPath += ` L ${validCoords[i].x.toFixed(2)} ${validCoords[i].y.toFixed(2)}`;
        }

        const baselineY = padding.top + innerHeight;
        const aPath = `${lPath} L ${validCoords[validCoords.length - 1].x.toFixed(2)} ${baselineY} L ${validCoords[0].x.toFixed(2)} ${baselineY} Z`;

        let aCoord = activeIndex !== null && points[activeIndex] ? getCoords(points[activeIndex]) : null;
        if (!aCoord && activeSyncPoint && typeof activeSyncPoint.relativeTime === "number" && chartData) {
            const nx = (activeSyncPoint.relativeTime - chartData.minTime) / chartData.timeRange;
            if (nx >= 0 && nx <= 1) {
                const x = padding.left + nx * innerWidth;
                aCoord = { x, y: padding.top + innerHeight / 2 };
            }
        }

        const hCoord = hoveredIndex !== null && points[hoveredIndex] ? getCoords(points[hoveredIndex]) : null;

        return { linePath: lPath, areaPath: aPath, activeCoord: aCoord, hoveredCoord: hCoord };
    }, [points, chartData, getCoords, padding.top, padding.left, innerHeight, innerWidth, activeIndex, hoveredIndex, activeSyncPoint]);

    const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
        if (!chartData) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const clientX = e.clientX - rect.left;
        const svgX = (clientX / rect.width) * svgWidth;

        let closestIdx = -1;
        let minDiff = Infinity;
        if (points && points.length > 0) {
            points.forEach((p, idx) => {
                const { x } = getCoords(p);
                const diff = Math.abs(x - svgX);
                if (diff < minDiff) {
                    minDiff = diff;
                    closestIdx = idx;
                }
            });
        }

        // Only snap to hover if cursor is reasonably close (within 30px) to actual data points
        if (closestIdx !== -1 && minDiff < 30) {
            onHoverIndex(closestIdx);
        } else {
            onHoverIndex(null);
        }
    };

    const handleMouseLeave = () => {
        onHoverIndex(null);
    };

    const handleClick = (e: React.MouseEvent<SVGSVGElement>) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const clientX = e.clientX - rect.left;
        const svgX = (clientX / rect.width) * svgWidth;

        if (hoveredIndex !== null) {
            onSelectIndex(hoveredIndex);
            return;
        }

        if (!chartData) return;

        let closestIdx = -1;
        let minDiff = Infinity;
        if (points && points.length > 0) {
            points.forEach((p, idx) => {
                const { x } = getCoords(p);
                const diff = Math.abs(x - svgX);
                if (diff < minDiff) {
                    minDiff = diff;
                    closestIdx = idx;
                }
            });
        }

        if (closestIdx !== -1 && minDiff < 30) {
            onSelectIndex(closestIdx);
            return;
        }

        // If clicked on an empty area of the timeline, seek video to that time
        const clickedRatio = Math.max(0, Math.min(1, (svgX - padding.left) / innerWidth));
        const clickedTime = chartData.minTime + clickedRatio * chartData.timeRange;

        if (videoTimeline && videoTimeline.offsets.length > 0) {
            let targetVidIdx = 0;
            let timeWithinVid = clickedTime;
            for (let i = 0; i < videoTimeline.offsets.length; i++) {
                const start = videoTimeline.offsets[i];
                const dur = videoTimeline.durations[i];
                if (clickedTime >= start && clickedTime < start + dur) {
                    targetVidIdx = i;
                    timeWithinVid = clickedTime - start;
                    break;
                }
                if (i === videoTimeline.offsets.length - 1 && clickedTime >= start) {
                    targetVidIdx = i;
                    timeWithinVid = Math.min(dur, clickedTime - start);
                }
            }
            if (onSeekTime) {
                onSeekTime(timeWithinVid, targetVidIdx);
            } else {
                useTrajectoryLogSync.getState().selectPoint(
                    {
                        relativeTime: clickedTime,
                        videoTime: timeWithinVid,
                        videoIndex: targetVidIdx,
                    },
                    "chart"
                );
            }
        }
    };

    return (
        <div
            className="logs-chart-panel"
            ref={containerRef}
            onClick={() => useTrajectoryLogSync.getState().openLogsPanel()}
        >
            <div className="logs-chart-header">
                <div className="logs-chart-tabs">
                    <button
                        className={`logs-chart-tab ${chartMode === "depth" ? "active" : ""}`}
                        onClick={() => setChartMode("depth")}
                    >
                        <FiCompass size={12} style={{ marginRight: 4 }} />
                        Depth Profile
                    </button>
                    <button
                        className={`logs-chart-tab ${chartMode === "altitude" ? "active" : ""}`}
                        onClick={() => setChartMode("altitude")}
                    >
                        <FiLayers size={12} style={{ marginRight: 4 }} />
                        Elevation
                    </button>
                    <button
                        className={`logs-chart-tab ${chartMode === "speed" ? "active" : ""}`}
                        onClick={() => setChartMode("speed")}
                    >
                        <FiActivity size={12} style={{ marginRight: 4 }} />
                        Speed Profile
                    </button>
                    <button
                        className={`logs-chart-tab ${chartMode === "distance" ? "active" : ""}`}
                        onClick={() => setChartMode("distance")}
                    >
                        <FiNavigation size={12} style={{ marginRight: 4 }} />
                        Distance
                    </button>
                </div>
            </div>

            <div className="logs-svg-wrapper">
                {(!points || points.length === 0) && (!videoTimeline || videoTimeline.totalDuration <= 0) ? (
                    <div className="logs-chart-empty">No trajectory data available to plot</div>
                ) : (
                    <svg
                        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
                        preserveAspectRatio="none"
                        className="logs-chart-svg"
                        onMouseMove={handleMouseMove}
                        onMouseLeave={handleMouseLeave}
                        onClick={handleClick}
                    >
                        <defs>
                            <linearGradient id="depthGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#0284c7" stopOpacity="0.4" />
                                <stop offset="100%" stopColor="#0284c7" stopOpacity="0.02" />
                            </linearGradient>

                            <linearGradient id="altitudeGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.45" />
                                <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.0" />
                            </linearGradient>

                            <linearGradient id="speedGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#10b981" stopOpacity="0.4" />
                                <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
                            </linearGradient>

                            <linearGradient id="distGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.4" />
                                <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.0" />
                            </linearGradient>
                        </defs>

                        {/* Video Parts Boundaries */}
                        {videoTimeline && videoTimeline.offsets.length > 1 && chartData && (
                            <g className="logs-video-parts-grid">
                                {videoTimeline.offsets.map((offset, idx) => {
                                    if (idx === 0) return null;
                                    const x = padding.left + (offset / chartData.timeRange) * innerWidth;
                                    return (
                                        <line
                                            key={`boundary-${idx}`}
                                            x1={x}
                                            y1={padding.top}
                                            x2={x}
                                            y2={padding.top + innerHeight}
                                            className="logs-video-boundary-line"
                                        />
                                    );
                                })}
                            </g>
                        )}

                        {/* Video Part Segment Labels */}
                        {videoTimeline && videoTimeline.offsets.length > 1 && chartData && (
                            <g className="logs-video-parts-labels">
                                {videoTimeline.offsets.map((offset, idx) => {
                                    const startX = padding.left + (offset / chartData.timeRange) * innerWidth;
                                    const dur = videoTimeline.durations[idx];
                                    const endX = padding.left + ((offset + dur) / chartData.timeRange) * innerWidth;
                                    const midX = (startX + endX) / 2;
                                    const isActivePart = currentVideoIndex === idx;

                                    return (
                                        <text
                                            key={`label-${idx}`}
                                            x={midX}
                                            y={padding.top - 8}
                                            className={`logs-part-badge ${isActivePart ? "active" : ""}`}
                                        >
                                            Part {idx + 1}
                                        </text>
                                    );
                                })}
                            </g>
                        )}

                        {/* Y-Axis Horizontal Grid Lines and Labels */}
                        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
                            const y = padding.top + (1 - ratio) * innerHeight;
                            let label = "";
                            if (chartData && chartData.hasData) {
                                if (chartMode === "depth") {
                                    // Oceanographic depth: ratio = 1 is top (min depth / surface), ratio = 0 is bottom (deepest)
                                    const val = chartData.maxDepth - ratio * chartData.depthRange;
                                    label = `${val.toFixed(1)}m`;
                                } else if (chartMode === "altitude") {
                                    const val = chartData.minZ + ratio * chartData.zRange;
                                    label = `${val.toFixed(1)}m`;
                                } else if (chartMode === "speed") {
                                    const val = ratio * chartData.maxSpeed;
                                    label = `${val.toFixed(2)}m/s`;
                                } else {
                                    const val = ratio * chartData.maxDistance;
                                    label = `${val.toFixed(1)}m`;
                                }
                            }
                            return (
                                <g key={ratio}>
                                    <line
                                        x1={padding.left}
                                        y1={y}
                                        x2={padding.left + innerWidth}
                                        y2={y}
                                        className="logs-grid-line"
                                    />
                                    {label && (
                                        <text x={padding.left - 10} y={y + 4} className="logs-axis-label-y">
                                            {label}
                                        </text>
                                    )}
                                </g>
                            );
                        })}

                        {/* X-Axis Vertical Time Grid Lines and Labels across Combined Duration */}
                        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
                            const x = padding.left + ratio * innerWidth;
                            const y = padding.top + innerHeight + 20;
                            const timeVal = chartData ? chartData.minTime + ratio * chartData.timeRange : 0;
                            const mins = Math.floor(timeVal / 60);
                            const secs = Math.floor(timeVal % 60);
                            const timeLabel = `${mins}:${secs < 10 ? "0" : ""}${secs}`;

                            return (
                                <g key={ratio}>
                                    <line
                                        x1={x}
                                        y1={padding.top}
                                        x2={x}
                                        y2={padding.top + innerHeight}
                                        className="logs-grid-line-vertical"
                                    />
                                    <text x={x} y={y} className="logs-axis-label-x">
                                        {timeLabel}
                                    </text>
                                </g>
                            );
                        })}

                        {/* Filled Area: Only covers portion where data exists */}
                        {areaPath && (
                            <path
                                d={areaPath}
                                fill={
                                    chartMode === "depth"
                                        ? "url(#depthGradient)"
                                        : chartMode === "altitude"
                                        ? "url(#altitudeGradient)"
                                        : chartMode === "speed"
                                        ? "url(#speedGradient)"
                                        : "url(#distGradient)"
                                }
                            />
                        )}

                        {/* Line Path: Only covers portion where data exists */}
                        {linePath && (
                            <path
                                d={linePath}
                                fill="none"
                                stroke={
                                    chartMode === "depth"
                                        ? "#38bdf8"
                                        : chartMode === "altitude"
                                        ? "#60a5fa"
                                        : chartMode === "speed"
                                        ? "#34d399"
                                        : "#c084fc"
                                }
                                strokeWidth="2.5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            />
                        )}

                        {/* Cursor line for hovered or active timestamp */}
                        {(hoveredCoord || activeCoord) && (
                            <line
                                x1={(hoveredCoord || activeCoord)!.x}
                                y1={padding.top}
                                x2={(hoveredCoord || activeCoord)!.x}
                                y2={padding.top + innerHeight}
                                className="logs-cursor-line"
                            />
                        )}

                        {/* Active Point Circle (only when on a real telemetry point) */}
                        {activeCoord && activeIndex !== null && points[activeIndex] && Number.isFinite(activeCoord.x) && Number.isFinite(activeCoord.y) && (
                            <circle
                                cx={activeCoord.x}
                                cy={activeCoord.y}
                                r="6"
                                className="logs-point-active"
                            />
                        )}

                        {/* Hovered Point Circle */}
                        {hoveredCoord && hoveredIndex !== activeIndex && Number.isFinite(hoveredCoord.x) && Number.isFinite(hoveredCoord.y) && (
                            <circle
                                cx={hoveredCoord.x}
                                cy={hoveredCoord.y}
                                r="5"
                                className="logs-point-hovered"
                            />
                        )}
                    </svg>
                )}
            </div>

            {/* Tooltip bar displaying active / hovered point details */}
            {(() => {
                const targetIdx = hoveredIndex !== null ? hoveredIndex : activeIndex;
                if (targetIdx === null || !points[targetIdx]) return null;
                const pt = points[targetIdx];
                const formatTime = (t?: number) => {
                    if (t === undefined || !Number.isFinite(t)) return "00:00";
                    const mins = Math.floor(t / 60);
                    const secs = Math.floor(t % 60);
                    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
                };

                return (
                    <div className="logs-chart-tooltip">
                        <div className="logs-tooltip-item">
                            <span className="logs-tooltip-label">Frame:</span>
                            <span className="logs-tooltip-val">#{pt.frameNumber ?? pt.index + 1}</span>
                        </div>
                        {typeof pt.videoIndex === "number" && (
                            <div className="logs-tooltip-item">
                                <span className="logs-tooltip-label">Video:</span>
                                <span className="logs-tooltip-val">Part {pt.videoIndex + 1} ({formatTime(pt.videoTime)})</span>
                            </div>
                        )}
                        <div className="logs-tooltip-item">
                            <span className="logs-tooltip-label">Depth:</span>
                            <span className="logs-tooltip-val">{pt.depth.toFixed(2)}m</span>
                        </div>
                        <div className="logs-tooltip-item">
                            <span className="logs-tooltip-label">Distance:</span>
                            <span className="logs-tooltip-val">{pt.distanceTravelled.toFixed(1)}m</span>
                        </div>
                        <div className="logs-tooltip-item" style={{ marginLeft: "auto", color: "#38bdf8", opacity: 0.85 }}>
                            <span>Click to jump video</span>
                        </div>
                    </div>
                );
            })()}
        </div>
    );
};
