import React, { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import * as THREE from "three";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";

export interface PLYPointCloudContextType {
    mode: "binary" | "plyFile" | "plyUrl";
    setMode: (mode: "binary" | "plyFile" | "plyUrl") => void;
    renderMode: "points" | "mesh";
    setRenderMode: (mode: "points" | "mesh") => void;
    wireframe: boolean;
    setWireframe: (wireframe: boolean) => void;
    pointSize: number;
    setPointSize: (size: number) => void;
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
    loadBinaryPointCloud: (idToLoad: string, lodToLoad?: number) => Promise<void>;
    loadPlyUrl: (urlToLoad: string) => void;
    loadPlyFile: (file: File) => Promise<void>;
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
    const [identifier, setIdentifier] = useState<string>(DEFAULT_HARDCODED_IDENTIFIER);
    const [plyUrl, setPlyUrl] = useState<string>(DEFAULT_PLY_URL);
    const [lod, setLod] = useState<number>(0);
    const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [pointCount, setPointCount] = useState<number | null>(null);
    const [selectedFileName, setSelectedFileName] = useState<string | null>(null);

    const loadPlyUrl = useCallback((urlToLoad: string) => {
        if (!urlToLoad.trim()) return;
        setIsLoading(true);
        setError(null);

        const loader = new PLYLoader();
        loader.load(
            urlToLoad,
            (geom) => {
                geom.center();
                geom.computeBoundingSphere();
                const count = geom.attributes.position ? geom.attributes.position.count : 0;

                setGeometry((prev) => {
                    if (prev) prev.dispose();
                    return geom;
                });
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

    const loadBinaryPointCloud = useCallback(async (idToLoad: string, lodToLoad: number = 0) => {
        if (!idToLoad.trim()) return;
        setIsLoading(true);
        setError(null);

        try {
            const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";
            const cleanId = idToLoad.trim().split("?")[0];
            const url = `${API_BASE_URL}/pointclouds/${encodeURIComponent(cleanId)}/stream-binary?lod=${lodToLoad}`;

            const res = await fetch(url);
            if (!res.ok) {
                throw new Error(`Backend returned status ${res.status}: ${res.statusText}`);
            }

            const buffer = await res.arrayBuffer();
            const pointSizeInBytes = 15;
            const count = Math.floor(buffer.byteLength / pointSizeInBytes);

            if (count === 0) {
                throw new Error("Received empty point cloud data buffer");
            }

            const positions = new Float32Array(count * 3);
            const colors = new Float32Array(count * 3);
            const dataView = new DataView(buffer);
            const colorScale = 255;
            const tempColor = new THREE.Color();

            for (let i = 0; i < count; i++) {
                const offset = i * 15;
                positions[i * 3] = dataView.getFloat32(offset, true);
                positions[i * 3 + 1] = dataView.getFloat32(offset + 4, true);
                positions[i * 3 + 2] = dataView.getFloat32(offset + 8, true);

                const r = dataView.getUint8(offset + 12);
                const g = dataView.getUint8(offset + 13);
                const b = dataView.getUint8(offset + 14);

                tempColor.setRGB(
                    Math.min(1, r / colorScale),
                    Math.min(1, g / colorScale),
                    Math.min(1, b / colorScale),
                    THREE.SRGBColorSpace
                );
                colors[i * 3] = tempColor.r;
                colors[i * 3 + 1] = tempColor.g;
                colors[i * 3 + 2] = tempColor.b;
            }

            const geom = new THREE.BufferGeometry();
            geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
            geom.setAttribute("color", new THREE.BufferAttribute(colors, 3));
            geom.center();
            geom.computeBoundingSphere();

            setGeometry((prev) => {
                if (prev) prev.dispose();
                return geom;
            });
            setPointCount(count);
        } catch (err: any) {
            console.error("Binary Stream Error:", err);
            setError(err.message || "Failed to load binary point cloud stream");
            if (idToLoad === DEFAULT_HARDCODED_IDENTIFIER) {
                loadPlyUrl(DEFAULT_PLY_URL);
            }
        } finally {
            setIsLoading(false);
        }
    }, [loadPlyUrl]);

    const loadPlyFile = useCallback(async (file: File) => {
        setIsLoading(true);
        setError(null);
        setSelectedFileName(file.name);

        try {
            const buffer = await file.arrayBuffer();
            const loader = new PLYLoader();
            const geom = loader.parse(buffer);

            geom.center();
            geom.computeBoundingSphere();
            const count = geom.attributes.position ? geom.attributes.position.count : 0;

            setGeometry((prev) => {
                if (prev) prev.dispose();
                return geom;
            });
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
                loadBinaryPointCloud,
                loadPlyUrl,
                loadPlyFile,
            }}
        >
            {children}
        </PLYPointCloudContext.Provider>
    );
};
