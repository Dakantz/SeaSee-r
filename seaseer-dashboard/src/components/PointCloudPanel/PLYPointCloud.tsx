import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { usePLYPointCloudContext } from "./PLYPointCloudContext";
import { generateDelaunayTerrainMesh } from "./utils/delaunayTriangulation";
// @ts-expect-error - geo-three submodule
import { MapView, DebugProvider, HeightDebugProvider, OpenStreetMapsProvider, OpenMapTilesProvider, MapTilerProvider, BingMapsProvider, BathymetryProvider, EmodnetProvider, UnitsUtils, MapNodeGeometry, MapHeightNodeShader, MapHeightNode, MapNodeHeightGeometry, MapPlaneNode, CanvasUtils } from "../../../public/geo-three/build/geo-three.module.js";

// Set skirt depth to 100.0 so the skirt extends down to height -100
MapHeightNodeShader.geometry = new MapNodeGeometry(1.0, 1.0, MapHeightNodeShader.geometrySize, MapHeightNodeShader.geometrySize, true, 200.0);

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
            this.geometry = new MapNodeHeightGeometry(1, 1, this.geometrySize, this.geometrySize, true, 200.0, imageData, true);
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
                    provider = new EmodnetProvider("https://ows.emodnet-bathymetry.eu/ows", "emodnet:mean", "", "image/png", "WMS");
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
            <SceneLighting />
            <GeoThreeHeightmap />
            {geometry && (
                <group position={[TARGET_X, 0, TARGET_Z]}>
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
        </group>
    );
}