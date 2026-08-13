import React, { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import * as THREE from "three";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";
import type { PointCloudMetadataResponse } from "../../client";

export type MapProviderChoice = "OpenStreetMaps" | "Bathymetry" | "Emodnet" | "Debug" | "MapTilerBasic" | "MapTilerOutdoor" | "MapTilerSatellite" | "Bing";
export type HeightProviderChoice = "Bathymetry" | "Emodnet" | "None" | "Debug" | "MapTiler" | "Bing";

import { loadProgressivePointCloud, isPointCloudLoading } from "./utils/pointCloudLoader";

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
    heightmapProvider: MapProviderChoice;
    setHeightmapProvider: (provider: MapProviderChoice) => void;
    identifier: string;
    setIdentifier: (id: string) => void;
    plyUrl: string;
    setPlyUrl: (url: string) => void;
    lod: number;
    setLod: (lod: number) => void;
    geometry: THREE.BufferGeometry | null;
    isLoading: boolean;
    error: string | null;
    pointCount: number | null;
    selectedFileName: string | null;
    keyLightIntensity: number;
    setKeyLightIntensity: (val: number) => void;
    fillLightIntensity: number;
    setFillLightIntensity: (val: number) => void;
    hemisphereLightIntensity: number;
    setHemisphereLightIntensity: (val: number) => void;
    ambientLightIntensity: number;
    setAmbientLightIntensity: (val: number) => void;
    loadBinaryPointCloud: (idToLoad: string, lodToLoad?: number) => Promise<void>;
    loadPlyUrl: (urlToLoad: string) => void;
    loadPlyFile: (file: File) => Promise<void>;
    showCameraTrajectories: boolean;
    setShowCameraTrajectories: (show: boolean) => void;

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
    loadedGeometries: Map<string, THREE.BufferGeometry>;
    loadingIds: Set<string>;
    toggleStreamPointCloud: (id: string, lodToLoad?: number) => Promise<void>;
    unloadPointCloud: (id: string) => void;
}

