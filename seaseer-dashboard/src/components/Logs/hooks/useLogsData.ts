import { useState, useEffect, useMemo, useCallback } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { listPointclouds, getCameraRoutes } from "../../../client";
import type { PointCloudMetadataResponse, CameraFrameResponse } from "../../../client";
import type { PointCloudOption, ComputedTelemetryPoint, MissionSummary, VideoItem } from "../types";

export function useLogsData() {
    const location = useLocation();
    const isLogsPage = location.pathname.startsWith("/logs");
    const [searchParams, setSearchParams] = useSearchParams();
    const mapParam = isLogsPage ? searchParams.get("map") : null;

    const [maps, setMaps] = useState<PointCloudOption[]>([]);
    const [selectedMapId, setSelectedMapId] = useState<string | null>(mapParam);
    const [loadingMaps, setLoadingMaps] = useState<boolean>(true);

    const [rawFrames, setRawFrames] = useState<CameraFrameResponse[]>([]);
    const [loadingFrames, setLoadingFrames] = useState<boolean>(false);
    const [videos, setVideos] = useState<VideoItem[]>([]);
    const [loadingVideos, setLoadingVideos] = useState<boolean>(false);
    const [reloadKey, setReloadKey] = useState<number>(0);
    const [error, setError] = useState<string | null>(null);

    const apiBaseUrl = import.meta.env.VITE_API_URL || "http://localhost:8000";

    const [activeIndex, setActiveIndex] = useState<number | null>(null);
    const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

    const fetchMaps = useCallback(async () => {
        setLoadingMaps(true);
        setError(null);
        try {
            const res = await listPointclouds();
            const data = res.data || [];
            const parsedMaps: PointCloudOption[] = (data as PointCloudMetadataResponse[])
                .filter((item) => typeof item === "object" && item.id)
                .map((item) => ({
                    id: item.id,
                    name: item.orig_filename || item.safe_filename || item.id,
                    safe_filename: item.safe_filename,
                    number_of_points: item.number_of_points || 0,
                    created_at: item.created_at || new Date().toISOString(),
                    min_x: item.min_x,
                    max_x: item.max_x,
                    min_y: item.min_y,
                    max_y: item.max_y,
                    min_z: item.min_z,
                    max_z: item.max_z,
                    center: item.center as [number, number, number] | undefined,
                }));

            setMaps(parsedMaps);

            if (isLogsPage && mapParam) {
                const matched = parsedMaps.find((m) => m.id === mapParam || m.name === mapParam);
                setSelectedMapId(matched ? matched.id : mapParam);
            }
        } catch (err: any) {
            console.error("Failed to load point cloud maps:", err);
            setError("Failed to load available maps from server.");
        } finally {
            setLoadingMaps(false);
        }
    }, [isLogsPage, mapParam]);

    useEffect(() => {
        fetchMaps();
    }, [fetchMaps]);

    const selectMap = useCallback(
        (id: string | null) => {
            setSelectedMapId(id);
            if (isLogsPage) {
                if (id) {
                    setSearchParams({ map: id }, { replace: true });
                } else {
                    setSearchParams({}, { replace: true });
                }
            }
            setActiveIndex(null);
            setHoveredIndex(null);
        },
        [isLogsPage, setSearchParams]
    );

    useEffect(() => {
        if (!selectedMapId) {
            setRawFrames([]);
            setVideos([]);
            setActiveIndex(null);
            setLoadingFrames(false);
            setLoadingVideos(false);
            return;
        }

        let isCancelled = false;
        setLoadingFrames(true);
        setLoadingVideos(true);
        setError(null);

        async function load() {
            try {
                const [routesRes, videosRes] = await Promise.allSettled([
                    getCameraRoutes({
                        path: { identifier: selectedMapId! },
                    }),
                    fetch(`${apiBaseUrl}/videos/by-pointcloud/${selectedMapId}`),
                ]);

                if (isCancelled) return;

                if (routesRes.status === "fulfilled") {
                    const frames = (routesRes.value.data || []) as CameraFrameResponse[];
                    setRawFrames(frames);
                    if (frames.length > 0) {
                        setActiveIndex(0);
                    } else {
                        setActiveIndex(null);
                    }
                } else {
                    console.error("Failed to fetch camera routes for map:", routesRes.reason);
                    setError("Failed to fetch trajectory for this map.");
                    setRawFrames([]);
                    setActiveIndex(null);
                }

                if (videosRes.status === "fulfilled" && videosRes.value.ok) {
                    const vData = await videosRes.value.json();
                    const list: VideoItem[] = Array.isArray(vData) ? vData : vData ? [vData] : [];
                    const sorted = [...list].sort((a, b) => {
                        const tA = new Date(a.video_start_at).getTime();
                        const tB = new Date(b.video_start_at).getTime();
                        if (!isNaN(tA) && !isNaN(tB) && Math.abs(tA - tB) > 5000) {
                            return tA - tB;
                        }
                        const nameA = a.upload_metadata?.orig_filename || a.upload_metadata?.safe_filename || a.id;
                        const nameB = b.upload_metadata?.orig_filename || b.upload_metadata?.safe_filename || b.id;
                        return nameA.localeCompare(nameB, undefined, { numeric: true });
                    });
                    setVideos(sorted);
                } else {
                    setVideos([]);
                }
            } catch (err) {
                if (!isCancelled) {
                    console.error("Error loading point cloud routes and videos:", err);
                    setRawFrames([]);
                    setVideos([]);
                }
            } finally {
                if (!isCancelled) {
                    setLoadingFrames(false);
                    setLoadingVideos(false);
                }
            }
        }

        load();

        return () => {
            isCancelled = true;
        };
    }, [selectedMapId, reloadKey, apiBaseUrl]);

    const activeMap = useMemo(
        () => maps.find((m) => m.id === selectedMapId),
        [maps, selectedMapId]
    );

    const telemetryPoints = useMemo<ComputedTelemetryPoint[]>(() => {
        if (!rawFrames || rawFrames.length === 0) return [];

        const sortedVideos = [...videos];

        // Duration of each video in seconds
        const getVideoDuration = (v: VideoItem): number => {
            if (typeof v.duration === "number" && v.duration > 0) {
                return v.duration;
            }
            const s = new Date(v.video_start_at).getTime();
            const e = new Date(v.video_stop_at).getTime();
            if (!isNaN(s) && !isNaN(e) && e > s) {
                return (e - s) / 1000.0;
            }
            return 180.0; // Standard fallback duration
        };

        const durations = sortedVideos.map(getVideoDuration);
        const cumulativeStartOffsets: number[] = [];
        let runningOffset = 0;
        for (let i = 0; i < sortedVideos.length; i++) {
            cumulativeStartOffsets.push(runningOffset);
            runningOffset += durations[i];
        }

        // Extract frame numbers from filenames (e.g. image_00160.png -> 160)
        const frameNumbers = rawFrames.map((f, i) => {
            if (f.filename) {
                const m = f.filename.match(/\d+/);
                if (m) {
                    const parsed = parseInt(m[0], 10);
                    if (!isNaN(parsed)) return parsed;
                }
            }
            return i + 1;
        });

        const minFrameNum = Math.min(...frameNumbers);
        const maxFrameNum = Math.max(...frameNumbers);

        // Detect total frame capacity from dataset name if present (e.g. dataset_..._f2000_b50.laz)
        let totalCapacity = Math.max(maxFrameNum, rawFrames.length);
        const datasetNameMatch = (activeMap?.name || selectedMapId || "").match(/_f(\d+)_/);
        if (datasetNameMatch) {
            const parsedCapacity = parseInt(datasetNameMatch[1], 10);
            if (!isNaN(parsedCapacity) && parsedCapacity > 0) {
                totalCapacity = parsedCapacity;
            }
        }

        // Check if video start/stop timestamp ranges directly cover frame timestamps
        const hasValidTimestamps = rawFrames.some((f) => f.timestamp > 1e8);
        const canUseTimestampRanges =
            hasValidTimestamps &&
            sortedVideos.some((v) => {
                const s = new Date(v.video_start_at).getTime();
                const e = new Date(v.video_stop_at).getTime();
                return !isNaN(s) && !isNaN(e) && e > s + 1000;
            });

        let cumulativeDist = 0;
        const result: ComputedTelemetryPoint[] = [];

        for (let i = 0; i < rawFrames.length; i++) {
            const frame = rawFrames[i];
            const pos = frame.position && frame.position.length === 3 ? frame.position : [0, 0, 0];
            const x = pos[0];
            const y = pos[1];
            const z = pos[2];
            const frameNum = frameNumbers[i];

            let videoIndex: number | undefined = undefined;
            let videoTime: number | undefined = undefined;
            let relTime = 0;

            const frameMs = frame.timestamp > 1e11 ? frame.timestamp : frame.timestamp * 1000;

            if (sortedVideos.length > 0) {
                if (canUseTimestampRanges && frameMs > 1e8) {
                    // Match by video start/stop timestamp range
                    const matchedIdx = sortedVideos.findIndex((v) => {
                        const sMs = new Date(v.video_start_at).getTime();
                        const eMs = new Date(v.video_stop_at).getTime();
                        return frameMs >= sMs - 1000 && frameMs <= eMs + 1000;
                    });

                    if (matchedIdx !== -1) {
                        videoIndex = matchedIdx;
                        const targetVideo = sortedVideos[matchedIdx];
                        const vStartMs = new Date(targetVideo.video_start_at).getTime();
                        const offsetSec = Math.max(0, (frameMs - vStartMs) / 1000.0);
                        videoTime = Math.min(offsetSec, durations[videoIndex]);
                        relTime = cumulativeStartOffsets[videoIndex] + videoTime;
                    }
                }

                // If not matched by timestamp range (e.g. timestamps are 0 or out of bounds):
                if (videoIndex === undefined) {
                    if (sortedVideos.length === 1) {
                        videoIndex = 0;
                        const vDur = durations[0];
                        if (frame.relative_time !== null && frame.relative_time !== undefined && frame.relative_time > 0) {
                            videoTime = Math.min(frame.relative_time, vDur);
                            relTime = frame.relative_time;
                        } else {
                            const ratio = (frameNum - minFrameNum) / Math.max(1, maxFrameNum - minFrameNum);
                            videoTime = Math.min(vDur, Math.max(0, ratio * vDur));
                            relTime = videoTime;
                        }
                    } else {
                        // Multi-video sequence: partition frames proportionally across videos
                        const framesPerVideo = Math.max(1, totalCapacity / sortedVideos.length);
                        const calculatedVideoIdx = Math.min(
                            sortedVideos.length - 1,
                            Math.max(0, Math.floor((frameNum - 1) / framesPerVideo))
                        );
                        videoIndex = calculatedVideoIdx;
                        const localFrameOffset = Math.max(0, (frameNum - 1) - videoIndex * framesPerVideo);
                        const localProgress = Math.min(1, Math.max(0, localFrameOffset / framesPerVideo));
                        const vDur = durations[videoIndex];
                        videoTime = Math.min(vDur, Math.max(0, localProgress * vDur));
                        relTime = cumulativeStartOffsets[videoIndex] + videoTime;
                    }
                }
            } else {
                // No video files linked
                if (frame.relative_time !== null && frame.relative_time !== undefined) {
                    relTime = Math.max(0, frame.relative_time);
                } else {
                    relTime = i * 0.1;
                }
            }

            // Wall clock time
            let wallClockTime: string | undefined = undefined;
            if (frame.timestamp > 1e8) {
                const d = new Date(frameMs);
                if (!isNaN(d.getTime())) {
                    wallClockTime = d.toISOString().substring(11, 23);
                }
            }

            // Physical speed and distance
            let speed = 0;
            if (i > 0) {
                const prev = result[i - 1];
                const dx = x - prev.x;
                const dy = y - prev.y;
                const dz = z - prev.z;
                const stepDist = Math.sqrt(dx * dx + dy * dy + dz * dz);
                cumulativeDist += stepDist;

                const dt = relTime - prev.relativeTime;
                if (dt > 0.0001) {
                    speed = stepDist / dt;
                }
            }

            result.push({
                index: i,
                id: frame.id,
                timestamp: frame.timestamp,
                relativeTime: Math.max(0, relTime),
                videoTime,
                videoIndex,
                frameNumber: frameNum,
                wallClockTime,
                x,
                y,
                z,
                depth: Math.abs(z), // in meters
                distanceTravelled: cumulativeDist, // cumulative meters
                speed, // meters per second
                direction: (frame.direction && frame.direction.length === 3) ? (frame.direction as [number, number, number]) : undefined,
                rotation: (frame.rotation && frame.rotation.length === 4) ? (frame.rotation as [number, number, number, number]) : undefined,
                filename: frame.filename,
                cameraHeaderId: frame.camera_header_id,
            });
        }

        return result;
    }, [rawFrames, videos, activeMap, selectedMapId]);

    const summary = useMemo<MissionSummary | null>(() => {
        if (!activeMap) return null;

        const totalFrames = telemetryPoints.length;
        if (totalFrames === 0) {
            return {
                mapId: activeMap.id,
                mapName: activeMap.name,
                totalPoints: activeMap.number_of_points,
                totalFrames: 0,
                durationSeconds: 0,
                totalDistanceMeters: 0,
                minDepth: 0,
                maxDepth: 0,
                avgDepth: 0,
                avgSpeed: 0,
                maxSpeed: 0,
                extentX: (activeMap.max_x ?? 0) - (activeMap.min_x ?? 0),
                extentY: (activeMap.max_y ?? 0) - (activeMap.min_y ?? 0),
                extentZ: (activeMap.max_z ?? 0) - (activeMap.min_z ?? 0),
                boundingVolumeM3: 0,
                netDisplacementMeters: 0,
            };
        }

        const depths = telemetryPoints.map((p) => p.depth);
        const speeds = telemetryPoints.map((p) => p.speed);
        const minDepth = Math.min(...depths);
        const maxDepth = Math.max(...depths);
        const avgDepth = depths.reduce((a, b) => a + b, 0) / depths.length;
        const totalDist = telemetryPoints[telemetryPoints.length - 1].distanceTravelled;
        const duration = telemetryPoints[telemetryPoints.length - 1].relativeTime - telemetryPoints[0].relativeTime;
        const maxSpeed = Math.max(...speeds);
        const avgSpeed = duration > 0 ? totalDist / duration : 0;

        const firstP = telemetryPoints[0];
        const lastP = telemetryPoints[telemetryPoints.length - 1];

        const extentX = Math.abs((activeMap.max_x ?? 0) - (activeMap.min_x ?? 0));
        const extentY = Math.abs((activeMap.max_y ?? 0) - (activeMap.min_y ?? 0));
        const extentZ = Math.abs((activeMap.max_z ?? 0) - (activeMap.min_z ?? 0));
        const boundingVolumeM3 = extentX * extentY * extentZ;

        const netDisplacementMeters = Math.sqrt(
            Math.pow(lastP.x - firstP.x, 2) +
            Math.pow(lastP.y - firstP.y, 2) +
            Math.pow(lastP.z - firstP.z, 2)
        );

        return {
            mapId: activeMap.id,
            mapName: activeMap.name,
            totalPoints: activeMap.number_of_points,
            totalFrames,
            durationSeconds: Math.max(0, duration),
            startFrame: firstP.frameNumber,
            endFrame: lastP.frameNumber,
            startVideoTime: firstP.videoTime,
            endVideoTime: lastP.videoTime,
            startTimeIso: firstP.wallClockTime,
            endTimeIso: lastP.wallClockTime,
            totalDistanceMeters: totalDist,
            minDepth,
            maxDepth,
            avgDepth,
            avgSpeed,
            maxSpeed,
            extentX,
            extentY,
            extentZ,
            boundingVolumeM3,
            netDisplacementMeters,
        };
    }, [activeMap, telemetryPoints]);

    const activePoint = useMemo(
        () => (activeIndex !== null && telemetryPoints[activeIndex] ? telemetryPoints[activeIndex] : null),
        [activeIndex, telemetryPoints]
    );

    const hoveredPoint = useMemo(
        () => (hoveredIndex !== null && telemetryPoints[hoveredIndex] ? telemetryPoints[hoveredIndex] : null),
        [hoveredIndex, telemetryPoints]
    );

    const refetch = useCallback(() => {
        fetchMaps();
        setReloadKey((prev) => prev + 1);
    }, [fetchMaps]);

    return {
        maps,
        activeMap,
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
        hoveredPoint,
        refetch,
    };
}
