import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
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
    const isDragging = useRef(false);
    const dragButton = useRef<number | null>(null);
    const previousMouse = useRef({ x: 0, y: 0 });
    const keysPressed = useRef<{ [key: string]: boolean }>({});

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
            isDragging.current = true;
            dragButton.current = e.button;
            previousMouse.current = { x: e.clientX, y: e.clientY };
        };

        const onPointerMove = (e: PointerEvent) => {
            if (!isDragging.current) return;

            const deltaX = e.clientX - previousMouse.current.x;
            const deltaY = e.clientY - previousMouse.current.y;
            previousMouse.current = { x: e.clientX, y: e.clientY };

            if (dragButton.current === 0) {
                // Left click: Rotate around current camera position using quaternions
                const rotateSpeed = 0.003;

                // 1. Yaw rotation around global world Up-axis (0, 0, 1)
                const up = _tmpVecUp.set(0, 0, 1);
                _qYaw.setFromAxisAngle(up, -deltaX * rotateSpeed);

                // 2. Pitch rotation around local camera Right-axis
                const right = _tmpVecRight.set(1, 0, 0).applyQuaternion(camera.quaternion).normalize();
                _qPitch.setFromAxisAngle(right, -deltaY * rotateSpeed);

                // Apply pitch then yaw to camera quaternion
                camera.quaternion.premultiply(_qPitch).premultiply(_qYaw).normalize();
                camera.up.set(0, 0, 1);
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
        const heightFactor = getHeightFactor(camera.position.z);
        const moveSpeed = (isShift ? 3000 : 800) * heightFactor * delta;

        camera.getWorldDirection(_tmpVecForward);
        const right = _tmpVecRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
        const up = _tmpVecUp.set(0, 0, 1);

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
                    color={0x00ffcc}
                    lineWidth={3}
                    showPoints={true}
                    pointSize={1.5}
                    onPointClick={(sample) => handlePointClick(sample, route.position)}
                />
            ))}
        </group>
    );
}

interface LodSlotData {
    gridKey: string;
    geometry: THREE.BufferGeometry;
    bounds?: {
        minX: number; maxX: number;
        minY: number; maxY: number;
        minZ: number; maxZ: number;
    };
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

    const [lodGeometriesMap, setLodGeometriesMap] = useState<Map<string, Map<number, LodSlotData>>>(new Map());
    const activeControllersRef = useRef<Map<string, AbortController>>(new Map());
    const currentGridKeysRef = useRef<Map<string, string>>(new Map());

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

