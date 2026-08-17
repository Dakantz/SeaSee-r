import React, { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import * as THREE from "three";
import type { PointCloudMetadataResponse } from "../../client";
import type { QuerySummaryData, CustomQuery } from "./CustomQueryManager";

export type MapProviderChoice = "OpenStreetMaps" | "Bathymetry" | "Emodnet" | "Debug" | "MapTilerBasic" | "MapTilerOutdoor" | "MapTilerSatellite" | "Bing";
export type HeightProviderChoice = "Bathymetry" | "Emodnet" | "None" | "Debug" | "MapTiler" | "Bing";

import { loadProgressivePointCloud, setPointCloudLoading } from "./utils/pointCloudLoader";

export const DEFAULT_CUSTOM_QUERY = "SELECT PC_Explode(patch) AS pt FROM pointcloud_patches WHERE pointcloud_id = 'e360394b-a241-49e5-bb66-97fee8bd85ef'";

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
    customQuery: string;
    setCustomQuery: (query: string) => void;
    startProgressiveStream: (idToLoad: string, startLod?: number, endLod?: number, overrideQuery?: string, streamKey?: string) => Promise<void>;
    showCameraTrajectories: boolean;
    setShowCameraTrajectories: (show: boolean) => void;

    // Custom Queries state
    queries: CustomQuery[];
    setQueries: React.Dispatch<React.SetStateAction<CustomQuery[]>>;

    // Multi-pointcloud extension state & methods
    catalog: PointCloudMetadataResponse[];
    isFetchingCatalog: boolean;
    fetchCatalog: () => Promise<void>;
    selectedId: string | null;
    selectPointcloud: (id: string | null) => void;
    hoveredId: string | null;
    hoverPointcloud: (id: string | null) => void;
    focusedId: string | null;
    focusTrigger: number;
    focusPointcloud: (id: string | null) => void;
    focusCameraTarget: (target: [number, number, number] | { x: number; y: number; z: number }) => void;
    loadedGeometries: Map<string, THREE.BufferGeometry>;
    loadingIds: Set<string>;
    toggleStreamPointCloud: (id: string, lodToLoad?: number) => Promise<void>;
    unloadPointCloud: (id: string) => void;
    summaryMap: Record<string, QuerySummaryData>;
    setSummaryMap: React.Dispatch<React.SetStateAction<Record<string, QuerySummaryData>>>;
    fetchQuerySummary: (queryId: string, queryText: string) => Promise<QuerySummaryData | null>;
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
    const [mode, setMode] = useState<"binary" | "plyFile" | "plyUrl">("binary");
    const [renderMode, setRenderMode] = useState<"points" | "mesh">("points");
    const [wireframe, setWireframe] = useState<boolean>(true);
    const [pointSize, setPointSize] = useState<number>(0.1);
    const [showHeightmap, setShowHeightmap] = useState<boolean>(false);
    const [heightmapMode, setHeightmapMode] = useState<"HEIGHT" | "HEIGHT_SHADER" | "MARTINI" | "PLANAR">("HEIGHT");
    const [heightmapMapProvider, setHeightmapMapProvider] = useState<MapProviderChoice>("OpenStreetMaps");
    const [heightmapHeightProvider, setHeightmapHeightProvider] = useState<HeightProviderChoice>("Emodnet");
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
    const [customQuery, setCustomQuery] = useState<string>(DEFAULT_CUSTOM_QUERY);
    const [summaryMap, setSummaryMap] = useState<Record<string, QuerySummaryData>>({});

    // Custom Queries state managed via CustomQueryManagerContainer
    const [queries, setQueries] = useState<CustomQuery[]>([]);

    // Multi-pointcloud states
    const [catalog, setCatalog] = useState<PointCloudMetadataResponse[]>([]);
    const [isFetchingCatalog, setIsFetchingCatalog] = useState<boolean>(false);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [hoveredId, setHoveredId] = useState<string | null>(null);
    const [focusedId, setFocusedId] = useState<string | null>(null);
    const [focusTrigger, setFocusTrigger] = useState<number>(0);
    const [loadedGeometries, setLoadedGeometries] = useState<Map<string, THREE.BufferGeometry>>(new Map());
    const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());

    // AbortControllers map to manage in-flight progressive LOD loads per pointcloud/query
    const activeControllersRef = React.useRef<Map<string, AbortController>>(new Map());

    const fetchQuerySummary = useCallback(async (queryId: string, queryText: string) => {
        if (!queryText || !queryText.trim()) return null;
        try {
            const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";
            const match = queryText.match(/pointcloud_id\s*=\s*'([a-fA-F0-9-]+)'/i);
            const targetPcId = match ? match[1] : null;
            let params = "lod=0";
            if (targetPcId) {
                params += `&pointcloud_id=${encodeURIComponent(targetPcId)}`;
            }
            const response = await fetch(`${API_BASE_URL}/pointclouds/stream-summary?${params}`);

            if (response.ok) {
                const data: QuerySummaryData = await response.json();
                setSummaryMap((prev) => ({ ...prev, [queryId]: data }));
                return data;
            }
        } catch (err) {
            console.error(`Error fetching summary for query ${queryId}:`, err);
        }
        return null;
    }, []);

    const startProgressiveStream = useCallback(async (idToLoad: string, startLod: number = 10, endLod: number = 0, overrideQuery?: string, streamKey?: string) => {
        if (!idToLoad.trim()) return;

        const key = streamKey || idToLoad;
        const queryToUse = overrideQuery !== undefined ? overrideQuery : customQuery;

        if (!summaryMap[key] && queryToUse) {
            fetchQuerySummary(key, queryToUse);
        }

        // Abort existing stream for this stream key if any
        if (activeControllersRef.current.has(key)) {
            activeControllersRef.current.get(key)?.abort();
            activeControllersRef.current.delete(key);
        }
        setPointCloudLoading(key, false);

        const controller = new AbortController();
        activeControllersRef.current.set(key, controller);

        setIsLoading(true);
        setError(null);
        setLoadingIds((prev) => new Set(prev).add(key));

        try {
            await loadProgressivePointCloud({
                id: idToLoad,
                streamKey: key,
                startLod,
                endLod,
                customQuery: queryToUse,
                signal: controller.signal,
                onLodLoaded: (currentLod, newGeom) => {
                    if (controller.signal.aborted) return;
                    setLoadedGeometries((prev) => {
                        const next = new Map(prev);
                        const oldGeom = next.get(key);
                        if (oldGeom && oldGeom !== newGeom) {
                            oldGeom.dispose();
                        }
                        next.set(key, newGeom);
                        return next;
                    });
                    const count = newGeom.attributes.position ? newGeom.attributes.position.count : 0;
                    setPointCount(count);
                    setLod(currentLod);
                    setIsLoading(false);
                },
                onError: (currentLod, err) => {
                    console.warn(`Error loading LOD ${currentLod} for ${key}:`, err);
                },
            });
        } catch (err: any) {
            if (!controller.signal.aborted) {
                console.error("Progressive stream error:", err);
                setError(err.message || "Failed to load binary point cloud stream");
            }
        } finally {
            if (activeControllersRef.current.get(key) === controller) {
                activeControllersRef.current.delete(key);
            }
            setLoadingIds((prev) => {
                const next = new Set(prev);
                next.delete(key);
                setIsLoading(next.size > 0);
                return next;
            });
            setPointCloudLoading(key, false);
        }
    }, [customQuery, fetchQuerySummary, summaryMap]);

    const selectPointcloud = useCallback((id: string | null) => {
        setSelectedId(id);
        if (id) {
            setIdentifier(id);
        }
    }, []);

    const hoverPointcloud = useCallback((id: string | null) => {
        setHoveredId(id);
    }, []);

    const focusPointcloud = useCallback((id: string | null) => {
        setFocusedId(id);
        if (id) {
            selectPointcloud(id);
            setFocusTrigger((prev) => prev + 1);
        }
    }, [selectPointcloud]);

    const focusCameraTarget = useCallback((target: [number, number, number] | { x: number; y: number; z: number }) => {
        let x: number, y: number, z: number;
        if (Array.isArray(target)) {
            [x, y, z] = target;
        } else {
            ({ x, y, z } = target);
        }
        window.dispatchEvent(
            new CustomEvent("focus_camera_target", {
                detail: { x, y, z },
            })
        );
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
        const idsToUnload = new Set<string>([id]);
        const summary = summaryMap[id];
        if (summary?.connected_pointclouds) {
            summary.connected_pointclouds.forEach((conn) => {
                if (conn.id) idsToUnload.add(conn.id);
            });
        }
        if (summary?.connected_camera_headers) {
            summary.connected_camera_headers.forEach((cam) => {
                if (cam.pointcloud_id) idsToUnload.add(cam.pointcloud_id);
            });
        }

        idsToUnload.forEach((targetId) => {
            if (activeControllersRef.current.has(targetId)) {
                activeControllersRef.current.get(targetId)?.abort();
                activeControllersRef.current.delete(targetId);
            }
            setPointCloudLoading(targetId, false);
        });

        setSelectedId((prev) => (prev && idsToUnload.has(prev) ? null : prev));
        setFocusedId((prev) => (prev && idsToUnload.has(prev) ? null : prev));
        setHoveredId((prev) => (prev && idsToUnload.has(prev) ? null : prev));

        setLoadingIds((prev) => {
            const next = new Set(prev);
            idsToUnload.forEach((targetId) => next.delete(targetId));
            return next;
        });

        const disposedGeoms: THREE.BufferGeometry[] = [];

        setLoadedGeometries((prev) => {
            const next = new Map(prev);
            idsToUnload.forEach((targetId) => {
                const existing = next.get(targetId);
                if (existing) {
                    disposedGeoms.push(existing);
                    existing.dispose();
                    next.delete(targetId);
                }
            });

            if (next.size === 0) {
                setGeometry((prevGeom) => {
                    if (prevGeom) prevGeom.dispose();
                    return null;
                });
            } else if (disposedGeoms.length > 0) {
                setGeometry((prevGeom) => {
                    if (prevGeom && disposedGeoms.includes(prevGeom)) {
                        prevGeom.dispose();
                        return null;
                    }
                    return prevGeom;
                });
            }

            return next;
        });
    }, [summaryMap]);

    const toggleStreamPointCloud = useCallback(async (id: string) => {
        if (loadedGeometries.has(id)) {
            unloadPointCloud(id);
            return;
        }

        selectPointcloud(id);
    }, [loadedGeometries, unloadPointCloud, selectPointcloud]);

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
                customQuery,
                setCustomQuery,
                startProgressiveStream,
                showCameraTrajectories,
                setShowCameraTrajectories,

                // Custom Queries exports
                queries,
                setQueries,

                // Multi-pointcloud exports
                catalog,
                isFetchingCatalog,
                fetchCatalog,
                selectedId,
                selectPointcloud,
                hoveredId,
                hoverPointcloud,
                focusedId,
                focusTrigger,
                focusPointcloud,
                focusCameraTarget,
                loadedGeometries,
                loadingIds,
                toggleStreamPointCloud,
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

