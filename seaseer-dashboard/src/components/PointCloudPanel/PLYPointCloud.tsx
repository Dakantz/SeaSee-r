import { useCallback, useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { usePLYPointCloudContext } from "./PLYPointCloudContext";
import { generateDelaunayTerrainMesh } from "./utils/delaunayTriangulation";
import { TrajectoryRenderer } from "../RovRenderer/trajectoryRenderer";

export { CustomQueryManager, PointCloudList } from "./CustomQueryManager";
export { CustomQueryManagerContainer, PointCloudListContainer } from "./CustomQueryManagerContainer";
export type { CustomQuery, CustomQueryManagerProps, PointCloudItem, PointCloudListProps } from "./CustomQueryManager";
import { getBoundingBoxCenter, type CustomQuery, type QuerySummaryData } from "./CustomQueryManager";


// @ts-expect-error - geo-three submodule
import { MapView, DebugProvider, HeightDebugProvider, OpenStreetMapsProvider, OpenMapTilesProvider, MapTilerProvider, BingMapsProvider, BathymetryProvider, EmodnetProvider, UnitsUtils, MapNodeGeometry, MapHeightNodeShader, MapHeightNode, MapNodeHeightGeometry, MapPlaneNode, CanvasUtils } from "../../../public/geo-three/build/geo-three.module.js";

// Set skirt depth to 100.0 so the skirt extends down to height -100
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

            const canvas = CanvasUtils.createOffscreenCanvas(this.geometrySize + 1, this.geometrySize + 1);
            const context = canvas.getContext('2d') as CanvasRenderingContext2D;
            context.imageSmoothingEnabled = false;
            context.drawImage(image, 0, 0, MapHeightNode.tileSize, MapHeightNode.tileSize, 0, 0, canvas.width, canvas.height);
            const imageData = context.getImageData(0, 0, canvas.width, canvas.height);

            // Use skirtDepth = 100.0 so skirt extends down to height -100
            this.geometry = new MapNodeHeightGeometry(1, 1, this.geometrySize, this.geometrySize, true, 2000.0, imageData, true);
        } catch (e) {
            if (this.disposed) return;
            this.geometry = MapPlaneNode.baseGeometry;
        }
        this.heightLoaded = true;
    };
}

const TARGET_X = 1622520.9730428709;
const TARGET_Z = -5522707.795739262;

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
            <object3D ref={targetRef} position={[TARGET_X, 0, TARGET_Z]} />

            {/* Hemisphere light to create natural sky/ground vertical gradient */}
            <hemisphereLight
                color="#ffffff"
                groundColor="#334455"
                intensity={hemisphereLightIntensity}
                position={[TARGET_X, 10000, TARGET_Z]}
            />

            {/* Main directional key light angled from North-West to produce cartographic hillshading */}
            <directionalLight
                ref={keyLightRef}
                position={[TARGET_X - 5000, 8000, TARGET_Z - 5000]}
                intensity={keyLightIntensity}
                color="#ffffff"
            />

            {/* Secondary fill light angled from South-East to soften deep shadows */}
            <directionalLight
                ref={fillLightRef}
                position={[TARGET_X + 5000, 4000, TARGET_Z + 5000]}
                intensity={fillLightIntensity}
                color="#cce0ff"
            />
        </group>
    );
}

function getHeightFactor(y: number): number {
    return y > 0
        ? Math.max(0.1, y / 1000)
        : Math.max(0.0001, 0.1 * Math.exp(y / 1000));
}

const _tmpVecForward = new THREE.Vector3();
const _tmpVecRight = new THREE.Vector3();
const _tmpVecUp = new THREE.Vector3();
const _tmpVecDir = new THREE.Vector3();

const _colorSelected = new THREE.Color("#ff3344");
const _colorHovered = new THREE.Color("#ffaa00");
const _colorDefault = new THREE.Color("#00e5ff");

