import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { usePLYPointCloudContext } from "./PLYPointCloudContext";
import { generateDelaunayTerrainMesh } from "./utils/delaunayTriangulation";
import { TrajectoryRenderer } from "../RovRenderer/trajectoryRenderer";

export { PointCloudList } from "./PointCloudList";
export { PointCloudListContainer } from "./PointCloudListContainer";
export type { PointCloudItem, PointCloudListProps } from "./PointCloudList";


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
                const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
                const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);

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
            const dir = new THREE.Vector3();
            camera.getWorldDirection(dir);

            const moveDistance = -Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 100) * zoomSpeed;
            camera.position.addScaledVector(dir, moveDistance);
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

        const isShift = keys["ShiftLeft"] || keys["ShiftRight"];
        const heightFactor = getHeightFactor(camera.position.y);
        const moveSpeed = (isShift ? 3000 : 800) * heightFactor * delta;

        const forward = new THREE.Vector3();
        camera.getWorldDirection(forward);

        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);

        if (keys["KeyW"] || keys["ArrowUp"]) {
            camera.position.addScaledVector(forward, moveSpeed);
        }
        if (keys["KeyS"] || keys["ArrowDown"]) {
            camera.position.addScaledVector(forward, -moveSpeed);
        }
        if (keys["KeyA"] || keys["ArrowLeft"]) {
            camera.position.addScaledVector(right, -moveSpeed);
        }
        if (keys["KeyD"] || keys["ArrowRight"]) {
            camera.position.addScaledVector(right, moveSpeed);
        }
        if (keys["KeyE"] || keys["Space"]) {
            camera.position.y += moveSpeed;
        }
        if (keys["KeyQ"] || keys["ControlLeft"] || keys["ControlRight"]) {
            camera.position.y -= moveSpeed;
        }
    });

    return null;
}

