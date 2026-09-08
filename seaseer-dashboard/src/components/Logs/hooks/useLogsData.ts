import { useState, useEffect, useMemo, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { listPointclouds, getCameraRoutes } from "../../../client";
import type { PointCloudMetadataResponse, CameraFrameResponse } from "../../../client";
import type { PointCloudOption, ComputedTelemetryPoint, MissionSummary } from "../types";

export function useLogsData() {
    const [searchParams, setSearchParams] = useSearchParams();
    const mapParam = searchParams.get("map");

    const [maps, setMaps] = useState<PointCloudOption[]>([]);
    const [selectedMapId, setSelectedMapId] = useState<string | null>(mapParam);
    const [loadingMaps, setLoadingMaps] = useState<boolean>(true);

    const [rawFrames, setRawFrames] = useState<CameraFrameResponse[]>([]);
    const [loadingFrames, setLoadingFrames] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);

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

            if (parsedMaps.length > 0 && mapParam) {
                const matched = parsedMaps.find((m) => m.id === mapParam || m.name === mapParam);
                if (matched) {
                    setSelectedMapId(matched.id);
                } else {
                    setSelectedMapId(null);
                }
            } else if (!mapParam) {
                // If no mapParam in URL, keep whatever was already focused or remain null
                setSelectedMapId((prev) => (prev && parsedMaps.some((m) => m.id === prev) ? prev : null));
            } else {
                setSelectedMapId(null);
            }
        } catch (err: any) {
            console.error("Failed to load point cloud maps:", err);
            setError("Failed to load available maps from server.");
        } finally {
            setLoadingMaps(false);
        }
    }, [mapParam, setSearchParams]);

    useEffect(() => {
        fetchMaps();
    }, [fetchMaps]);

    const selectMap = useCallback(
        (id: string | null) => {
            if (id) {
                setSelectedMapId(id);
                setSearchParams({ map: id });
            } else {
                setSelectedMapId(null);
                setSearchParams({});
            }
            setActiveIndex(null);
            setHoveredIndex(null);
        },
        [setSearchParams]
    );

    useEffect(() => {
        if (!selectedMapId) {
            setRawFrames([]);
            return;
        }

        let isCancelled = false;
        setLoadingFrames(true);
        setError(null);

        async function loadRoutes() {
            try {
                const res = await getCameraRoutes({
                    path: { identifier: selectedMapId! },
                });
                if (!isCancelled) {
                    const frames = (res.data || []) as CameraFrameResponse[];
                    setRawFrames(frames);
                    if (frames.length > 0) {
                        setActiveIndex(0);
                    } else {
                        setActiveIndex(null);
                    }
                }
            } catch (err: any) {
                if (!isCancelled) {
                    console.error("Failed to fetch camera routes for map:", err);
                    setError("Failed to fetch trajectory for this map.");
                    setRawFrames([]);
                }
            } finally {
                if (!isCancelled) {
                    setLoadingFrames(false);
                }
            }
        }

        loadRoutes();

        return () => {
            isCancelled = true;
        };
    }, [selectedMapId]);

    const telemetryPoints = useMemo<ComputedTelemetryPoint[]>(() => {
        if (!rawFrames || rawFrames.length === 0) return [];

        let cumulativeDist = 0;
        const result: ComputedTelemetryPoint[] = [];
        const baseTimestamp = rawFrames[0].timestamp || 0;
        const lastTimestamp = rawFrames[rawFrames.length - 1].timestamp || 0;

        const hasStoredRelTime = rawFrames.some(
            (f) => f.relative_time !== null && f.relative_time !== undefined && f.relative_time > 0
        );

        for (let i = 0; i < rawFrames.length; i++) {
            const frame = rawFrames[i];
            const pos = (frame.position && frame.position.length === 3) ? frame.position : [0, 0, 0];
            const x = pos[0];
            const y = pos[1];
            const z = pos[2];

            let frameNum: number | undefined = undefined;
            if (frame.filename) {
                const parts = frame.filename.replace(/\.[^/.]+$/, "").split("_");
                const lastPart = parts[parts.length - 1];
                if (lastPart && /^\d+$/.test(lastPart)) {
                    frameNum = parseInt(lastPart, 10);
                }
            }

            const videoTime = frameNum !== undefined ? frameNum / 25.0 : undefined;

            let relTime = 0;
            if (hasStoredRelTime && frame.relative_time !== null && frame.relative_time !== undefined) {
                relTime = frame.relative_time;
            } else if (lastTimestamp > baseTimestamp) {
                relTime = (frame.timestamp - baseTimestamp) / 1000.0;
            } else if (videoTime !== undefined && result.length > 0 && result[0].videoTime !== undefined) {
                relTime = videoTime - result[0].videoTime;
            } else {
                relTime = i / 25.0; // Standard 25 FPS pacing
            }

            let wallClockTime: string | undefined = undefined;
            if (frame.timestamp > 1e11) {
                const d = new Date(frame.timestamp);
                wallClockTime = d.toISOString().substring(11, 23); // HH:mm:ss.SSS
            }

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
    }, [rawFrames]);

    const activeMap = useMemo(
        () => maps.find((m) => m.id === selectedMapId),
        [maps, selectedMapId]
    );

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

    return {
        maps,
        activeMap,
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
        hoveredPoint,
        refetch: fetchMaps,
    };
}
