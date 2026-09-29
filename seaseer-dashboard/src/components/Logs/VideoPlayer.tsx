import React, { useRef, useState, useEffect, useCallback } from "react";
import {
    FiPlay,
    FiPause,
    FiRotateCcw,
    FiMaximize2,
    FiVolume2,
    FiVolumeX,
    FiVideo,
    FiVideoOff,
    FiCheckCircle,
    FiSkipBack,
    FiSkipForward,
} from "react-icons/fi";
import { useTrajectoryLogSync } from "./hooks";
import type { ComputedTelemetryPoint, VideoItem } from "./types";

export interface VideoPlayerProps {
    pointCloudId?: string | null;
    telemetryPoints?: ComputedTelemetryPoint[];
    onPointSelect?: (index: number) => void;
    videos?: VideoItem[];
    currentVideoIndex?: number;
    onVideoEnded?: () => void;
    onSelectVideoIndex?: (index: number) => void;
    autoPlayNext?: boolean;
    loadingVideos?: boolean;
}

function findClosestPointIndex(points: ComputedTelemetryPoint[], t: number): number {
    if (!points || points.length === 0) return -1;
    if (points.length === 1) return 0;

    const hasVideoTime = points.some((p) => p.videoTime !== undefined);
    const getTime = (p: ComputedTelemetryPoint) =>
        hasVideoTime && p.videoTime !== undefined ? p.videoTime : p.relativeTime;

    // Check boundary conditions
    if (t <= getTime(points[0])) return 0;
    if (t >= getTime(points[points.length - 1])) return points.length - 1;

    let low = 0;
    let high = points.length - 1;

    while (low <= high) {
        const mid = (low + high) >> 1;
        const midTime = getTime(points[mid]);

        if (midTime === t) return mid;
        if (midTime < t) {
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }

    const p1 = Math.max(0, Math.min(points.length - 1, high));
    const p2 = Math.max(0, Math.min(points.length - 1, low));
    const diff1 = Math.abs(getTime(points[p1]) - t);
    const diff2 = Math.abs(getTime(points[p2]) - t);

    return diff1 <= diff2 ? p1 : p2;
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
    pointCloudId,
    telemetryPoints = [],
    onPointSelect,
    videos: propVideos,
    currentVideoIndex: propVideoIndex = 0,
    onVideoEnded,
    onSelectVideoIndex,
    autoPlayNext = false,
    loadingVideos: propLoadingVideos,
}) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const apiBaseUrl = import.meta.env.VITE_API_URL || "http://localhost:8000";

    // Internal state if videos are not passed as props
    const [internalVideos, setInternalVideos] = useState<VideoItem[]>([]);
    const [internalIndex, setInternalIndex] = useState<number>(0);
    const [internalLoading, setInternalLoading] = useState<boolean>(false);
    const [internalAutoPlay, setInternalAutoPlay] = useState<boolean>(false);

    const isControlled = propVideos !== undefined;
    const resolvedVideos = isControlled ? propVideos : internalVideos;
    const resolvedIndex = isControlled ? propVideoIndex : internalIndex;
    const resolvedLoading = isControlled ? (propLoadingVideos ?? false) : internalLoading;
    const resolvedAutoPlay = isControlled ? autoPlayNext : internalAutoPlay;

    const [videoSrc, setVideoSrc] = useState<string | null>(null);
    const [videoTitle, setVideoTitle] = useState<string>("Underwater Recording");
    const [isPlaying, setIsPlaying] = useState<boolean>(false);
    const [currentTime, setCurrentTime] = useState<number>(0);
    const [duration, setDuration] = useState<number>(0);
    const [isMuted, setIsMuted] = useState<boolean>(true);
    const [playbackRate, setPlaybackRate] = useState<number>(1.0);
    const [videoError, setVideoError] = useState<string | null>(null);

    const seekTimestamp = useTrajectoryLogSync((state) => state.seekTimestamp);
    const syncSource = useTrajectoryLogSync((state) => state.syncSource);
    const selectPoint = useTrajectoryLogSync((state) => state.selectPoint);

    // Fallback: Fetch video info internally if videos prop is not controlled
    useEffect(() => {
        if (isControlled) return;

        let isCancelled = false;
        setVideoError(null);

        if (!pointCloudId) {
            setInternalVideos([]);
            setInternalIndex(0);
            setInternalAutoPlay(false);
            setInternalLoading(false);
            return;
        }

        setInternalLoading(true);

        async function fetchVideos() {
            try {
                const res = await fetch(`${apiBaseUrl}/videos/by-pointcloud/${pointCloudId}`);
                if (res.ok) {
                    const data = await res.json();
                    const list: VideoItem[] = Array.isArray(data) ? data : data ? [data] : [];
                    if (!isCancelled) {
                        setInternalVideos(list);
                        setInternalIndex(0);
                        setInternalAutoPlay(false);
                    }
                } else if (!isCancelled) {
                    setInternalVideos([]);
                    setInternalIndex(0);
                }
            } catch (err) {
                console.warn("Could not load video metadata for point cloud:", err);
                if (!isCancelled) {
                    setInternalVideos([]);
                    setInternalIndex(0);
                }
            } finally {
                if (!isCancelled) setInternalLoading(false);
            }
        }

        fetchVideos();

        return () => {
            isCancelled = true;
        };
    }, [apiBaseUrl, pointCloudId, isControlled]);

    // Update active video URL and title whenever the resolved video changes
    useEffect(() => {
        setVideoError(null);

        if (!pointCloudId) {
            setVideoSrc(null);
            setVideoTitle("No Video Focused");
            setCurrentTime(0);
            setDuration(0);
            setIsPlaying(false);
            return;
        }

        const activeVideo = resolvedVideos[resolvedIndex];
        if (activeVideo) {
            const targetUrl = `${apiBaseUrl}${activeVideo.stream_url || `/videos/${activeVideo.id}/stream`}`;
            const title = activeVideo.upload_metadata?.orig_filename || `Video ${activeVideo.id.substring(0, 8)}`;
            setVideoSrc(targetUrl);
            setVideoTitle(title);
            setCurrentTime(0);
        } else if (!resolvedLoading) {
            setVideoSrc(null);
            setVideoTitle("No Video Recording Linked");
            setCurrentTime(0);
            setDuration(0);
            setIsPlaying(false);
        }
    }, [resolvedVideos, resolvedIndex, resolvedLoading, pointCloudId, apiBaseUrl]);

    // Handle auto-play when sequential playback switches to the next video
    useEffect(() => {
        if (resolvedAutoPlay && videoRef.current && videoSrc) {
            const playPromise = videoRef.current.play();
            if (playPromise !== undefined) {
                playPromise
                    .then(() => setIsPlaying(true))
                    .catch((err) => {
                        console.warn("Autoplay next video interrupted:", err);
                        setIsPlaying(false);
                    });
            }
        }
    }, [videoSrc, resolvedAutoPlay]);

    // Synchronize video seeking when triggered from 3D or Chart
    useEffect(() => {
        if (seekTimestamp !== null && syncSource !== "video" && videoRef.current) {
            const video = videoRef.current;
            if (Number.isFinite(seekTimestamp) && seekTimestamp >= 0) {
                const maxT = video.duration || 10000;
                const clamped = Math.min(Math.max(0, seekTimestamp), maxT);
                video.currentTime = clamped;
                setCurrentTime(clamped);
            }
        }
    }, [seekTimestamp, syncSource]);

    // Reference to track last active index and prevent redundant dispatches
    const lastActiveIdxRef = useRef<number | null>(null);

    // Reset cached index when telemetryPoints changes
    useEffect(() => {
        lastActiveIdxRef.current = null;
    }, [telemetryPoints]);

    const syncPointAtTime = useCallback(
        (timeSec: number) => {
            if (!telemetryPoints || telemetryPoints.length === 0) return;
            const closestIdx = findClosestPointIndex(telemetryPoints, timeSec);
            if (closestIdx !== -1 && closestIdx !== lastActiveIdxRef.current) {
                lastActiveIdxRef.current = closestIdx;
                if (onPointSelect) {
                    onPointSelect(closestIdx);
                }
                const closest = telemetryPoints[closestIdx];
                if (closest) {
                    selectPoint(
                        {
                            id: closest.id,
                            index: closest.index,
                            relativeTime: closest.relativeTime,
                            videoTime: closest.videoTime,
                            frameNumber: closest.frameNumber,
                            filename: closest.filename,
                            x: closest.x,
                            y: closest.y,
                            z: closest.z,
                            rotation: closest.rotation,
                            direction: closest.direction,
                        },
                        "video"
                    );
                }
            }
        },
        [telemetryPoints, onPointSelect, selectPoint]
    );

    // Continuous smooth synchronization while video is playing
    useEffect(() => {
        if (!isPlaying) return;

        let animId: number;
        const tick = () => {
            if (videoRef.current && !videoRef.current.paused) {
                const cur = videoRef.current.currentTime;
                setCurrentTime(cur);
                syncPointAtTime(cur);
            }
            animId = requestAnimationFrame(tick);
        };

        animId = requestAnimationFrame(tick);
        return () => {
            cancelAnimationFrame(animId);
        };
    }, [isPlaying, syncPointAtTime]);

    // Handle user scrubbing slider
    const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = parseFloat(e.target.value);
        setCurrentTime(val);
        if (videoRef.current) {
            videoRef.current.currentTime = val;
        }
        syncPointAtTime(val);
    };

    const togglePlay = useCallback(() => {
        if (!videoRef.current) return;
        if (isPlaying) {
            videoRef.current.pause();
            setIsPlaying(false);
        } else {
            videoRef.current.play().catch(() => {});
            setIsPlaying(true);
        }
    }, [isPlaying]);

    const handleTimeUpdate = () => {
        if (!videoRef.current) return;
        const cur = videoRef.current.currentTime;
        setCurrentTime(cur);
        syncPointAtTime(cur);
    };

    const handleLoadedMetadata = () => {
        if (!videoRef.current) return;
        setDuration(videoRef.current.duration || 0);
    };

    const toggleMute = () => {
        if (!videoRef.current) return;
        videoRef.current.muted = !isMuted;
        setIsMuted(!isMuted);
    };

    const cyclePlaybackRate = () => {
        const rates = [0.5, 1.0, 1.5, 2.0];
        const nextIdx = (rates.indexOf(playbackRate) + 1) % rates.length;
        const nextRate = rates[nextIdx];
        setPlaybackRate(nextRate);
        if (videoRef.current) {
            videoRef.current.playbackRate = nextRate;
        }
    };

    const toggleFullscreen = () => {
        if (!videoRef.current) return;
        if (document.fullscreenElement) {
            document.exitFullscreen().catch(() => {});
        } else {
            videoRef.current.requestFullscreen().catch(() => {});
        }
    };

    const formatTime = (t: number) => {
        if (!Number.isFinite(t)) return "00:00";
        const mins = Math.floor(t / 60);
        const secs = Math.floor(t % 60);
        return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
    };

    const currentFrame = Math.floor(currentTime * 25);

    const handleEnded = () => {
        setIsPlaying(false);
        if (onVideoEnded) {
            onVideoEnded();
        } else if (resolvedVideos.length > 1 && resolvedIndex < resolvedVideos.length - 1) {
            setInternalIndex((prev) => prev + 1);
            setInternalAutoPlay(true);
        }
    };

    return (
        <div className="logs-video-player-container">
            {/* Header Badge */}
            <div className="logs-video-header">
                <div className="logs-video-title-group">
                    <FiVideo className="logs-video-icon" />
                    <span className="logs-video-title" title={videoTitle}>
                        {videoTitle}
                    </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {resolvedVideos.length > 1 && (
                        <div className="logs-video-seq-badge" title="Sequential Playback">
                            <span>Part {resolvedIndex + 1}/{resolvedVideos.length}</span>
                        </div>
                    )}
                    {videoSrc ? (
                        <div className="logs-video-badge">
                            <FiCheckCircle size={11} style={{ color: "#34d399", marginRight: 4 }} />
                            <span>HTTP 206 Stream</span>
                        </div>
                    ) : (
                        <div className="logs-video-badge logs-badge-standby">
                            <span>{pointCloudId ? "No Stream" : "Standby"}</span>
                        </div>
                    )}
                </div>
            </div>

            {/* Video Canvas Container */}
            <div className="logs-video-viewport" onClick={videoSrc ? togglePlay : undefined}>
                {videoSrc && (
                    <video
                        ref={videoRef}
                        src={videoSrc}
                        className="logs-video-element"
                        muted={isMuted}
                        playsInline
                        preload="metadata"
                        onTimeUpdate={handleTimeUpdate}
                        onLoadedMetadata={handleLoadedMetadata}
                        onPlay={() => setIsPlaying(true)}
                        onPause={() => setIsPlaying(false)}
                        onEnded={handleEnded}
                        onError={() => setVideoError("Stream loading failed")}
                    />
                )}

                {!videoSrc && !resolvedLoading && (
                    <div className="logs-video-standby">
                        <FiVideoOff className="logs-video-standby-icon" size={32} />
                        <span className="logs-video-standby-title">
                            {pointCloudId ? "No Video Recording Linked" : "No Video Focused"}
                        </span>
                        <span className="logs-video-standby-desc">
                            {pointCloudId
                                ? "No video stream is associated with this point cloud"
                                : "Select or focus a trajectory / point cloud to view recording"}
                        </span>
                    </div>
                )}

                {resolvedLoading && (
                    <div className="logs-video-overlay">
                        <div className="logs-spinner" />
                        <span>Loading Stream...</span>
                    </div>
                )}

                {videoError && (
                    <div className="logs-video-overlay error">
                        <span>{videoError}</span>
                    </div>
                )}

                {/* Big Center Play Overlay when paused and videoSrc exists */}
                {videoSrc && !isPlaying && !resolvedLoading && !videoError && (
                    <div className="logs-video-play-overlay">
                        <div className="logs-video-play-button">
                            <FiPlay size={22} style={{ marginLeft: 3 }} />
                        </div>
                    </div>
                )}
            </div>

            {/* Scrubber Progress Bar */}
            <div className="logs-video-scrub-bar">
                <input
                    type="range"
                    min={0}
                    max={duration || 100}
                    step={0.04}
                    value={videoSrc ? currentTime : 0}
                    onChange={handleSliderChange}
                    disabled={!videoSrc}
                    className="logs-video-slider"
                />
            </div>

            {/* Controls Bar */}
            <div className="logs-video-controls">
                <div className="logs-video-controls-left">
                    {resolvedVideos.length > 1 && (
                        <button
                            type="button"
                            className="logs-video-btn"
                            onClick={() => {
                                if (onSelectVideoIndex && resolvedIndex > 0) {
                                    onSelectVideoIndex(resolvedIndex - 1);
                                } else if (!isControlled && resolvedIndex > 0) {
                                    setInternalIndex(resolvedIndex - 1);
                                    setInternalAutoPlay(true);
                                }
                            }}
                            disabled={resolvedIndex === 0 && currentTime <= 3}
                            title="Previous Video in Sequence"
                        >
                            <FiSkipBack size={13} />
                        </button>
                    )}

                    <button
                        type="button"
                        className="logs-video-btn"
                        onClick={togglePlay}
                        disabled={!videoSrc}
                        title={isPlaying ? "Pause" : "Play"}
                    >
                        {isPlaying ? <FiPause size={15} /> : <FiPlay size={15} />}
                    </button>

                    {resolvedVideos.length > 1 && (
                        <button
                            type="button"
                            className="logs-video-btn"
                            onClick={() => {
                                if (onSelectVideoIndex && resolvedIndex < resolvedVideos.length - 1) {
                                    onSelectVideoIndex(resolvedIndex + 1);
                                } else if (!isControlled && resolvedIndex < resolvedVideos.length - 1) {
                                    setInternalIndex(resolvedIndex + 1);
                                    setInternalAutoPlay(true);
                                }
                            }}
                            disabled={resolvedIndex >= resolvedVideos.length - 1}
                            title="Next Video in Sequence"
                        >
                            <FiSkipForward size={13} />
                        </button>
                    )}

                    <button
                        type="button"
                        className="logs-video-btn"
                        onClick={() => {
                            if (videoRef.current) {
                                videoRef.current.currentTime = 0;
                                setCurrentTime(0);
                                syncPointAtTime(0);
                            }
                        }}
                        disabled={!videoSrc}
                        title="Restart Video"
                    >
                        <FiRotateCcw size={13} />
                    </button>

                    <button
                        type="button"
                        className="logs-video-btn"
                        onClick={toggleMute}
                        disabled={!videoSrc}
                        title={isMuted ? "Unmute" : "Mute"}
                    >
                        {isMuted ? <FiVolumeX size={14} /> : <FiVolume2 size={14} />}
                    </button>

                    <div className="logs-video-time">
                        <span className="logs-video-time-cur">
                            {videoSrc ? formatTime(currentTime) : "--:--"}
                        </span>
                        <span className="logs-video-time-div">/</span>
                        <span className="logs-video-time-dur">
                            {videoSrc ? formatTime(duration) : "--:--"}
                        </span>
                    </div>
                </div>

                <div className="logs-video-controls-right">
                    <span className="logs-video-frame-badge">
                        Frame #{videoSrc ? currentFrame : "--"}
                    </span>

                    <button
                        type="button"
                        className="logs-video-rate-btn"
                        onClick={cyclePlaybackRate}
                        disabled={!videoSrc}
                        title="Playback Rate"
                    >
                        {playbackRate}x
                    </button>

                    <button
                        type="button"
                        className="logs-video-btn"
                        onClick={toggleFullscreen}
                        disabled={!videoSrc}
                        title="Fullscreen"
                    >
                        <FiMaximize2 size={13} />
                    </button>
                </div>
            </div>
        </div>
    );
};
