import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { TransformControls } from "@react-three/drei";
import * as THREE from "three";
import { usePLYPointCloudContext } from "./PLYPointCloudContext";
import ViewportGizmoHelper from "./ViewportGizmoHelper";
import { generateDelaunayTerrainMesh } from "./utils/delaunayTriangulation";
import { TrajectoryRenderer } from "../RovRenderer/trajectoryRenderer";
import type { PositionSample } from "../TelemetoryPanel/TelemetryPositionReader";
import { fetchBinaryGeometry } from "./utils/pointCloudLoader";
import type { FilterRule } from "./utils/filterUtils";

export { CustomQueryManager, PointCloudList } from "./CustomQueryManager";
export { CustomQueryManagerContainer, PointCloudListContainer } from "./CustomQueryManagerContainer";
export type { CustomQuery, CustomQueryManagerProps, PointCloudItem, PointCloudListProps } from "./CustomQueryManager";
import { getBoundingBoxCenter, type CustomQuery, type QuerySummaryData, type ConnectedPointCloudMetadata } from "./CustomQueryManager";
import type { PointCloudMetadataResponse } from "../../client";
import { CameraMovementSystem, TARGET_X, TARGET_Y } from "./utils/CameraMovementController";


// @ts-expect-error - geo-three submodule
import { MapView, DebugProvider, HeightDebugProvider, OpenStreetMapsProvider, OpenMapTilesProvider, MapTilerProvider, BingMapsProvider, BathymetryProvider, EmodnetProvider, EmodnetTileProvider, EmodnetWCSProvider, UnitsUtils, MapNodeGeometry, MapHeightNodeShader, MapHeightNode, MapNodeHeightGeometry, MapPlaneNode, CanvasUtils } from "../../../public/geo-three/build/geo-three.module.js";

// Set skirt depth to 2000.0 so the skirt extends down to height -2000
MapHeightNodeShader.geometry = new MapNodeGeometry(1.0, 1.0, MapHeightNodeShader.geometrySize, MapHeightNodeShader.geometrySize, true, 2000.0);

if (MapHeightNode.prototype.loadHeightGeometry) {
    MapHeightNode.prototype.loadHeightGeometry = async function () {
        if (this.mapView?.heightProvider === null) {
            throw new Error('GeoThree: MapView.heightProvider provider is null.');
        }

        if (this.level < this.mapView.heightProvider.minZoom || this.level > this.mapView.heightProvider.maxZoom) {
            this.geometry = MapPlaneNode.baseGeometry;
            return;
        }

        try {
            const image = await this.mapView.heightProvider.fetchTile(this.level, this.x, this.y);
            if (this.disposed) return;

            // 1. Draw 1:1 onto a 256x256 canvas without downscaling to extract exact uncorrupted RGBA bytes
            const srcTileSize = MapHeightNode.tileSize; // 256
            const srcCanvas = CanvasUtils.createOffscreenCanvas(srcTileSize, srcTileSize);
            const srcContext = srcCanvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
            srcContext.imageSmoothingEnabled = false;
            srcContext.drawImage(image, 0, 0, srcTileSize, srcTileSize, 0, 0, srcTileSize, srcTileSize);
            const srcData = srcContext.getImageData(0, 0, srcTileSize, srcTileSize).data;

            // 2. Downsample to 17x17 via pure nearest-neighbor pixel sampling (prevents 2D canvas color byte interpolation craters)
            const dstSize = this.geometrySize + 1; // 17
            const dstCanvas = CanvasUtils.createOffscreenCanvas(dstSize, dstSize);
            const dstContext = dstCanvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
            const dstImageData = dstContext.createImageData(dstSize, dstSize);
            const dstData = dstImageData.data;

            for (let r = 0; r < dstSize; r++) {
                const srcY = Math.min(srcTileSize - 1, Math.round((r / (dstSize - 1)) * (srcTileSize - 1)));
                for (let c = 0; c < dstSize; c++) {
                    const srcX = Math.min(srcTileSize - 1, Math.round((c / (dstSize - 1)) * (srcTileSize - 1)));

                    const srcIdx = (srcY * srcTileSize + srcX) * 4;
                    const dstIdx = (r * dstSize + c) * 4;

                    dstData[dstIdx + 0] = srcData[srcIdx + 0];
                    dstData[dstIdx + 1] = srcData[srcIdx + 1];
                    dstData[dstIdx + 2] = srcData[srcIdx + 2];
                    dstData[dstIdx + 3] = srcData[srcIdx + 3];
                }
            }

            // 3. Build geometry with non-corrupted 17x17 height grid
            this.geometry = new MapNodeHeightGeometry(1, 1, this.geometrySize, this.geometrySize, true, 2000.0, dstImageData, true);
        } catch (e) {
            if (this.disposed) return;
            this.geometry = MapPlaneNode.baseGeometry;
        }
        this.heightLoaded = true;
    };
}

