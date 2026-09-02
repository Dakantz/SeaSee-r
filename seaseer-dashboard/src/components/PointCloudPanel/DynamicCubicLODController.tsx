import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { usePLYPointCloudContext } from "./PLYPointCloudContext";
import { generateDelaunayTerrainMesh } from "./utils/delaunayTriangulation";
import { fetchBinaryGeometry } from "./utils/pointCloudLoader";
import type { FilterRule } from "./utils/filterUtils";
import { getPointCloudTransform } from "./utils/pointCloudTransform";
import { PointCloudTransformItem } from "./PLYPointCloud";

export function getLodColor(lod: number): string {
    const colors: Record<number, string> = {
        0: "#ff0055", // Red/Pink (LOD 0 - highest detail)
        1: "#ffaa00", // Orange (LOD 1)
        2: "#ffff00", // Yellow (LOD 2)
        3: "#00ff66", // Bright Green (LOD 3)
        4: "#00ffff", // Cyan (LOD 4)
        5: "#0088ff", // Blue (LOD 5)
        6: "#aa00ff", // Purple (LOD 6)
        7: "#ff00aa", // Magenta (LOD 7)
        8: "#888888", // Gray (LOD 8)
        9: "#ffffff", // White (LOD 9)
        10: "#445566", // Slate (LOD 10 - Global)
    };
    return colors[lod] || "#ffffff";
}

export function BoxOutline({ width, height, depth, color }: { width: number; height: number; depth: number; color: string }) {
    const edgesGeometry = useMemo(() => {
        const box = new THREE.BoxGeometry(width, height, depth);
        const edges = new THREE.EdgesGeometry(box);
        box.dispose();
        return edges;
    }, [width, height, depth]);

    useEffect(() => {
        return () => {
            edgesGeometry.dispose();
        };
    }, [edgesGeometry]);

    return (
        <lineSegments geometry={edgesGeometry}>
            <lineBasicMaterial color={color} transparent opacity={0.7} />
        </lineSegments>
    );
}

export interface ChunkSlotData {
    key: string;
    queryId: string;
    lod: number;
    i?: number;
    j?: number;
    k?: number;
    bounds?: {
        minX: number; maxX: number;
        minY: number; maxY: number;
        minZ: number; maxZ: number;
    };
    geometry?: THREE.BufferGeometry;
    instancedGeometry?: THREE.InstancedBufferGeometry;
    status: "loading" | "loaded" | "empty";
    abortController?: AbortController;
}

export interface FetchTask {
    key: string;
    queryId: string;
    lod: number;
    i?: number;
    j?: number;
    k?: number;
    distSq: number;
    filters: FilterRule[];
    bounds?: {
        minX: number; maxX: number;
        minY: number; maxY: number;
        minZ: number; maxZ: number;
    };
}

/**
 * Helper to convert standard THREE.BufferGeometry point cloud attribute buffers
 * into a THREE.InstancedBufferGeometry for high-performance instanced point rendering.
 */
export function createInstancedPointGeometry(
    sourceGeometry: THREE.BufferGeometry,
    pointScale: number = 1.0
): THREE.InstancedBufferGeometry {
    const posAttr = sourceGeometry.getAttribute("position");
    const colorAttr = sourceGeometry.getAttribute("color");
    const count = posAttr ? posAttr.count : 0;

    // Base geometry instance shape (small 2D plane quad per point, as requested)
    const baseSize = Math.max(0.05, pointScale * 0.1);
    const baseGeo = new THREE.PlaneGeometry(baseSize, baseSize);

    const instancedGeom = new THREE.InstancedBufferGeometry();
    instancedGeom.index = baseGeo.index;
    instancedGeom.attributes = { ...baseGeo.attributes };

    if (count > 0 && posAttr) {
        const instanceMatrices = new Float32Array(count * 16);
        const tempMatrix = new THREE.Matrix4();
        const tempPos = new THREE.Vector3();
        const tempQuat = new THREE.Quaternion();
        const tempScale = new THREE.Vector3(1, 1, 1);

        const posArray = posAttr.array;
        for (let i = 0; i < count; i++) {
            tempPos.set(
                posArray[i * 3],
                posArray[i * 3 + 1],
                posArray[i * 3 + 2]
            );
            tempMatrix.compose(tempPos, tempQuat, tempScale);
            tempMatrix.toArray(instanceMatrices, i * 16);
        }

        instancedGeom.setAttribute(
            "instanceMatrix",
            new THREE.InstancedBufferAttribute(instanceMatrices, 16)
        );

        if (colorAttr) {
            instancedGeom.setAttribute(
                "instanceColor",
                new THREE.InstancedBufferAttribute(colorAttr.array as Float32Array, 3)
            );
        }
    }

    instancedGeom.instanceCount = count;

    if (sourceGeometry.boundingSphere) {
        instancedGeom.boundingSphere = sourceGeometry.boundingSphere.clone();
    } else {
        instancedGeom.computeBoundingSphere();
    }

    if (sourceGeometry.boundingBox) {
        instancedGeom.boundingBox = sourceGeometry.boundingBox.clone();
    } else {
        instancedGeom.computeBoundingBox();
    }

    baseGeo.dispose();
    return instancedGeom;
}

