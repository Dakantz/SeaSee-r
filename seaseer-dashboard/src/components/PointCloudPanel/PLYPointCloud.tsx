import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { TransformControls } from "@react-three/drei";
import * as THREE from "three";
import { usePLYPointCloudContext } from "./PLYPointCloudContext";
import { generateDelaunayTerrainMesh } from "./utils/delaunayTriangulation";
import { TrajectoryRenderer } from "../RovRenderer/trajectoryRenderer";
import { fetchBinaryGeometry } from "./utils/pointCloudLoader";
import type { FilterRule } from "./utils/filterUtils";

export { CustomQueryManager, PointCloudList } from "./CustomQueryManager";
export { CustomQueryManagerContainer, PointCloudListContainer } from "./CustomQueryManagerContainer";
export type { CustomQuery, CustomQueryManagerProps, PointCloudItem, PointCloudListProps } from "./CustomQueryManager";
import { getBoundingBoxCenter, type CustomQuery } from "./CustomQueryManager";


// @ts-expect-error - geo-three submodule
import { MapView, DebugProvider, HeightDebugProvider, OpenStreetMapsProvider, OpenMapTilesProvider, MapTilerProvider, BingMapsProvider, BathymetryProvider, EmodnetProvider, EmodnetTileProvider, EmodnetWCSProvider, UnitsUtils, MapNodeGeometry, MapHeightNodeShader, MapHeightNode, MapNodeHeightGeometry, MapPlaneNode, CanvasUtils } from "../../../public/geo-three/build/geo-three.module.js";

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

const TARGET_X = 1622520.9730428709;
const TARGET_Y = -5522707.795739262;

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

function getHeightFactor(z: number): number {
    return Math.max(0.1, Math.abs(z) / 1000);
}

const _qYaw = new THREE.Quaternion();
const _qPitch = new THREE.Quaternion();
const _tmpVecForward = new THREE.Vector3();
const _tmpVecRight = new THREE.Vector3();
const _tmpVecUp = new THREE.Vector3();
const _tmpVecDir = new THREE.Vector3();

const _colorHovered = new THREE.Color("#ffaa00");
const _colorDefault = new THREE.Color("#00e5ff");

