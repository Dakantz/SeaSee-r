import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { usePLYPointCloudContext } from "./PLYPointCloudContext";
import { generateDelaunayTerrainMesh } from "./utils/delaunayTriangulation";
// @ts-expect-error - geo-three submodule
import { MapView, DebugProvider, HeightDebugProvider, OpenStreetMapsProvider, OpenMapTilesProvider, MapTilerProvider, BingMapsProvider, BathymetryProvider, EmodnetProvider, UnitsUtils } from "../../../public/geo-three/build/geo-three.module.js";

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
            <GeoThreeHeightmap />
            {geometry && (
                renderMode === "mesh" ? (
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
                )
            )}
        </group>
    );
}