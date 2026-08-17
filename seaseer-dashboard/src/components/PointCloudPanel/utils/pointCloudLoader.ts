import * as THREE from "three";
import { buildFilterQueryParams, type FilterRule } from "./filterUtils.ts";

/** Set tracking pointcloud IDs currently in the process of being loaded */
const loadingPointClouds = new Set<string>();

/**
 * Checks if a specific pointcloud (or any pointcloud if no ID provided) is currently in the process of being loaded.
 * @param id Optional UUID of the pointcloud dataset.
 * @returns boolean indicating whether the pointcloud is currently loading.
 */
export function isPointCloudLoading(id?: string): boolean {
    if (id !== undefined) {
        return loadingPointClouds.has(id);
    }
    return loadingPointClouds.size > 0;
}

/**
 * Manually set or clear the loading status flag of a pointcloud dataset.
 */
export function setPointCloudLoading(id: string, loading: boolean): void {
    if (loading) {
        loadingPointClouds.add(id);
    } else {
        loadingPointClouds.delete(id);
    }
}

export interface ProgressiveLoadOptions {
    /** UUID of the pointcloud dataset */
    id: string;
    /** Stream key or ID to distinguish concurrent streams (defaults to id) */
    streamKey?: string;
    /** Starting Level of Detail (default: 10) */
    startLod?: number;
    /** Final Level of Detail (default: 0) */
    endLod?: number;
    /** Structured filter rules */
    filters?: FilterRule[];
    /** AbortSignal to cancel progressive loading mid-stream */
    signal?: AbortSignal;
    /** Callback fired when an LOD successfully loads and is ready for rendering */
    onLodLoaded?: (lod: number, geometry: THREE.BufferGeometry) => void;
    /** Optional callback for individual LOD load errors */
    onError?: (lod: number, error: unknown) => void;
}

/**
 * Low-level helper to fetch and parse binary pointcloud buffer for a specific LOD.
 * Uses 16-byte packed vertex layout: [X:f32, Y:f32, Z:f32, R:u8, G:u8, B:u8, Pad:u8]
 */
export async function fetchBinaryGeometry(
    _idToLoad: string,
    lodToLoad: number = 0,
    signal?: AbortSignal,
    filters?: FilterRule[]
): Promise<THREE.BufferGeometry> {
    const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";
    
    // Convert structured filters into URL query parameters
    const searchParams = buildFilterQueryParams({ lod: lodToLoad, filters });

    const url = `${API_BASE_URL}/pointclouds/stream-binary?${searchParams.toString()}`;

    const res = await fetch(url, { signal });

    if (!res.ok) {
        throw new Error(`Backend returned status ${res.status}: ${res.statusText}`);
    }

    const buffer = await res.arrayBuffer();
    const pointSizeInBytes = 16;
    const count = Math.floor(buffer.byteLength / pointSizeInBytes);

    if (count === 0) {
        throw new Error(`Received empty point cloud data buffer for LOD ${lodToLoad}`);
    }

    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const dataView = new DataView(buffer);
    const colorScale = 255;
    const tempColor = new THREE.Color();

    for (let i = 0; i < count; i++) {
        const offset = i * 16;
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
    geom.computeBoundingSphere();
    return geom;
}

/**
 * Unified progressive pointcloud loader.
 * Iterates sequentially from startLod (10) down to endLod (0).
 * Displays each loaded LOD immediately while fetching the next LOD in the background.
 */
export async function loadProgressivePointCloud(
    options: ProgressiveLoadOptions
): Promise<THREE.BufferGeometry | null> {
    const {
        id,
        streamKey,
        startLod = 10,
        endLod = 0,
        filters,
        signal,
        onLodLoaded,
        onError,
    } = options;

    if (!id || !id.trim()) return null;
    const key = streamKey || id;

    // If pointcloud stream key is currently in the process of being loaded, continue where it currently is at
    if (loadingPointClouds.has(key)) {
        return null;
    }

    loadingPointClouds.add(key);
    let currentBestGeometry: THREE.BufferGeometry | null = null;

    try {
        for (let currentLod = startLod; currentLod >= endLod; currentLod--) {
            if (signal?.aborted) {
                break;
            }

            try {
                const geom = await fetchBinaryGeometry(id, currentLod, signal, filters);

                if (signal?.aborted) {
                    geom.dispose();
                    break;
                }

                currentBestGeometry = geom;
                if (onLodLoaded) {
                    onLodLoaded(currentLod, geom);
                }
            } catch (err: unknown) {
                if (signal?.aborted || (err instanceof DOMException && err.name === "AbortError")) {
                    break;
                }
                console.warn(`[pointCloudLoader] Failed loading LOD ${currentLod} for ${key}:`, err);
                if (onError) {
                    onError(currentLod, err);
                }
            }
        }
    } finally {
        loadingPointClouds.delete(key);
    }

    return currentBestGeometry;
}


