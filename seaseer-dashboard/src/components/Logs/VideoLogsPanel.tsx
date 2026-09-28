import React, { useEffect, useCallback } from "react";
import { FiAlertCircle } from "react-icons/fi";
import { VideoPlayer } from "./VideoPlayer";
import { LogsSummaryCards } from "./LogsSummaryCards";
import { LogsCharts } from "./LogsCharts";
import { usePLYPointCloudContext } from "../PointCloudPanel/PLYPointCloudContext";
import { useLogsData, useTrajectoryLogSync, useRoverFocus } from "./hooks";

import "./LogsPage.css";
import "./VideoLogsPanel.css";

export const VideoLogsPanel: React.FC = () => {
    const {
        maps,
        selectedMapId,
        selectMap,
        loadingMaps,
        loadingFrames,
        error,
        telemetryPoints,
        summary,
        activeIndex,
        setActiveIndex,
        hoveredIndex,
        setHoveredIndex,
        activePoint,
        refetch,
    } = useLogsData();

    const plyContext = usePLYPointCloudContext();
    const { focusOnRover } = useRoverFocus();
    const activeSyncPoint = useTrajectoryLogSync((state) => state.activePoint);
    const syncSource = useTrajectoryLogSync((state) => state.syncSource);
    const focusedTrajectoryId = useTrajectoryLogSync((state) => state.focusedTrajectoryId);

    // Sync active point index when updated externally (from 3D map click or video playback)
    useEffect(() => {
        if (!activeSyncPoint || syncSource === "chart") return;

        // If activeSyncPoint has an index, use it directly
        if (typeof activeSyncPoint.index === "number" && activeSyncPoint.index >= 0) {
            if (activeSyncPoint.index !== activeIndex) {
                setActiveIndex(activeSyncPoint.index);
            }
            return;
        }

        // Match against telemetryPoints by id, filename, or closest relativeTime
        if (telemetryPoints.length === 0) return;
        const matchedIdx = telemetryPoints.findIndex((p) => {
            if (activeSyncPoint.id && p.id === activeSyncPoint.id) return true;
            if (activeSyncPoint.filename && p.filename === activeSyncPoint.filename) return true;
            if (typeof activeSyncPoint.relativeTime === "number") {
                return Math.abs(p.relativeTime - activeSyncPoint.relativeTime) < 0.05;
            }
            return false;
        });

        if (matchedIdx !== -1 && matchedIdx !== activeIndex) {
            setActiveIndex(matchedIdx);
        }
    }, [activeSyncPoint, syncSource, telemetryPoints, activeIndex, setActiveIndex]);

    // Automatically sync when 3D scene point cloud is selected
    useEffect(() => {
        if (plyContext?.identifier && plyContext.identifier !== selectedMapId) {
            const match = maps.find((m) => m.id === plyContext.identifier || m.name === plyContext.identifier);
            if (match) {
                selectMap(match.id);
            }
        }
    }, [plyContext?.identifier, selectedMapId, maps, selectMap]);

    // Automatically focus on trajectory/pointcloud if focused from 3D scene
    useEffect(() => {
        if (focusedTrajectoryId && focusedTrajectoryId !== selectedMapId) {
            const match = maps.find(
                (m) => m.id === focusedTrajectoryId || m.name === focusedTrajectoryId
            );
            if (match) {
                selectMap(match.id);
            }
        }
    }, [focusedTrajectoryId, selectedMapId, maps, selectMap]);

    const handleMapChange = (newId: string | null) => {
        selectMap(newId);
        if (plyContext?.selectPointcloud) {
            plyContext.selectPointcloud(newId);
        }
    };

    // When a point is selected on the chart, update chart, seek video, and focus 3D camera
    const handleChartPointSelect = useCallback(
        (index: number) => {
            setActiveIndex(index);
            const pt = telemetryPoints[index];
            if (!pt) return;

            // 1. Sync global state (source = "chart") -> seeks video & highlights 3D waypoint
            const videoTime = pt.videoTime !== undefined ? pt.videoTime : pt.relativeTime;
            useTrajectoryLogSync.getState().selectPoint(
                {
                    id: pt.id,
                    index: pt.index,
                    relativeTime: pt.relativeTime,
                    videoTime,
                    frameNumber: pt.frameNumber,
                    filename: pt.filename,
                    x: pt.x,
                    y: pt.y,
                    z: pt.z,
                    rotation: pt.rotation,
                    direction: pt.direction,
                    cameraHeaderId: pt.cameraHeaderId || pt.id,
                    pointCloudId: selectedMapId || undefined,
                },
                "chart"
            );

            // 2. Focus 3D camera on rover at that position using the EXACT same hook!
            focusOnRover(pt);
        },
        [telemetryPoints, setActiveIndex, selectedMapId, focusOnRover]
    );

    return (
        <div className="video-logs-panel">
            {/* Top Toolbar: Map/Dataset Selector */}
            <div className="video-logs-toolbar">
                <div className="video-logs-select-row">
                    <select
                        className="video-logs-select"
                        value={selectedMapId || ""}
                        onChange={(e) => handleMapChange(e.target.value || null)}
                        disabled={loadingMaps}
                    >
                        <option value="">-- No dataset focused --</option>
                        {maps.map((m) => (
                            <option key={m.id} value={m.id}>
                                {m.name} ({m.number_of_points ? (m.number_of_points / 1000000).toFixed(1) + "M pts" : "Dataset"})
                            </option>
                        ))}
                    </select>

                    <button
                        type="button"
                        className="video-logs-refresh-btn"
                        onClick={refetch}
                        disabled={loadingMaps || loadingFrames}
                        title="Reload Telemetry & Video"
                    >
                        ↻
                    </button>
                </div>
            </div>

            {error && (
                <div className="logs-alert-banner" style={{ margin: "0 0 6px 0", padding: "6px 10px" }}>
                    <FiAlertCircle size={14} />
                    <span style={{ fontSize: "11px" }}>{error}</span>
                </div>
            )}

            {/* Top: Video Player */}
            <VideoPlayer
                pointCloudId={selectedMapId}
                telemetryPoints={telemetryPoints}
                onPointSelect={setActiveIndex}
            />

            {/* Summary KPI Cards */}
            <div className="video-logs-summary-wrapper">
                <LogsSummaryCards summary={summary} activePoint={activePoint} />
            </div>

            {/* Trajectory & Dive Profile Charts */}
            <div className="video-logs-charts-wrapper">
                <LogsCharts
                    points={telemetryPoints}
                    activeIndex={activeIndex}
                    hoveredIndex={hoveredIndex}
                    onSelectIndex={handleChartPointSelect}
                    onHoverIndex={setHoveredIndex}
                />
            </div>
        </div>
    );
};