function CameraPositionControls() {
    const { camera, gl } = useThree();
    const { isGizmoDragging } = usePLYPointCloudContext();
    const isGizmoDraggingRef = useRef(isGizmoDragging);
    const isDragging = useRef(false);
    const dragButton = useRef<number | null>(null);
    const previousMouse = useRef({ x: 0, y: 0 });
    const keysPressed = useRef<{ [key: string]: boolean }>({});

    useEffect(() => {
        isGizmoDraggingRef.current = isGizmoDragging;
        if (isGizmoDragging) {
            isDragging.current = false;
            dragButton.current = null;
        }
    }, [isGizmoDragging]);

    const initialized = useRef(false);
    useEffect(() => {
        if (!initialized.current) {
            camera.up.set(0, 0, 1);
            camera.lookAt(TARGET_X, TARGET_Y, 0);
            initialized.current = true;
        }
    }, [camera]);

    useEffect(() => {
        const domElement = gl.domElement;

        const onPointerDown = (e: PointerEvent) => {
            if (isGizmoDraggingRef.current) return;
            isDragging.current = true;
            dragButton.current = e.button;
            previousMouse.current = { x: e.clientX, y: e.clientY };
        };

        const onPointerMove = (e: PointerEvent) => {
            if (isGizmoDraggingRef.current || !isDragging.current) return;

            const deltaX = e.clientX - previousMouse.current.x;
            const deltaY = e.clientY - previousMouse.current.y;
            previousMouse.current = { x: e.clientX, y: e.clientY };

            if (dragButton.current === 0) {
                // Left click: Rotate around current camera position using quaternions
                const rotateSpeed = 0.003;

                // 1. Yaw rotation around local camera Up-axis
                const up = _tmpVecUp.set(0, 1, 0).applyQuaternion(camera.quaternion).normalize();
                _qYaw.setFromAxisAngle(up, -deltaX * rotateSpeed);

                // 2. Pitch rotation around local camera Right-axis
                const right = _tmpVecRight.set(1, 0, 0).applyQuaternion(camera.quaternion).normalize();
                _qPitch.setFromAxisAngle(right, -deltaY * rotateSpeed);

                // Apply pitch then yaw to camera quaternion
                camera.quaternion.premultiply(_qPitch).premultiply(_qYaw).normalize();
            } else if (dragButton.current === 2 || dragButton.current === 1) {
                // Right or middle click: Pan camera position
                const heightFactor = getHeightFactor(camera.position.z);
                const panSpeed = 2.0 * heightFactor;
                const right = _tmpVecRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
                const up = _tmpVecUp.set(0, 1, 0).applyQuaternion(camera.quaternion);

                right.z = 0;
                up.z = 0;
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
            if (isGizmoDraggingRef.current) return;
            e.preventDefault();
            const heightFactor = getHeightFactor(camera.position.z);
            const zoomSpeed = 1.0 * heightFactor;
            camera.getWorldDirection(_tmpVecDir);

            const moveDistance = -Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 100) * zoomSpeed;
            camera.position.addScaledVector(_tmpVecDir, moveDistance);
        };

        const onContextMenu = (e: MouseEvent) => {
            e.preventDefault();
        };

        const onKeyDown = (e: KeyboardEvent) => {
            if (isGizmoDraggingRef.current) return;
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
        if (isGizmoDraggingRef.current) return;
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
        const heightFactor = getHeightFactor(camera.position.z);
        const moveSpeed = (isShift ? 3000 : 800) * heightFactor * delta;

        camera.getWorldDirection(_tmpVecForward);
        const right = _tmpVecRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
        const up = _tmpVecUp.set(0, 1, 0).applyQuaternion(camera.quaternion);

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
            camera.position.addScaledVector(up, moveSpeed);
        }
        if (keys["KeyQ"]) {
            camera.position.addScaledVector(up, -moveSpeed);
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
        startProgressiveStream,
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
        if (startProgressiveStream) {
            startProgressiveStream(query.id, 10, 0, query.filters);
        }
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

import type { PositionSample } from "../TelemetoryPanel/TelemetryPositionReader";

function CameraFocusController() {
    const { camera, gl } = useThree();
    const { cameraTarget, cameraViewTarget } = usePLYPointCloudContext();

    const animState = useRef<{
        startTime: number;
        duration: number;
        startPos: THREE.Vector3;
        targetCamPos: THREE.Vector3;
        targetCenter: THREE.Vector3;
    } | null>(null);

    const viewAnimState = useRef<{
        startTime: number;
        duration: number;
        startPos: THREE.Vector3;
        targetPos: THREE.Vector3;
        startQuat: THREE.Quaternion;
        targetQuat: THREE.Quaternion;
        startFov: number;
        targetFov: number;
    } | null>(null);

    const startFocusAnimation = useCallback((targetCenter: THREE.Vector3, customOffset?: [number, number, number] | number) => {
        let offsetVec = new THREE.Vector3(0, -150, 150);
        if (customOffset !== undefined) {
            if (Array.isArray(customOffset)) {
                offsetVec = new THREE.Vector3(...customOffset);
            } else if (typeof customOffset === "number") {
                offsetVec = new THREE.Vector3(0, -customOffset, customOffset);
            }
        }
        const targetCamPos = targetCenter.clone().add(offsetVec);

        viewAnimState.current = null;
        animState.current = {
            startTime: performance.now() / 1000,
            duration: 0.6,
            startPos: camera.position.clone(),
            targetCamPos: targetCamPos,
            targetCenter: targetCenter.clone(),
        };
    }, [camera]);

    useEffect(() => {
        if (!cameraTarget) return;
        const { x, y, z, offset } = cameraTarget;
        if (typeof x === "number" && typeof y === "number" && typeof z === "number") {
            const targetCenter = new THREE.Vector3(x, y, z);
            startFocusAnimation(targetCenter, offset);
        }
    }, [cameraTarget, startFocusAnimation]);

    useEffect(() => {
        if (!cameraViewTarget) return;
        const { position, quaternion, fov } = cameraViewTarget;
        const targetPos = new THREE.Vector3(...position);

        let targetQuat: THREE.Quaternion;
        if (quaternion && quaternion.length === 4) {
            targetQuat = new THREE.Quaternion(quaternion[0], quaternion[1], quaternion[2], quaternion[3]);
        } else {
            targetQuat = camera.quaternion.clone();
        }

        const perspCam = camera as THREE.PerspectiveCamera;
        const startFov = perspCam.fov ?? 60;
        const targetFov = fov ?? startFov;

        animState.current = null;
        viewAnimState.current = {
            startTime: performance.now() / 1000,
            duration: 0.6,
            startPos: camera.position.clone(),
            targetPos,
            startQuat: camera.quaternion.clone(),
            targetQuat,
            startFov,
            targetFov,
        };
    }, [cameraViewTarget, camera]);

    useEffect(() => {
        const domElement = gl.domElement;

        const stopAnimation = () => {
            if (animState.current) {
                animState.current = null;
            }
            if (viewAnimState.current) {
                viewAnimState.current = null;
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
                "KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE"
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
        if (animState.current) {
            const { startTime, duration, startPos, targetCamPos, targetCenter } = animState.current;
            const now = performance.now() / 1000;
            const elapsed = now - startTime;
            const progress = Math.min(1, elapsed / duration);
            const easeT = 1 - Math.pow(1 - progress, 3);

            camera.position.lerpVectors(startPos, targetCamPos, easeT);
            camera.up.set(0, 0, 1);
            camera.lookAt(targetCenter);

            if (progress >= 1) {
                camera.position.copy(targetCamPos);
                camera.up.set(0, 0, 1);
                camera.lookAt(targetCenter);
                animState.current = null;
            }
            return;
        }

        if (viewAnimState.current) {
            const { startTime, duration, startPos, targetPos, startQuat, targetQuat, startFov, targetFov } = viewAnimState.current;
            const now = performance.now() / 1000;
            const elapsed = now - startTime;
            const progress = Math.min(1, elapsed / duration);
            const easeT = 1 - Math.pow(1 - progress, 3);

            camera.position.lerpVectors(startPos, targetPos, easeT);
            camera.quaternion.slerpQuaternions(startQuat, targetQuat, easeT);

            const perspCam = camera as THREE.PerspectiveCamera;
            if (perspCam.fov !== undefined && startFov !== targetFov) {
                perspCam.fov = THREE.MathUtils.lerp(startFov, targetFov, easeT);
                perspCam.updateProjectionMatrix();
            }

            if (progress >= 1) {
                camera.position.copy(targetPos);
                camera.quaternion.copy(targetQuat);
                if (perspCam.fov !== undefined && targetFov) {
                    perspCam.fov = targetFov;
                    perspCam.updateProjectionMatrix();
                }
                viewAnimState.current = null;
            }
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
        setCameraView,
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

    const handlePointClick = useCallback((sample: PositionSample, routePosition: [number, number, number]) => {
        if (!sample) return;

        if (sample.filename) {
            console.log("Clicked trajectory point filename:", sample.filename);
        }

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

        // 3. Compute camera vertical FOV (in degrees) from camera header focal length
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
    }, [headerMap, setCameraView]);

    if (!showCameraTrajectories || displayedKeys.length === 0) return null;

    const apiBaseUrl = import.meta.env.VITE_API_URL || "http://localhost:8000";

    const routesToRender: Array<{
        key: string;
        pcId: string;
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
                mode === "plyUrl" ? [TARGET_X, TARGET_Y, 0] : [0, 0, 0];

            routesToRender.push({
                key: `${qId}-${pcId}`,
                pcId,
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
                <PointCloudTransformItem key={route.key} id={route.pcId}>
                    <TrajectoryRenderer
                        url={route.url}
                        allowedHeaderIds={route.allowedHeaderIds}
                        position={route.position}
                        color={0x00ffcc}
                        lineWidth={3}
                        showPoints={true}
                        pointSize={1.5}
                        onPointClick={(sample) => handlePointClick(sample, route.position)}
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
const SHOW_OUTLINES = false

function DynamicCubicLODController() {
    const { camera } = useThree();
    const {
        queries,
        loadedGeometries,
        mode,
        renderMode,
        wireframe,
        pointSize,
    } = usePLYPointCloudContext();

    const [chunksMap, setChunksMap] = useState<Map<string, ChunkSlotData>>(new Map());
    const activeFetchesRef = useRef<number>(0);
    const pendingQueueRef = useRef<FetchTask[]>([]);
    const activeKeysRef = useRef<Set<string>>(new Set());
    const lastCamPosRef = useRef<THREE.Vector3>(new THREE.Vector3(NaN, NaN, NaN));

    const activeTargetQueries = useMemo(() => {
        if (mode !== "binary") return [];
        const targets: Array<{ id: string; filters?: FilterRule[] }> = [];
        const targetIds = new Set<string>();

        for (const id of loadedGeometries.keys()) {
            if (id) targetIds.add(id);
        }
        for (const q of queries) {
            if (q.id) targetIds.add(q.id);
        }

        for (const id of targetIds) {
            const matchedQuery = queries.find((q) => q.id === id);
            targets.push({
                id,
                filters: matchedQuery?.filters || [
                    { id: `filter-${id}`, field: "pointcloud_id", operator: "eq", value: id }
                ]
            });
        }
        return targets;
    }, [mode, loadedGeometries, queries]);

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
        if (mode !== "binary" || activeTargetQueries.length === 0) return;

        const camPos = camera.position;

        if (
            !Number.isNaN(lastCamPosRef.current.x) &&
            camPos.distanceToSquared(lastCamPosRef.current) < MOVEMENT_THRESHOLD_SQ
        ) {
            return;
        }

        lastCamPosRef.current.copy(camPos);

        const pcX = camPos.x;
        const pcY = camPos.y;
        const pcZ = camPos.z;

        const newActiveKeys = new Set<string>();
        const newTasks: FetchTask[] = [];

        for (const { id: queryId, filters: baseFilters } of activeTargetQueries) {
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

    if (mode !== "binary" || chunksMap.size === 0) return null;

    return (
        <group>
            {Array.from(chunksMap.values()).map((chunk) => {
                if (!chunk.geometry && (!SHOW_OUTLINES || !chunk.bounds)) return null;
                return (
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
                                        size={pointSize * 0.0025 * Math.pow(2, chunk.lod)}
                                        sizeAttenuation
                                    />
                                </points>
                            )
                        )}

                        {/* Spatial Chunk Bounding Cube Outer Wireframe Visualizer */}
                        {SHOW_OUTLINES && chunk.bounds && (
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
                );
            })}
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

    // Use the saved center coordinates stored inside querysummary
    const center = useMemo<[number, number, number]>(() => {
        const keysToCheck = [id, editingPointcloudId].filter(Boolean) as string[];

        for (const key of keysToCheck) {
            const summary = summaryMap[key];
            if (!summary) continue;

            // Check saved centerpoint or center on summary
            if (summary.centerpoint && Array.isArray(summary.centerpoint) && summary.centerpoint.length === 3) {
                return [Number(summary.centerpoint[0]), Number(summary.centerpoint[1]), Number(summary.centerpoint[2])];
            }
            if (summary.center && Array.isArray(summary.center) && summary.center.length === 3) {
                return [Number(summary.center[0]), Number(summary.center[1]), Number(summary.center[2])];
            }

            // Check saved connected_pointclouds metadata entries for center or centerpoint
            if (summary.connected_pointclouds) {
                for (const meta of summary.connected_pointclouds) {
                    if (meta.center && Array.isArray(meta.center) && meta.center.length === 3) {
                        return [Number(meta.center[0]), Number(meta.center[1]), Number(meta.center[2])];
                    }
                    if (meta.centerpoint && Array.isArray(meta.centerpoint) && meta.centerpoint.length === 3) {
                        return [Number(meta.centerpoint[0]), Number(meta.centerpoint[1]), Number(meta.centerpoint[2])];
                    }
                }
            }
        }

        return [0, 0, 0];
    }, [id, editingPointcloudId, summaryMap]);

    // Apply saved initial transform matrix from metadata onto pivot group
    useEffect(() => {
        if (!pivotObj) return;
        let matrixArr: number[] | undefined;

        // 1. First check summaryMap for key === id or key === editingPointcloudId
        const keysToCheck = [id, editingPointcloudId].filter(Boolean) as string[];

        for (const key of keysToCheck) {
            const summary = summaryMap[key];
            if (summary?.connected_pointclouds) {
                for (const pc of summary.connected_pointclouds) {
                    if (pc?.transform_matrix && pc.transform_matrix.length === 16) {
                        matrixArr = pc.transform_matrix;
                        break;
                    }
                }
            }
            if (matrixArr) break;
        }

        // 2. Fallback: check all summaryMap entries for pc.id === id
        if (!matrixArr) {
            for (const currSummary of Object.values(summaryMap)) {
                if (currSummary?.connected_pointclouds) {
                    const pc = currSummary.connected_pointclouds.find(
                        (p) => p.id === id || p.id === editingPointcloudId
                    );
                    if (pc?.transform_matrix && pc.transform_matrix.length === 16) {
                        matrixArr = pc.transform_matrix;
                        break;
                    }
                }
            }
        }

        // 3. Fallback: check catalog
        if (!matrixArr && catalog) {
            for (const pc of catalog) {
                if (pc.transform_matrix && pc.transform_matrix.length === 16) {
                    matrixArr = pc.transform_matrix;
                    break;
                }
            }
        }

        if (matrixArr && matrixArr.length === 16) {
            const mat = new THREE.Matrix4().fromArray(matrixArr);
            mat.decompose(pivotObj.position, pivotObj.quaternion, pivotObj.scale);
            pivotObj.updateMatrix();
        }
    }, [id, editingPointcloudId, summaryMap, catalog, pivotObj]);

    const handleObjectChange = useCallback(() => {
        if (!pivotObj) return;
        pivotObj.updateMatrix();
    }, [pivotObj]);

    const handleMouseUp = useCallback(() => {
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        const targetId = uuidRegex.test(id) ? id : (editingPointcloudId || id);
        if (!pivotObj || !targetId) return;
        pivotObj.updateMatrix();
        const matrixArray = pivotObj.matrix.toArray();
        updatePointcloudTransform(targetId, matrixArray);
    }, [id, editingPointcloudId, pivotObj, updatePointcloudTransform]);

    const [cx, cy, cz] = center;

    return (
        <group>
            <group position={[cx, cy, cz]} ref={setPivotObj}>
                <group position={[-cx, -cy, -cz]}>
                    {children}
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
    const {
        geometry,
        renderMode,
        wireframe,
        pointSize,
        loadedGeometries,
        editingPointcloudId,
        identifier,
    } = usePLYPointCloudContext();

    const lodTargetId = editingPointcloudId || identifier || "binary-lod";

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

            <PointCloudTransformItem id={lodTargetId}>
                <DynamicCubicLODController />
            </PointCloudTransformItem>

            {/* Render dynamically streamed full pointcloud geometries with transform controls */}
            {Array.from(loadedGeometries.entries()).map(([id, geom]) => (
                <PointCloudTransformItem key={id} id={id}>
                    {renderMode === "mesh" ? (
                        <mesh geometry={geom}>
                            <meshStandardMaterial
                                vertexColors={!!geom.attributes.color}
                                side={THREE.DoubleSide}
                                wireframe={wireframe}
                                roughness={0.5}
                                metalness={0.1}
                            />
                        </mesh>
                    ) : (
                        <points geometry={geom}>
                            <pointsMaterial
                                vertexColors={!!geom.attributes.color}
                                size={pointSize}
                                sizeAttenuation
                            />
                        </points>
                    )}
                </PointCloudTransformItem>
            ))}
        </group>
    );
}