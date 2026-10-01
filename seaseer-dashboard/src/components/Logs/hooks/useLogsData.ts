import { useState, useEffect, useMemo, useCallback, useContext } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { listPointclouds, getCameraRoutes } from "../../../client";
import type { PointCloudMetadataResponse, CameraFrameResponse } from "../../../client";
import type { PointCloudOption, ComputedTelemetryPoint, MissionSummary, VideoItem } from "../types";
import { PLYPointCloudContext } from "../../PointCloudPanel/PLYPointCloudContext";

export interface TargetDataset {
    id: string;
    name: string;
    reconstruction_index: number;
    batch_id?: string | null;
}

export interface EnrichedCameraFrame extends CameraFrameResponse {
    pointCloudId: string;
    reconstructionIndex: number;
    pointCloudName?: string;
}

/**
 * Merge camera frames across all datasets with the same batch ID.
 * When two datasets have an overlap in timestamp, only the data from the dataset
 * with the lower Reconstruction Index is used.
 */
export function mergeFramesByReconstructionIndex(
    datasetRouteGroups: Array<{ dataset: TargetDataset; frames: CameraFrameResponse[] }>
): EnrichedCameraFrame[] {
    // 1. Sort dataset groups strictly by reconstruction_index ascending, tie-breaking by ID
    const sortedGroups = [...datasetRouteGroups].sort(
        (a, b) =>
            (a.dataset.reconstruction_index ?? 0) - (b.dataset.reconstruction_index ?? 0) ||
            a.dataset.id.localeCompare(b.dataset.id)
    );

    interface TimeInterval {
        start: number;
        end: number;
    }
    const acceptedIntervals: TimeInterval[] = [];
    const acceptedFilenames = new Set<string>();
    const acceptedExactTimestamps = new Set<number>();
    const allAcceptedFrames: EnrichedCameraFrame[] = [];

    const getFrameTimeSec = (frame: CameraFrameResponse): number => {
        if (typeof frame.timestamp === "number" && frame.timestamp > 0) {
            return frame.timestamp > 1e11
                ? frame.timestamp / 1000.0
                : frame.timestamp > 1e8
                ? frame.timestamp / 1000.0
                : frame.timestamp;
        }
        if (typeof frame.relative_time === "number" && !isNaN(frame.relative_time)) {
            return frame.relative_time;
        }
        if (frame.filename) {
            const m = frame.filename.match(/\d+/);
            if (m) {
                const parsed = parseInt(m[0], 10);
                if (!isNaN(parsed)) return parsed;
            }
        }
        return 0;
    };

    for (const group of sortedGroups) {
        const { dataset, frames } = group;
        if (!frames || frames.length === 0) continue;

        // Sort frames in this dataset chronologically
        const sortedFrames = [...frames].sort((a, b) => {
            const tA = getFrameTimeSec(a);
            const tB = getFrameTimeSec(b);
            if (tA !== tB) return tA - tB;
            return (a.filename || "").localeCompare(b.filename || "", undefined, { numeric: true });
        });

        const acceptedFromThisDataset: EnrichedCameraFrame[] = [];

        for (const frame of sortedFrames) {
            const timeSec = getFrameTimeSec(frame);
            const filename = frame.filename ? frame.filename.trim() : null;

            let isOverlapping = false;

            // 1. Filename match against lower-index dataset
            if (filename && acceptedFilenames.has(filename)) {
                isOverlapping = true;
            }

            // 2. Exact timestamp match (within 0.25s / 250ms tolerance)
            if (!isOverlapping && timeSec > 0) {
                for (const existingTime of acceptedExactTimestamps) {
                    if (Math.abs(existingTime - timeSec) < 0.25) {
                        isOverlapping = true;
                        break;
                    }
                }
            }

            // 3. Fall inside any continuous interval of lower-index dataset
            if (!isOverlapping && timeSec > 0) {
                for (const interval of acceptedIntervals) {
                    if (timeSec >= interval.start - 0.25 && timeSec <= interval.end + 0.25) {
                        isOverlapping = true;
                        break;
                    }
                }
            }

            // If not overlapping, accept the frame from this dataset
            if (!isOverlapping) {
                const enriched: EnrichedCameraFrame = {
                    ...frame,
                    pointCloudId: dataset.id,
                    reconstructionIndex: dataset.reconstruction_index ?? 0,
                    pointCloudName: dataset.name,
                };
                acceptedFromThisDataset.push(enriched);
            }
        }

        // Register accepted frames from this dataset to guard against higher reconstruction index datasets
        if (acceptedFromThisDataset.length > 0) {
            let segStart = getFrameTimeSec(acceptedFromThisDataset[0]);
            let segEnd = segStart;

            for (let i = 0; i < acceptedFromThisDataset.length; i++) {
                const f = acceptedFromThisDataset[i];
                const t = getFrameTimeSec(f);
                if (f.filename) {
                    acceptedFilenames.add(f.filename.trim());
                }
                if (t > 0) {
                    acceptedExactTimestamps.add(t);
                    if (t - segEnd <= 5.0) {
                        segEnd = Math.max(segEnd, t);
                    } else {
                        acceptedIntervals.push({ start: segStart, end: segEnd });
                        segStart = t;
                        segEnd = t;
                    }
                }
            }
            if (segEnd >= segStart) {
                acceptedIntervals.push({ start: segStart, end: segEnd });
            }

            allAcceptedFrames.push(...acceptedFromThisDataset);
        }
    }

    // Sort all accepted frames chronologically
    allAcceptedFrames.sort((a, b) => {
        const tA = getFrameTimeSec(a);
        const tB = getFrameTimeSec(b);
        if (tA !== tB) return tA - tB;
        return (a.filename || "").localeCompare(b.filename || "", undefined, { numeric: true });
    });

    return allAcceptedFrames;
}