const DEFAULT_HARDCODED_IDENTIFIER = "";
const DEFAULT_PLY_URL = "/test_data/datasets/video_1/odm_filterpoints/point_cloud.ply";

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
    const [plyUrl, setPlyUrl] = useState<string>(DEFAULT_PLY_URL);
    const [lod, setLod] = useState<number>(0);
    const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [pointCount, setPointCount] = useState<number | null>(null);
    const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
    const [keyLightIntensity, setKeyLightIntensity] = useState<number>(1.5);
    const [fillLightIntensity, setFillLightIntensity] = useState<number>(0.5);
    const [hemisphereLightIntensity, setHemisphereLightIntensity] = useState<number>(0.6);
    const [ambientLightIntensity, setAmbientLightIntensity] = useState<number>(0.4);
    const [showCameraTrajectories, setShowCameraTrajectories] = useState<boolean>(true);

    // Multi-pointcloud states
    const [catalog, setCatalog] = useState<PointCloudMetadataResponse[]>([]);
    const [isFetchingCatalog, setIsFetchingCatalog] = useState<boolean>(false);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [hoveredId, setHoveredId] = useState<string | null>(null);
    const [focusedId, setFocusedId] = useState<string | null>(null);
    const [focusTrigger, setFocusTrigger] = useState<number>(0);
    const [loadedGeometries, setLoadedGeometries] = useState<Map<string, THREE.BufferGeometry>>(new Map());
    const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());

    // AbortControllers map to manage in-flight progressive LOD loads per pointcloud
    const activeControllersRef = React.useRef<Map<string, AbortController>>(new Map());

    const updateGeometryForId = useCallback((id: string, newGeom: THREE.BufferGeometry, currentLod: number) => {
        setLoadedGeometries((prev) => {
            const next = new Map(prev);
            const oldGeom = next.get(id);
            if (oldGeom && oldGeom !== newGeom) {
                oldGeom.dispose();
            }
            next.set(id, newGeom);
            return next;
        });

        setGeometry((prevGeom) => {
            if (prevGeom && prevGeom !== newGeom) {
                prevGeom.dispose();
            }
            return newGeom;
        });

        const count = newGeom.attributes.position ? newGeom.attributes.position.count : 0;
        setPointCount(count);
        setLod(currentLod);
    }, []);

    const startProgressiveStream = useCallback(async (idToLoad: string, startLod: number = 10, endLod: number = 0) => {
        if (!idToLoad.trim()) return;

        // If pointcloud is currently in the process of being loaded, continue loading where it currently is at
        if (isPointCloudLoading(idToLoad)) {
            return;
        }

        // Abort existing stream for this ID if any
        if (activeControllersRef.current.has(idToLoad)) {
            activeControllersRef.current.get(idToLoad)?.abort();
            activeControllersRef.current.delete(idToLoad);
        }

        const controller = new AbortController();
        activeControllersRef.current.set(idToLoad, controller);

        setIsLoading(true);
        setError(null);
        setLoadingIds((prev) => new Set(prev).add(idToLoad));

        try {
            await loadProgressivePointCloud({
                id: idToLoad,
                startLod,
                endLod,
                signal: controller.signal,
                onLodLoaded: (currentLod, newGeom) => {
                    if (controller.signal.aborted) return;
                    updateGeometryForId(idToLoad, newGeom, currentLod);
                    setIsLoading(false);
                },
                onError: (currentLod, err) => {
                    console.warn(`Error loading LOD ${currentLod} for ${idToLoad}:`, err);
                },
            });
        } catch (err: any) {
            if (!controller.signal.aborted) {
                console.error("Progressive stream error:", err);
                setError(err.message || "Failed to load binary point cloud stream");
            }
        } finally {
            if (!controller.signal.aborted) {
                setIsLoading(false);
                setLoadingIds((prev) => {
                    const next = new Set(prev);
                    next.delete(idToLoad);
                    return next;
                });
                activeControllersRef.current.delete(idToLoad);
            }
        }
    }, [updateGeometryForId]);

    const selectPointcloud = useCallback((id: string | null) => {
        setSelectedId(id);
        if (id) {
            setIdentifier(id);
            startProgressiveStream(id, 10, 0);
        }
    }, [startProgressiveStream]);

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

        setLoadedGeometries((prev) => {
            const next = new Map(prev);
            const existing = next.get(id);
            if (existing) {
                existing.dispose();
                next.delete(id);
            }
            return next;
        });
    }, []);

    const toggleStreamPointCloud = useCallback(async (id: string) => {
        if (loadedGeometries.has(id)) {
            unloadPointCloud(id);
            return;
        }

        selectPointcloud(id);
    }, [loadedGeometries, unloadPointCloud, selectPointcloud]);

    const loadPlyUrl = useCallback((urlToLoad: string) => {
        if (!urlToLoad.trim()) return;
        setIsLoading(true);
        setError(null);
        setGeometry((prev) => {
            if (prev) prev.dispose();
            return null;
        });

        const loader = new PLYLoader();
        loader.load(
            urlToLoad,
            (geom) => {
                geom.center();
                geom.computeBoundingSphere();
                const count = geom.attributes.position ? geom.attributes.position.count : 0;

                setGeometry(geom);
                setPointCount(count);
                setIsLoading(false);
            },
            undefined,
            (err) => {
                console.error("PLY URL load error:", err);
                setError("Failed to load PLY from URL");
                setIsLoading(false);
            }
        );
    }, []);

    const loadBinaryPointCloud = useCallback(async (idToLoad: string, startLod: number = 10) => {
        if (!idToLoad.trim()) return;
        await startProgressiveStream(idToLoad, startLod, 0);
    }, [startProgressiveStream]);

    const loadPlyFile = useCallback(async (file: File) => {
        setIsLoading(true);
        setError(null);
        setSelectedFileName(file.name);
        setGeometry((prev) => {
            if (prev) prev.dispose();
            return null;
        });

        try {
            const buffer = await file.arrayBuffer();
            const loader = new PLYLoader();
            const geom = loader.parse(buffer);

            geom.center();
            geom.computeBoundingSphere();
            const count = geom.attributes.position ? geom.attributes.position.count : 0;

            setGeometry(geom);
            setPointCount(count);
        } catch (err: any) {
            console.error("PLY parse error:", err);
            setError(err.message || "Failed to parse PLY file");
        } finally {
            setIsLoading(false);
        }
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
                heightmapProvider: heightmapMapProvider,
                setHeightmapProvider: setHeightmapMapProvider,
                identifier,
                setIdentifier,
                plyUrl,
                setPlyUrl,
                lod,
                setLod,
                geometry,
                isLoading,
                error,
                pointCount,
                selectedFileName,
                keyLightIntensity,
                setKeyLightIntensity,
                fillLightIntensity,
                setFillLightIntensity,
                hemisphereLightIntensity,
                setHemisphereLightIntensity,
                ambientLightIntensity,
                setAmbientLightIntensity,
                loadBinaryPointCloud,
                loadPlyUrl,
                loadPlyFile,
                showCameraTrajectories,
                setShowCameraTrajectories,

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
                loadedGeometries,
                loadingIds,
                toggleStreamPointCloud,
                unloadPointCloud,
            }}
        >
            {children}
        </PLYPointCloudContext.Provider>
    );
};

