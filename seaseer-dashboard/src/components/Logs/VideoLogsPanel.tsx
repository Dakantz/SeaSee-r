import React, { useState, useEffect, useCallback, useRef } from "react";
import { FiAlertCircle, FiFilm, FiChevronLeft, FiChevronRight } from "react-icons/fi";
import { VideoPlayer } from "./VideoPlayer";
import { LogsSummaryCards } from "./LogsSummaryCards";
import { LogsCharts } from "./LogsCharts";
import { usePLYPointCloudContext } from "../PointCloudPanel/PLYPointCloudContext";
import { useLogsData, useTrajectoryLogSync, useRoverFocus } from "./hooks";
import { findClosestPointIndex, type ComputedTelemetryPoint } from "./types";

import "./LogsPage.css";
import "./VideoLogsPanel.css";

export const VideoLogsPanel: React.FC = () => {
    const {
        maps,
        selectedMapId,
        selectMap,
        loadingMaps,
        loadingFrames,
        loadingVideos,
        videos,
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

    // Sequential Video Playlist State
    const [currentVideoIndex, setCurrentVideoIndex] = useState<number>(0);
    const [autoPlayNext, setAutoPlayNext] = useState<boolean>(false);

    // Reset current video index when selected map changes
    useEffect(() => {
        setCurrentVideoIndex(0);
        setAutoPlayNext(false);
        useTrajectoryLogSync.getState().clearSync();
    }, [selectedMapId]);

    const handleSelectVideoIndex = useCallback((index: number, autoPlay: boolean = false) => {
        if (index >= 0 && index < videos.length) {
            setCurrentVideoIndex(index);
            setAutoPlayNext(autoPlay);
        }
    }, [videos.length]);

    // Advance to next video when current video completes
    const handleVideoEnded = useCallback(() => {
        if (currentVideoIndex < videos.length - 1) {
            handleSelectVideoIndex(currentVideoIndex + 1, true);
        } else {
            setAutoPlayNext(false);
        }
    }, [currentVideoIndex, videos.length, handleSelectVideoIndex]);

    // Sync active point index when updated externally (from 3D map click)
    useEffect(() => {
        if (!activeSyncPoint || syncSource !== "3d") return;

        // If activeSyncPoint has an index, use it directly
        if (typeof activeSyncPoint.index === "number" && activeSyncPoint.index >= 0) {
            if (activeSyncPoint.index !== activeIndex) {
                setActiveIndex(activeSyncPoint.index);
            }
            const pt = telemetryPoints[activeSyncPoint.index];
            if (pt && typeof pt.videoIndex === "number" && pt.videoIndex !== currentVideoIndex) {
                handleSelectVideoIndex(pt.videoIndex);
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
            const pt = telemetryPoints[matchedIdx];
            if (pt && typeof pt.videoIndex === "number" && pt.videoIndex !== currentVideoIndex) {
                handleSelectVideoIndex(pt.videoIndex);
            }
        }
    }, [activeSyncPoint, syncSource, telemetryPoints, activeIndex, setActiveIndex, currentVideoIndex, handleSelectVideoIndex]);

    // Automatically sync when 3D scene point cloud or query card is selected/deselected
    useEffect(() => {
        const targetId = focusedTrajectoryId || plyContext?.identifier || null;
        if (targetId !== selectedMapId) {
            const match = targetId ? maps.find((m) => m.id === targetId || m.name === targetId) : null;
            selectMap(match ? match.id : targetId);
        }
    }, [focusedTrajectoryId, plyContext?.identifier, selectedMapId, maps, selectMap]);

    const activeMap = maps.find((m) => m.id === selectedMapId);

    // Ref to track last focused point to prevent redundant setCameraView calls
    const lastFocusedPointIdRef = useRef<string | number | null>(null);

    // Whenever logs-point-active gets changed (by chart click, video playing, video changing, or scrubbing),
    // move to the associated camera position inside of the Three.js scene
    useEffect(() => {
        if (activeIndex === null || !telemetryPoints || telemetryPoints.length === 0) {
            lastFocusedPointIdRef.current = null;
            return;
        }

        const pt = telemetryPoints[activeIndex];
        if (!pt) return;

        const pointKey = pt.id || pt.index;
        if (lastFocusedPointIdRef.current === pointKey) return;
        lastFocusedPointIdRef.current = pointKey;

        focusOnRover(pt);
    }, [activeIndex, telemetryPoints, focusOnRover]);

    // When a point is selected on the chart, update chart, seek video, and focus 3D camera
    const handleChartPointSelect = useCallback(
        (index: number) => {
            setActiveIndex(index);
            const pt = telemetryPoints[index];
            if (!pt) return;

            // Switch video if this point belongs to another video part in the playlist
            if (typeof pt.videoIndex === "number" && pt.videoIndex !== currentVideoIndex) {
                handleSelectVideoIndex(pt.videoIndex);
            }

            // 1. Sync global state (source = "chart") -> seeks video & highlights 3D waypoint
            const videoTime = pt.videoTime !== undefined ? pt.videoTime : pt.relativeTime;
            useTrajectoryLogSync.getState().selectPoint(
                {
                    id: pt.id,
                    index: pt.index,
                    relativeTime: pt.relativeTime,
                    videoTime,
                    videoIndex: pt.videoIndex,
                    frameNumber: pt.frameNumber,
                    filename: pt.filename,
                    x: pt.x,
                    y: pt.y,
                    z: pt.z,
                    rotation: pt.rotation,
                    direction: pt.direction,
                    cameraHeaderId: pt.cameraHeaderId || pt.id,
                    pointCloudId: pt.pointCloudId || selectedMapId || undefined,
                    reconstructionIndex: pt.reconstructionIndex,
                },
                "chart"
            );

            // 2. Focus 3D camera on rover at that position
            lastFocusedPointIdRef.current = pt.id || pt.index;
            focusOnRover(pt);
        },
        [telemetryPoints, setActiveIndex, selectedMapId, focusOnRover, currentVideoIndex, handleSelectVideoIndex]
    );

    // When an empty section of the timeline is clicked, seek video player directly
    const handleChartSeekTime = useCallback(
        (timeSec: number, targetVideoIndex?: number, fullRelativeTime?: number) => {
            if (typeof targetVideoIndex === "number" && targetVideoIndex !== currentVideoIndex) {
                handleSelectVideoIndex(targetVideoIndex);
            }
            const relTime = typeof fullRelativeTime === "number" ? fullRelativeTime : timeSec;
            let closestPt: ComputedTelemetryPoint | undefined;
            if (telemetryPoints.length > 0) {
                const closestIdx = findClosestPointIndex(telemetryPoints, timeSec, targetVideoIndex ?? currentVideoIndex);
                if (closestIdx !== -1) {
                    setActiveIndex(closestIdx);
                    closestPt = telemetryPoints[closestIdx];
                }
            }
            useTrajectoryLogSync.getState().selectPoint(
                {
                    id: closestPt?.id,
                    index: closestPt?.index,
                    relativeTime: relTime,
                    videoTime: timeSec,
                    videoIndex: targetVideoIndex ?? currentVideoIndex,
                    pointCloudId: closestPt?.pointCloudId || selectedMapId || undefined,
                    reconstructionIndex: closestPt?.reconstructionIndex,
                },
                "chart"
            );
            if (closestPt) {
                lastFocusedPointIdRef.current = closestPt.id || closestPt.index;
                focusOnRover(closestPt);
            }
        },
        [currentVideoIndex, handleSelectVideoIndex, selectedMapId, setActiveIndex, telemetryPoints, focusOnRover]
    );

    return (
        <div className="video-logs-panel">
            {/* Top Toolbar: Active Dataset Header */}
            {selectedMapId ? (
                <div className="video-logs-toolbar">
                    <div className="video-logs-active-row">
                        <div className="video-logs-active-info">
                            <span className="video-logs-active-label">Dataset:</span>
                            <span className="video-logs-active-name" title={activeMap?.name || selectedMapId}>
                                {activeMap?.name || selectedMapId}
                            </span>
                        </div>
                        <button
                            type="button"
                            className="video-logs-refresh-btn"
                            onClick={() => refetch()}
                            disabled={loadingMaps || loadingFrames || loadingVideos}
                            title="Reload Telemetry & Video"
                        >
                            ↻
                        </button>
                    </div>
                </div>
            ) : (
                <div className="video-logs-toolbar video-logs-toolbar--empty">
                    <span className="video-logs-empty-text">
                        No dataset focused. Click <strong>Select</strong> on a query card in Custom Queries to view video & telemetry logs.
                    </span>
                </div>
            )}

            {error && (
                <div className="logs-alert-banner" style={{ margin: "0 0 6px 0", padding: "6px 10px" }}>
                    <FiAlertCircle size={14} />
                    <span style={{ fontSize: "11px" }}>{error}</span>
                </div>
            )}

            {/* Sequential Video Playlist Bar when multiple videos exist */}
            {videos.length > 1 && (
                <div className="video-logs-playlist-bar">
                    <div className="video-playlist-info">
                        <FiFilm size={12} className="video-playlist-icon" />
                        <span className="video-playlist-label">Sequence</span>
                        <span className="video-playlist-counter">
                            Part {currentVideoIndex + 1} of {videos.length}
                        </span>
                    </div>

                    <div className="video-playlist-pills">
                        {videos.map((vid, idx) => (
                            <button
                                key={vid.id}
                                type="button"
                                className={`video-playlist-pill ${idx === currentVideoIndex ? "active" : ""}`}
                                onClick={() => handleSelectVideoIndex(idx)}
                                title={`Play part ${idx + 1}: ${vid.upload_metadata?.orig_filename || vid.id}`}
                            >
                                {idx + 1}
                            </button>
                        ))}
                    </div>

                    <div className="video-playlist-nav">
                        <button
                            type="button"
                            className="video-playlist-nav-btn"
                            onClick={() => handleSelectVideoIndex(currentVideoIndex - 1)}
                            disabled={currentVideoIndex === 0}
                            title="Previous Video Part"
                        >
                            <FiChevronLeft size={13} />
                        </button>
                        <button
                            type="button"
                            className="video-playlist-nav-btn"
                            onClick={() => handleSelectVideoIndex(currentVideoIndex + 1)}
                            disabled={currentVideoIndex >= videos.length - 1}
                            title="Next Video Part"
                        >
                            <FiChevronRight size={13} />
                        </button>
                    </div>
                </div>
            )}

            {/* Top: Video Player */}
            <VideoPlayer
                pointCloudId={selectedMapId}
                telemetryPoints={telemetryPoints}
                onPointSelect={setActiveIndex}
                videos={videos}
                currentVideoIndex={currentVideoIndex}
                onVideoEnded={handleVideoEnded}
                onSelectVideoIndex={handleSelectVideoIndex}
                autoPlayNext={autoPlayNext}
                loadingVideos={loadingVideos}
            />

            {/* Summary KPI Cards */}
            <div className="video-logs-summary-wrapper">
                <LogsSummaryCards
                    summary={summary}
                    activePoint={activePoint}
                    points={telemetryPoints}
                    activeIndex={activeIndex}
                />
            </div>

            {/* Trajectory & Dive Profile Charts */}
            <div className="video-logs-charts-wrapper">
                <LogsCharts
                    points={telemetryPoints}
                    videos={videos}
                    currentVideoIndex={currentVideoIndex}
                    activeIndex={activeIndex}
                    hoveredIndex={hoveredIndex}
                    onSelectIndex={handleChartPointSelect}
                    onHoverIndex={setHoveredIndex}
                    onSeekTime={handleChartSeekTime}
                />
            </div>
        </div>
    );
};