export function useLogsData() {
    const location = useLocation();
    const isLogsPage = location.pathname.startsWith("/logs");
    const [searchParams, setSearchParams] = useSearchParams();
    const mapParam = isLogsPage ? searchParams.get("map") : null;

    const [maps, setMaps] = useState<PointCloudOption[]>([]);
    const [selectedMapId, setSelectedMapId] = useState<string | null>(mapParam);
    const [loadingMaps, setLoadingMaps] = useState<boolean>(true);

    const [batchDatasets, setBatchDatasets] = useState<TargetDataset[]>([]);
    const [rawFrames, setRawFrames] = useState<EnrichedCameraFrame[]>([]);
    const [loadingFrames, setLoadingFrames] = useState<boolean>(false);
    const [videos, setVideos] = useState<VideoItem[]>([]);
    const [loadingVideos, setLoadingVideos] = useState<boolean>(false);
    const [reloadKey, setReloadKey] = useState<number>(0);
    const [error, setError] = useState<string | null>(null);

    const apiBaseUrl = import.meta.env.VITE_API_URL || "http://localhost:8000";

    const [activeIndex, setActiveIndex] = useState<number | null>(null);
    const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

    // Safely access PLYPointCloudContext (undefined when outside provider)
    const plyContext = useContext(PLYPointCloudContext);

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
                    batch_id: item.batch_id,
                    reconstruction_index: item.reconstruction_index ?? 0,
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
            setBatchDatasets([]);
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
                // 1. Identify all datasets inside the selected query with the same Batch ID
                let targetBatchId: string | null = null;
                let queryDatasets: TargetDataset[] = [];

                if (plyContext && plyContext.queries && plyContext.queries.length > 0) {
                    // Match query by selectedMapId, plyContext.identifier, or containing selectedMapId
                    let selectedQuery = plyContext.queries.find(
                        (q) => q.id === selectedMapId || q.id === plyContext.identifier
                    );

                    if (!selectedQuery) {
                        selectedQuery = plyContext.queries.find((q) => {
                            const sum = plyContext.summaryMap[q.id] || q.summary;
                            return sum?.connected_pointclouds?.some(
                                (pc) => pc.id === selectedMapId || pc.orig_filename === selectedMapId
                            );
                        });
                    }

                    if (!selectedQuery) {
                        selectedQuery = plyContext.queries.find((q) =>
                            q.filters?.some(
                                (f) => f.field === "pointcloud_id" && String(f.value) === String(selectedMapId)
                            )
                        );
                    }

                    if (selectedQuery) {
                        let summaryData = plyContext.summaryMap[selectedQuery.id] || selectedQuery.summary;
                        if (!summaryData?.connected_pointclouds && plyContext.fetchQuerySummary) {
                            try {
                                summaryData =
                                    (await plyContext.fetchQuerySummary(selectedQuery.id, selectedQuery.filters)) ||
                                    summaryData;
                            } catch {
                                // Ignore summary fetch errors and proceed
                            }
                        }

                        // Determine targetBatchId from query filters
                        const batchRule = selectedQuery.filters?.find(
                            (f) => f.field === "batch_id" && (f.operator === "eq" || !f.operator)
                        );
                        if (batchRule && batchRule.value) {
                            targetBatchId = String(batchRule.value);
                        }

                        // If not in filters, match batch_id from connected pointclouds
                        if (
                            !targetBatchId &&
                            summaryData?.connected_pointclouds &&
                            summaryData.connected_pointclouds.length > 0
                        ) {
                            const matchedPc = summaryData.connected_pointclouds.find(
                                (pc) => pc.id === selectedMapId || pc.orig_filename === selectedMapId
                            );
                            if (matchedPc?.batch_id) {
                                targetBatchId = matchedPc.batch_id;
                            } else if (summaryData.connected_pointclouds[0]?.batch_id) {
                                targetBatchId = summaryData.connected_pointclouds[0].batch_id;
                            }
                        }

                        // Collect all datasets from this query matching targetBatchId
                        if (
                            summaryData?.connected_pointclouds &&
                            summaryData.connected_pointclouds.length > 0
                        ) {
                            const matchedConnected = targetBatchId
                                ? summaryData.connected_pointclouds.filter((pc) => pc.batch_id === targetBatchId)
                                : summaryData.connected_pointclouds;

                            if (matchedConnected.length > 0) {
                                queryDatasets = matchedConnected.map((pc) => ({
                                    id: pc.id,
                                    name: pc.orig_filename || pc.safe_filename || pc.id,
                                    reconstruction_index: pc.reconstruction_index ?? 0,
                                    batch_id: pc.batch_id,
                                }));
                            }
                        }
                    }
                }

                // If no query-based datasets were found (e.g. standalone /logs page), fallback to maps by batch_id
                if (queryDatasets.length === 0) {
                    const matchedMap = maps.find((m) => m.id === selectedMapId || m.name === selectedMapId);
                    const bId = targetBatchId || matchedMap?.batch_id;
                    if (bId) {
                        targetBatchId = bId;
                        const batchMaps = maps.filter((m) => m.batch_id === bId);
                        if (batchMaps.length > 0) {
                            queryDatasets = batchMaps.map((m) => ({
                                id: m.id,
                                name: m.name,
                                reconstruction_index: m.reconstruction_index ?? 0,
                                batch_id: m.batch_id,
                            }));
                        }
                    }
                }

                // Fallback: single selected dataset
                if (queryDatasets.length === 0) {
                    const matchedMap = maps.find((m) => m.id === selectedMapId || m.name === selectedMapId);
                    queryDatasets = [
                        {
                            id: selectedMapId!,
                            name: matchedMap?.name || selectedMapId!,
                            reconstruction_index: matchedMap?.reconstruction_index ?? 0,
                            batch_id: matchedMap?.batch_id,
                        },
                    ];
                }

                // Sort datasets strictly by reconstruction_index ascending (0 is highest priority)
                queryDatasets.sort((a, b) => {
                    const rA = a.reconstruction_index ?? 0;
                    const rB = b.reconstruction_index ?? 0;
                    if (rA !== rB) return rA - rB;
                    return a.id.localeCompare(b.id);
                });

                if (isCancelled) return;
                setBatchDatasets(queryDatasets);

                // 2. Fetch camera routes for each dataset in parallel
                const routesPromises = queryDatasets.map((d) =>
                    getCameraRoutes({
                        path: { identifier: d.id },
                    }).then((res) => ({
                        dataset: d,
                        frames: (res.data || []) as CameraFrameResponse[],
                    }))
                );

                // Fetch videos for the primary dataset / batch
                const primaryId = queryDatasets[0]?.id || selectedMapId;
                const videosPromise = fetch(`${apiBaseUrl}/videos/by-pointcloud/${primaryId}`);

                const [routesResults, videosRes] = await Promise.all([
                    Promise.allSettled(routesPromises),
                    videosPromise.catch((e) => {
                        console.warn("Failed to fetch videos:", e);
                        return null;
                    }),
                ]);

                if (isCancelled) return;

                // Collect all successful route groups
                const routeGroups: Array<{ dataset: TargetDataset; frames: CameraFrameResponse[] }> = [];
                for (const res of routesResults) {
                    if (res.status === "fulfilled" && res.value.frames.length > 0) {
                        routeGroups.push(res.value);
                    }
                }

                if (routeGroups.length > 0) {
                    // Apply merge and deduplication by reconstruction_index
                    const merged = mergeFramesByReconstructionIndex(routeGroups);
                    setRawFrames(merged);
                    if (merged.length > 0) {
                        setActiveIndex((prev) => (prev !== null && prev < merged.length ? prev : 0));
                    } else {
                        setActiveIndex(null);
                    }
                } else {
                    console.warn("No camera routes found for batch datasets");
                    setRawFrames([]);
                    setActiveIndex(null);
                }

                // Parse videos
                if (videosRes && videosRes.ok) {
                    const vData = await videosRes.json();
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
            } catch (err: any) {
                if (!isCancelled) {
                    console.error("Error loading batch routes and videos:", err);
                    setError("Failed to load trajectory for batch.");
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
    }, [
        selectedMapId,
        reloadKey,
        apiBaseUrl,
        maps,
        plyContext?.identifier,
        plyContext?.queries,
        plyContext?.summaryMap,
    ]);

    const activeMap = useMemo(() => {
        const directMatch = maps.find((m) => m.id === selectedMapId || m.name === selectedMapId);
        if (directMatch) return directMatch;
        if (batchDatasets.length > 0) {
            const first = batchDatasets[0];
            return (
                maps.find((m) => m.id === first.id) || {
                    id: first.id,
                    name: first.name,
                    number_of_points: 0,
                    created_at: new Date().toISOString(),
                    batch_id: first.batch_id,
                    reconstruction_index: first.reconstruction_index,
                }
            );
        }
        return undefined;
    }, [maps, selectedMapId, batchDatasets]);

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

                // If not matched by timestamp range:
                if (videoIndex === undefined) {
                    if (sortedVideos.length === 1) {
                        videoIndex = 0;
                        const vDur = durations[0];
                        if (
                            frame.relative_time !== null &&
                            frame.relative_time !== undefined &&
                            frame.relative_time > 0
                        ) {
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
                        const localFrameOffset = Math.max(0, frameNum - 1 - videoIndex * framesPerVideo);
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
                const isSameModel =
                    !prev.pointCloudId ||
                    !frame.pointCloudId ||
                    prev.pointCloudId === frame.pointCloudId;
                const dx = x - prev.x;
                const dy = y - prev.y;
                const dz = z - prev.z;
                const stepDist = isSameModel ? Math.sqrt(dx * dx + dy * dy + dz * dz) : 0;
                cumulativeDist += stepDist;

                const dt = relTime - prev.relativeTime;
                if (dt > 0.0001 && isSameModel) {
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
                direction:
                    frame.direction && frame.direction.length === 3
                        ? (frame.direction as [number, number, number])
                        : undefined,
                rotation:
                    frame.rotation && frame.rotation.length === 4
                        ? (frame.rotation as [number, number, number, number])
                        : undefined,
                filename: frame.filename,
                cameraHeaderId: frame.camera_header_id,
                pointCloudId: frame.pointCloudId,
                reconstructionIndex: frame.reconstructionIndex,
            });
        }

        return result;
    }, [rawFrames, videos, activeMap, selectedMapId]);

    const summary = useMemo<MissionSummary | null>(() => {
        if (!activeMap) return null;

        const totalPointsInBatch =
            batchDatasets.length > 0
                ? batchDatasets.reduce((sum, d) => {
                      const m = maps.find((x) => x.id === d.id);
                      return sum + (m?.number_of_points || 0);
                  }, 0)
                : activeMap.number_of_points;

        const totalFrames = telemetryPoints.length;
        if (totalFrames === 0) {
            return {
                mapId: activeMap.id,
                mapName: activeMap.name,
                totalPoints: totalPointsInBatch || activeMap.number_of_points,
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
            totalPoints: totalPointsInBatch || activeMap.number_of_points,
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
    }, [activeMap, batchDatasets, maps, telemetryPoints]);

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
        batchDatasets,
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
