import * as THREE from "three";
import type { EngineConfig } from "../types";

// @ts-expect-error - geo-three submodule
import { MapView, DebugProvider, HeightDebugProvider, OpenStreetMapsProvider, MapTilerProvider, BingMapsProvider, BathymetryProvider, EmodnetTileProvider, EmodnetWCSProvider, UnitsUtils, MapHeightNodeShader } from "../../../../../public/geo-three/build/geo-three.module.js";

export class TerrainSystem {
    private scene: THREE.Scene;
    private mapView: any = null;
    private currentConfigKey: string = "";

    constructor(scene: THREE.Scene, config: Partial<EngineConfig> = {}) {
        this.scene = scene;
        this.updateConfig(config);
    }

    public updateConfig(config: Partial<EngineConfig>): void {
        const showHeightmap = config.showHeightmap ?? true;
        const heightmapMode = config.heightmapMode ?? "HEIGHT";
        const mapChoice = config.heightmapMapProvider ?? "OpenStreetMaps";
        const heightChoice = config.heightmapHeightProvider ?? "Bathymetry";

        const configKey = `${showHeightmap}_${heightmapMode}_${mapChoice}_${heightChoice}`;
        if (configKey === this.currentConfigKey) {
            return;
        }
        this.currentConfigKey = configKey;

        this.disposeMapView();

        if (!showHeightmap) {
            return;
        }

        try {
            let provider: any;
            let heightProvider: any = null;
            const apiBaseUrl = import.meta.env.VITE_API_URL || "http://localhost:8000";

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

            this.mapView = new MapView(modeCode, provider, heightProvider);
            this.mapView.scale.set(UnitsUtils.EARTH_PERIMETER, 1, UnitsUtils.EARTH_PERIMETER);
            this.mapView.rotation.x = Math.PI / 2;
            this.mapView.position.set(0, -0.5, 0);

            this.scene.add(this.mapView);
        } catch (err) {
            console.error("Failed to initialize GeoThree MapView in TerrainSystem:", err);
            this.mapView = null;
        }
    }

    public update(camera: THREE.Camera, renderer: THREE.WebGLRenderer): void {
        if (!this.mapView?.lod) return;

        try {
            this.mapView.lod.updateLOD(this.mapView, camera, renderer, this.scene);

            // Force THREE.NearestFilter on loaded textures
            this.mapView.traverse((child: any) => {
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
            // Ignore transient update errors
        }
    }

    private disposeMapView(): void {
        if (!this.mapView) return;

        this.scene.remove(this.mapView);

        if (this.mapView.root?.dispose) {
            try {
                this.mapView.root.dispose();
            } catch (e) {
                // Ignore cleanup errors
            }
        }

        this.mapView.traverse((child: any) => {
            if (child !== this.mapView) {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    const mats = Array.isArray(child.material) ? child.material : [child.material];
                    mats.forEach((mat: any) => {
                        if (mat.map) mat.map.dispose();
                        if (mat.userData?.heightMap?.value && mat.userData.heightMap.value !== MapHeightNodeShader.defaultHeightTexture) {
                            mat.userData.heightMap.value.dispose();
                        }
                        mat.dispose();
                    });
                }
                if (typeof child.dispose === "function") {
                    try {
                        child.dispose();
                    } catch (e) {
                        // ignore
                    }
                }
            }
        });

        this.mapView = null;
    }

    public destroy(): void {
        this.disposeMapView();
        this.currentConfigKey = "";
    }
}
