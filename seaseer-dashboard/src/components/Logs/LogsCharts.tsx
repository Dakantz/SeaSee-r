import React, { useRef, useState, useMemo, useCallback, useEffect } from "react";
import { FiNavigation, FiThermometer, FiDroplet, FiRadio, FiTarget } from "react-icons/fi";
import type { ComputedTelemetryPoint, VideoItem, LogDataItem } from "./types";
import { getVideoDuration } from "./types";
import { useTrajectoryLogSync, type TrajectorySyncPoint } from "./hooks/useTrajectoryLogSync";

interface LogsChartsProps {
    points: ComputedTelemetryPoint[];
    videos?: VideoItem[];
    currentVideoIndex?: number;
    totalDuration?: number;
    activeIndex: number | null;
    hoveredIndex: number | null;
    onSelectIndex: (index: number) => void;
    onHoverIndex: (index: number | null) => void;
    onSeekTime?: (timeSec: number, videoIndex?: number, fullRelativeTime?: number) => void;
    batchId?: string | null;
    startTime?: number | string | null;
    endTime?: number | string | null;
}

type ChartMode = "log_depth" | "log_temperature" | "log_sonar_altitude" | "log_sonar_front" | "distance";

interface ComputedLogPoint {
    raw: LogDataItem;
    index: number;
    relativeTime: number;
    videoIndex?: number;
    videoTime?: number;
    depth: number | null;
    temperature: number | null;
    altitude: number | null;
    distance: number | null;
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
    batchId: propBatchId,
    startTime: propStartTime,
    endTime: propEndTime,
}) => {
    const [chartMode, setChartMode] = useState<ChartMode>("log_depth");
    const containerRef = useRef<HTMLDivElement>(null);
    const activeSyncPoint = useTrajectoryLogSync((state) => state.activePoint);
    const syncSource = useTrajectoryLogSync((state) => state.syncSource);

    const apiBaseUrl = import.meta.env.VITE_API_URL || "http://localhost:8000";

    // Explicitly sort videos chronologically by video_start_at
    const sortedVideos = useMemo(() => {
        if (!videos || videos.length === 0) return [];
        return [...videos].sort((a, b) => {
            const tA = new Date(a.video_start_at).getTime();
            const tB = new Date(b.video_start_at).getTime();
            if (!isNaN(tA) && !isNaN(tB) && Math.abs(tA - tB) > 5000) {
                return tA - tB;
            }
            const nameA = a.upload_metadata?.orig_filename || a.upload_metadata?.safe_filename || a.id;
            const nameB = b.upload_metadata?.orig_filename || b.upload_metadata?.safe_filename || b.id;
            return nameA.localeCompare(nameB, undefined, { numeric: true });
        });
    }, [videos]);

    // Resolve batch_id from props or from videos metadata
    const resolvedBatchId = useMemo(() => {
        if (propBatchId) return propBatchId;
        if (sortedVideos && sortedVideos.length > 0) {
            const found = sortedVideos.find((v) => v.upload_metadata?.batch_id);
            if (found && found.upload_metadata?.batch_id) {
                return found.upload_metadata.batch_id;
            }
        }
        return null;
    }, [propBatchId, sortedVideos]);

    // Determine timerange across videos or points if not explicitly passed
    const { effectiveStart, effectiveEnd } = useMemo(() => {
        if (propStartTime !== undefined && propStartTime !== null && propEndTime !== undefined && propEndTime !== null) {
            return { effectiveStart: propStartTime, effectiveEnd: propEndTime };
        }

        // Try from videos
        if (sortedVideos && sortedVideos.length > 0) {
            const starts = sortedVideos.map((v) => new Date(v.video_start_at).getTime()).filter((t) => !isNaN(t) && t > 0);
            const stops = sortedVideos.map((v) => new Date(v.video_stop_at).getTime()).filter((t) => !isNaN(t) && t > 0);
            if (starts.length > 0 && stops.length > 0) {
                return {
                    effectiveStart: propStartTime ?? Math.min(...starts),
                    effectiveEnd: propEndTime ?? Math.max(...stops),
                };
            }
        }

        // Try from points timestamps
        if (points && points.length > 0) {
            const validTs = points.map((p) => p.timestamp).filter((t) => typeof t === "number" && t > 1e8);
            if (validTs.length > 0) {
                const norm = validTs.map((t) => (t > 1e11 ? t : t * 1000));
                return {
                    effectiveStart: propStartTime ?? Math.min(...norm),
                    effectiveEnd: propEndTime ?? Math.max(...norm),
                };
            }
        }

        return {
            effectiveStart: propStartTime ?? null,
            effectiveEnd: propEndTime ?? null,
        };
    }, [propStartTime, propEndTime, sortedVideos, points]);

    // Backend route state for log_data
    const [logData, setLogData] = useState<LogDataItem[]>([]);
    const [loadingLogs, setLoadingLogs] = useState<boolean>(false);
    const [logsError, setLogsError] = useState<string | null>(null);

    // Fetch log_data from the new backend route
    useEffect(() => {
        if (!resolvedBatchId) {
            setLogData([]);
            setLoadingLogs(false);
            return;
        }

        let isCancelled = false;
        setLoadingLogs(true);
        setLogsError(null);

        async function fetchLogs() {
            try {
                const url = new URL(`${apiBaseUrl}/videos/batches/${resolvedBatchId}/logs`);
                if (effectiveStart !== null && effectiveStart !== undefined) {
                    url.searchParams.append("start_time", String(effectiveStart));
                }
                if (effectiveEnd !== null && effectiveEnd !== undefined) {
                    url.searchParams.append("end_time", String(effectiveEnd));
                }

                let res = await fetch(url.toString());
                if (!res.ok) {
                    // Fallback to /logs?batch_id=...
                    const fallbackUrl = new URL(`${apiBaseUrl}/logs`);
                    fallbackUrl.searchParams.append("batch_id", resolvedBatchId!);
                    if (effectiveStart !== null && effectiveStart !== undefined) {
                        fallbackUrl.searchParams.append("start_time", String(effectiveStart));
                    }
                    if (effectiveEnd !== null && effectiveEnd !== undefined) {
                        fallbackUrl.searchParams.append("end_time", String(effectiveEnd));
                    }
                    res = await fetch(fallbackUrl.toString());
                }

                if (!res.ok) {
                    throw new Error(`Failed to load log data: ${res.statusText}`);
                }

                const data = await res.json();
                if (!isCancelled) {
                    setLogData(Array.isArray(data) ? data : []);
                }
            } catch (err: any) {
                if (!isCancelled) {
                    console.error("Error fetching batch log data:", err);
                    setLogsError(err?.message || "Failed to load log data");
                    setLogData([]);
                }
            } finally {
                if (!isCancelled) {
                    setLoadingLogs(false);
                }
            }
        }

        fetchLogs();

        return () => {
            isCancelled = true;
        };
    }, [resolvedBatchId, effectiveStart, effectiveEnd, apiBaseUrl]);

    // Compute combined duration and start offsets across all videos
    const videoTimeline = useMemo(() => {
        if (!sortedVideos || sortedVideos.length === 0) return null;
        const durations = sortedVideos.map(getVideoDuration);
        const offsets: number[] = [];
        let runningOffset = 0;
        for (let i = 0; i < sortedVideos.length; i++) {
            offsets.push(runningOffset);
            runningOffset += durations[i];
        }
        return {
            durations,
            offsets,
            totalDuration: runningOffset,
        };
    }, [sortedVideos]);

    // Compute log data points mapped to timeline
    const computedLogPoints = useMemo<ComputedLogPoint[]>(() => {
        if (!logData || logData.length === 0) return [];

        let t0: number | null = null;
        if (sortedVideos && sortedVideos.length > 0) {
            const vStart = new Date(sortedVideos[0].video_start_at).getTime();
            if (!isNaN(vStart) && vStart > 0) {
                t0 = vStart;
            }
        }
        if (t0 === null && points && points.length > 0) {
            const firstPtTs = points.find((p) => p.timestamp > 1e8)?.timestamp;
            if (firstPtTs) {
                t0 = firstPtTs > 1e11 ? firstPtTs : firstPtTs * 1000;
            }
        }
        if (t0 === null && logData.length > 0) {
            t0 = logData[0].timestamp;
        }

        const result: ComputedLogPoint[] = [];
        let prevRelTime = 0;

        for (let idx = 0; idx < logData.length; idx++) {
            const item = logData[idx];
            let vidIdx: number | undefined = undefined;
            let vidTime: number | undefined = undefined;
            let relTime = 0;

            if (videoTimeline && sortedVideos && sortedVideos.length > 0) {
                for (let i = 0; i < sortedVideos.length; i++) {
                    const s = new Date(sortedVideos[i].video_start_at).getTime();
                    const e = new Date(sortedVideos[i].video_stop_at).getTime();
                    if (!isNaN(s) && !isNaN(e) && item.timestamp >= s && item.timestamp <= e) {
                        const origIdx = videos ? videos.indexOf(sortedVideos[i]) : i;
                        vidIdx = origIdx !== -1 ? origIdx : i;
                        vidTime = Math.max(0, Math.min(videoTimeline.durations[i], (item.timestamp - s) / 1000.0));
                        relTime = videoTimeline.offsets[i] + vidTime;
                        break;
                    }
                }

                // If videos are present, filter out points in recording gaps outside all video windows
                // to align the chart 1:1 with video playback and eliminate backtracking loops.
                if (vidIdx === undefined) {
                    continue;
                }
            } else {
                relTime = t0 !== null ? Math.max(0, (item.timestamp - t0) / 1000.0) : idx * 0.1;
            }

            // Clamp relTime to adjacent boundaries to ensure strict monotonicity
            if (relTime < prevRelTime) {
                relTime = prevRelTime;
            }
            prevRelTime = relTime;

            const rawDepth = item.payload?.depth ?? item.payload?.Depth;
            const depth = typeof rawDepth === "number" && !isNaN(rawDepth) ? rawDepth : null;

            const rawTemp = item.payload?.temperature ?? item.payload?.Temperature;
            const temperature = typeof rawTemp === "number" && !isNaN(rawTemp) ? rawTemp : null;

            const rawAltitude = item.payload?.altitude ?? item.payload?.Altitude;
            const altitude = typeof rawAltitude === "number" && !isNaN(rawAltitude) ? rawAltitude : null;

            const rawDistance = item.payload?.distance ?? item.payload?.Distance;
            const distance = typeof rawDistance === "number" && !isNaN(rawDistance) ? rawDistance : null;

            result.push({
                raw: item,
                index: result.length,
                relativeTime: relTime,
                videoIndex: vidIdx,
                videoTime: vidTime,
                depth,
                temperature,
                altitude,
                distance,
            });
        }

        return result;
    }, [logData, sortedVideos, points, videoTimeline]);

    const isLogMode =
        chartMode === "log_depth" ||
        chartMode === "log_temperature" ||
        chartMode === "log_sonar_altitude" ||
        chartMode === "log_sonar_front";
    const [hoveredLogIndex, setHoveredLogIndex] = useState<number | null>(null);

    const chartData = useMemo(() => {
        const hasPoints = Boolean(points && points.length > 0);
        const times = hasPoints ? points.map((p) => p.relativeTime) : [];
        const maxPointsTime = times.length > 0 ? Math.max(...times) : 0;
        const maxLogTime = computedLogPoints.length > 0 ? Math.max(...computedLogPoints.map((p) => p.relativeTime)) : 0;

        // Total combined duration across all videos
        const combinedVideoDuration = videoTimeline ? videoTimeline.totalDuration : (propTotalDuration ?? 0);
        const minTime = 0;
        const maxTime = combinedVideoDuration > 0 ? combinedVideoDuration : Math.max(maxPointsTime, maxLogTime, 1);
        const timeRange = Math.max(maxTime - minTime, 0.5);

        // Trajectory points ranges
        const depths = hasPoints ? points.map((p) => p.depth) : [0];
        const minDepth = Math.min(...depths);
        const maxDepth = Math.max(...depths);
        const depthRange = Math.max(maxDepth - minDepth, 0.5);

        const zs = hasPoints ? points.map((p) => p.z) : [0];
        const minZ = Math.min(...zs);
        const maxZ = Math.max(...zs);
        const zRange = Math.max(maxZ - minZ, 0.5);

        const speeds = hasPoints ? points.map((p) => p.speed) : [0];
        const maxSpeed = Math.max(...speeds, 0.5);

        const distances = hasPoints ? points.map((p) => p.distanceTravelled) : [0];
        const maxDistance = Math.max(...distances, 1.0);

        // Log points ranges
        const validLogDepths = computedLogPoints.map((p) => p.depth).filter((d): d is number => d !== null);
        const minLogDepth = validLogDepths.length > 0 ? Math.min(...validLogDepths) : 0;
        const maxLogDepth = validLogDepths.length > 0 ? Math.max(...validLogDepths) : 10;
        const logDepthRange = Math.max(maxLogDepth - minLogDepth, 0.5);

        const validLogTemps = computedLogPoints.map((p) => p.temperature).filter((t): t is number => t !== null);
        const minLogTemp = validLogTemps.length > 0 ? Math.min(...validLogTemps) : 15;
        const maxLogTemp = validLogTemps.length > 0 ? Math.max(...validLogTemps) : 25;
        const logTempRange = Math.max(maxLogTemp - minLogTemp, 0.5);

        const validLogAltitudes = computedLogPoints.map((p) => p.altitude).filter((a): a is number => a !== null);
        const minLogAltitude = validLogAltitudes.length > 0 ? Math.min(...validLogAltitudes) : 0;
        const maxLogAltitude = validLogAltitudes.length > 0 ? Math.max(...validLogAltitudes) : 10;
        const logAltitudeRange = Math.max(maxLogAltitude - minLogAltitude, 0.5);

        const validLogDistances = computedLogPoints.map((p) => p.distance).filter((d): d is number => d !== null);
        const minLogDistance = validLogDistances.length > 0 ? Math.min(...validLogDistances) : 0;
        const maxLogDistance = validLogDistances.length > 0 ? Math.max(...validLogDistances) : 10;
        const logDistanceRange = Math.max(maxLogDistance - minLogDistance, 0.5);

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
            minLogDepth,
            maxLogDepth,
            logDepthRange,
            minLogTemp,
            maxLogTemp,
            logTempRange,
            minLogAltitude,
            maxLogAltitude,
            logAltitudeRange,
            minLogDistance,
            maxLogDistance,
            logDistanceRange,
            hasData: isLogMode ? computedLogPoints.length > 0 : hasPoints,
            hasLogData: computedLogPoints.length > 0,
        };
    }, [points, computedLogPoints, videoTimeline, propTotalDuration, isLogMode]);

    const svgWidth = 1000;
    const svgHeight = 280;
    const padding = { top: 28, right: 35, bottom: 45, left: 65 };
    const innerWidth = svgWidth - padding.left - padding.right;
    const innerHeight = svgHeight - padding.top - padding.bottom;

    const getTrajectoryCoords = useCallback(
        (point: ComputedTelemetryPoint) => {
            if (!chartData) return { x: 0, y: 0 };
            const { minTime, timeRange, maxDistance } = chartData;

            const nx = (point.relativeTime - minTime) / timeRange;
            const x = padding.left + Math.max(0, Math.min(1, nx)) * innerWidth;

            const ny = point.distanceTravelled / maxDistance;
            const y = padding.top + (1 - Math.max(0, Math.min(1, ny))) * innerHeight;
            return { x, y };
        },
        [chartData, innerWidth, innerHeight, padding.left, padding.top]
    );

    const getLogCoords = useCallback(
        (point: ComputedLogPoint) => {
            if (!chartData) return { x: 0, y: 0 };
            const {
                minTime,
                timeRange,
                minLogDepth,
                logDepthRange,
                minLogTemp,
                logTempRange,
                minLogAltitude,
                logAltitudeRange,
                minLogDistance,
                logDistanceRange,
            } = chartData;

            const nx = (point.relativeTime - minTime) / timeRange;
            const x = padding.left + Math.max(0, Math.min(1, nx)) * innerWidth;

            let ny = 0;
            if (chartMode === "log_depth") {
                const val = point.depth !== null ? point.depth : minLogDepth;
                ny = (val - minLogDepth) / logDepthRange;
                const y = padding.top + Math.max(0, Math.min(1, ny)) * innerHeight;
                return { x, y };
            } else if (chartMode === "log_temperature") {
                const val = point.temperature !== null ? point.temperature : minLogTemp;
                ny = (val - minLogTemp) / logTempRange;
                const y = padding.top + (1 - Math.max(0, Math.min(1, ny))) * innerHeight;
                return { x, y };
            } else if (chartMode === "log_sonar_altitude") {
                const val = point.altitude !== null ? point.altitude : minLogAltitude;
                ny = (val - minLogAltitude) / logAltitudeRange;
                const y = padding.top + (1 - Math.max(0, Math.min(1, ny))) * innerHeight;
                return { x, y };
            } else if (chartMode === "log_sonar_front") {
                const val = point.distance !== null ? point.distance : minLogDistance;
                ny = (val - minLogDistance) / logDistanceRange;
                const y = padding.top + (1 - Math.max(0, Math.min(1, ny))) * innerHeight;
                return { x, y };
            }
            return { x, y: padding.top + innerHeight };
        },
        [chartData, chartMode, innerWidth, innerHeight, padding.left, padding.top]
    );

    // Helper to find matching point in points array from activeSyncPoint
    const findMatchingTelemetryIndex = useCallback(
        (syncPt: TrajectorySyncPoint | null, pts: ComputedTelemetryPoint[]): number | null => {
            if (!syncPt || !pts || pts.length === 0) return null;

            // 1. Direct ID match
            if (syncPt.id) {
                const idx = pts.findIndex((p) => p.id === syncPt.id);
                if (idx !== -1) return idx;
            }

            // 2. Direct filename match
            if (syncPt.filename) {
                const idx = pts.findIndex((p) => p.filename && p.filename === syncPt.filename);
                if (idx !== -1) return idx;
            }

            // 3. Exact or close timestamp match (within 500ms)
            if (syncPt.timestamp) {
                let closestIdx = -1;
                let minDiff = Infinity;
                for (let i = 0; i < pts.length; i++) {
                    if (pts[i].timestamp) {
                        const diff = Math.abs(pts[i].timestamp - syncPt.timestamp);
                        if (diff < minDiff && diff < 500) {
                            minDiff = diff;
                            closestIdx = i;
                        }
                    }
                }
                if (closestIdx !== -1) return closestIdx;
            }

            // 4. Position match in 3D space
            if (syncPt.x !== undefined && syncPt.y !== undefined && syncPt.z !== undefined) {
                let closestIdx = -1;
                let minDist = Infinity;
                for (let i = 0; i < pts.length; i++) {
                    const p = pts[i];
                    const dist = Math.hypot(p.x - syncPt.x, p.y - syncPt.y, p.z - syncPt.z);
                    if (dist < minDist) {
                        minDist = dist;
                        closestIdx = i;
                    }
                }
                if (closestIdx !== -1 && minDist < 0.1) return closestIdx;
            }

            // 5. Match by relativeTime
            if (typeof syncPt.relativeTime === "number") {
                let closestIdx = -1;
                let minDiff = Infinity;
                for (let i = 0; i < pts.length; i++) {
                    const diff = Math.abs(pts[i].relativeTime - syncPt.relativeTime);
                    if (diff < minDiff) {
                        minDiff = diff;
                        closestIdx = i;
                    }
                }
                if (closestIdx !== -1 && minDiff < 0.5) return closestIdx;
            }

            // 6. If syncSource is NOT "3d" and index is in bounds, fallback to index
            if (syncSource !== "3d" && typeof syncPt.index === "number" && syncPt.index >= 0 && syncPt.index < pts.length) {
                return syncPt.index;
            }

            return null;
        },
        [syncSource]
    );

    const effectiveActiveIndex = useMemo(() => {
        if (syncSource === "3d" && activeSyncPoint && points && points.length > 0) {
            const matched = findMatchingTelemetryIndex(activeSyncPoint, points);
            if (matched !== null) return matched;
        }
        return activeIndex;
    }, [syncSource, activeSyncPoint, points, activeIndex, findMatchingTelemetryIndex]);

    // Keep parent activeIndex in sync whenever 3D camera waypoint is selected
    useEffect(() => {
        if (!activeSyncPoint || syncSource !== "3d" || !points || points.length === 0) return;
        const matchedIdx = findMatchingTelemetryIndex(activeSyncPoint, points);
        if (matchedIdx !== null && matchedIdx !== activeIndex) {
            onSelectIndex(matchedIdx);
            const pt = points[matchedIdx];
            if (onSeekTime && pt) {
                const vidIdx = pt.videoIndex ?? currentVideoIndex ?? 0;
                const vidTime = pt.videoTime !== undefined ? pt.videoTime : pt.relativeTime;
                onSeekTime(vidTime, vidIdx, pt.relativeTime);
            }
        }
    }, [
        activeSyncPoint,
        syncSource,
        points,
        activeIndex,
        onSelectIndex,
        onSeekTime,
        currentVideoIndex,
        findMatchingTelemetryIndex,
    ]);

    const activeTime = useMemo(() => {
        const effIdx = effectiveActiveIndex !== null ? effectiveActiveIndex : activeIndex;
        if (effIdx !== null && points && points[effIdx]) {
            return points[effIdx].relativeTime;
        }
        if (activeSyncPoint && typeof activeSyncPoint.relativeTime === "number") {
            return activeSyncPoint.relativeTime;
        }
        if (activeSyncPoint && typeof activeSyncPoint.videoTime === "number") {
            const vIdx = activeSyncPoint.videoIndex ?? 0;
            const vOffset = videoTimeline?.offsets[vIdx] ?? 0;
            return vOffset + activeSyncPoint.videoTime;
        }
        return null;
    }, [effectiveActiveIndex, activeIndex, points, activeSyncPoint, videoTimeline]);

    const activeLogIndex = useMemo(() => {
        if (!computedLogPoints || computedLogPoints.length === 0 || activeTime === null) return null;
        let closestIdx = -1;
        let minDiff = Infinity;
        for (let i = 0; i < computedLogPoints.length; i++) {
            const diff = Math.abs(computedLogPoints[i].relativeTime - activeTime);
            if (diff < minDiff) {
                minDiff = diff;
                closestIdx = i;
            }
        }
        return closestIdx !== -1 ? closestIdx : null;
    }, [computedLogPoints, activeTime]);

    // Memoize paths separately so they don't recompute on every animation frame
    const { linePath, areaPath } = useMemo(() => {
        if (isLogMode) {
            const validLogPointsWithCoords = computedLogPoints
                .filter((p) => {
                    if (chartMode === "log_depth") return p.depth !== null;
                    if (chartMode === "log_temperature") return p.temperature !== null;
                    if (chartMode === "log_sonar_altitude") return p.altitude !== null;
                    if (chartMode === "log_sonar_front") return p.distance !== null;
                    return false;
                })
                .map((p) => ({ pt: p, coord: getLogCoords(p) }))
                .filter((item) => Number.isFinite(item.coord.x) && Number.isFinite(item.coord.y));

            if (validLogPointsWithCoords.length === 0) return { linePath: "", areaPath: "" };

            const segments: Array<Array<{ x: number; y: number }>> = [];
            let currentSegment: Array<{ x: number; y: number }> = [];

            for (let i = 0; i < validLogPointsWithCoords.length; i++) {
                const { pt, coord } = validLogPointsWithCoords[i];

                if (currentSegment.length > 0) {
                    const prevPt = validLogPointsWithCoords[i - 1].pt;
                    const isSame =
                        (prevPt.videoIndex === undefined || pt.videoIndex === undefined || prevPt.videoIndex === pt.videoIndex) &&
                        (!prevPt.raw?.batch_id || !pt.raw?.batch_id || prevPt.raw.batch_id === pt.raw.batch_id);

                    if (!isSame) {
                        segments.push(currentSegment);
                        currentSegment = [];
                    }
                }
                currentSegment.push(coord);
            }
            if (currentSegment.length > 0) {
                segments.push(currentSegment);
            }

            const baselineY = padding.top + innerHeight;
            let lPath = "";
            let aPath = "";

            for (const seg of segments) {
                if (seg.length === 0) continue;
                let segLine = `M ${seg[0].x.toFixed(2)} ${seg[0].y.toFixed(2)}`;
                for (let j = 1; j < seg.length; j++) {
                    segLine += ` L ${seg[j].x.toFixed(2)} ${seg[j].y.toFixed(2)}`;
                }
                const segArea = `${segLine} L ${seg[seg.length - 1].x.toFixed(2)} ${baselineY.toFixed(2)} L ${seg[0].x.toFixed(2)} ${baselineY.toFixed(2)} Z`;
                lPath += (lPath ? " " : "") + segLine;
                aPath += (aPath ? " " : "") + segArea;
            }

            return { linePath: lPath, areaPath: aPath };
        }

        const validPointsWithCoords = points
            .map((p) => ({ pt: p, coord: getTrajectoryCoords(p) }))
            .filter((item) => Number.isFinite(item.coord.x) && Number.isFinite(item.coord.y));

        if (validPointsWithCoords.length === 0) return { linePath: "", areaPath: "" };

        const segments: Array<Array<{ x: number; y: number }>> = [];
        let currentSegment: Array<{ x: number; y: number }> = [];

        for (let i = 0; i < validPointsWithCoords.length; i++) {
            const { pt, coord } = validPointsWithCoords[i];

            if (currentSegment.length > 0) {
                const prevPt = validPointsWithCoords[i - 1].pt;
                const prevId = prevPt.pointCloudId ?? (prevPt.reconstructionIndex !== undefined ? `recon_${prevPt.reconstructionIndex}` : null);
                const currId = pt.pointCloudId ?? (pt.reconstructionIndex !== undefined ? `recon_${pt.reconstructionIndex}` : null);

                let isSame = true;
                if (prevId !== null && currId !== null) {
                    isSame = prevId === currId;
                } else if (prevPt.videoIndex !== undefined && pt.videoIndex !== undefined) {
                    isSame = prevPt.videoIndex === pt.videoIndex;
                }

                if (!isSame) {
                    segments.push(currentSegment);
                    currentSegment = [];
                }
            }
            currentSegment.push(coord);
        }
        if (currentSegment.length > 0) {
            segments.push(currentSegment);
        }

        const baselineY = padding.top + innerHeight;
        let lPath = "";
        let aPath = "";

        for (const seg of segments) {
            if (seg.length === 0) continue;
            let segLine = `M ${seg[0].x.toFixed(2)} ${seg[0].y.toFixed(2)}`;
            for (let j = 1; j < seg.length; j++) {
                segLine += ` L ${seg[j].x.toFixed(2)} ${seg[j].y.toFixed(2)}`;
            }
            const segArea = `${segLine} L ${seg[seg.length - 1].x.toFixed(2)} ${baselineY.toFixed(2)} L ${seg[0].x.toFixed(2)} ${baselineY.toFixed(2)} Z`;
            lPath += (lPath ? " " : "") + segLine;
            aPath += (aPath ? " " : "") + segArea;
        }

        return { linePath: lPath, areaPath: aPath };
    }, [
        isLogMode,
        points,
        computedLogPoints,
        chartMode,
        getTrajectoryCoords,
        getLogCoords,
        padding.top,
        innerHeight,
    ]);

    // Active coordinate on the curve synced continuously with activeTime / activeIndex
    const activeCoord = useMemo<{ x: number; y: number } | null>(() => {
        if (!chartData) return null;

        if (isLogMode) {
            if (activeTime === null) return null;
            const validPoints = computedLogPoints.filter((p) => {
                if (chartMode === "log_depth") return p.depth !== null;
                if (chartMode === "log_temperature") return p.temperature !== null;
                if (chartMode === "log_sonar_altitude") return p.altitude !== null;
                if (chartMode === "log_sonar_front") return p.distance !== null;
                return false;
            });
            if (validPoints.length === 0) return null;

            const getPointVal = (p: ComputedLogPoint): number | null => {
                if (chartMode === "log_depth") return p.depth;
                if (chartMode === "log_temperature") return p.temperature;
                if (chartMode === "log_sonar_altitude") return p.altitude;
                if (chartMode === "log_sonar_front") return p.distance;
                return null;
            };

            let activeVal: number | null = null;
            if (activeTime <= validPoints[0].relativeTime) {
                activeVal = getPointVal(validPoints[0]);
            } else if (activeTime >= validPoints[validPoints.length - 1].relativeTime) {
                activeVal = getPointVal(validPoints[validPoints.length - 1]);
            } else {
                let low = 0;
                let high = validPoints.length - 1;
                while (low <= high) {
                    const mid = Math.floor((low + high) / 2);
                    if (validPoints[mid].relativeTime <= activeTime) {
                        low = mid + 1;
                    } else {
                        high = mid - 1;
                    }
                }
                const idxA = Math.max(0, high);
                const idxB = Math.min(validPoints.length - 1, low);
                const pA = validPoints[idxA];
                const pB = validPoints[idxB];
                const valA = getPointVal(pA);
                const valB = getPointVal(pB);

                if (valA !== null && valB !== null) {
                    if (pB.relativeTime === pA.relativeTime) {
                        activeVal = valA;
                    } else {
                        const t = (activeTime - pA.relativeTime) / (pB.relativeTime - pA.relativeTime);
                        activeVal = valA + t * (valB - valA);
                    }
                }
            }

            if (activeVal !== null) {
                const nx = (activeTime - chartData.minTime) / chartData.timeRange;
                if (nx >= 0 && nx <= 1) {
                    const x = padding.left + nx * innerWidth;
                    let y: number;
                    if (chartMode === "log_depth") {
                        const ny = (activeVal - chartData.minLogDepth) / chartData.logDepthRange;
                        y = padding.top + Math.max(0, Math.min(1, ny)) * innerHeight;
                    } else if (chartMode === "log_temperature") {
                        const ny = (activeVal - chartData.minLogTemp) / chartData.logTempRange;
                        y = padding.top + (1 - Math.max(0, Math.min(1, ny))) * innerHeight;
                    } else if (chartMode === "log_sonar_altitude") {
                        const ny = (activeVal - chartData.minLogAltitude) / chartData.logAltitudeRange;
                        y = padding.top + (1 - Math.max(0, Math.min(1, ny))) * innerHeight;
                    } else {
                        const ny = (activeVal - chartData.minLogDistance) / chartData.logDistanceRange;
                        y = padding.top + (1 - Math.max(0, Math.min(1, ny))) * innerHeight;
                    }
                    return { x, y };
                }
            }
            return null;
        }

        // Trajectory mode: smoothly interpolate activeCoord along the curve at activeTime
        if (activeTime !== null && points && points.length > 0) {
            const nx = (activeTime - chartData.minTime) / chartData.timeRange;
            if (nx >= 0 && nx <= 1) {
                const x = padding.left + nx * innerWidth;
                let activeVal = 0;
                if (activeTime <= points[0].relativeTime) {
                    activeVal = points[0].distanceTravelled;
                } else if (activeTime >= points[points.length - 1].relativeTime) {
                    const lastPt = points[points.length - 1];
                    activeVal = lastPt.distanceTravelled;
                } else {
                    let low = 0;
                    let high = points.length - 1;
                    while (low <= high) {
                        const mid = Math.floor((low + high) / 2);
                        if (points[mid].relativeTime <= activeTime) {
                            low = mid + 1;
                        } else {
                            high = mid - 1;
                        }
                    }
                    const idxA = Math.max(0, high);
                    const idxB = Math.min(points.length - 1, low);
                    const pA = points[idxA];
                    const pB = points[idxB];
                    const valA = pA.distanceTravelled;
                    const valB = pB.distanceTravelled;
                    if (pB.relativeTime === pA.relativeTime) {
                        activeVal = valA;
                    } else {
                        const t = (activeTime - pA.relativeTime) / (pB.relativeTime - pA.relativeTime);
                        activeVal = valA + t * (valB - valA);
                    }
                }
                const maxVal = chartData.maxDistance;
                const ny = maxVal > 0 ? activeVal / maxVal : 0;
                const y = padding.top + (1 - Math.max(0, Math.min(1, ny))) * innerHeight;
                return { x, y };
            }
        }

        const effIdx = effectiveActiveIndex !== null ? effectiveActiveIndex : activeIndex;
        if (effIdx !== null && points && points[effIdx]) {
            return getTrajectoryCoords(points[effIdx]);
        }

        return null;
    }, [
        isLogMode,
        activeTime,
        activeIndex,
        effectiveActiveIndex,
        chartData,
        chartMode,
        computedLogPoints,
        points,
        padding.top,
        padding.left,
        innerHeight,
        innerWidth,
        getTrajectoryCoords,
    ]);

    // Hovered coordinate
    const hoveredCoord = useMemo<{ x: number; y: number } | null>(() => {
        if (isLogMode) {
            return hoveredLogIndex !== null && computedLogPoints[hoveredLogIndex]
                ? getLogCoords(computedLogPoints[hoveredLogIndex])
                : null;
        }
        return hoveredIndex !== null && points && points[hoveredIndex]
            ? getTrajectoryCoords(points[hoveredIndex])
            : null;
    }, [isLogMode, hoveredLogIndex, hoveredIndex, computedLogPoints, points, getLogCoords, getTrajectoryCoords]);

    const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
        if (!chartData) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const clientX = e.clientX - rect.left;
        const svgX = (clientX / rect.width) * svgWidth;

        if (isLogMode) {
            let closestIdx = -1;
            let minDiff = Infinity;
            if (computedLogPoints && computedLogPoints.length > 0) {
                computedLogPoints.forEach((p, idx) => {
                    const { x } = getLogCoords(p);
                    const diff = Math.abs(x - svgX);
                    if (diff < minDiff) {
                        minDiff = diff;
                        closestIdx = idx;
                    }
                });
            }

            if (closestIdx !== -1 && minDiff < 40) {
                setHoveredLogIndex(closestIdx);
            } else {
                setHoveredLogIndex(null);
            }
            return;
        }

        let closestIdx = -1;
        let minDiff = Infinity;
        if (points && points.length > 0) {
            points.forEach((p, idx) => {
                const { x } = getTrajectoryCoords(p);
                const diff = Math.abs(x - svgX);
                if (diff < minDiff) {
                    minDiff = diff;
                    closestIdx = idx;
                }
            });
        }

        if (closestIdx !== -1 && minDiff < 30) {
            onHoverIndex(closestIdx);
        } else {
            onHoverIndex(null);
        }
    };

    const handleMouseLeave = () => {
        if (isLogMode) {
            setHoveredLogIndex(null);
        } else {
            onHoverIndex(null);
        }
    };

    const activeTrajectoryIndex = useMemo(() => {
        const effIdx = effectiveActiveIndex !== null ? effectiveActiveIndex : activeIndex;
        if (effIdx !== null) return effIdx;
        if (!points || points.length === 0 || activeTime === null) return null;
        let closestIdx = -1;
        let minDiff = Infinity;
        for (let i = 0; i < points.length; i++) {
            const diff = Math.abs(points[i].relativeTime - activeTime);
            if (diff < minDiff) {
                minDiff = diff;
                closestIdx = i;
            }
        }
        return closestIdx !== -1 ? closestIdx : null;
    }, [effectiveActiveIndex, activeIndex, points, activeTime]);

    // Keep activeTabValues in sync with activeIndex / activeTrajectoryIndex / activeLogIndex
    useEffect(() => {
        const trajIdx = effectiveActiveIndex !== null ? effectiveActiveIndex : (activeIndex !== null ? activeIndex : activeTrajectoryIndex);
        const trajPt =
            trajIdx !== null && points && points[trajIdx]
                ? points[trajIdx]
                : points && points.length > 0
                ? points[0]
                : null;

        let logPt: ComputedLogPoint | null = null;
        if (activeLogIndex !== null && computedLogPoints[activeLogIndex]) {
            logPt = computedLogPoints[activeLogIndex];
        } else if (computedLogPoints.length > 0) {
            if (trajPt) {
                let closestIdx = 0;
                let minDiff = Infinity;
                for (let i = 0; i < computedLogPoints.length; i++) {
                    const diff = Math.abs(computedLogPoints[i].relativeTime - trajPt.relativeTime);
                    if (diff < minDiff) {
                        minDiff = diff;
                        closestIdx = i;
                    }
                }
                logPt = computedLogPoints[closestIdx];
            } else {
                logPt = computedLogPoints[0];
            }
        }

        const logDepth = logPt?.depth ?? trajPt?.depth ?? null;
        const logTemp = logPt?.temperature ?? null;
        const sonarAltitude = logPt?.altitude ?? null;
        const sonarFront = logPt?.distance ?? null;
        const distance = trajPt?.distanceTravelled ?? null;

        useTrajectoryLogSync.getState().setActiveTabValues({
            logDepth,
            logTemp,
            sonarAltitude,
            sonarFront,
            distance,
        });
    }, [activeIndex, activeTrajectoryIndex, activeLogIndex, computedLogPoints, points]);

    const handleClick = (e: React.MouseEvent<SVGSVGElement>) => {
        e.stopPropagation();
        const rect = e.currentTarget.getBoundingClientRect();
        const clientX = e.clientX - rect.left;
        const svgX = (clientX / rect.width) * svgWidth;

        if (!chartData) return;

        // Calculate time at clicked horizontal coordinate
        const clickedRatio = Math.max(0, Math.min(1, (svgX - padding.left) / innerWidth));
        const clickedTime = chartData.minTime + clickedRatio * chartData.timeRange;

        // Determine target video index and time within that video
        let targetVidIdx = 0;
        let timeWithinVid = clickedTime;
        if (videoTimeline && videoTimeline.offsets.length > 0) {
            for (let i = 0; i < videoTimeline.offsets.length; i++) {
                const start = videoTimeline.offsets[i];
                const dur = videoTimeline.durations[i];
                if (clickedTime >= start && clickedTime < start + dur) {
                    const sortedVid = sortedVideos[i];
                    const origIdx = videos ? videos.indexOf(sortedVid) : i;
                    targetVidIdx = origIdx !== -1 ? origIdx : i;
                    timeWithinVid = clickedTime - start;
                    break;
                }
                if (i === videoTimeline.offsets.length - 1 && clickedTime >= start) {
                    const sortedVid = sortedVideos[i];
                    const origIdx = videos ? videos.indexOf(sortedVid) : i;
                    targetVidIdx = origIdx !== -1 ? origIdx : i;
                    timeWithinVid = Math.min(dur, clickedTime - start);
                }
            }
        }

        // Helper to find exact camera-position in points at target time if one exists
        const findExactCameraPoint = (relT: number, vidT: number, vidIdx: number, rawTs?: number) => {
            if (!points || points.length === 0) return null;
            for (let i = 0; i < points.length; i++) {
                const p = points[i];
                if (typeof rawTs === "number" && typeof p.timestamp === "number" && rawTs > 1e8 && p.timestamp > 1e8) {
                    const pMs = p.timestamp > 1e11 ? p.timestamp : p.timestamp * 1000;
                    const rMs = rawTs > 1e11 ? rawTs : rawTs * 1000;
                    if (Math.abs(pMs - rMs) < 50) {
                        return { point: p, index: i };
                    }
                }
                if (typeof p.videoIndex === "number" && typeof vidIdx === "number") {
                    if (p.videoIndex !== vidIdx) {
                        continue;
                    }
                    if (typeof p.videoTime === "number") {
                        if (Math.abs(p.videoTime - vidT) < 0.05) {
                            return { point: p, index: i };
                        }
                        continue;
                    }
                }
                if (Math.abs(p.relativeTime - relT) < 0.05) {
                    return { point: p, index: i };
                }
            }
            return null;
        };

        // Case 1: Hovering a specific log point in log mode
        if (isLogMode && hoveredLogIndex !== null && computedLogPoints[hoveredLogIndex]) {
            const pt = computedLogPoints[hoveredLogIndex];
            const ptVidIdx = pt.videoIndex !== undefined ? pt.videoIndex : targetVidIdx;
            const ptVidTime = pt.videoTime !== undefined ? pt.videoTime : timeWithinVid;
            const exactMatch = findExactCameraPoint(pt.relativeTime, ptVidTime, ptVidIdx, pt.raw?.timestamp);

            if (exactMatch) {
                onSelectIndex(exactMatch.index);
                if (onSeekTime) {
                    onSeekTime(ptVidTime, ptVidIdx, pt.relativeTime);
                }
                useTrajectoryLogSync.getState().selectPoint(
                    {
                        id: exactMatch.point.id,
                        index: exactMatch.point.index,
                        relativeTime: pt.relativeTime,
                        videoTime: ptVidTime,
                        videoIndex: ptVidIdx,
                        frameNumber: exactMatch.point.frameNumber,
                        filename: exactMatch.point.filename,
                        x: exactMatch.point.x,
                        y: exactMatch.point.y,
                        z: exactMatch.point.z,
                        rotation: exactMatch.point.rotation,
                        direction: exactMatch.point.direction,
                        cameraHeaderId: exactMatch.point.cameraHeaderId || exactMatch.point.id,
                    },
                    "chart"
                );
            } else {
                if (onSeekTime) {
                    onSeekTime(ptVidTime, ptVidIdx, pt.relativeTime);
                }
                useTrajectoryLogSync.getState().selectPoint(
                    {
                        relativeTime: pt.relativeTime,
                        videoTime: ptVidTime,
                        videoIndex: ptVidIdx,
                    },
                    "chart"
                );
            }
            return;
        }

        // Case 2: Hovering a specific trajectory point in trajectory mode
        if (!isLogMode && hoveredIndex !== null && points[hoveredIndex]) {
            const pt = points[hoveredIndex];
            onSelectIndex(hoveredIndex);
            const ptVidIdx = pt.videoIndex !== undefined ? pt.videoIndex : targetVidIdx;
            const ptVidTime = pt.videoTime !== undefined ? pt.videoTime : pt.relativeTime;
            if (onSeekTime) {
                onSeekTime(ptVidTime, ptVidIdx, pt.relativeTime);
            }
            useTrajectoryLogSync.getState().selectPoint(
                {
                    id: pt.id,
                    index: pt.index,
                    relativeTime: pt.relativeTime,
                    videoTime: ptVidTime,
                    videoIndex: ptVidIdx,
                    frameNumber: pt.frameNumber,
                    filename: pt.filename,
                    x: pt.x,
                    y: pt.y,
                    z: pt.z,
                    rotation: pt.rotation,
                    direction: pt.direction,
                    cameraHeaderId: pt.cameraHeaderId || pt.id,
                },
                "chart"
            );
            return;
        }

        // Case 3: Clicked anywhere on the timeline / chart curve
        const exactMatch = findExactCameraPoint(clickedTime, timeWithinVid, targetVidIdx);
        if (exactMatch) {
            onSelectIndex(exactMatch.index);
            if (onSeekTime) {
                onSeekTime(timeWithinVid, targetVidIdx, clickedTime);
            }
            useTrajectoryLogSync.getState().selectPoint(
                {
                    id: exactMatch.point.id,
                    index: exactMatch.point.index,
                    relativeTime: clickedTime,
                    videoTime: timeWithinVid,
                    videoIndex: targetVidIdx,
                    frameNumber: exactMatch.point.frameNumber,
                    filename: exactMatch.point.filename,
                    x: exactMatch.point.x,
                    y: exactMatch.point.y,
                    z: exactMatch.point.z,
                    rotation: exactMatch.point.rotation,
                    direction: exactMatch.point.direction,
                    cameraHeaderId: exactMatch.point.cameraHeaderId || exactMatch.point.id,
                },
                "chart"
            );
        } else {
            if (onSeekTime) {
                onSeekTime(timeWithinVid, targetVidIdx, clickedTime);
            }
            useTrajectoryLogSync.getState().selectPoint(
                {
                    relativeTime: clickedTime,
                    videoTime: timeWithinVid,
                    videoIndex: targetVidIdx,
                },
                "chart"
            );
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
                        className={`logs-chart-tab ${chartMode === "log_depth" ? "active" : ""}`}
                        onClick={() => setChartMode("log_depth")}
                    >
                        <FiDroplet size={12} style={{ marginRight: 4 }} />
                        Depth
                    </button>
                    <button
                        className={`logs-chart-tab ${chartMode === "log_temperature" ? "active" : ""}`}
                        onClick={() => setChartMode("log_temperature")}
                    >
                        <FiThermometer size={12} style={{ marginRight: 4 }} />
                        Temp
                    </button>
                    <button
                        className={`logs-chart-tab ${chartMode === "log_sonar_altitude" ? "active" : ""}`}
                        onClick={() => setChartMode("log_sonar_altitude")}
                    >
                        <FiRadio size={12} style={{ marginRight: 4 }} />
                        Sonar Altitude
                    </button>
                    <button
                        className={`logs-chart-tab ${chartMode === "log_sonar_front" ? "active" : ""}`}
                        onClick={() => setChartMode("log_sonar_front")}
                    >
                        <FiTarget size={12} style={{ marginRight: 4 }} />
                        Sonar Front
                    </button>
                    <button
                        className={`logs-chart-tab ${chartMode === "distance" ? "active" : ""}`}
                        onClick={() => setChartMode("distance")}
                    >
                        <FiNavigation size={12} style={{ marginRight: 4 }} />
                        Calculated Distance
                    </button>
                </div>
            </div>

            <div className="logs-svg-wrapper">
                {isLogMode && loadingLogs ? (
                    <div className="logs-chart-empty">Loading log data from server...</div>
                ) : isLogMode && (!logData || logData.length === 0) ? (
                    <div className="logs-chart-empty">
                        {logsError || (!resolvedBatchId ? "No batch associated to fetch log data" : "No log data available for this batch / timerange")}
                    </div>
                ) : (!isLogMode && (!points || points.length === 0) && (!videoTimeline || videoTimeline.totalDuration <= 0)) ? (
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

                            <linearGradient id="logDepthGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.45" />
                                <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.02" />
                            </linearGradient>

                            <linearGradient id="logTempGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#f97316" stopOpacity="0.45" />
                                <stop offset="100%" stopColor="#f97316" stopOpacity="0.02" />
                            </linearGradient>

                            <linearGradient id="sonarAltitudeGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.45" />
                                <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.02" />
                            </linearGradient>

                            <linearGradient id="sonarFrontGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#10b981" stopOpacity="0.45" />
                                <stop offset="100%" stopColor="#10b981" stopOpacity="0.02" />
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
                            if (chartData && (isLogMode ? chartData.hasLogData : chartData.hasData)) {
                                if (chartMode === "distance") {
                                    const val = ratio * chartData.maxDistance;
                                    label = `${val.toFixed(1)}m`;
                                } else if (chartMode === "log_depth") {
                                    // Oceanographic: top is min (shallowest), bottom is max (deepest)
                                    const val = chartData.maxLogDepth - ratio * chartData.logDepthRange;
                                    label = `${val.toFixed(1)}m`;
                                } else if (chartMode === "log_temperature") {
                                    // Temperature: top is max (warmest), bottom is min (coolest)
                                    const val = chartData.minLogTemp + ratio * chartData.logTempRange;
                                    label = `${val.toFixed(1)}°C`;
                                } else if (chartMode === "log_sonar_altitude") {
                                    const val = chartData.minLogAltitude + ratio * chartData.logAltitudeRange;
                                    label = `${val.toFixed(1)}m`;
                                } else if (chartMode === "log_sonar_front") {
                                    const val = chartData.minLogDistance + ratio * chartData.logDistanceRange;
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

                        {/* Filled Area */}
                        {areaPath && (
                            <path
                                d={areaPath}
                                fill={
                                    chartMode === "distance"
                                        ? "url(#distGradient)"
                                        : chartMode === "log_depth"
                                        ? "url(#logDepthGradient)"
                                        : chartMode === "log_temperature"
                                        ? "url(#logTempGradient)"
                                        : chartMode === "log_sonar_altitude"
                                        ? "url(#sonarAltitudeGradient)"
                                        : "url(#sonarFrontGradient)"
                                }
                            />
                        )}

                        {/* Line Path */}
                        {linePath && (
                            <path
                                d={linePath}
                                fill="none"
                                stroke={
                                    chartMode === "distance"
                                        ? "#c084fc"
                                        : chartMode === "log_depth"
                                        ? "#22d3ee"
                                        : chartMode === "log_temperature"
                                        ? "#fb923c"
                                        : chartMode === "log_sonar_altitude"
                                        ? "#60a5fa"
                                        : "#34d399"
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

                        {/* Active Point Circle */}
                        {activeCoord && Number.isFinite(activeCoord.x) && Number.isFinite(activeCoord.y) && (
                            <circle
                                cx={activeCoord.x}
                                cy={activeCoord.y}
                                r="6"
                                className="logs-point-active"
                            />
                        )}

                        {/* Hovered Point Circle */}
                        {hoveredCoord && Number.isFinite(hoveredCoord.x) && Number.isFinite(hoveredCoord.y) && (
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
                if (isLogMode) {
                    const targetLogIdx = hoveredLogIndex !== null ? hoveredLogIndex : activeLogIndex;
                    if (targetLogIdx === null || !computedLogPoints[targetLogIdx]) return null;
                    const pt = computedLogPoints[targetLogIdx];
                    const formatTime = (t?: number) => {
                        if (t === undefined || !Number.isFinite(t)) return "00:00";
                        const mins = Math.floor(t / 60);
                        const secs = Math.floor(t % 60);
                        return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
                    };

                    return (
                        <div className="logs-chart-tooltip">
                            <div className="logs-tooltip-item">
                                <span className="logs-tooltip-label">Log:</span>
                                <span className="logs-tooltip-val">#{pt.index + 1}</span>
                            </div>
                            {typeof pt.videoIndex === "number" && (
                                <div className="logs-tooltip-item">
                                    <span className="logs-tooltip-label">Video:</span>
                                    <span className="logs-tooltip-val">Part {pt.videoIndex + 1} ({formatTime(pt.videoTime)})</span>
                                </div>
                            )}
                            {chartMode === "log_depth" && typeof pt.depth === "number" && (
                                <div className="logs-tooltip-item">
                                    <span className="logs-tooltip-label">Depth:</span>
                                    <span className="logs-tooltip-val" style={{ color: "#22d3ee" }}>{pt.depth.toFixed(2)}m</span>
                                </div>
                            )}
                            {chartMode === "log_temperature" && typeof pt.temperature === "number" && (
                                <div className="logs-tooltip-item">
                                    <span className="logs-tooltip-label">Temp:</span>
                                    <span className="logs-tooltip-val" style={{ color: "#fb923c" }}>{pt.temperature.toFixed(2)}°C</span>
                                </div>
                            )}
                            {chartMode === "log_sonar_altitude" && typeof pt.altitude === "number" && (
                                <div className="logs-tooltip-item">
                                    <span className="logs-tooltip-label">Sonar Alt:</span>
                                    <span className="logs-tooltip-val" style={{ color: "#60a5fa" }}>{pt.altitude.toFixed(2)}m</span>
                                </div>
                            )}
                            {chartMode === "log_sonar_front" && typeof pt.distance === "number" && (
                                <div className="logs-tooltip-item">
                                    <span className="logs-tooltip-label">Sonar Front:</span>
                                    <span className="logs-tooltip-val" style={{ color: "#34d399" }}>{pt.distance.toFixed(2)}m</span>
                                </div>
                            )}
                            {typeof pt.raw.payload?.yaw === "number" && (
                                <div className="logs-tooltip-item">
                                    <span className="logs-tooltip-label">Yaw:</span>
                                    <span className="logs-tooltip-val">{pt.raw.payload.yaw.toFixed(1)}°</span>
                                </div>
                            )}
                            <div className="logs-tooltip-item" style={{ marginLeft: "auto", color: "#38bdf8", opacity: 0.85 }}>
                                <span>Click to jump video</span>
                            </div>
                        </div>
                    );
                }

                const targetIdx = hoveredIndex !== null ? hoveredIndex : (effectiveActiveIndex !== null ? effectiveActiveIndex : activeTrajectoryIndex);
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
                            <span className="logs-tooltip-label">Calculated Distance:</span>
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