function SceneLighting() {
    const {
        keyLightIntensity,
        fillLightIntensity,
        hemisphereLightIntensity,
        ambientLightIntensity,
    } = usePLYPointCloudContext();

    const keyLightRef = useRef<THREE.DirectionalLight>(null);
    const fillLightRef = useRef<THREE.DirectionalLight>(null);
    const targetRef = useRef<THREE.Object3D>(null);

    useEffect(() => {
        if (targetRef.current) {
            if (keyLightRef.current) {
                keyLightRef.current.target = targetRef.current;
            }
            if (fillLightRef.current) {
                fillLightRef.current.target = targetRef.current;
            }
        }
    }, []);

    return (
        <group>
            {/* Base ambient illumination */}
            <ambientLight intensity={ambientLightIntensity} />

            {/* Target object for directional lights */}
            <object3D ref={targetRef} position={[TARGET_X, TARGET_Y, 0]} />

            {/* Hemisphere light to create natural sky/ground vertical gradient */}
            <hemisphereLight
                color="#ffffff"
                groundColor="#334455"
                intensity={hemisphereLightIntensity}
                position={[TARGET_X, TARGET_Y, 10000]}
            />

            {/* Main directional key light angled from North-West to produce cartographic hillshading */}
            <directionalLight
                ref={keyLightRef}
                position={[TARGET_X - 5000, TARGET_Y + 5000, 8000]}
                intensity={keyLightIntensity}
                color="#ffffff"
            />

            {/* Secondary fill light angled from South-East to soften deep shadows */}
            <directionalLight
                ref={fillLightRef}
                position={[TARGET_X + 5000, TARGET_Y - 5000, 4000]}
                intensity={fillLightIntensity}
                color="#cce0ff"
            />
        </group>
    );
}

const _colorHovered = new THREE.Color("#ffaa00");
const _colorDefault = new THREE.Color("#00e5ff");