const W0_BASE_CELL_WIDTH = 0.25;
const MAX_CONCURRENT_FETCHES = 100;
const MOVEMENT_THRESHOLD_SQ = 0.025;

export function DynamicCubicLODController() {
    const { camera } = useThree();
    const {
        queries,
        summaryMap,
        catalog,
        renderMode,
        wireframe,
        pointSize,
        showOutlines,
    } = usePLYPointCloudContext();

    // Central source of truth: Array of loaded chunks
    const [loadedChunks, setLoadedChunks] = useState<ChunkSlotData[]>([]);

    const activeFetchesRef = useRef<number>(0);
    const pendingQueueRef = useRef<FetchTask[]>([]);
    const activeKeysRef = useRef<Set<string>>(new Set());
    const lastCamPosRef = useRef<THREE.Vector3>(new THREE.Vector3(NaN, NaN, NaN));

    const activeTargetQueries = useMemo(() => {
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        return queries.flatMap((q) => {
            const summary = summaryMap[q.id];
            if (summary?.connected_pointclouds && summary.connected_pointclouds.length > 0) {
                return summary.connected_pointclouds.map((pc) => {
                    const baseFilters = q.filters || [];
                    const hasPcFilter = baseFilters.some((f) => f.field === "pointcloud_id" && String(f.value) === pc.id);
                    const filters = hasPcFilter
                        ? baseFilters
                        : [
                            ...baseFilters,
                            { id: `filter-pc-${pc.id}`, field: "pointcloud_id", operator: "eq" as const, value: pc.id }
                        ];
                    return { id: pc.id, queryId: pc.id, filters };
                });
            }

            if (q.filters && q.filters.length > 0) {
                return [{ id: q.id, queryId: q.id, filters: q.filters }];
            }
            if (uuidRegex.test(q.id)) {
                return [{
                    id: q.id,
                    queryId: q.id,
                    filters: [{ id: `filter-${q.id}`, field: "pointcloud_id", operator: "eq" as const, value: q.id }]
                }];
            }
            return [{ id: q.id, queryId: q.id, filters: [] }];
        });
    }, [queries, summaryMap]);

    const processQueue = useCallback(() => {
        while (activeFetchesRef.current < MAX_CONCURRENT_FETCHES && pendingQueueRef.current.length > 0) {
            const task = pendingQueueRef.current.shift();
            if (!task) break;

            if (!activeKeysRef.current.has(task.key)) continue;

            activeFetchesRef.current++;
            const controller = new AbortController();

            setLoadedChunks((prevChunks) => {
                const newSlot: ChunkSlotData = {
                    key: task.key,
                    queryId: task.queryId,
                    lod: task.lod,
                    i: task.i,
                    j: task.j,
                    k: task.k,
                    bounds: task.bounds,
                    status: "loading",
                    abortController: controller,
                };
                const idx = prevChunks.findIndex((c) => c.key === task.key);
                if (idx >= 0) {
                    const updated = [...prevChunks];
                    updated[idx] = newSlot;
                    return updated;
                }
                return [...prevChunks, newSlot];
            });

            fetchBinaryGeometry(task.queryId, task.lod, controller.signal, task.filters)
                .then((geom) => {
                    if (controller.signal.aborted) {
                        geom.dispose();
                        return;
                    }
                    if (renderMode === "mesh") {
                        generateDelaunayTerrainMesh(geom, true);
                    }
                    const instancedGeom = createInstancedPointGeometry(geom, pointSize);

                    setLoadedChunks((prevChunks) => {
                        const idx = prevChunks.findIndex((c) => c.key === task.key);
                        if (idx === -1 || controller.signal.aborted) {
                            geom.dispose();
                            instancedGeom.dispose();
                            return prevChunks;
                        }
                        const updated = [...prevChunks];
                        updated[idx] = {
                            ...updated[idx],
                            geometry: geom,
                            instancedGeometry: instancedGeom,
                            status: "loaded",
                            abortController: undefined,
                        };
                        const loadedCount = updated.filter((c) => c.status === "loaded").length;
                        const loadingCount = updated.filter((c) => c.status === "loading").length;
                        console.log(
                            `[DynamicCubicLODController] Chunk Loaded: ${task.key} | Currently Loaded: ${loadedCount} | Currently Loading: ${loadingCount} | In Queue: ${pendingQueueRef.current.length}`
                        );
                        return updated;
                    });
                })
                .catch((_err) => {
                    if (controller.signal.aborted) return;
                    setLoadedChunks((prevChunks) => {
                        const idx = prevChunks.findIndex((c) => c.key === task.key);
                        if (idx === -1) return prevChunks;
                        const updated = [...prevChunks];
                        updated[idx] = {
                            ...updated[idx],
                            status: "empty",
                            abortController: undefined,
                        };
                        return updated;
                    });
                })
                .finally(() => {
                    activeFetchesRef.current--;
                    processQueue();
                });
        }
    }, [renderMode, pointSize]);

    useFrame(() => {
        if (activeTargetQueries.length === 0) return;

        const camPos = camera.position;

        if (
            !Number.isNaN(lastCamPosRef.current.x) &&
            camPos.distanceToSquared(lastCamPosRef.current) < MOVEMENT_THRESHOLD_SQ
        ) {
            return;
        }

        lastCamPosRef.current.copy(camPos);

        const newActiveKeys = new Set<string>();
        const newTasks: FetchTask[] = [];

        const loadedKeySet = new Set(loadedChunks.map((c) => c.key));

        for (const { id: queryId, filters: baseFilters } of activeTargetQueries) {
            // Transform world camera position to local pointcloud space if transform_matrix exists: p_local = M_world^-1 * p_world
            const { matrixArr } = getPointCloudTransform(queryId, summaryMap, catalog);
            let pcX = camPos.x;
            let pcY = camPos.y;
            let pcZ = camPos.z;

            if (matrixArr && matrixArr.length === 16) {
                const matWorld = new THREE.Matrix4().fromArray(matrixArr);
                const invMatWorld = matWorld.clone().invert();

                const localCamPos = camPos.clone().applyMatrix4(invMatWorld);
                pcX = localCamPos.x;
                pcY = localCamPos.y;
                pcZ = localCamPos.z;
            }

            // Global LOD 10 view
            const globalKey = `${queryId}_lod10_global`;
            newActiveKeys.add(globalKey);
            if (!loadedKeySet.has(globalKey)) {
                newTasks.push({
                    key: globalKey,
                    queryId,
                    lod: 10,
                    distSq: 0,
                    filters: baseFilters || [],
                });
            }

            // 3x3x3 cell neighborhood across spatial LOD levels (3x scaling factor so middle cube of LOD L overlaps 27 cubes of LOD L-1)
            for (let lod = 0; lod <= 9; lod++) {
                const wL = W0_BASE_CELL_WIDTH * Math.pow(3, lod);

                const centerI = Math.floor(pcX / wL);
                const centerJ = Math.floor(pcY / wL);
                const centerK = Math.floor(pcZ / wL);

                for (let dx = -1; dx <= 1; dx++) {
                    for (let dy = -1; dy <= 1; dy++) {
                        for (let dz = -1; dz <= 1; dz++) {
                            const i = centerI + dx;
                            const j = centerJ + dy;
                            const k = centerK + dz;

                            const chunkKey = `${queryId}_lod${lod}_${i}_${j}_${k}`;
                            newActiveKeys.add(chunkKey);

                            if (loadedKeySet.has(chunkKey)) continue;

                            const minX = i * wL;
                            const maxX = (i + 1) * wL;
                            const minY = j * wL;
                            const maxY = (j + 1) * wL;
                            const minZ = k * wL;
                            const maxZ = (k + 1) * wL;

                            const cellCenterX = (i + 0.5) * wL;
                            const cellCenterY = (j + 0.5) * wL;
                            const cellCenterZ = (k + 0.5) * wL;

                            const distSq =
                                Math.pow(cellCenterX - pcX, 2) +
                                Math.pow(cellCenterY - pcY, 2) +
                                Math.pow(cellCenterZ - pcZ, 2);

                            const combinedFilters: FilterRule[] = [
                                ...(baseFilters || []),
                                { id: `spatial-min_x-${lod}-${i}`, field: "min_x", operator: "gte", value: minX },
                                { id: `spatial-max_x-${lod}-${i}`, field: "max_x", operator: "lte", value: maxX },
                                { id: `spatial-min_y-${lod}-${j}`, field: "min_y", operator: "gte", value: minY },
                                { id: `spatial-max_y-${lod}-${j}`, field: "max_y", operator: "lte", value: maxY },
                                { id: `spatial-min_z-${lod}-${k}`, field: "min_z", operator: "gte", value: minZ },
                                { id: `spatial-max_z-${lod}-${k}`, field: "max_z", operator: "lte", value: maxZ },
                            ];

                            newTasks.push({
                                key: chunkKey,
                                queryId,
                                lod,
                                i, j, k,
                                distSq,
                                filters: combinedFilters,
                                bounds: { minX, maxX, minY, maxY, minZ, maxZ },
                            });
                        }
                    }
                }
            }
        }

        activeKeysRef.current = newActiveKeys;

        // Retain loaded chunks in memory until they are more than 3 times as far away as where they would be loaded
        setLoadedChunks((prevChunks) => {
            let changed = false;
            let evictedCount = 0;
            const remainingChunks: ChunkSlotData[] = [];

            for (const entry of prevChunks) {
                if (entry.key.endsWith("_global") || newActiveKeys.has(entry.key)) {
                    remainingChunks.push(entry);
                    continue;
                }

                if (
                    entry.i !== undefined &&
                    entry.j !== undefined &&
                    entry.k !== undefined &&
                    entry.lod !== undefined
                ) {
                    const { matrixArr } = getPointCloudTransform(entry.queryId, summaryMap, catalog);
                    let pcX = camPos.x;
                    let pcY = camPos.y;
                    let pcZ = camPos.z;

                    if (matrixArr && matrixArr.length === 16) {
                        const matWorld = new THREE.Matrix4().fromArray(matrixArr);
                        const invMatWorld = matWorld.clone().invert();

                        const localCamPos = camPos.clone().applyMatrix4(invMatWorld);
                        pcX = localCamPos.x;
                        pcY = localCamPos.y;
                        pcZ = localCamPos.z;
                    }

                    const wL = W0_BASE_CELL_WIDTH * Math.pow(3, entry.lod);
                    const camCenterI = Math.floor(pcX / wL);
                    const camCenterJ = Math.floor(pcY / wL);
                    const camCenterK = Math.floor(pcZ / wL);

                    const dx = Math.abs(entry.i - camCenterI);
                    const dy = Math.abs(entry.j - camCenterJ);
                    const dz = Math.abs(entry.k - camCenterK);

                    // Chunks are loaded when max(dx, dy, dz) <= 1 (3x3x3 grid).
                    // Keep in memory until max(dx, dy, dz) > 3 (more than 3x as far as loading threshold).
                    if (dx <= 3 && dy <= 3 && dz <= 3) {
                        remainingChunks.push(entry);
                        continue;
                    }
                }

                // Evict chunk resources
                if (entry.abortController) {
                    entry.abortController.abort();
                }
                if (entry.geometry) {
                    entry.geometry.dispose();
                }
                if (entry.instancedGeometry) {
                    entry.instancedGeometry.dispose();
                }
                evictedCount++;
                changed = true;
            }

            if (changed && evictedCount > 0) {
                const loadedCount = remainingChunks.filter((c) => c.status === "loaded").length;
                console.log(
                    `[DynamicCubicLODController] Evicted ${evictedCount} chunk(s) | Currently Loaded: ${loadedCount} | In Queue: ${pendingQueueRef.current.length}`
                );
            }

            return changed ? remainingChunks : prevChunks;
        });

        // Filter and merge pending queue tasks
        const existingQueuedKeys = new Set(pendingQueueRef.current.map((t) => t.key));
        const filteredPending = pendingQueueRef.current.filter((t) => newActiveKeys.has(t.key));

        for (const task of newTasks) {
            if (!existingQueuedKeys.has(task.key)) {
                filteredPending.push(task);
            }
        }

        // Priority ordering: LOD 10 first down to LOD 0 last, then closest cell center first
        filteredPending.sort((a, b) => {
            if (b.lod !== a.lod) {
                return b.lod - a.lod;
            }
            return a.distSq - b.distSq;
        });

        pendingQueueRef.current = filteredPending;
        processQueue();
    });

    useEffect(() => {
        if (renderMode === "mesh") {
            loadedChunks.forEach((chunk) => {
                if (chunk.geometry) {
                    generateDelaunayTerrainMesh(chunk.geometry, true);
                }
            });
        }
    }, [renderMode, loadedChunks]);

    useEffect(() => {
        setLoadedChunks((prevChunks) => {
            return prevChunks.map((chunk) => {
                if (chunk.geometry) {
                    if (chunk.instancedGeometry) {
                        chunk.instancedGeometry.dispose();
                    }
                    const newInstanced = createInstancedPointGeometry(chunk.geometry, pointSize);
                    return {
                        ...chunk,
                        instancedGeometry: newInstanced,
                    };
                }
                return chunk;
            });
        });
    }, [pointSize]);

    useEffect(() => {
        return () => {
            pendingQueueRef.current = [];
            activeKeysRef.current.clear();
            setLoadedChunks((prevChunks) => {
                prevChunks.forEach((entry) => {
                    entry.abortController?.abort();
                    entry.geometry?.dispose();
                    entry.instancedGeometry?.dispose();
                });
                return [];
            });
        };
    }, []);

    // Group loaded chunks by queryId for rendering under a single PointCloudTransformItem per pointcloud
    const chunksByQuery = useMemo(() => {
        const map = new Map<string, ChunkSlotData[]>();
        for (const chunk of loadedChunks) {
            if (!chunk.geometry && (!showOutlines || !chunk.bounds)) continue;
            if (!map.has(chunk.queryId)) {
                map.set(chunk.queryId, []);
            }
            map.get(chunk.queryId)!.push(chunk);
        }
        return map;
    }, [loadedChunks, showOutlines]);

    if (chunksByQuery.size === 0) return null;

    return (
        <group>
            {Array.from(chunksByQuery.entries()).map(([queryId, chunks]) => (
                <PointCloudTransformItem key={queryId} id={queryId}>
                    <group>
                        {chunks.map((chunk) => (
                            <group key={chunk.key}>
                                {renderMode === "mesh" ? (
                                    chunk.geometry && (
                                        <mesh geometry={chunk.geometry}>
                                            <meshStandardMaterial
                                                vertexColors={!!chunk.geometry.attributes.color}
                                                side={THREE.DoubleSide}
                                                wireframe={wireframe}
                                                roughness={0.5}
                                                metalness={0.1}
                                            />
                                        </mesh>
                                    )
                                ) : (
                                    chunk.instancedGeometry && (
                                        <instancedMesh
                                            ref={(mesh) => {
                                                if (mesh && chunk.instancedGeometry) {
                                                    const matrixAttr = chunk.instancedGeometry.getAttribute("instanceMatrix") as THREE.InstancedBufferAttribute;
                                                    const colorAttr = chunk.instancedGeometry.getAttribute("instanceColor") as THREE.InstancedBufferAttribute;
                                                    if (matrixAttr) mesh.instanceMatrix = matrixAttr;
                                                    if (colorAttr) mesh.instanceColor = colorAttr;
                                                    mesh.count = chunk.instancedGeometry.instanceCount;
                                                }
                                            }}
                                            args={[chunk.instancedGeometry, undefined, chunk.instancedGeometry.instanceCount]}
                                            frustumCulled={false}
                                        >
                                            <meshStandardMaterial
                                                vertexColors={!!chunk.instancedGeometry.attributes.instanceColor}
                                                side={THREE.DoubleSide}
                                                roughness={0.5}
                                                metalness={0.1}
                                                wireframe={wireframe}
                                            />
                                        </instancedMesh>
                                    )
                                )}

                                {/* Spatial Chunk Bounding Cube Outer Wireframe Visualizer */}
                                {showOutlines && chunk.bounds && (
                                    <group
                                        position={[
                                            (chunk.bounds.minX + chunk.bounds.maxX) / 2,
                                            (chunk.bounds.minY + chunk.bounds.maxY) / 2,
                                            (chunk.bounds.minZ + chunk.bounds.maxZ) / 2,
                                        ]}
                                    >
                                        <BoxOutline
                                            width={chunk.bounds.maxX - chunk.bounds.minX}
                                            height={chunk.bounds.maxY - chunk.bounds.minY}
                                            depth={chunk.bounds.maxZ - chunk.bounds.minZ}
                                            color={getLodColor(chunk.lod)}
                                        />
                                    </group>
                                )}
                            </group>
                        ))}
                    </group>
                </PointCloudTransformItem>
            ))}
        </group>
    );
}

export default DynamicCubicLODController;
