import React, { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import * as THREE from "three";
import type { PointCloudMetadataResponse } from "../../client";
import type { QuerySummaryData, CustomQuery } from "./CustomQueryManager";
import { fetchPointCloudSummary } from "./utils/pointCloudApi.ts";
import { type FilterRule, sanitizeNonSpatialFilters } from "./utils/filterUtils.ts";

export type MapProviderChoice = "OpenStreetMaps" | "Bathymetry" | "EmodnetWMS" | "EmodnetWCSBilinear" | "EmodnetWCSNearestNeighbour" | "Debug" | "MapTilerBasic" | "MapTilerOutdoor" | "MapTilerSatellite" | "Bing";
export type HeightProviderChoice = "Bathymetry" | "EmodnetWCSBilinear" | "EmodnetWCSNearestNeighbour" | "None" | "Debug" | "MapTiler" | "Bing";

import { loadProgressivePointCloud, setPointCloudLoading } from "./utils/pointCloudLoader";
import { getApiBaseUrl } from "../../utils/apiConfig";

export interface AddCustomQueryPayload {
    name?: string;
    filters?: FilterRule[];
}

export interface CameraViewTarget {
    position: [number, number, number];
    quaternion?: [number, number, number, number];
    fov?: number;
    timestamp: number;
}

export interface PerfTestMetric {
    second: number;
    fps: number;
    frameTimeMs: number;
    pointsCount: number;
    position: { x: number; y: number; z: number };
}

export interface PerfTestSummary {
    averageFps: number;
    averageFrameTimeMs: number;
    totalFrames: number;
    totalDurationSec: number;
    metrics: PerfTestMetric[];
}

export interface PLYPointCloudContextType {
    renderMode: "points" | "mesh";
    setRenderMode: (mode: "points" | "mesh") => void;
    wireframe: boolean;
    setWireframe: (wireframe: boolean) => void;
    pointSize: number;
    setPointSize: (size: number) => void;
    showHeightmap: boolean;
    setShowHeightmap: (show: boolean) => void;
    heightmapMode: "HEIGHT" | "HEIGHT_SHADER" | "MARTINI" | "PLANAR";
    setHeightmapMode: (mode: "HEIGHT" | "HEIGHT_SHADER" | "MARTINI" | "PLANAR") => void;
    heightmapMapProvider: MapProviderChoice;
    setHeightmapMapProvider: (provider: MapProviderChoice) => void;
    heightmapHeightProvider: HeightProviderChoice;
    setHeightmapHeightProvider: (provider: HeightProviderChoice) => void;
    identifier: string;
    setIdentifier: (id: string) => void;
    lod: number;
    setLod: (lod: number) => void;
    geometry: THREE.BufferGeometry | null;
    isLoading: boolean;
    error: string | null;
    pointCount: number | null;
    setPointCount: (count: number | null) => void;
    keyLightIntensity: number;
    setKeyLightIntensity: (val: number) => void;
    fillLightIntensity: number;
    setFillLightIntensity: (val: number) => void;
    hemisphereLightIntensity: number;
    setHemisphereLightIntensity: (val: number) => void;
    ambientLightIntensity: number;
    setAmbientLightIntensity: (val: number) => void;
    startProgressiveStream: (queryId: string, startLod?: number, endLod?: number, filters?: FilterRule[]) => Promise<void>;
    showCameraTrajectories: boolean;
    setShowCameraTrajectories: (show: boolean) => void;
    showOutlines: boolean;
    setShowOutlines: (show: boolean) => void;
    pauseCubicLodUpdate: boolean;
    setPauseCubicLodUpdate: (pause: boolean) => void;

    // Custom Queries state & action dispatcher
    queries: CustomQuery[];
    setQueries: React.Dispatch<React.SetStateAction<CustomQuery[]>>;
    addCustomQuery: (payload: AddCustomQueryPayload) => void;

    // Multi-pointcloud extension state & methods
    catalog: PointCloudMetadataResponse[];
    isFetchingCatalog: boolean;
    fetchCatalog: () => Promise<void>;
    selectPointcloud: (id: string | null) => void;
    hoveredId: string | null;
    hoverPointcloud: (id: string | null) => void;
    cameraTarget: { x: number; y: number; z: number; offset?: [number, number, number] | number; timestamp: number } | null;
    focusCameraTarget: (target: [number, number, number] | { x: number; y: number; z: number }, offset?: [number, number, number] | number) => void;
    cameraViewTarget: CameraViewTarget | null;
    setCameraView: (view: Omit<CameraViewTarget, "timestamp">) => void;
    unloadPointCloud: (id: string) => void;
    summaryMap: Record<string, QuerySummaryData>;
    setSummaryMap: React.Dispatch<React.SetStateAction<Record<string, QuerySummaryData>>>;
    fetchQuerySummary: (queryId: string, filters?: FilterRule[], lod?: number) => Promise<QuerySummaryData | null>;

    // Camera UP position lock state
    isCameraUpFixed: boolean;
    setIsCameraUpFixed: React.Dispatch<React.SetStateAction<boolean>>;
    toggleCameraUpFixed: () => void;

    // Pointcloud Transform Edit State
    editingPointcloudId: string | null;
    setEditingPointcloudId: (id: string | null) => void;
    gizmoMode: "translate" | "rotate" | "scale" | null;
    setGizmoMode: (mode: "translate" | "rotate" | "scale" | null) => void;
    updatePointcloudTransform: (id: string, matrix: number[]) => Promise<void>;
    isGizmoDragging: boolean;
    setIsGizmoDragging: (dragging: boolean) => void;

    // Performance Test State
    perfTestTrigger: number;
    startPerfTest: () => void;
    stopPerfTest: () => void;
    isPerfTestRunning: boolean;
    setIsPerfTestRunning: React.Dispatch<React.SetStateAction<boolean>>;
    perfTestMetrics: PerfTestMetric[];
    setPerfTestMetrics: React.Dispatch<React.SetStateAction<PerfTestMetric[]>>;
    perfTestSummary: PerfTestSummary | null;
    setPerfTestSummary: React.Dispatch<React.SetStateAction<PerfTestSummary | null>>;
    currentFps: number | null;
    setCurrentFps: React.Dispatch<React.SetStateAction<number | null>>;
    currentFrameTimeMs: number | null;
    setCurrentFrameTimeMs: React.Dispatch<React.SetStateAction<number | null>>;
}

const DEFAULT_HARDCODED_IDENTIFIER = "";

const PLYPointCloudContext = createContext<PLYPointCloudContextType | undefined>(undefined);

export const usePLYPointCloudContext = () => {
    const context = useContext(PLYPointCloudContext);
    if (!context) {
        throw new Error("usePLYPointCloudContext must be used within a PLYPointCloudProvider");
    }
    return context;
};

export const PLYPointCloudProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [renderMode, setRenderMode] = useState<"points" | "mesh">("points");
    const [wireframe, setWireframe] = useState<boolean>(true);
    const [pointSize, setPointSize] = useState<number>(0.1);
    const [showHeightmap, setShowHeightmap] = useState<boolean>(false);
    const [heightmapMode, setHeightmapMode] = useState<"HEIGHT" | "HEIGHT_SHADER" | "MARTINI" | "PLANAR">("HEIGHT");
    const [heightmapMapProvider, setHeightmapMapProvider] = useState<MapProviderChoice>("OpenStreetMaps");
    const [heightmapHeightProvider, setHeightmapHeightProvider] = useState<HeightProviderChoice>("EmodnetWCSBilinear");
    const [identifier, setIdentifier] = useState<string>(DEFAULT_HARDCODED_IDENTIFIER);
    const [lod, setLod] = useState<number>(0);
    const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [pointCount, setPointCount] = useState<number | null>(null);
    const [keyLightIntensity, setKeyLightIntensity] = useState<number>(1.5);
    const [fillLightIntensity, setFillLightIntensity] = useState<number>(0.5);
    const [hemisphereLightIntensity, setHemisphereLightIntensity] = useState<number>(0.6);
    const [ambientLightIntensity, setAmbientLightIntensity] = useState<number>(0.4);
    const [showCameraTrajectories, setShowCameraTrajectories] = useState<boolean>(true);
    const [showOutlines, setShowOutlines] = useState<boolean>(false);
    const [pauseCubicLodUpdate, setPauseCubicLodUpdate] = useState<boolean>(false);
    const [summaryMap, setSummaryMap] = useState<Record<string, QuerySummaryData>>({});
    const [cameraTarget, setCameraTarget] = useState<{ x: number; y: number; z: number; offset?: [number, number, number] | number; timestamp: number } | null>(null);
    const [cameraViewTarget, setCameraViewTargetState] = useState<CameraViewTarget | null>(null);

    const [editingPointcloudId, setEditingPointcloudId] = useState<string | null>(null);
    const [gizmoMode, setGizmoMode] = useState<"translate" | "rotate" | "scale" | null>(null);
    const [isGizmoDragging, setIsGizmoDragging] = useState<boolean>(false);
    const [isCameraUpFixed, setIsCameraUpFixed] = useState<boolean>(true);

    const toggleCameraUpFixed = useCallback(() => {
        setIsCameraUpFixed((prev) => !prev);
    }, []);

    const setCameraView = useCallback((view: Omit<CameraViewTarget, "timestamp">) => {
        setCameraViewTargetState({
            ...view,
            timestamp: Date.now(),
        });
    }, []);

    // Custom Queries state persisted to localStorage
    const [queries, setQueries] = useState<CustomQuery[]>(() => {
        try {
            const saved = localStorage.getItem("seaseer_custom_sql_queries");
            if (saved !== null) {
                const parsed = JSON.parse(saved);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    return parsed.map((q: CustomQuery) => ({
                        ...q,
                        filters: sanitizeNonSpatialFilters(q.filters),
                    }));
                }
            }
        } catch (e) {
            console.error("Failed to load queries from localStorage in PLYPointCloudContext:", e);
        }
        return [];
    });

    useEffect(() => {
        try {
            localStorage.setItem("seaseer_custom_sql_queries", JSON.stringify(queries));
        } catch (e) {
            console.error("Failed to persist queries to localStorage:", e);
        }
    }, [queries]);

    // Multi-pointcloud states
    const [catalog, setCatalog] = useState<PointCloudMetadataResponse[]>([]);

    // Performance Test State
    const [perfTestTrigger, setPerfTestTrigger] = useState<number>(0);
    const [isPerfTestRunning, setIsPerfTestRunning] = useState<boolean>(false);
    const [perfTestMetrics, setPerfTestMetrics] = useState<PerfTestMetric[]>([]);
    const [perfTestSummary, setPerfTestSummary] = useState<PerfTestSummary | null>(null);
    const [currentFps, setCurrentFps] = useState<number | null>(null);
    const [currentFrameTimeMs, setCurrentFrameTimeMs] = useState<number | null>(null);

    const startPerfTest = useCallback(() => {
        setPerfTestMetrics([]);
        setPerfTestSummary(null);
        setCurrentFps(null);
        setCurrentFrameTimeMs(null);
        setIsPerfTestRunning(true);
        setPerfTestTrigger((prev) => prev + 1);
    }, []);

    const stopPerfTest = useCallback(() => {
        setIsPerfTestRunning(false);
    }, []);
    const [isFetchingCatalog, setIsFetchingCatalog] = useState<boolean>(false);
    const [hoveredId, setHoveredId] = useState<string | null>(null);

    const updatePointcloudTransform = useCallback(async (id: string, matrix: number[]) => {
        try {
            const API_BASE_URL = getApiBaseUrl();
            const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

            const targetUuids = new Set<string>();

            if (uuidRegex.test(id)) {
                targetUuids.add(id);
            } else {
                // Look up in summaryMap for connected pointclouds
                const summary = summaryMap[id];
                if (summary?.connected_pointclouds) {
                    for (const pc of summary.connected_pointclouds) {
                        if (pc.id && uuidRegex.test(pc.id)) {
                            targetUuids.add(pc.id);
                        }
                    }
                }

                // Look up in query filters
                const query = queries.find((q) => q.id === id);
                const filterPcId = query?.filters?.find((f) => f.field === "pointcloud_id")?.value;
                if (filterPcId && uuidRegex.test(String(filterPcId))) {
                    targetUuids.add(String(filterPcId));
                }
            }

            if (targetUuids.size === 0) {
                // Check catalog for a pointcloud matching id
                for (const pc of catalog) {
                    if (pc.id === id && uuidRegex.test(pc.id)) {
                        targetUuids.add(pc.id);
                    }
                }
                // Check summaryMap values for a pointcloud matching id
                for (const currSummary of Object.values(summaryMap)) {
                    if (currSummary?.connected_pointclouds) {
                        for (const pc of currSummary.connected_pointclouds) {
                            if (pc.id === id && uuidRegex.test(pc.id)) {
                                targetUuids.add(pc.id);
                            }
                        }
                    }
                }
            }

            if (targetUuids.size === 0) {
                console.error("Could not resolve any valid pointcloud UUID for id", id);
                return;
            }

            // Dispatch PATCH for each target pointcloud UUID
            for (const pcUuid of targetUuids) {
                const res = await fetch(`${API_BASE_URL}/pointclouds/${pcUuid}/transform`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ matrix }),
                });
                if (!res.ok) {
                    console.error("Failed to update transform matrix for pointcloud UUID", pcUuid, res.status, res.statusText);
                } else {
                    console.log("Successfully updated transform matrix for pointcloud UUID", pcUuid);
                }
            }

            // Update summaryMap in context
            setSummaryMap((prev) => {
                const next = { ...prev };
                for (const [key, currSummary] of Object.entries(next)) {
                    let updatedConnected = currSummary?.connected_pointclouds;
                    if (currSummary?.connected_pointclouds) {
                        updatedConnected = currSummary.connected_pointclouds.map((pc) =>
                            targetUuids.has(pc.id) ? { ...pc, transform_matrix: matrix } : pc
                        );
                    }
                    if (targetUuids.has(key) || key === id || currSummary?.connected_pointclouds) {
                        next[key] = {
                            ...currSummary,
                            connected_pointclouds: updatedConnected,
                            ...(targetUuids.has(key) || key === id ? { transform_matrix: matrix } : {}),
                        };
                    }
                }
                return next;
            });

            // Update catalog in context
            setCatalog((prev) =>
                prev.map((pc) => (targetUuids.has(pc.id) ? { ...pc, transform_matrix: matrix } : pc))
            );
        } catch (e) {
            console.error("Error updating transform matrix:", e);
        }
    }, [summaryMap, queries, catalog]);

    // AbortControllers map to manage in-flight progressive LOD loads per pointcloud/query
    const activeControllersRef = React.useRef<Map<string, AbortController>>(new Map());

    const fetchQuerySummary = useCallback(async (queryId: string, filters?: FilterRule[], lod = 0) => {
        try {
            const data = await fetchPointCloudSummary({ lod, filters });
            setSummaryMap((prev) => ({ ...prev, [queryId]: data }));
            return data;
        } catch (err) {
            console.error(`Error fetching summary for query ${queryId}:`, err);
        }
        return null;
    }, []);

    const startProgressiveStream = useCallback(async (
        queryId: string,
        startLod: number = 10,
        endLod: number = 0,
        filters?: FilterRule[]
    ) => {
        if (!queryId.trim()) return;

        if (!summaryMap[queryId]) {
            fetchQuerySummary(queryId, filters);
        }

        // Abort existing stream for this query ID if any
        if (activeControllersRef.current.has(queryId)) {
            activeControllersRef.current.get(queryId)?.abort();
            activeControllersRef.current.delete(queryId);
        }
        setPointCloudLoading(queryId, false);

        const controller = new AbortController();
        activeControllersRef.current.set(queryId, controller);

        setIsLoading(true);
        setError(null);

        try {
            await loadProgressivePointCloud({
                id: queryId,
                startLod,
                endLod,
                filters: filters,
                signal: controller.signal,
                onLodLoaded: (currentLod, newGeom) => {
                    if (controller.signal.aborted) return;
                    setGeometry((oldGeom) => {
                        if (oldGeom && oldGeom !== newGeom && !(oldGeom as any)._disposed) {
                            (oldGeom as any)._disposed = true;
                            oldGeom.dispose();
                        }
                        return newGeom;
                    });
                    const count = newGeom.attributes.position ? newGeom.attributes.position.count : 0;
                    setPointCount(count);
                    setLod(currentLod);
                    setIsLoading(false);
                },
                onError: (currentLod, err) => {
                    console.warn(`Error loading LOD ${currentLod} for ${queryId}:`, err);
                },
            });
        } catch (err: any) {
            if (!controller.signal.aborted) {
                console.error("Progressive stream error:", err);
                setError(err.message || "Failed to load binary point cloud stream");
            }
        } finally {
            if (activeControllersRef.current.get(queryId) === controller) {
                activeControllersRef.current.delete(queryId);
            }
            setIsLoading(false);
            setPointCloudLoading(queryId, false);
        }
    }, [fetchQuerySummary, summaryMap]);

    const selectPointcloud = useCallback((id: string | null) => {
        if (id) {
            setIdentifier(id);
        }
    }, []);

    const hoverPointcloud = useCallback((id: string | null) => {
        setHoveredId(id);
    }, []);

    const addCustomQuery = useCallback((payload: AddCustomQueryPayload) => {
        const { name, filters } = payload;
        const pcIdRule = filters?.find((f) => f.field === "pointcloud_id" && (f.operator === "eq" || !f.operator))?.value;
        const targetId = pcIdRule ? String(pcIdRule) : null;

        setQueries((prevQueries) => {
            const existing = prevQueries.find((q) => {
                if (targetId && q.filters?.some((f) => f.field === "pointcloud_id" && f.value === targetId)) {
                    return true;
                }
                return false;
            });
            if (existing) return prevQueries;

            const now = new Date().toISOString();
            const defaultFilters: FilterRule[] = filters !== undefined
                ? sanitizeNonSpatialFilters(filters)
                : targetId
                    ? [{ id: `rule-${Date.now()}`, field: "pointcloud_id", operator: "eq", value: targetId }]
                    : [];

            const newQuery: CustomQuery = {
                id: `query-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
                name: name || `Custom Query #${prevQueries.length + 1}`,
                filters: defaultFilters,
                createdAt: now,
                updatedAt: now,
            };

            return [...prevQueries, newQuery];
        });
    }, []);

    const focusCameraTarget = useCallback((target: [number, number, number] | { x: number; y: number; z: number }, offset?: [number, number, number] | number) => {
        let x: number, y: number, z: number;
        if (Array.isArray(target)) {
            [x, y, z] = target;
        } else {
            ({ x, y, z } = target);
        }
        setCameraTarget({ x, y, z, offset, timestamp: Date.now() });
    }, []);

    const fetchCatalog = useCallback(async () => {
        setIsFetchingCatalog(true);
        try {
            const API_BASE_URL = getApiBaseUrl();
            const res = await fetch(`${API_BASE_URL}/pointclouds/`);
            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data)) {
                    const items: PointCloudMetadataResponse[] = data.filter(
                        (item): item is PointCloudMetadataResponse => typeof item === "object" && item !== null && "id" in item
                    );
                    setCatalog(items);
                }
            }
        } catch (err) {
            console.error("Failed to fetch pointcloud catalog:", err);
        } finally {
            setIsFetchingCatalog(false);
        }
    }, []);

    useEffect(() => {
        fetchCatalog();
    }, [fetchCatalog]);

    useEffect(() => {
        queries.forEach((q) => {
            if (q.id && !summaryMap[q.id]) {
                fetchQuerySummary(q.id, q.filters);
            }
        });
    }, [queries, summaryMap, fetchQuerySummary]);

    const unloadPointCloud = useCallback((id: string) => {
        if (activeControllersRef.current.has(id)) {
            activeControllersRef.current.get(id)?.abort();
            activeControllersRef.current.delete(id);
        }
        setPointCloudLoading(id, false);

        setHoveredId((prev) => (prev === id ? null : prev));

        setGeometry((prevGeom) => {
            if (prevGeom && !(prevGeom as any)._disposed) {
                (prevGeom as any)._disposed = true;
                prevGeom.dispose();
            }
            return null;
        });
        setIsLoading(false);
    }, []);

    return (
        <PLYPointCloudContext.Provider
            value={{
                renderMode,
                setRenderMode,
                wireframe,
                setWireframe,
                pointSize,
                setPointSize,
                showHeightmap,
                setShowHeightmap,
                heightmapMode,
                setHeightmapMode,
                heightmapMapProvider,
                setHeightmapMapProvider,
                heightmapHeightProvider,
                setHeightmapHeightProvider,
                identifier,
                setIdentifier,
                lod,
                setLod,
                geometry,
                isLoading,
                error,
                pointCount,
                setPointCount,
                keyLightIntensity,
                setKeyLightIntensity,
                fillLightIntensity,
                setFillLightIntensity,
                hemisphereLightIntensity,
                setHemisphereLightIntensity,
                ambientLightIntensity,
                setAmbientLightIntensity,
                startProgressiveStream,
                showCameraTrajectories,
                setShowCameraTrajectories,

                // Custom Queries exports
                queries,
                setQueries,
                addCustomQuery,

                // Multi-pointcloud exports
                catalog,
                isFetchingCatalog,
                fetchCatalog,
                selectPointcloud,
                hoveredId,
                hoverPointcloud,
                cameraTarget,
                focusCameraTarget,
                cameraViewTarget,
                setCameraView,
                unloadPointCloud,
                summaryMap,
                setSummaryMap,
                fetchQuerySummary,
                editingPointcloudId,
                setEditingPointcloudId,
                gizmoMode,
                setGizmoMode,
                updatePointcloudTransform,
                isGizmoDragging,
                setIsGizmoDragging,
                isCameraUpFixed,
                setIsCameraUpFixed,
                toggleCameraUpFixed,
                showOutlines,
                setShowOutlines,
                pauseCubicLodUpdate,
                setPauseCubicLodUpdate,

                // Performance Test exports
                perfTestTrigger,
                startPerfTest,
                stopPerfTest,
                isPerfTestRunning,
                setIsPerfTestRunning,
                perfTestMetrics,
                setPerfTestMetrics,
                perfTestSummary,
                setPerfTestSummary,
                currentFps,
                setCurrentFps,
                currentFrameTimeMs,
                setCurrentFrameTimeMs,
            }}
        >
            {children}
        </PLYPointCloudContext.Provider>
    );
};