function GeoThreeHeightmap() {
    const { showHeightmap, heightmapMode, heightmapMapProvider, heightmapHeightProvider } = usePLYPointCloudContext();
    const mapViewRef = useRef<any>(null);

    const mapView = useMemo(() => {
        if (!showHeightmap) return null;
        try {
            let provider: any;
            let heightProvider: any = null;
            const apiBaseUrl = import.meta.env.VITE_API_URL || "http://localhost:8000";

            const mapChoice = heightmapMapProvider ?? "OpenStreetMaps";
            const heightChoice = heightmapHeightProvider ?? "Bathymetry";

            // 1. Map Imagery Provider
            switch (mapChoice) {
                case "Bathymetry":
                    provider = new BathymetryProvider(`${apiBaseUrl}/bathymetry`);
                    break;
                case "EmodnetWMS":
                    provider = new EmodnetTileProvider();
                    break;
                case "EmodnetWCSBilinear":
                    provider = new EmodnetWCSProvider("https://ows.emodnet-bathymetry.eu/ows", "emodnet:mean", 1.0, true);
                    break;
                case "EmodnetWCSNearestNeighbour":
                    provider = new EmodnetWCSProvider("https://ows.emodnet-bathymetry.eu/ows", "emodnet:mean", 1.0, false);
                    break;
                case "Debug":
                    provider = new DebugProvider();
                    break;
                case "MapTilerBasic":
                    provider = new MapTilerProvider("6XkbBH0nwlhrFrcr1xa3", "maps", "basic", "png");
                    break;
                case "MapTilerOutdoor":
                    provider = new MapTilerProvider("6XkbBH0nwlhrFrcr1xa3", "maps", "outdoor", "png");
                    break;
                case "MapTilerSatellite":
                    provider = new MapTilerProvider("6XkbBH0nwlhrFrcr1xa3", "maps", "hybrid", "jpg");
                    break;

                case "Bing":
                    provider = new BingMapsProvider();
                    break;
                case "OpenStreetMaps":
                default:
                    provider = new OpenStreetMapsProvider();
                    break;
            }

            // 2. Height Data Provider
            switch (heightChoice) {
                case "Bathymetry":
                    heightProvider = new BathymetryProvider(`${apiBaseUrl}/bathymetry`);
                    break;
                case "EmodnetWCSBilinear":
                    heightProvider = new EmodnetWCSProvider("https://ows.emodnet-bathymetry.eu/ows", "emodnet:mean", 1.0, true);
                    break;
                case "EmodnetWCSNearestNeighbour":
                    heightProvider = new EmodnetWCSProvider("https://ows.emodnet-bathymetry.eu/ows", "emodnet:mean", 1.0, false);
                    break;
                case "Debug":
                    heightProvider = new HeightDebugProvider(new DebugProvider());
                    break;
                case "MapTiler":
                    heightProvider = new MapTilerProvider("6XkbBH0nwlhrFrcr1xa3", "tiles", "terrain-rgb", "png");
                    break;
                case "None":
                default:
                    heightProvider = null;
                    break;
            }

            const modeCode = (!heightProvider || heightChoice === "None")
                ? MapView.PLANAR
                : (MapView[heightmapMode] ?? MapView.HEIGHT);
            const map = new MapView(modeCode, provider, heightProvider);
            map.scale.set(
                UnitsUtils.EARTH_PERIMETER,
                1,
                UnitsUtils.EARTH_PERIMETER
            );
            map.rotation.x = Math.PI / 2;
            return map;
        } catch (err) {
            console.error("Failed to initialize GeoThree MapView:", err);
            return null;
        }
    }, [showHeightmap, heightmapMode, heightmapMapProvider, heightmapHeightProvider]);

    useEffect(() => {
        mapViewRef.current = mapView;
        return () => {
            if (mapView) {
                if (mapView.root?.dispose) {
                    mapView.root.dispose();
                }
                mapView.traverse((child: any) => {
                    if (child !== mapView && typeof child.dispose === "function") {
                        child.dispose();
                    }
                });
            }
        };
    }, [mapView]);

    useFrame(({ camera, gl, scene }) => {
        if (mapViewRef.current?.lod) {
            try {
                mapViewRef.current.lod.updateLOD(mapViewRef.current, camera, gl, scene);

                // Enforce THREE.NearestFilter on all terrain/height textures to prevent RGB channel interpolation craters
                mapViewRef.current.traverse((child: any) => {
                    if (child.material) {
                        const materials = Array.isArray(child.material) ? child.material : [child.material];
                        materials.forEach((mat: any) => {
                            if (mat.map && (mat.map.magFilter !== THREE.NearestFilter || mat.map.minFilter !== THREE.NearestFilter)) {
                                mat.map.magFilter = THREE.NearestFilter;
                                mat.map.minFilter = THREE.NearestFilter;
                                mat.map.needsUpdate = true;
                            }
                            if (mat.userData?.heightMap?.value && mat.userData.heightMap.value !== MapHeightNodeShader.defaultHeightTexture) {
                                const hm = mat.userData.heightMap.value;
                                if (hm.magFilter !== THREE.NearestFilter || hm.minFilter !== THREE.NearestFilter) {
                                    hm.magFilter = THREE.NearestFilter;
                                    hm.minFilter = THREE.NearestFilter;
                                    hm.needsUpdate = true;
                                }
                            }
                        });
                    }
                });
            } catch (e) {
                // Ignore transient update errors on unmount/re-render
            }
        }
    });

    if (!showHeightmap || !mapView) return null;

    return <primitive object={mapView} position={[0, -0.5, 0]} />;
}