function GeoThreeHeightmap() {
    const { showHeightmap, heightmapMode, heightmapMapProvider, heightmapHeightProvider, heightmapProvider } = usePLYPointCloudContext();
    const mapViewRef = useRef<any>(null);

    const mapView = useMemo(() => {
        if (!showHeightmap) return null;
        try {
            let provider: any;
            let heightProvider: any = null;
            const apiBaseUrl = import.meta.env.VITE_API_URL || "http://localhost:8000";

            const mapChoice = heightmapMapProvider ?? heightmapProvider ?? "OpenStreetMaps";
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
    }, [showHeightmap, heightmapMode, heightmapMapProvider, heightmapHeightProvider, heightmapProvider]);

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
    if (
        item.min_x != null && item.max_x != null &&
        item.min_y != null && item.max_y != null &&
        item.min_z != null && item.max_z != null
    ) {
        return [
            (item.min_x + item.max_x) / 2.0,
            (item.min_y + item.max_y) / 2.0,
            (item.min_z + item.max_z) / 2.0,
        ];
    }
    return [TARGET_X, 0, TARGET_Z];
}

function PointCloudCenterMarkers() {
    const {
        catalog,
        selectedId,
        hoveredId,
        selectPointcloud,
        hoverPointcloud,
        focusPointcloud,
        setIdentifier,
        toggleStreamPointCloud,
        loadedGeometries,
        lod,
        mode,
        loadBinaryPointCloud,
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
    }, [catalog]);

    useFrame(({ camera }) => {
        if (!meshRef.current || catalog.length === 0) return;

        catalog.forEach((item, index) => {
            const [cx, cy, cz] = getItemCenter(item);
            centerVec.set(cx, cy, cz).applyEuler(rotEuler);
            const dist = camera.position.distanceTo(centerVec);

            const isSelected = item.id === selectedId;
            const isHovered = item.id === hoveredId;

            const baseFactor = isSelected ? 0.025 : isHovered ? 0.02 : 0.012;
            const scale = Math.max(0.01, dist * baseFactor);

            dummy.position.set(cx, cy, cz);
            dummy.scale.set(scale, scale, scale);
            dummy.updateMatrix();
            meshRef.current!.setMatrixAt(index, dummy.matrix);

            const color = new THREE.Color(
                isSelected ? "#ff3344" : isHovered ? "#ffaa00" : "#00e5ff"
            );
            meshRef.current!.setColorAt(index, color);
        });

        meshRef.current.instanceMatrix.needsUpdate = true;
        if (meshRef.current.instanceColor) {
            meshRef.current.instanceColor.needsUpdate = true;
        }
    });

    if (catalog.length === 0) return null;

    const handleSelect = (instanceId?: number) => {
        if (instanceId !== undefined && catalog[instanceId]) {
            const targetId = catalog[instanceId].id;
            selectPointcloud(targetId);
            setIdentifier(targetId);
            if (mode === "binary") {
                loadBinaryPointCloud(targetId, lod);
            }
            if (!loadedGeometries.has(targetId)) {
                toggleStreamPointCloud(targetId, lod);
            }
        }
    };

    return (
        <instancedMesh
            ref={meshRef}
            args={[undefined, undefined, catalog.length]}
            rotation={[-Math.PI / 2, 0, 0]}
            onClick={(e) => {
                e.stopPropagation();
                handleSelect(e.instanceId);
            }}
            onDoubleClick={(e) => {
                e.stopPropagation();
                if (e.instanceId !== undefined && catalog[e.instanceId]) {
                    const targetId = catalog[e.instanceId].id;
                    focusPointcloud(targetId);
                    handleSelect(e.instanceId);
                }
            }}
            onPointerOver={(e) => {
                e.stopPropagation();
                document.body.style.cursor = "pointer";
                if (e.instanceId !== undefined && catalog[e.instanceId]) {
                    hoverPointcloud(catalog[e.instanceId].id);
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
    const { camera } = useThree();
    const { focusedId, catalog } = usePLYPointCloudContext();
    const targetPos = useRef<THREE.Vector3 | null>(null);

    useEffect(() => {
        if (!focusedId) return;
        const item = catalog.find((pc) => pc.id === focusedId);
        if (item) {
            const [cx, cy, cz] = getItemCenter(item);
            targetPos.current = new THREE.Vector3(cx, cy, cz).applyEuler(
                new THREE.Euler(-Math.PI / 2, 0, 0)
            );
        }
    }, [focusedId, catalog]);

    useFrame((_, delta) => {
        if (targetPos.current) {
            const targetCamPos = targetPos.current.clone().add(new THREE.Vector3(0, 1500, 1500));
            camera.position.lerp(targetCamPos, Math.min(1, 5 * delta));
            camera.lookAt(targetPos.current);

            if (camera.position.distanceTo(targetCamPos) < 5.0) {
                targetPos.current = null;
            }
        }
    });

    return null;
}

function DBCameraTrajectoryDisplay() {
    const {
        showCameraTrajectories,
        selectedId,
        identifier,
        loadedGeometries,
        mode,
    } = usePLYPointCloudContext();

    const activeIds = useMemo(() => {
        const set = new Set<string>();
        if (selectedId) set.add(selectedId);
        if (identifier && identifier.trim().length > 0) set.add(identifier);
        for (const id of loadedGeometries.keys()) {
            if (id) set.add(id);
        }
        return Array.from(set);
    }, [selectedId, identifier, loadedGeometries]);

    if (!showCameraTrajectories || activeIds.length === 0) return null;

    const apiBaseUrl = import.meta.env.VITE_API_URL || "http://localhost:8000";

    return (
        <group>
            {activeIds.map((id) => {
                const position: [number, number, number] =
                    mode === "plyUrl"
                        ? [TARGET_X, 0, TARGET_Z]
                        : [0, 0, 0];

                return (
                    <TrajectoryRenderer
                        key={id}
                        url={`${apiBaseUrl}/pointclouds/${id}/camera-routes`}
                        position={position}
                        rotation={[-Math.PI / 2, 0, 0]}
                        color={0x00ffcc}
                        lineWidth={3}
                        showPoints={true}
                        pointSize={1.5}
                    />
                );
            })}
        </group>
    );
}

export default function PLYPointCloud() {
    const {
        geometry,
        mode,
        renderMode,
        wireframe,
        pointSize,
        identifier,
        lod,
        plyUrl,
        loadBinaryPointCloud,
        loadPlyUrl,
        loadedGeometries,
    } = usePLYPointCloudContext();

    useEffect(() => {
        if (mode === "binary") {
            loadBinaryPointCloud(identifier, lod);
        } else if (mode === "plyUrl") {
            loadPlyUrl(plyUrl);
        }
    }, [mode, identifier, lod, loadBinaryPointCloud, loadPlyUrl]);

    useEffect(() => {
        if (geometry && renderMode === "mesh") {
            generateDelaunayTerrainMesh(geometry, true);
        }
    }, [geometry, renderMode]);

    return (
        <group>
            <CameraPositionControls />
            <CameraFocusController />
            <SceneLighting />
            <GeoThreeHeightmap />
            <PointCloudCenterMarkers />
            <DBCameraTrajectoryDisplay />

            {/* Render legacy / single active pointcloud geometry */}
            {geometry && (
                <group position={mode === "plyUrl" ? [TARGET_X, 0, TARGET_Z] : [0, 0, 0]}>
                    {renderMode === "mesh" ? (
                        <mesh geometry={geometry} rotation={[-Math.PI / 2, 0, 0]}>
                            <meshStandardMaterial
                                vertexColors={!!geometry.attributes.color}
                                side={THREE.DoubleSide}
                                wireframe={wireframe}
                                roughness={0.5}
                                metalness={0.1}
                            />
                        </mesh>
                    ) : (
                        <points geometry={geometry} rotation={[-Math.PI / 2, 0, 0]}>
                            <pointsMaterial
                                vertexColors={!!geometry.attributes.color}
                                size={pointSize}
                                sizeAttenuation
                            />
                        </points>
                    )}
                </group>
            )}

            {/* Render dynamically streamed full pointcloud geometries */}
            {Array.from(loadedGeometries.entries()).map(([id, geom]) => (
                <group key={id}>
                    <points geometry={geom} rotation={[-Math.PI / 2, 0, 0]}>
                        <pointsMaterial
                            vertexColors={!!geom.attributes.color}
                            size={pointSize}
                            sizeAttenuation
                        />
                    </points>
                </group>
            ))}
        </group>
    );
}