function CameraPositionControls() {
    const { camera, gl } = useThree();
    const isDragging = useRef(false);
    const dragButton = useRef<number | null>(null);
    const previousMouse = useRef({ x: 0, y: 0 });
    const euler = useRef(new THREE.Euler(0, 0, 0, "YXZ"));
    const keysPressed = useRef<{ [key: string]: boolean }>({});

    const initialized = useRef(false);
    useEffect(() => {
        if (!initialized.current) {
            camera.lookAt(TARGET_X, 0, TARGET_Z);
            euler.current.setFromQuaternion(camera.quaternion, "YXZ");
            initialized.current = true;
        }
    }, [camera]);

    useEffect(() => {
        const domElement = gl.domElement;

        const onPointerDown = (e: PointerEvent) => {
            isDragging.current = true;
            dragButton.current = e.button;
            previousMouse.current = { x: e.clientX, y: e.clientY };
            euler.current.setFromQuaternion(camera.quaternion, "YXZ");
        };

        const onPointerMove = (e: PointerEvent) => {
            if (!isDragging.current) return;

            const deltaX = e.clientX - previousMouse.current.x;
            const deltaY = e.clientY - previousMouse.current.y;
            previousMouse.current = { x: e.clientX, y: e.clientY };

            if (dragButton.current === 0) {
                // Left click: Rotate around current camera position
                const rotateSpeed = 0.003;
                euler.current.y -= deltaX * rotateSpeed;
                euler.current.x -= deltaY * rotateSpeed;

                const maxPitch = Math.PI / 2 - 0.01;
                euler.current.x = Math.max(-maxPitch, Math.min(maxPitch, euler.current.x));

                camera.quaternion.setFromEuler(euler.current);
            } else if (dragButton.current === 2 || dragButton.current === 1) {
                // Right or middle click: Pan camera position
                const heightFactor = getHeightFactor(camera.position.y);
                const panSpeed = 2.0 * heightFactor;
                const right = _tmpVecRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
                const up = _tmpVecUp.set(0, 1, 0).applyQuaternion(camera.quaternion);

                right.y = 0;
                up.y = 0;
                if (right.lengthSq() > 0) right.normalize();
                if (up.lengthSq() > 0) up.normalize();

                camera.position.addScaledVector(right, -deltaX * panSpeed);
                camera.position.addScaledVector(up, deltaY * panSpeed);
            }
        };

        const onPointerUp = () => {
            isDragging.current = false;
            dragButton.current = null;
        };

        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            const heightFactor = getHeightFactor(camera.position.y);
            const zoomSpeed = 1.0 * heightFactor;
            camera.getWorldDirection(_tmpVecDir);

            const moveDistance = -Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 100) * zoomSpeed;
            camera.position.addScaledVector(_tmpVecDir, moveDistance);
        };

        const onContextMenu = (e: MouseEvent) => {
            e.preventDefault();
        };

        const onKeyDown = (e: KeyboardEvent) => {
            keysPressed.current[e.code] = true;
        };

        const onKeyUp = (e: KeyboardEvent) => {
            keysPressed.current[e.code] = false;
        };

        domElement.addEventListener("pointerdown", onPointerDown);
        window.addEventListener("pointermove", onPointerMove);
        window.addEventListener("pointerup", onPointerUp);
        domElement.addEventListener("wheel", onWheel, { passive: false });
        domElement.addEventListener("contextmenu", onContextMenu);
        window.addEventListener("keydown", onKeyDown);
        window.addEventListener("keyup", onKeyUp);

        return () => {
            domElement.removeEventListener("pointerdown", onPointerDown);
            window.removeEventListener("pointermove", onPointerMove);
            window.removeEventListener("pointerup", onPointerUp);
            domElement.removeEventListener("wheel", onWheel);
            domElement.removeEventListener("contextmenu", onContextMenu);
            window.removeEventListener("keydown", onKeyDown);
            window.removeEventListener("keyup", onKeyUp);
        };
    }, [camera, gl]);

    useFrame((_, delta) => {
        if (
            document.activeElement &&
            (document.activeElement.tagName === "INPUT" ||
                document.activeElement.tagName === "TEXTAREA" ||
                document.activeElement.tagName === "SELECT")
        ) {
            return;
        }

        const keys = keysPressed.current;
        if (!keys) return;

        const isShift = keys["ShiftLeft"];
        const heightFactor = getHeightFactor(camera.position.y);
        const moveSpeed = (isShift ? 3000 : 800) * heightFactor * delta;

        camera.getWorldDirection(_tmpVecForward);
        const right = _tmpVecRight.set(1, 0, 0).applyQuaternion(camera.quaternion);

        if (keys["KeyW"]) {
            camera.position.addScaledVector(_tmpVecForward, moveSpeed);
        }
        if (keys["KeyS"]) {
            camera.position.addScaledVector(_tmpVecForward, -moveSpeed);
        }
        if (keys["KeyA"]) {
            camera.position.addScaledVector(right, -moveSpeed);
        }
        if (keys["KeyD"]) {
            camera.position.addScaledVector(right, moveSpeed);
        }
        if (keys["KeyE"]) {
            camera.position.y += moveSpeed;
        }
        if (keys["KeyQ"]) {
            camera.position.y -= moveSpeed;
        }
    });

    return null;
}

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
                case "Emodnet":
                    provider = new EmodnetProvider("https://ows.emodnet-bathymetry.eu/ows", "emodnet:mean", "", "image/png", "WCS");
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
                case "Emodnet":
                    heightProvider = new EmodnetProvider("https://ows.emodnet-bathymetry.eu/ows", "emodnet:mean", "", "image/png", "WCS", 1.0);
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
            // eslint-disable-next-line react-hooks/refs
            mapViewRef.current = map;
            return map;
        } catch (err) {
            console.error("Failed to initialize GeoThree MapView:", err);
            return null;
        }
    }, [showHeightmap, heightmapMode, heightmapMapProvider, heightmapHeightProvider]);

    useFrame(({ camera, gl, scene }) => {
        if (mapViewRef.current?.lod) {
            try {
                mapViewRef.current.lod.updateLOD(mapViewRef.current, camera, gl, scene);
            } catch (e) {
                // Ignore transient update errors on unmount/re-render
            }
        }
    });

    if (!showHeightmap || !mapView) return null;

    return <primitive object={mapView} position={[0, -0.5, 0]} />;
}