function PointCloudCenterMarkers() {
    const {
        queries,
        summaryMap,
        hoveredId,
        selectPointcloud,
        hoverPointcloud,
        focusCameraTarget,
    } = usePLYPointCloudContext();

    const meshRef = useRef<THREE.InstancedMesh>(null);
    const dummy = useMemo(() => new THREE.Object3D(), []);

    useEffect(() => {
        if (!meshRef.current || queries.length === 0) return;

        if (meshRef.current.geometry) {
            meshRef.current.geometry.boundingSphere = new THREE.Sphere(
                new THREE.Vector3(0, 0, 0),
                Infinity
            );
        }

        queries.forEach((query, index) => {
            const [cx, cy, cz] = getBoundingBoxCenter(summaryMap[query.id]) || [TARGET_X, TARGET_Y, 0];

            const isHovered = query.id === hoveredId;

            // Fixed size in 3D world space
            const scale = isHovered ? 1.5 : 1.0;

            dummy.position.set(cx, cy, cz);
            dummy.scale.set(scale, scale, scale);
            dummy.updateMatrix();
            meshRef.current!.setMatrixAt(index, dummy.matrix);

            const color = isHovered ? _colorHovered : _colorDefault;
            meshRef.current!.setColorAt(index, color);
        });

        meshRef.current.instanceMatrix.needsUpdate = true;
        if (meshRef.current.instanceColor) {
            meshRef.current.instanceColor.needsUpdate = true;
        }
    }, [queries, summaryMap, hoveredId, dummy]);

    if (queries.length === 0) return null;

    const handleLoadQuery = (query: CustomQuery) => {
        selectPointcloud(query.id);
    };

    return (
        <instancedMesh
            ref={meshRef}
            args={[undefined, undefined, queries.length]}
            onClick={(e) => {
                e.stopPropagation();
                if (e.instanceId !== undefined && queries[e.instanceId]) {
                    const query = queries[e.instanceId];
                    handleLoadQuery(query);
                }
            }}
            onDoubleClick={(e) => {
                e.stopPropagation();
                if (e.instanceId !== undefined && queries[e.instanceId]) {
                    const query = queries[e.instanceId];
                    handleLoadQuery(query);
                    const center = getBoundingBoxCenter(summaryMap[query.id]) || [TARGET_X, TARGET_Y, 0];
                    focusCameraTarget(center);
                }
            }}
            onPointerOver={(e) => {
                e.stopPropagation();
                document.body.style.cursor = "pointer";
                if (e.instanceId !== undefined && queries[e.instanceId]) {
                    hoverPointcloud(queries[e.instanceId].id);
                }
            }}
            onPointerOut={(e) => {
                e.stopPropagation();
                document.body.style.cursor = "auto";
                hoverPointcloud(null);
            }}
        >
            <sphereGeometry args={[1, 16, 16]} />
            <meshStandardMaterial roughness={0.3} metalness={0.2} />
        </instancedMesh>
    );
}



function getPointCloudTransform(
    queryId: string,
    summaryMap?: Record<string, QuerySummaryData>,
    catalog?: PointCloudMetadataResponse[]
): { matrixArr?: number[]; center: [number, number, number] } {
    let matrixArr: number[] | undefined;
    let center: [number, number, number] = [0, 0, 0];

    if (!queryId) return { matrixArr, center };

    // Single source of truth: Array of ConnectedPointCloudMetadata
    const metadataList: ConnectedPointCloudMetadata[] = [];

    if (summaryMap) {
        // Collect from direct summaryMap[queryId]
        const summary = summaryMap[queryId];
        if (summary?.connected_pointclouds) {
            metadataList.push(...summary.connected_pointclouds);
        }

        // Collect from all summaries in summaryMap
        for (const currSummary of Object.values(summaryMap)) {
            if (currSummary?.connected_pointclouds) {
                for (const pc of currSummary.connected_pointclouds) {
                    if (pc && !metadataList.some((m) => m.id === pc.id)) {
                        metadataList.push(pc);
                    }
                }
            }
        }
    }

    if (catalog) {
        for (const pc of catalog) {
            if (pc && !metadataList.some((m) => m.id === pc.id)) {
                metadataList.push(pc as ConnectedPointCloudMetadata);
            }
        }
    }

    // 1. Check for exact match by pointcloud ID in ConnectedPointCloudMetadata[]
    const match = metadataList.find((m) => m.id === queryId);
    if (match) {
        if (match.transform_matrix && match.transform_matrix.length === 16) {
            matrixArr = match.transform_matrix;
        }
        if (match.center && Array.isArray(match.center) && match.center.length === 3) {
            center = [Number(match.center[0]), Number(match.center[1]), Number(match.center[2])];
        } else if (match.centerpoint && Array.isArray(match.centerpoint) && match.centerpoint.length === 3) {
            center = [Number(match.centerpoint[0]), Number(match.centerpoint[1]), Number(match.centerpoint[2])];
        }
    }

    // 2. If no exact ID match (e.g. queryId is a query container ID), fallback to first item with valid matrix
    if (!matrixArr && metadataList.length > 0) {
        for (const pc of metadataList) {
            if (pc.transform_matrix && pc.transform_matrix.length === 16) {
                matrixArr = pc.transform_matrix;
                break;
            }
        }
    }

    // 3. Fallback center from metadataList if center is still [0,0,0]
    if (center[0] === 0 && center[1] === 0 && center[2] === 0 && metadataList.length > 0) {
        for (const pc of metadataList) {
            if (pc.center && Array.isArray(pc.center) && pc.center.length === 3) {
                center = [Number(pc.center[0]), Number(pc.center[1]), Number(pc.center[2])];
                break;
            }
            if (pc.centerpoint && Array.isArray(pc.centerpoint) && pc.centerpoint.length === 3) {
                center = [Number(pc.centerpoint[0]), Number(pc.centerpoint[1]), Number(pc.centerpoint[2])];
                break;
            }
        }
    }

    // 4. Final fallback center from summary root
    if (center[0] === 0 && center[1] === 0 && center[2] === 0 && summaryMap?.[queryId]) {
        const summary = summaryMap[queryId];
        if (summary.centerpoint && Array.isArray(summary.centerpoint) && summary.centerpoint.length === 3) {
            center = [Number(summary.centerpoint[0]), Number(summary.centerpoint[1]), Number(summary.centerpoint[2])];
        } else if (summary.center && Array.isArray(summary.center) && summary.center.length === 3) {
            center = [Number(summary.center[0]), Number(summary.center[1]), Number(summary.center[2])];
        }
    }

    return { matrixArr, center };
}

