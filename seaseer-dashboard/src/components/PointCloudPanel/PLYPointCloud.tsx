import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { TransformControls } from "@react-three/drei";
import * as THREE from "three";
import { usePLYPointCloudContext, type PerfTestMetric, type PerfTestSummary } from "./PLYPointCloudContext";
import ViewportGizmoHelper from "./ViewportGizmoHelper";
import { TrajectoryRenderer } from "../RovRenderer/trajectoryRenderer";
import type { PositionSample } from "../TelemetoryPanel/TelemetryPositionReader";

export { CustomQueryManager, PointCloudList } from "./CustomQueryManager";
export { CustomQueryManagerContainer, PointCloudListContainer } from "./CustomQueryManagerContainer";
export type { CustomQuery, CustomQueryManagerProps, PointCloudItem, PointCloudListProps } from "./CustomQueryManager";
import { CameraMovementSystem, TARGET_X, TARGET_Y } from "./utils/CameraMovementController";
import { getPointCloudTransform } from "./utils/pointCloudTransform";
import DynamicCubicLODController, { BoxOutline } from "./DynamicCubicLODController";


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

function GeoThreeHeightmap() {
    const { showHeightmap, heightmapMode, heightmapMapProvider, heightmapHeightProvider } = usePLYPointCloudContext();
    const mapViewRef = useRef<any>(null);

    const mapView = useMemo(() => {
        if (!showHeightmap) return null;
        try {
            let provider: any;
            let heightProvider: any = null;
            const apiBaseUrl = (import.meta.env.VITE_API_URL || "http://localhost:8000").replace(/\/+$/, "");

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

function QuerySummaryOutlines() {
    const { queries, summaryMap, hoveredId, editingPointcloudId } = usePLYPointCloudContext();

    const outlineItems = useMemo(() => {
        const items: Array<{
            id: string;
            queryId: string;
            minX: number;
            minY: number;
            minZ: number;
            maxX: number;
            maxY: number;
            maxZ: number;
            transformMatrix?: number[];
            isHovered: boolean;
            isSelected: boolean;
        }> = [];

        queries.forEach((q) => {
            const summary = summaryMap[q.id];
            if (!summary) return;

            const isQueryHovered = q.id === hoveredId;
            const isQuerySelected = q.id === editingPointcloudId;

            let hasConnectedOutlines = false;

            // Render a separate bounding box for EVERY Connected Metadata record
            if (summary.connected_pointclouds && summary.connected_pointclouds.length > 0) {
                summary.connected_pointclouds.forEach((pc, idx) => {
                    if (
                        typeof pc.min_x === "number" && typeof pc.max_x === "number" &&
                        typeof pc.min_y === "number" && typeof pc.max_y === "number" &&
                        typeof pc.min_z === "number" && typeof pc.max_z === "number"
                    ) {
                        const isPcHovered = isQueryHovered || pc.id === hoveredId;
                        const isPcSelected = isQuerySelected || pc.id === editingPointcloudId;

                        items.push({
                            id: `connected-pc-bbox-${q.id}-${pc.id || idx}`,
                            queryId: q.id,
                            minX: pc.min_x,
                            minY: pc.min_y,
                            minZ: pc.min_z,
                            maxX: pc.max_x,
                            maxY: pc.max_y,
                            maxZ: pc.max_z,
                            transformMatrix: pc.transform_matrix && pc.transform_matrix.length === 16 ? pc.transform_matrix : undefined,
                            isHovered: isPcHovered,
                            isSelected: isPcSelected,
                        });
                        hasConnectedOutlines = true;
                    }
                });
            }

            // Fallback overall query summary bounding box if present and no connected bounds exist
            if (
                !hasConnectedOutlines &&
                summary.bounding_box &&
                typeof summary.bounding_box.min_x === "number" &&
                typeof summary.bounding_box.max_x === "number" &&
                typeof summary.bounding_box.min_y === "number" &&
                typeof summary.bounding_box.max_y === "number" &&
                typeof summary.bounding_box.min_z === "number" &&
                typeof summary.bounding_box.max_z === "number"
            ) {
                items.push({
                    id: `summary-bbox-${q.id}`,
                    queryId: q.id,
                    minX: summary.bounding_box.min_x,
                    minY: summary.bounding_box.min_y,
                    minZ: summary.bounding_box.min_z,
                    maxX: summary.bounding_box.max_x,
                    maxY: summary.bounding_box.max_y,
                    maxZ: summary.bounding_box.max_z,
                    isHovered: isQueryHovered,
                    isSelected: isQuerySelected,
                });
            }
        });

        return items;
    }, [queries, summaryMap, hoveredId, editingPointcloudId]);

    if (outlineItems.length === 0) return null;

    return (
        <group name="query-summary-outlines">
            {outlineItems.map((item) => {
                const width = Math.max(0.1, item.maxX - item.minX);
                const height = Math.max(0.1, item.maxY - item.minY);
                const depth = Math.max(0.1, item.maxZ - item.minZ);

                const cx = (item.minX + item.maxX) / 2;
                const cy = (item.minY + item.maxY) / 2;
                const cz = (item.minZ + item.maxZ) / 2;

                const color = item.isHovered ? "#ffaa00" : item.isSelected ? "#3b82f6" : "#00e5ff";

                return (
                    <QuerySingleOutlineBox
                        key={item.id}
                        cx={cx}
                        cy={cy}
                        cz={cz}
                        width={width}
                        height={height}
                        depth={depth}
                        color={color}
                        transformMatrix={item.transformMatrix}
                    />
                );
            })}
        </group>
    );
}

function QuerySingleOutlineBox({
    cx,
    cy,
    cz,
    width,
    height,
    depth,
    color,
    transformMatrix,
}: {
    cx: number;
    cy: number;
    cz: number;
    width: number;
    height: number;
    depth: number;
    color: string;
    transformMatrix?: number[];
}) {
    const groupRef = useRef<THREE.Group>(null);

    useEffect(() => {
        if (groupRef.current && transformMatrix && transformMatrix.length === 16) {
            const mat = new THREE.Matrix4().fromArray(transformMatrix);
            groupRef.current.matrix.copy(mat);
            groupRef.current.matrixAutoUpdate = false;
        } else if (groupRef.current) {
            groupRef.current.matrixAutoUpdate = true;
        }
    }, [transformMatrix]);

    return (
        <group ref={groupRef}>
            <group position={[cx, cy, cz]}>
                <BoxOutline width={width} height={height} depth={depth} color={color} />
            </group>
        </group>
    );
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

    const apiBaseUrl = (import.meta.env.VITE_API_URL || "http://localhost:8000").replace(/\/+$/, "");

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

export function PointCloudTransformItem({
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

const PERF_TEST_START_POS = new THREE.Vector3(10, -100, 10);
const PERF_TEST_END_POS = new THREE.Vector3(10, 100, -10);
const PERF_TEST_LOOK_TARGET = new THREE.Vector3(0, 0, 0);
const PERF_TEST_DURATION_SEC = 30;

export function PerformanceTestController() {
    const { camera } = useThree();
    const {
        perfTestTrigger,
        isPerfTestRunning,
        setIsPerfTestRunning,
        setPerfTestSummary,
        setPerfTestMetrics,
        setCurrentFps,
        setCurrentFrameTimeMs,
        pointCount,
    } = usePLYPointCloudContext();

    const isRunningRef = useRef<boolean>(false);
    const completedRef = useRef<boolean>(false);
    const totalElapsedSecRef = useRef<number>(0);
    const totalFramesRef = useRef<number>(0);
    const framesInSecRef = useRef<number>(0);
    const secTimerRef = useRef<number>(0);
    const secondCountRef = useRef<number>(0);
    const metricsRef = useRef<PerfTestMetric[]>([]);

    useEffect(() => {
        if (!isPerfTestRunning && isRunningRef.current) {
            isRunningRef.current = false;
            completedRef.current = true;
            console.log("[Performance Test Cancelled by User]");
        }
    }, [isPerfTestRunning]);

    useEffect(() => {
        if (perfTestTrigger === 0) return;

        camera.position.copy(PERF_TEST_START_POS);
        camera.up.set(0, 0, 1);
        camera.lookAt(PERF_TEST_LOOK_TARGET);

        totalElapsedSecRef.current = 0;
        totalFramesRef.current = 0;
        framesInSecRef.current = 0;
        secTimerRef.current = 0;
        secondCountRef.current = 0;
        metricsRef.current = [];

        completedRef.current = false;
        isRunningRef.current = true;

        console.log("=================================================");
        console.log("[Performance Test Started]");
        console.log("Start Camera Position:", PERF_TEST_START_POS);
        console.log("End Camera Position:", PERF_TEST_END_POS);
        console.log("Look At Target:", PERF_TEST_LOOK_TARGET);
        console.log(`Duration: ${PERF_TEST_DURATION_SEC} seconds`);
        console.log("=================================================");
    }, [perfTestTrigger, camera]);

    useFrame((_, delta) => {
        if (!isRunningRef.current || completedRef.current) return;

        totalElapsedSecRef.current += delta;
        const progress = Math.min(1, totalElapsedSecRef.current / PERF_TEST_DURATION_SEC);

        // Move camera slowly between start and end positions while rotating to continuously look at the center
        camera.position.lerpVectors(PERF_TEST_START_POS, PERF_TEST_END_POS, progress);
        camera.up.set(0, 0, 1);
        camera.lookAt(PERF_TEST_LOOK_TARGET);

        // Frame counting
        totalFramesRef.current++;
        framesInSecRef.current++;
        secTimerRef.current += delta;

        // Measure FPS and Frametime every 1 second
        if (secTimerRef.current >= 1.0) {
            secondCountRef.current += 1;
            const windowDuration = secTimerRef.current;
            const count = framesInSecRef.current;
            const calculatedFps = count > 0 && windowDuration > 0 ? Math.round((count / windowDuration) * 100) / 100 : 0;
            const calculatedFrameTimeMs = count > 0 ? Math.round((windowDuration / count) * 1000 * 100) / 100 : 0;
            const currentPoints = pointCount ?? 0;

            const metric: PerfTestMetric = {
                second: secondCountRef.current,
                fps: calculatedFps,
                frameTimeMs: calculatedFrameTimeMs,
                pointsCount: currentPoints,
                position: {
                    x: Math.round(camera.position.x * 1000) / 1000,
                    y: Math.round(camera.position.y * 1000) / 1000,
                    z: Math.round(camera.position.z * 1000) / 1000,
                },
            };

            metricsRef.current.push(metric);
            setCurrentFps(calculatedFps);
            setCurrentFrameTimeMs(calculatedFrameTimeMs);
            setPerfTestMetrics((prev) => [...prev, metric]);

            console.log(
                `[Performance Test] Second ${metric.second}s: ${metric.fps} FPS | ${metric.frameTimeMs} ms | ${metric.pointsCount.toLocaleString()} points | Pos: (${metric.position.x}, ${metric.position.y}, ${metric.position.z})`
            );

            framesInSecRef.current = 0;
            secTimerRef.current = 0; // Reset window accumulator
        }

        // Check completion
        if (progress >= 1.0) {
            // Capture remainder / final second if frames are pending
            if (framesInSecRef.current > 0) {
                secondCountRef.current += 1;
                const windowDuration = secTimerRef.current;
                const count = framesInSecRef.current;
                const calculatedFps = count > 0 && windowDuration > 0 ? Math.round((count / windowDuration) * 100) / 100 : 0;
                const calculatedFrameTimeMs = count > 0 ? Math.round((windowDuration / count) * 1000 * 100) / 100 : 0;
                const currentPoints = pointCount ?? 0;

                const metric: PerfTestMetric = {
                    second: secondCountRef.current,
                    fps: calculatedFps,
                    frameTimeMs: calculatedFrameTimeMs,
                    pointsCount: currentPoints,
                    position: {
                        x: Math.round(camera.position.x * 1000) / 1000,
                        y: Math.round(camera.position.y * 1000) / 1000,
                        z: Math.round(camera.position.z * 1000) / 1000,
                    },
                };

                metricsRef.current.push(metric);
                setCurrentFps(calculatedFps);
                setCurrentFrameTimeMs(calculatedFrameTimeMs);
                setPerfTestMetrics((prev) => [...prev, metric]);

                console.log(
                    `[Performance Test] Second ${metric.second}s (Final): ${metric.fps} FPS | ${metric.frameTimeMs} ms | ${metric.pointsCount.toLocaleString()} points | Pos: (${metric.position.x}, ${metric.position.y}, ${metric.position.z})`
                );

                framesInSecRef.current = 0;
                secTimerRef.current = 0;
            }

            camera.position.copy(PERF_TEST_END_POS);
            camera.up.set(0, 0, 1);
            camera.lookAt(PERF_TEST_LOOK_TARGET);

            const totalDurationSec = totalElapsedSecRef.current;
            const totalFrames = totalFramesRef.current;
            const averageFps = totalFrames > 0 && totalDurationSec > 0 ? Math.round((totalFrames / totalDurationSec) * 100) / 100 : 0;
            const averageFrameTimeMs = totalFrames > 0 ? Math.round((totalDurationSec / totalFrames) * 1000 * 100) / 100 : 0;

            const summary: PerfTestSummary = {
                averageFps,
                averageFrameTimeMs,
                totalFrames,
                totalDurationSec: Math.round(totalDurationSec * 100) / 100,
                metrics: [...metricsRef.current],
            };

            (window as any).__PLY_PERFORMANCE_TEST_RESULTS__ = summary;

            setPerfTestSummary(summary);
            setIsPerfTestRunning(false);
            completedRef.current = true;
            isRunningRef.current = false;

            console.log("=================================================");
            console.log("[Performance Test Completed]");
            console.log(`Average FPS: ${summary.averageFps}`);
            console.log(`Average Frametime: ${summary.averageFrameTimeMs} ms`);
            console.log(`Total Frames: ${summary.totalFrames}`);
            console.log(`Total Duration: ${summary.totalDurationSec}s`);
            console.log("Per-second breakdown:", summary.metrics);
            console.log("=================================================");
        }
    });

    return null;
}

export default function PLYPointCloud() {
    return (
        <group>
            <CameraMovementSystem />
            <ViewportGizmoHelper />
            <SceneLighting />
            <GeoThreeHeightmap />
            <QuerySummaryOutlines />
            <DBCameraTrajectoryDisplay />

            <DynamicCubicLODController />
            <PerformanceTestController />
        </group>
    );
}