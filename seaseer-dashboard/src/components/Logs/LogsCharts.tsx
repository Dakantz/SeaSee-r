import React, { useRef, useState, useMemo, useCallback } from "react";
import { FiActivity, FiCompass, FiNavigation, FiLayers } from "react-icons/fi";
import type { ComputedTelemetryPoint } from "./types";

interface LogsChartsProps {
    points: ComputedTelemetryPoint[];
    activeIndex: number | null;
    hoveredIndex: number | null;
    onSelectIndex: (index: number) => void;
    onHoverIndex: (index: number | null) => void;
}

export const LogsCharts: React.FC<LogsChartsProps> = ({
    points,
    activeIndex,
    hoveredIndex,
    onSelectIndex,
    onHoverIndex,
}) => {
    const [chartMode, setChartMode] = useState<"depth" | "altitude" | "speed" | "distance">("depth");
    const containerRef = useRef<HTMLDivElement>(null);

    const chartData = useMemo(() => {
        if (!points || points.length === 0) return null;

        const times = points.map((p) => p.relativeTime);
        const minTime = Math.min(...times);
        const maxTime = Math.max(...times);
        const timeRange = Math.max(maxTime - minTime, 0.5);

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
        };
    }, [points]);

    const svgWidth = 1000;
    const svgHeight = 280;
    const padding = { top: 25, right: 35, bottom: 45, left: 65 };
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
        if (!points || points.length === 0 || !chartData) {
            return { linePath: "", areaPath: "", activeCoord: null, hoveredCoord: null };
        }

        const validCoords = points.map(getCoords).filter((c) => Number.isFinite(c.x) && Number.isFinite(c.y));
        if (validCoords.length === 0) return { linePath: "", areaPath: "", activeCoord: null, hoveredCoord: null };

        let lPath = `M ${validCoords[0].x.toFixed(2)} ${validCoords[0].y.toFixed(2)}`;
        for (let i = 1; i < validCoords.length; i++) {
            lPath += ` L ${validCoords[i].x.toFixed(2)} ${validCoords[i].y.toFixed(2)}`;
        }

        const baselineY = padding.top + innerHeight;
        const aPath = `${lPath} L ${validCoords[validCoords.length - 1].x.toFixed(2)} ${baselineY} L ${validCoords[0].x.toFixed(2)} ${baselineY} Z`;

        const aCoord = activeIndex !== null && points[activeIndex] ? getCoords(points[activeIndex]) : null;
        const hCoord = hoveredIndex !== null && points[hoveredIndex] ? getCoords(points[hoveredIndex]) : null;

        return { linePath: lPath, areaPath: aPath, activeCoord: aCoord, hoveredCoord: hCoord };
    }, [points, chartData, getCoords, padding.top, innerHeight, activeIndex, hoveredIndex]);

    const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
        if (!points || points.length === 0 || !chartData) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const clientX = e.clientX - rect.left;
        const svgX = (clientX / rect.width) * svgWidth;

        let closestIdx = 0;
        let minDiff = Infinity;
        points.forEach((p, idx) => {
            const { x } = getCoords(p);
            const diff = Math.abs(x - svgX);
            if (diff < minDiff) {
                minDiff = diff;
                closestIdx = idx;
            }
        });

        onHoverIndex(closestIdx);
    };

    const handleMouseLeave = () => {
        onHoverIndex(null);
    };

    const handleClick = () => {
        if (hoveredIndex !== null) {
            onSelectIndex(hoveredIndex);
        }
    };

    return (
        <div className="logs-chart-panel" ref={containerRef}>
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
                {points.length === 0 ? (
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

                        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
                            const y = padding.top + (1 - ratio) * innerHeight;
                            let label = "";
                            if (chartData) {
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
                                    <text x={padding.left - 10} y={y + 4} className="logs-axis-label-y">
                                        {label}
                                    </text>
                                </g>
                            );
                        })}

                        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
                            const x = padding.left + ratio * innerWidth;
                            const y = padding.top + innerHeight + 20;
                            const timeVal = chartData ? chartData.minTime + ratio * chartData.timeRange : 0;
                            const mins = Math.floor(timeVal / 60);
                            const secs = (timeVal % 60).toFixed(1);
                            const timeLabel = `${mins}:${Number(secs) < 10 ? "0" : ""}${secs}s`;

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

                        {(hoveredCoord || activeCoord) && (
                            <line
                                x1={(hoveredCoord || activeCoord)!.x}
                                y1={padding.top}
                                x2={(hoveredCoord || activeCoord)!.x}
                                y2={padding.top + innerHeight}
                                className="logs-cursor-line"
                            />
                        )}

                        {activeCoord && Number.isFinite(activeCoord.x) && Number.isFinite(activeCoord.y) && (
                            <circle
                                cx={activeCoord.x}
                                cy={activeCoord.y}
                                r="6"
                                className="logs-point-active"
                            />
                        )}

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
        </div>
    );
};