function DBCameraTrajectoryDisplay() {
    const {
        showCameraTrajectories,
        queries,
        summaryMap,
        catalog,
        setCameraView,
        setIsCameraUpFixed,
    } = usePLYPointCloudContext();

    const headerMap = useMemo(() => {
        const map = new Map<string, { id: string; focal?: number | null; width?: number | null; height?: number | null }>();
        if (summaryMap) {
            Object.values(summaryMap).forEach((summary) => {
                if (summary?.connected_camera_headers) {
                    summary.connected_camera_headers.forEach((h) => {
                        if (h && h.id) {
                            map.set(h.id, h);
                        }
                    });
                }
            });
        }
        return map;
    }, [summaryMap]);

    const handlePointClick = useCallback(
        (sample: PositionSample, routePosition: [number, number, number], pcId?: string) => {
            if (!sample) return;

            if (sample.filename) {
                console.log("Clicked trajectory point filename:", sample.filename);
            }

            setIsCameraUpFixed(false);

            // Compute 3D camera position and orientation directly for native Z-up
            const routeOffset = new THREE.Vector3(...routePosition);

            // 1. Compute 3D camera position in world coordinates
            const localPos = new THREE.Vector3(sample.x, sample.y, sample.z);
            const worldPos = localPos.clone().add(routeOffset);

            // 2. Compute 3D camera orientation quaternion in world coordinates
            let worldQuat: THREE.Quaternion;
            if (sample.rotation && Array.isArray(sample.rotation) && sample.rotation.length === 4) {
                worldQuat = new THREE.Quaternion(
                    sample.rotation[0],
                    sample.rotation[1],
                    sample.rotation[2],
                    sample.rotation[3]
                );
            } else if (sample.direction && Array.isArray(sample.direction) && sample.direction.length === 3) {
                const worldDir = new THREE.Vector3(sample.direction[0], sample.direction[1], sample.direction[2]).normalize();

                const tempCam = new THREE.PerspectiveCamera();
                tempCam.up.set(0, 0, 1);
                tempCam.position.copy(worldPos);
                tempCam.lookAt(worldPos.clone().add(worldDir));
                worldQuat = tempCam.quaternion.clone();
            } else {
                worldQuat = new THREE.Quaternion();
            }

            // 3. Retrieve point cloud transformation matrix (full world matrix M_world)
            const targetId = pcId || "";
            const { matrixArr } = getPointCloudTransform(targetId, summaryMap, catalog);

            // Apply transformation matrix to position & quaternion before moving camera
            if (matrixArr && matrixArr.length === 16) {
                const matWorld = new THREE.Matrix4().fromArray(matrixArr);

                // Transform position: p_world = M_world * p_local
                worldPos.applyMatrix4(matWorld);

                // Transform orientation quaternion
                const transformPos = new THREE.Vector3();
                const transformQuat = new THREE.Quaternion();
                const transformScale = new THREE.Vector3();
                matWorld.decompose(transformPos, transformQuat, transformScale);

                worldQuat.premultiply(transformQuat);
            }

            // 4. Compute camera vertical FOV (in degrees) from camera header focal length
            let fovDeg: number | undefined = undefined;
            if (sample.cameraHeaderId && headerMap.has(sample.cameraHeaderId)) {
                const header = headerMap.get(sample.cameraHeaderId);
                if (header && typeof header.focal === "number" && header.width && header.height) {
                    const maxDim = Math.max(header.width, header.height);
                    const focalPixels = header.focal * maxDim;
                    if (focalPixels > 0) {
                        const fovRad = 2 * Math.atan((header.height / 2) / focalPixels);
                        fovDeg = fovRad * (180 / Math.PI);
                    }
                }
            }

            setCameraView({
                position: [worldPos.x, worldPos.y, worldPos.z],
                quaternion: [worldQuat.x, worldQuat.y, worldQuat.z, worldQuat.w],
                fov: fovDeg,
            });
        },
        [headerMap, setCameraView, setIsCameraUpFixed, summaryMap, catalog]
    );

    if (!showCameraTrajectories || queries.length === 0) return null;

    const apiBaseUrl = import.meta.env.VITE_API_URL || "http://localhost:8000";

    const routesToRender: Array<{
        key: string;
        pcId: string;
        url: string;
        allowedHeaderIds: Set<string>;
        position: [number, number, number];
    }> = [];

    const seenRouteKeys = new Set<string>();

    for (const query of queries) {
        const qId = query.id;
        if (!qId) continue;
        const summary = summaryMap?.[qId];
        const connectedHeaders = summary?.connected_camera_headers;
        if (!connectedHeaders || connectedHeaders.length === 0) {
            const query = queries.find((q) => q.id === qId);
            const pcIdRule = query?.filters?.find(
                (f) => f.field === "pointcloud_id" && (f.operator === "eq" || !f.operator)
            )?.value;
            const pcId = pcIdRule ? String(pcIdRule) : (qId.includes("-") && qId.length >= 32 ? qId : null);

            if (pcId) {
                const rKey = `${qId}-${pcId}`;
                if (!seenRouteKeys.has(rKey)) {
                    seenRouteKeys.add(rKey);
                    routesToRender.push({
                        key: rKey,
                        pcId,
                        url: `${apiBaseUrl}/pointclouds/${pcId}/camera-routes`,
                        allowedHeaderIds: new Set<string>(),
                        position: [0, 0, 0],
                    });
                }
            }
            continue;
        }

        // Group headers by pointcloud_id
        const headersByPc = new Map<string, Set<string>>();
        for (const header of connectedHeaders) {
            if (header.pointcloud_id && header.id) {
                if (!headersByPc.has(header.pointcloud_id)) {
                    headersByPc.set(header.pointcloud_id, new Set());
                }
                headersByPc.get(header.pointcloud_id)!.add(header.id);
            }
        }

        headersByPc.forEach((headerIds, pcId) => {
            const rKey = `${qId}-${pcId}`;
            if (!seenRouteKeys.has(rKey)) {
                seenRouteKeys.add(rKey);
                routesToRender.push({
                    key: rKey,
                    pcId,
                    url: `${apiBaseUrl}/pointclouds/${pcId}/camera-routes`,
                    allowedHeaderIds: headerIds,
                    position: [0, 0, 0],
                });
            }
        });
    }

    if (routesToRender.length === 0) return null;

    return (
        <group>
            {routesToRender.map((route) => (
                <PointCloudTransformItem key={route.key} id={route.pcId}>
                    <TrajectoryRenderer
                        url={route.url}
                        allowedHeaderIds={route.allowedHeaderIds}
                        position={route.position}
                        color={0x00ffcc}
                        lineWidth={3}
                        showPoints={true}
                        pointSize={1.5}
                        onPointClick={(sample) => handlePointClick(sample, route.position, route.pcId)}
                    />
                </PointCloudTransformItem>
            ))}
        </group>
    );
}