import type { PointCloudMetadataResponse } from "../../client";

function getItemCenter(item: PointCloudMetadataResponse): [number, number, number] {
    if (item.center && Array.isArray(item.center) && item.center.length === 3) {
        return [item.center[0], item.center[1], item.center[2]];
    }
    return [TARGET_X, 0, TARGET_Z];
}

function getQueryCenter(
    query: CustomQuery,
    summaryMap: Record<string, QuerySummaryData>,
    catalog: PointCloudMetadataResponse[]
): [number, number, number] {
    const summary = summaryMap[query.id];
    const center = getBoundingBoxCenter(summary);
    if (center) {
        return center;
    }
    const match = query.queryText.match(/pointcloud_id\s*=\s*['"]([^'"]+)['"]/i);
    if (match) {
        const pcId = match[1];
        const catalogItem = catalog.find((c) => c.id === pcId);
        if (catalogItem) {
            return getItemCenter(catalogItem);
        }
    }
    return [TARGET_X, 0, TARGET_Z];
}

function PointCloudCenterMarkers() {
    const {
        queries,
        summaryMap,
        catalog,
        selectedId,
        hoveredId,
        selectPointcloud,
        hoverPointcloud,
        fetchQuerySummary,
        focusCameraTarget,
        startProgressiveStream,
        setCustomQuery,
        identifier,
    } = usePLYPointCloudContext();

    const meshRef = useRef<THREE.InstancedMesh>(null);
    const dummy = useMemo(() => new THREE.Object3D(), []);
    const centerVec = useMemo(() => new THREE.Vector3(), []);
    const rotEuler = useMemo(() => new THREE.Euler(-Math.PI / 2, 0, 0), []);

    useEffect(() => {
        if (meshRef.current && meshRef.current.geometry) {
            meshRef.current.geometry.boundingSphere = new THREE.Sphere(
                new THREE.Vector3(0, 0, 0),
                Infinity
            );
        }
    }, [queries]);

    useEffect(() => {
        queries.forEach((q) => {
            if (!summaryMap[q.id]) {
                fetchQuerySummary(q.id, q.queryText);
            }
        });
    }, [queries, summaryMap, fetchQuerySummary]);

    useFrame(({ camera }) => {
        if (!meshRef.current || queries.length === 0) return;

        queries.forEach((query, index) => {
            const [cx, cy, cz] = getQueryCenter(query, summaryMap, catalog);
            centerVec.set(cx, cy, cz).applyEuler(rotEuler);
            const dist = camera.position.distanceTo(centerVec);

            const isSelected = query.id === selectedId || (selectedId != null && selectedId.length > 0 && query.queryText.includes(selectedId));
            const isHovered = query.id === hoveredId || (hoveredId != null && hoveredId.length > 0 && query.queryText.includes(hoveredId));

            const baseFactor = isSelected ? 0.025 : isHovered ? 0.02 : 0.012;
            const scale = Math.max(0.01, dist * baseFactor);

            dummy.position.set(cx, cy, cz);
            dummy.scale.set(scale, scale, scale);
            dummy.updateMatrix();
            meshRef.current!.setMatrixAt(index, dummy.matrix);

            const color = isSelected ? _colorSelected : isHovered ? _colorHovered : _colorDefault;
            meshRef.current!.setColorAt(index, color);
        });

        meshRef.current.instanceMatrix.needsUpdate = true;
        if (meshRef.current.instanceColor) {
            meshRef.current.instanceColor.needsUpdate = true;
        }
    });

    if (queries.length === 0) return null;

    const handleLoadQuery = (query: CustomQuery) => {
        selectPointcloud(query.id);
        if (setCustomQuery) {
            setCustomQuery(query.queryText);
        }
        const match = query.queryText.match(/pointcloud_id\s*=\s*['"]([^'"]+)['"]/i);
        const extractedId = match ? match[1] : null;
        const targetId =
            extractedId ||
            selectedId ||
            identifier ||
            (catalog.length > 0 ? catalog[0].id : null);

        if (targetId && targetId.trim() && startProgressiveStream) {
            startProgressiveStream(targetId, 10, 0, query.queryText, query.id);
        }
    };

    return (
        <instancedMesh
            ref={meshRef}
            args={[undefined, undefined, queries.length]}
            rotation={[-Math.PI / 2, 0, 0]}
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
                    const center = getQueryCenter(query, summaryMap, catalog);
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

function CameraFocusController() {
    const { camera, gl } = useThree();
    const { focusedId, focusTrigger, catalog } = usePLYPointCloudContext();

    const animState = useRef<{
        startTime: number;
        duration: number;
        startPos: THREE.Vector3;
        targetCamPos: THREE.Vector3;
        targetCenter: THREE.Vector3;
    } | null>(null);

    const startFocusAnimation = useCallback((targetCenter: THREE.Vector3) => {
        const targetCamPos = targetCenter.clone().add(new THREE.Vector3(0, 1500, 1500));

        animState.current = {
            startTime: performance.now() / 1000,
            duration: 0.6,
            startPos: camera.position.clone(),
            targetCamPos: targetCamPos,
            targetCenter: targetCenter.clone(),
        };
    }, [camera]);

    useEffect(() => {
        if (!focusedId) return;
        const item = catalog.find((pc) => pc.id === focusedId);
        if (item) {
            const [cx, cy, cz] = getItemCenter(item);
            const targetCenter = new THREE.Vector3(cx, cy, cz).applyEuler(
                new THREE.Euler(-Math.PI / 2, 0, 0)
            );
            startFocusAnimation(targetCenter);
        }
    }, [focusedId, focusTrigger, catalog, startFocusAnimation]);

    useEffect(() => {
        const handleFocusTarget = (e: Event) => {
            const customEvent = e as CustomEvent<{ x: number; y: number; z: number } | [number, number, number]>;
            const detail = customEvent.detail;
            if (!detail) return;
            let x: number, y: number, z: number;
            if (Array.isArray(detail)) {
                [x, y, z] = detail;
            } else {
                ({ x, y, z } = detail);
            }
            if (typeof x === "number" && typeof y === "number" && typeof z === "number") {
                const targetCenter = new THREE.Vector3(x, y, z).applyEuler(
                    new THREE.Euler(-Math.PI / 2, 0, 0)
                );
                startFocusAnimation(targetCenter);
            }
        };

        window.addEventListener("focus_camera_target", handleFocusTarget);
        return () => window.removeEventListener("focus_camera_target", handleFocusTarget);
    }, [startFocusAnimation]);

    useEffect(() => {
        const domElement = gl.domElement;

        const stopAnimation = () => {
            if (animState.current) {
                animState.current = null;
            }
        };

        const onKeyDown = (e: KeyboardEvent) => {
            if (
                document.activeElement &&
                (document.activeElement.tagName === "INPUT" ||
                    document.activeElement.tagName === "TEXTAREA" ||
                    document.activeElement.tagName === "SELECT")
            ) {
                return;
            }
            const navKeys = [
                "KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE", "Space",
                "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"
            ];
            if (navKeys.includes(e.code)) {
                stopAnimation();
            }
        };

        domElement.addEventListener("pointerdown", stopAnimation);
        domElement.addEventListener("wheel", stopAnimation, { passive: true });
        domElement.addEventListener("touchstart", stopAnimation, { passive: true });
        window.addEventListener("keydown", onKeyDown);

        return () => {
            domElement.removeEventListener("pointerdown", stopAnimation);
            domElement.removeEventListener("wheel", stopAnimation);
            domElement.removeEventListener("touchstart", stopAnimation);
            window.removeEventListener("keydown", onKeyDown);
        };
    }, [gl]);

    useFrame(() => {
        if (!animState.current) return;

        const { startTime, duration, startPos, targetCamPos, targetCenter } = animState.current;
        const now = performance.now() / 1000;
        const elapsed = now - startTime;
        const progress = Math.min(1, elapsed / duration);

        const easeT = 1 - Math.pow(1 - progress, 3);

        camera.position.lerpVectors(startPos, targetCamPos, easeT);
        camera.lookAt(targetCenter);

        if (progress >= 1) {
            camera.position.copy(targetCamPos);
            camera.lookAt(targetCenter);
            animState.current = null;
        }
    });

    return null;
}

function DBCameraTrajectoryDisplay() {
    const {
        showCameraTrajectories,
        loadedGeometries,
        loadingIds,
        summaryMap,
        mode,
    } = usePLYPointCloudContext();

    const displayedKeys = useMemo(() => {
        const keys = new Set<string>();
        for (const id of loadedGeometries.keys()) {
            if (id) keys.add(id);
        }
        if (loadingIds) {
            for (const id of loadingIds) {
                if (id) keys.add(id);
            }
        }
        return Array.from(keys);
    }, [loadedGeometries, loadingIds]);

    if (!showCameraTrajectories || displayedKeys.length === 0) return null;

    const apiBaseUrl = import.meta.env.VITE_API_URL || "http://localhost:8000";

    const routesToRender: Array<{
        key: string;
        url: string;
        allowedHeaderIds: Set<string>;
        position: [number, number, number];
    }> = [];

    for (const qId of displayedKeys) {
        const summary = summaryMap?.[qId];
        const connectedHeaders = summary?.connected_camera_headers;
        if (!connectedHeaders || connectedHeaders.length === 0) {
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
            const position: [number, number, number] =
                mode === "plyUrl" ? [TARGET_X, 0, TARGET_Z] : [0, 0, 0];

            routesToRender.push({
                key: `${qId}-${pcId}`,
                url: `${apiBaseUrl}/pointclouds/${pcId}/camera-routes`,
                allowedHeaderIds: headerIds,
                position,
            });
        });
    }

    if (routesToRender.length === 0) return null;

    return (
        <group>
            {routesToRender.map((route) => (
                <TrajectoryRenderer
                    key={route.key}
                    url={route.url}
                    allowedHeaderIds={route.allowedHeaderIds}
                    position={route.position}
                    rotation={[-Math.PI / 2, 0, 0]}
                    color={0x00ffcc}
                    lineWidth={3}
                    showPoints={true}
                    pointSize={1.5}
                />
            ))}
        </group>
    );
}

export default function PLYPointCloud() {
    const {
        geometry,
        renderMode,
        wireframe,
        pointSize,
        loadedGeometries,
    } = usePLYPointCloudContext();

    useEffect(() => {
        if (renderMode === "mesh") {
            if (geometry) {
                generateDelaunayTerrainMesh(geometry, true);
            }
            loadedGeometries.forEach((geom) => {
                generateDelaunayTerrainMesh(geom, true);
            });
        }
    }, [geometry, loadedGeometries, renderMode]);

    return (
        <group>
            <CameraPositionControls />
            <CameraFocusController />
            <SceneLighting />
            <GeoThreeHeightmap />
            <PointCloudCenterMarkers />
            <DBCameraTrajectoryDisplay />

            {/* Render dynamically streamed full pointcloud geometries */}
            {Array.from(loadedGeometries.entries()).map(([id, geom]) => (
                <group key={id}>
                    {renderMode === "mesh" ? (
                        <mesh geometry={geom} rotation={[-Math.PI / 2, 0, 0]}>
                            <meshStandardMaterial
                                vertexColors={!!geom.attributes.color}
                                side={THREE.DoubleSide}
                                wireframe={wireframe}
                                roughness={0.5}
                                metalness={0.1}
                            />
                        </mesh>
                    ) : (
                        <points geometry={geom} rotation={[-Math.PI / 2, 0, 0]}>
                            <pointsMaterial
                                vertexColors={!!geom.attributes.color}
                                size={pointSize}
                                sizeAttenuation
                            />
                        </points>
                    )}
                </group>
            ))}
        </group>
    );
}