    const fetchLodLevel = useCallback(async (
        queryId: string,
        lod: number,
        gridKey: string,
        filters: FilterRule[],
        bounds?: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number }
    ) => {
        const fetchId = `${queryId}_lod${lod}`;

        if (activeControllersRef.current.has(fetchId)) {
            activeControllersRef.current.get(fetchId)?.abort();
            activeControllersRef.current.delete(fetchId);
        }

        const controller = new AbortController();
        activeControllersRef.current.set(fetchId, controller);
        currentGridKeysRef.current.set(fetchId, gridKey);

        try {
            const geom = await fetchBinaryGeometry(queryId, lod, controller.signal, filters);

            if (controller.signal.aborted) {
                geom.dispose();
                return;
            }

            setLodGeometriesMap((prevMap) => {
                const newMap = new Map(prevMap);
                let queryMap = newMap.get(queryId);
                if (!queryMap) {
                    queryMap = new Map();
                    newMap.set(queryId, queryMap);
                }

                const existingSlot = queryMap.get(lod);
                if (existingSlot?.geometry && existingSlot.geometry !== geom) {
                    existingSlot.geometry.dispose();
                }

                queryMap.set(lod, { gridKey, geometry: geom, bounds });
                return newMap;
            });
        } catch (err: unknown) {
            if (controller.signal.aborted) return;
        } finally {
            if (activeControllersRef.current.get(fetchId) === controller) {
                activeControllersRef.current.delete(fetchId);
            }
        }
    }, [renderMode]);

    useEffect(() => {
        if (mode !== "binary") return;

        activeTargetQueries.forEach(({ id, filters }) => {
            const fetchId = `${id}_lod10`;
            if (!currentGridKeysRef.current.has(fetchId)) {
                fetchLodLevel(id, 10, "global", filters || []);
            }
        });
    }, [activeTargetQueries, fetchLodLevel, mode]);

    useFrame(() => {
        if (mode !== "binary" || activeTargetQueries.length === 0) return;

        const camPos = camera.position;
        const pcX = camPos.x;
        const pcY = camPos.y;
        const pcZ = camPos.z;

        const baseRadius = 0.2; // R0 = 0.2m

        for (const { id: queryId, filters: baseFilters } of activeTargetQueries) {
            for (let lod = 0; lod <= 9; lod++) {
                const radius = baseRadius * Math.pow(2, lod);
                const sideLength = radius * 2.0;

                const gridI = Math.floor(pcX / sideLength);
                const gridJ = Math.floor(pcY / sideLength);
                const gridK = Math.floor(pcZ / sideLength);
                const gridKey = `${gridI}_${gridJ}_${gridK}`;

                const fetchId = `${queryId}_lod${lod}`;
                const activeKey = currentGridKeysRef.current.get(fetchId);

                if (activeKey === gridKey) continue;

                const centerX = (gridI + 0.5) * sideLength;
                const centerY = (gridJ + 0.5) * sideLength;
                const centerZ = (gridK + 0.5) * sideLength;

                const minX = centerX - radius;
                const maxX = centerX + radius;
                const minY = centerY - radius;
                const maxY = centerY + radius;
                const minZ = centerZ - radius;
                const maxZ = centerZ + radius;

                const combinedFilters: FilterRule[] = [
                    ...(baseFilters || []),
                    { id: `spatial-min_x-${lod}`, field: "min_x", operator: "gte", value: minX },
                    { id: `spatial-max_x-${lod}`, field: "max_x", operator: "lte", value: maxX },
                    { id: `spatial-min_y-${lod}`, field: "min_y", operator: "gte", value: minY },
                    { id: `spatial-max_y-${lod}`, field: "max_y", operator: "lte", value: maxY },
                    { id: `spatial-min_z-${lod}`, field: "min_z", operator: "gte", value: minZ },
                    { id: `spatial-max_z-${lod}`, field: "max_z", operator: "lte", value: maxZ },
                ];

                fetchLodLevel(queryId, lod, gridKey, combinedFilters, { minX, maxX, minY, maxY, minZ, maxZ });
            }
        }
    });

    useEffect(() => {
        return () => {
            activeControllersRef.current.forEach((ctrl) => ctrl.abort());
            activeControllersRef.current.clear();
            currentGridKeysRef.current.clear();

            setLodGeometriesMap((prevMap) => {
                prevMap.forEach((queryMap) => {
                    queryMap.forEach((slot) => {
                        if (slot.geometry) {
                            slot.geometry.dispose();
                        }
                    });
                });
                return new Map();
            });
        };
    }, []);

    if (mode !== "binary" || lodGeometriesMap.size === 0) return null;

    return (
        <group>
            {Array.from(lodGeometriesMap.entries()).flatMap(([queryId, queryMap]) =>
                Array.from(queryMap.entries()).map(([lod, { gridKey, geometry, bounds }]) => (
                    <group key={`${queryId}-lod${lod}-${gridKey}`}>
                        {renderMode === "mesh" ? (
                            <mesh geometry={geometry}>
                                <meshStandardMaterial
                                    vertexColors={!!geometry.attributes.color}
                                    side={THREE.DoubleSide}
                                    wireframe={wireframe}
                                    roughness={0.5}
                                    metalness={0.1}
                                />
                            </mesh>
                        ) : (
                            <points geometry={geometry}>
                                <pointsMaterial
                                    vertexColors={!!geometry.attributes.color}
                                    size={Math.max(0.02, pointSize * (1 - lod * 0.05))}
                                    sizeAttenuation
                                />
                            </points>
                        )}

                        {/* Spatial Chunk Bounding Cube Outer Wireframe Visualizer */}
                        {bounds && (
                            <group
                                position={[
                                    (bounds.minX + bounds.maxX) / 2,
                                    (bounds.minY + bounds.maxY) / 2,
                                    (bounds.minZ + bounds.maxZ) / 2,
                                ]}
                            >
                                <BoxOutline
                                    width={bounds.maxX - bounds.minX}
                                    height={bounds.maxY - bounds.minY}
                                    depth={bounds.maxZ - bounds.minZ}
                                    color={getLodColor(lod)}
                                />
                            </group>
                        )}
                    </group>
                ))
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
            <DynamicCubicLODController />

            {/* Render dynamically streamed full pointcloud geometries */}
            {Array.from(loadedGeometries.entries()).map(([id, geom]) => (
                <group key={id}>
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
                </group>
            ))}
        </group>
    );
}