function getLodColor(lod: number): string {
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

function BoxOutline({ width, height, depth, color }: { width: number; height: number; depth: number; color: string }) {
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

interface ChunkSlotData {
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
    status: "loading" | "loaded" | "empty";
    abortController?: AbortController;
}

interface FetchTask {
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

const W0_BASE_CELL_WIDTH = 0.25;
const MAX_CONCURRENT_FETCHES = 100;
const MOVEMENT_THRESHOLD_SQ = 0.025;

function DynamicCubicLODController() {
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

    const [chunksMap, setChunksMap] = useState<Map<string, ChunkSlotData>>(new Map());
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

            setChunksMap((prevMap) => {
                const newMap = new Map(prevMap);
                newMap.set(task.key, {
                    key: task.key,
                    queryId: task.queryId,
                    lod: task.lod,
                    i: task.i,
                    j: task.j,
                    k: task.k,
                    bounds: task.bounds,
                    status: "loading",
                    abortController: controller,
                });
                return newMap;
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
                    setChunksMap((prevMap) => {
                        const entry = prevMap.get(task.key);
                        if (!entry || controller.signal.aborted) {
                            geom.dispose();
                            return prevMap;
                        }
                        const newMap = new Map(prevMap);
                        newMap.set(task.key, {
                            ...entry,
                            geometry: geom,
                            status: "loaded",
                            abortController: undefined,
                        });
                        return newMap;
                    });
                })
                .catch((_err) => {
                    if (controller.signal.aborted) return;
                    setChunksMap((prevMap) => {
                        const entry = prevMap.get(task.key);
                        if (!entry) return prevMap;
                        const newMap = new Map(prevMap);
                        newMap.set(task.key, {
                            ...entry,
                            status: "empty",
                            abortController: undefined,
                        });
                        return newMap;
                    });
                })
                .finally(() => {
                    activeFetchesRef.current--;
                    processQueue();
                });
        }
    }, []);

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
            if (!chunksMap.has(globalKey)) {
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

                            if (chunksMap.has(chunkKey)) continue;

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
        setChunksMap((prevMap) => {
            let changed = false;
            const newMap = new Map(prevMap);
            for (const [key, entry] of prevMap.entries()) {
                if (key.endsWith("_global")) continue;
                if (newActiveKeys.has(key)) continue;

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
                        continue;
                    }
                }

                if (entry.abortController) {
                    entry.abortController.abort();
                }
                if (entry.geometry) {
                    entry.geometry.dispose();
                }
                newMap.delete(key);
                changed = true;
            }
            return changed ? newMap : prevMap;
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
            chunksMap.forEach((chunk) => {
                if (chunk.geometry) {
                    generateDelaunayTerrainMesh(chunk.geometry, true);
                }
            });
        }
    }, [renderMode, chunksMap]);

    useEffect(() => {
        return () => {
            pendingQueueRef.current = [];
            activeKeysRef.current.clear();
            setChunksMap((prevMap) => {
                prevMap.forEach((entry) => {
                    entry.abortController?.abort();
                    entry.geometry?.dispose();
                });
                return new Map();
            });
        };
    }, []);

    // Group chunks by queryId for rendering under a single PointCloudTransformItem per pointcloud
    const chunksByQuery = useMemo(() => {
        const map = new Map<string, ChunkSlotData[]>();
        for (const chunk of chunksMap.values()) {
            if (!chunk.geometry && (!showOutlines || !chunk.bounds)) continue;
            if (!map.has(chunk.queryId)) {
                map.set(chunk.queryId, []);
            }
            map.get(chunk.queryId)!.push(chunk);
        }
        return map;
    }, [chunksMap, showOutlines]);

    if (chunksByQuery.size === 0) return null;

    return (
        <group>
            {Array.from(chunksByQuery.entries()).map(([queryId, chunks]) => (
                <PointCloudTransformItem key={queryId} id={queryId}>
                    <group>
                        {chunks.map((chunk) => (
                            <group key={chunk.key}>
                                {chunk.geometry && (
                                    renderMode === "mesh" ? (
                                        <mesh geometry={chunk.geometry}>
                                            <meshStandardMaterial
                                                vertexColors={!!chunk.geometry.attributes.color}
                                                side={THREE.DoubleSide}
                                                wireframe={wireframe}
                                                roughness={0.5}
                                                metalness={0.1}
                                            />
                                        </mesh>
                                    ) : (
                                        <points geometry={chunk.geometry}>
                                            <pointsMaterial
                                                vertexColors={!!chunk.geometry.attributes.color}
                                                size={pointSize * 0.25}
                                                sizeAttenuation
                                            />
                                        </points>
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

function PointCloudTransformItem({
    id,
    children,
}: {
    id: string;
    children: React.ReactNode;
}) {
    const {
        editingPointcloudId,
        gizmoMode,
        updatePointcloudTransform,
        summaryMap,
        queries,
        catalog,
        setIsGizmoDragging,
    } = usePLYPointCloudContext();

    const [pivotObj, setPivotObj] = useState<THREE.Group | null>(null);

    const isEditing = useMemo(() => {
        if (!editingPointcloudId || !gizmoMode) return false;
        if (editingPointcloudId === id) return true;

        const summary = summaryMap[editingPointcloudId];
        if (summary?.connected_pointclouds?.some((pc) => pc.id === id)) {
            return true;
        }

        const query = queries.find((q) => q.id === editingPointcloudId);
        const filterPcId = query?.filters?.find((f) => f.field === "pointcloud_id")?.value;
        if (filterPcId && String(filterPcId) === id) {
            return true;
        }

        return false;
    }, [editingPointcloudId, gizmoMode, id, summaryMap, queries]);

    // Retrieve saved transform_matrix (M_world) and center offset via getPointCloudTransform
    const { matrixArr, center } = useMemo(() => {
        return getPointCloudTransform(id, summaryMap, catalog);
    }, [id, summaryMap, catalog]);

    const [cx, cy, cz] = center;

    // Apply saved initial transform matrix from metadata onto pivot group
    // Formula: M_pivot = T(-c) * M_world * T(c)
    useEffect(() => {
        if (!pivotObj) return;

        const matWorld = (matrixArr && matrixArr.length === 16)
            ? new THREE.Matrix4().fromArray(matrixArr)
            : new THREE.Matrix4().identity();

        const Tc = new THREE.Matrix4().makeTranslation(cx, cy, cz);
        const T_neg_c = new THREE.Matrix4().makeTranslation(-cx, -cy, -cz);
        const matPivot = T_neg_c.clone().multiply(matWorld).multiply(Tc);

        matPivot.decompose(pivotObj.position, pivotObj.quaternion, pivotObj.scale);
        pivotObj.updateMatrix();
    }, [matrixArr, cx, cy, cz, pivotObj]);

    const handleObjectChange = useCallback(() => {
        if (!pivotObj) return;
        pivotObj.updateMatrix();
    }, [pivotObj]);

    const handleMouseUp = useCallback(() => {
        const targetId = id;
        if (!pivotObj || !targetId) return;
        pivotObj.updateMatrix();

        // Convert pivot delta matrix (matPivot) back to full world matrix (matWorld):
        // Formula: M_world = T(c) * M_pivot * T(-c)
        const matPivot = pivotObj.matrix;
        const Tc = new THREE.Matrix4().makeTranslation(cx, cy, cz);
        const T_neg_c = new THREE.Matrix4().makeTranslation(-cx, -cy, -cz);
        const matWorld = Tc.clone().multiply(matPivot).multiply(T_neg_c);

        const matrixArray = matWorld.toArray();
        updatePointcloudTransform(targetId, matrixArray);
    }, [id, pivotObj, cx, cy, cz, updatePointcloudTransform]);

    return (
        <group>
            <group position={[cx, cy, cz]}>
                <group ref={setPivotObj}>
                    <group position={[-cx, -cy, -cz]}>
                        {children}
                    </group>
                </group>
            </group>

            {isEditing && pivotObj && (
                <TransformControls
                    object={pivotObj}
                    mode={gizmoMode!}
                    onMouseDown={() => setIsGizmoDragging(true)}
                    onMouseUp={() => {
                        setIsGizmoDragging(false);
                        handleMouseUp();
                    }}
                    onObjectChange={handleObjectChange}
                />
            )}
        </group>
    );
}



export default function PLYPointCloud() {
    return (
        <group>
            <CameraMovementSystem />
            <ViewportGizmoHelper />
            <SceneLighting />
            <GeoThreeHeightmap />
            <PointCloudCenterMarkers />
            <DBCameraTrajectoryDisplay />

            <DynamicCubicLODController />
        </group>
    );
}