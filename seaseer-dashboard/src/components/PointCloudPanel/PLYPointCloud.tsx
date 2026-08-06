import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { usePLYPointCloudContext } from "./PLYPointCloudContext";
import { generateDelaunayTerrainMesh } from "./utils/delaunayTriangulation";
// @ts-ignore - geo-three submodule
import { MapView, DebugProvider, HeightDebugProvider, OpenStreetMapsProvider, OpenMapTilesProvider, MapBoxProvider, BingMapsProvider, GoogleMapsProvider, MapTilerProvider, UnitsUtils } from "../../../public/geo-three/build/geo-three.module.js";

function GeoThreeHeightmap() {
    const { showHeightmap, heightmapMode, heightmapProvider, heightmapApiToken } = usePLYPointCloudContext();
    const mapViewRef = useRef<any>(null);

    const mapView = useMemo(() => {
        if (!showHeightmap) return null;
        try {
            let provider: any;
            let heightProvider: any = null;

            switch (heightmapProvider) {
                case "Debug": {
                    const debugP = new DebugProvider();
                    provider = debugP;
                    heightProvider = new HeightDebugProvider(debugP);
                    break;
                }
                case "OpenMapTiles": {
                    provider = new OpenMapTilesProvider();
                    heightProvider = heightmapApiToken
                        ? new MapBoxProvider(heightmapApiToken, "mapbox.terrain-rgb", MapBoxProvider.MAP_ID, "pngraw")
                        : null;
                    break;
                }
                case "MapBox": {
                    provider = new MapBoxProvider(heightmapApiToken, "mapbox/satellite-v9", MapBoxProvider.STYLE);
                    heightProvider = new MapBoxProvider(heightmapApiToken, "mapbox.terrain-rgb", MapBoxProvider.MAP_ID, "pngraw");
                    break;
                }
                case "Bing": {
                    provider = new BingMapsProvider(heightmapApiToken);
                    heightProvider = heightmapApiToken
                        ? new MapBoxProvider(heightmapApiToken, "mapbox.terrain-rgb", MapBoxProvider.MAP_ID, "pngraw")
                        : null;
                    break;
                }
                case "Google": {
                    provider = new GoogleMapsProvider(heightmapApiToken);
                    heightProvider = heightmapApiToken
                        ? new MapBoxProvider(heightmapApiToken, "mapbox.terrain-rgb", MapBoxProvider.MAP_ID, "pngraw")
                        : null;
                    break;
                }
                case "MapTiler": {
                    provider = new MapTilerProvider(heightmapApiToken);
                    heightProvider = heightmapApiToken
                        ? new MapBoxProvider(heightmapApiToken, "mapbox.terrain-rgb", MapBoxProvider.MAP_ID, "pngraw")
                        : null;
                    break;
                }
                case "OpenStreetMaps":
                default: {
                    const osm = new OpenStreetMapsProvider();
                    provider = osm;
                    heightProvider = heightmapApiToken
                        ? new MapBoxProvider(heightmapApiToken, "mapbox.terrain-rgb", MapBoxProvider.MAP_ID, "pngraw")
                        : new HeightDebugProvider(osm);
                    break;
                }
            }

            const modeCode = MapView[heightmapMode] ?? MapView.HEIGHT;
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
    }, [showHeightmap, heightmapMode, heightmapProvider, heightmapApiToken]);

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