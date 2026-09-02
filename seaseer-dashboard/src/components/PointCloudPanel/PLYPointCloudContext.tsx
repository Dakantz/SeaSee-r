import React, { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import * as THREE from "three";
import type { PointCloudMetadataResponse } from "../../client";
import type { QuerySummaryData, CustomQuery } from "./CustomQueryManager";
import { fetchPointCloudSummary } from "./utils/pointCloudApi.ts";
import type { FilterRule } from "./utils/filterUtils.ts";

export type MapProviderChoice = "OpenStreetMaps" | "Bathymetry" | "EmodnetWMS" | "EmodnetWCSBilinear" | "EmodnetWCSNearestNeighbour" | "Debug" | "MapTilerBasic" | "MapTilerOutdoor" | "MapTilerSatellite" | "Bing";
export type HeightProviderChoice = "Bathymetry" | "EmodnetWCSBilinear" | "EmodnetWCSNearestNeighbour" | "None" | "Debug" | "MapTiler" | "Bing";

import { loadProgressivePointCloud, setPointCloudLoading } from "./utils/pointCloudLoader";

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

export interface PLYPointCloudContextType {
    mode: "binary" | "plyFile" | "plyUrl";
    setMode: (mode: "binary" | "plyFile" | "plyUrl") => void;
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
    loadedGeometries: Map<string, THREE.BufferGeometry>;
    loadingIds: Set<string>;
    isStreamLoaded: (queryId: string) => boolean;
    isStreamLoading: (queryId: string) => boolean;
    unloadPointCloud: (id: string) => void;
    summaryMap: Record<string, QuerySummaryData>;
    setSummaryMap: React.Dispatch<React.SetStateAction<Record<string, QuerySummaryData>>>;
    fetchQuerySummary: (queryId: string, filters?: FilterRule[], lod?: number) => Promise<QuerySummaryData | null>;
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
/**
 * Helper function to check if an active key (in loadedGeometries or loadingIds)
 * matches a target queryId or pointcloudId.
 */
const isKeyMatch = (
    activeKey: string,
    targetId: string,
    queries: CustomQuery[],
    summaryMap: Record<string, QuerySummaryData>
): boolean => {
    if (!activeKey || !targetId) return false;
    if (activeKey === targetId) return true;

    // Check if activeKey is a query ID that targets targetId (as a pointcloud_id)
    const activeQuery = queries.find((q) => q.id === activeKey);
    if (activeQuery) {
        const pcIdRule = activeQuery.filters?.find(
            (f) => f.field === "pointcloud_id" && (f.operator === "eq" || !f.operator)
        )?.value;
        if (pcIdRule && String(pcIdRule) === targetId) return true;

        const summary = summaryMap[activeQuery.id];
        if (summary?.connected_pointclouds?.some((pc) => pc.id === targetId)) {
            return true;
        }
    }

    // Check if targetId is a query ID that targets activeKey (as a pointcloud_id)
    const targetQuery = queries.find((q) => q.id === targetId);
    if (targetQuery) {
        const pcIdRule = targetQuery.filters?.find(
            (f) => f.field === "pointcloud_id" && (f.operator === "eq" || !f.operator)
        )?.value;
        if (pcIdRule && String(pcIdRule) === activeKey) return true;

        const summary = summaryMap[targetQuery.id];
        if (summary?.connected_pointclouds?.some((pc) => pc.id === activeKey)) {
            return true;
        }
    }

    return false;
};

export const PLYPointCloudProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [mode, setMode] = useState<"binary" | "plyFile" | "plyUrl">("binary");
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
    const [summaryMap, setSummaryMap] = useState<Record<string, QuerySummaryData>>({});
    const [cameraTarget, setCameraTarget] = useState<{ x: number; y: number; z: number; offset?: [number, number, number] | number; timestamp: number } | null>(null);
    const [cameraViewTarget, setCameraViewTargetState] = useState<CameraViewTarget | null>(null);

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
                    return parsed;
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
    const [isFetchingCatalog, setIsFetchingCatalog] = useState<boolean>(false);
    const [hoveredId, setHoveredId] = useState<string | null>(null);
    const [loadedGeometries, setLoadedGeometries] = useState<Map<string, THREE.BufferGeometry>>(new Map());
    const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());

    // AbortControllers map to manage in-flight progressive LOD loads per pointcloud/query
    const activeControllersRef = React.useRef<Map<string, AbortController>>(new Map());

    const isStreamLoaded = useCallback((queryId: string): boolean => {
        if (!queryId) return false;
        if (loadedGeometries.has(queryId)) return true;
        for (const loadedKey of loadedGeometries.keys()) {
            if (isKeyMatch(loadedKey, queryId, queries, summaryMap)) {
                return true;
            }
        }
        return false;
    }, [loadedGeometries, queries, summaryMap]);

    const isStreamLoading = useCallback((queryId: string): boolean => {
        if (!queryId) return false;
        if (loadingIds.has(queryId)) return true;
        for (const loadingKey of loadingIds) {
            if (isKeyMatch(loadingKey, queryId, queries, summaryMap)) {
                return true;
            }
        }
        return false;
    }, [loadingIds, queries, summaryMap]);

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

        if (isStreamLoading(queryId)) {
            return;
        }

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
        setLoadingIds((prev) => new Set(prev).add(queryId));

        try {
            await loadProgressivePointCloud({
                id: queryId,
                startLod,
                endLod,
                filters: filters,
                signal: controller.signal,
                onLodLoaded: (currentLod, newGeom) => {
                    if (controller.signal.aborted) return;
                    setLoadedGeometries((prev) => {
                        const next = new Map(prev);
                        const oldGeom = next.get(queryId);
                        if (oldGeom && oldGeom !== newGeom) {
                            if (!(oldGeom as any)._disposed) {
                                (oldGeom as any)._disposed = true;
                                oldGeom.dispose();
                            }
                        }
                        next.set(queryId, newGeom);
                        return next;
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
            setLoadingIds((prev) => {
                const next = new Set(prev);
                next.delete(queryId);
                setIsLoading(next.size > 0);
                return next;
            });
            setPointCloudLoading(queryId, false);
        }
    }, [fetchQuerySummary, isStreamLoading, summaryMap]);

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
                ? filters
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
            const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";
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

    const unloadPointCloud = useCallback((id: string) => {
        if (activeControllersRef.current.has(id)) {
            activeControllersRef.current.get(id)?.abort();
            activeControllersRef.current.delete(id);
        }
        setPointCloudLoading(id, false);

        setHoveredId((prev) => (prev === id ? null : prev));

        setLoadingIds((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
        });

        setLoadedGeometries((prev) => {
            const next = new Map(prev);
            const existing = next.get(id);
            if (existing) {
                if (!(existing as any)._disposed) {
                    (existing as any)._disposed = true;
                    existing.dispose();
                }
                next.delete(id);
            }

            if (next.size === 0) {
                setGeometry((prevGeom) => {
                    if (prevGeom && !(prevGeom as any)._disposed) {
                        (prevGeom as any)._disposed = true;
                        prevGeom.dispose();
                    }
                    return null;
                });
            }

            return next;
        });
    }, []);

    return (
        <PLYPointCloudContext.Provider
            value={{
                mode,
                setMode,
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
                loadedGeometries,
                loadingIds,
                isStreamLoaded,
                isStreamLoading,
                unloadPointCloud,
                summaryMap,
                setSummaryMap,
                fetchQuerySummary,
            }}
        >
            {children}
        </PLYPointCloudContext.Provider>
    );
};


