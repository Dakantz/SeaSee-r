import * as THREE from "three";
import type { EngineConfig, MapProviderChoice, HeightProviderChoice } from "../types";

// @ts-expect-error - geo-three submodule
import { MapView, DebugProvider, HeightDebugProvider, OpenStreetMapsProvider, MapTilerProvider, BingMapsProvider, BathymetryProvider, EmodnetTileProvider, EmodnetWCSProvider, UnitsUtils, MapHeightNodeShader } from "../../../../../public/geo-three/build/geo-three.module.js";
import { getApiBaseUrl } from "../../../../utils/apiConfig";

export const EXPERIMENTAL_MAP_PROVIDERS: MapProviderChoice[] = [
    "Bathymetry",
    "MapTilerBasic",
    "MapTilerOutdoor",
    "MapTilerSatellite",
    "Bing",
];

export const EXPERIMENTAL_HEIGHT_PROVIDERS: HeightProviderChoice[] = [
    "Bathymetry",
    "Debug",
    "MapTiler",
];

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
        const experimentalBathymetry = config.experimentalBathymetry;
        const heightmapMode = config.heightmapMode ?? "HEIGHT_SHADER";
        let mapChoice = config.heightmapMapProvider ?? "OpenStreetMaps";
        let heightChoice = config.heightmapHeightProvider ?? (experimentalBathymetry ? "Bathymetry" : "EmodnetWCSBilinear");

        if (!experimentalBathymetry) {
            if (EXPERIMENTAL_MAP_PROVIDERS.includes(mapChoice)) {
                mapChoice = "OpenStreetMaps";
            }
            if (EXPERIMENTAL_HEIGHT_PROVIDERS.includes(heightChoice)) {
                heightChoice = "EmodnetWCSBilinear";
            }
        }

        const configKey = `${showHeightmap}_${experimentalBathymetry}_${heightmapMode}_${mapChoice}_${heightChoice}`;
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
            const apiBaseUrl = getApiBaseUrl();

            switch (mapChoice) {
                case "Bathymetry":
                    if (experimentalBathymetry) {
                        provider = new BathymetryProvider(`${apiBaseUrl}/bathymetry`);
                    } else {
                        provider = new OpenStreetMapsProvider();
                    }
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
                    if (experimentalBathymetry) {
                        provider = new MapTilerProvider("6XkbBH0nwlhrFrcr1xa3", "maps", "basic", "png");
                    } else {
                        provider = new OpenStreetMapsProvider();
                    }
                    break;
                case "MapTilerOutdoor":
                    if (experimentalBathymetry) {
                        provider = new MapTilerProvider("6XkbBH0nwlhrFrcr1xa3", "maps", "outdoor", "png");
                    } else {
                        provider = new OpenStreetMapsProvider();
                    }
                    break;
                case "MapTilerSatellite":
                    if (experimentalBathymetry) {
                        provider = new MapTilerProvider("6XkbBH0nwlhrFrcr1xa3", "maps", "hybrid", "jpg");
                    } else {
                        provider = new OpenStreetMapsProvider();
                    }
                    break;
                case "Bing":
                    if (experimentalBathymetry) {
                        provider = new BingMapsProvider();
                    } else {
                        provider = new OpenStreetMapsProvider();
                    }
                    break;
                case "OpenStreetMaps":
                default:
                    provider = new OpenStreetMapsProvider();
                    break;
            }

            switch (heightChoice) {
                case "Bathymetry":
                    if (experimentalBathymetry) {
                        heightProvider = new BathymetryProvider(`${apiBaseUrl}/bathymetry`);
                    } else {
                        heightProvider = new EmodnetWCSProvider("https://ows.emodnet-bathymetry.eu/ows", "emodnet:mean", 1.0, true);
                    }
                    break;
                case "EmodnetWCSBilinear":
                    heightProvider = new EmodnetWCSProvider("https://ows.emodnet-bathymetry.eu/ows", "emodnet:mean", 1.0, true);
                    break;
                case "EmodnetWCSNearestNeighbour":
                    heightProvider = new EmodnetWCSProvider("https://ows.emodnet-bathymetry.eu/ows", "emodnet:mean", 1.0, false);
                    break;
                case "Debug":
                    if (experimentalBathymetry) {
                        heightProvider = new HeightDebugProvider(new DebugProvider());
                    } else {
                        heightProvider = new EmodnetWCSProvider("https://ows.emodnet-bathymetry.eu/ows", "emodnet:mean", 1.0, true);
                    }
                    break;
                case "MapTiler":
                    if (experimentalBathymetry) {
                        heightProvider = new MapTilerProvider("6XkbBH0nwlhrFrcr1xa3", "tiles", "terrain-rgb", "png");
                    } else {
                        heightProvider = new EmodnetWCSProvider("https://ows.emodnet-bathymetry.eu/ows", "emodnet:mean", 1.0, true);
                    }
                    break;
                case "None":
                default:
                    heightProvider = null;
                    break;
            }

            const modeCode = (!heightProvider || heightChoice === "None")
                ? MapView.PLANAR
                : (MapView[heightmapMode] ?? MapView.HEIGHT_SHADER);

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
