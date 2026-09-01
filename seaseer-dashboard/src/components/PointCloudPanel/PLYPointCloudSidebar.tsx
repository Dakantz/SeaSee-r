import { useEffect, useState } from "react";
import type { PointCloudMetadataResponse } from "../../client";
import { usePLYPointCloudContext, type MapProviderChoice, type HeightProviderChoice } from "./PLYPointCloudContext";

export interface PLYPointCloudSidebarProps {
    renderMode?: "points" | "mesh";
    setRenderMode?: (mode: "points" | "mesh") => void;
    wireframe?: boolean;
    setWireframe?: (wireframe: boolean) => void;
    pointSize?: number;
    setPointSize?: (size: number) => void;
    showHeightmap?: boolean;
    setShowHeightmap?: (show: boolean) => void;
    heightmapMode?: "HEIGHT" | "HEIGHT_SHADER" | "MARTINI" | "PLANAR";
    setHeightmapMode?: (mode: "HEIGHT" | "HEIGHT_SHADER" | "MARTINI" | "PLANAR") => void;
    heightmapMapProvider?: MapProviderChoice;
    setHeightmapMapProvider?: (provider: MapProviderChoice) => void;
    heightmapHeightProvider?: HeightProviderChoice;
    setHeightmapHeightProvider?: (provider: HeightProviderChoice) => void;
    lod?: number;
    isLoading?: boolean;
    error?: string | null;
    pointCount?: number | null;
    keyLightIntensity?: number;
    setKeyLightIntensity?: (val: number) => void;
    fillLightIntensity?: number;
    setFillLightIntensity?: (val: number) => void;
    hemisphereLightIntensity?: number;
    setHemisphereLightIntensity?: (val: number) => void;
    ambientLightIntensity?: number;
    setAmbientLightIntensity?: (val: number) => void;
    showOutlines?: boolean;
    setShowOutlines?: (show: boolean) => void;
}

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

export default function PLYPointCloudSidebar(props: PLYPointCloudSidebarProps) {
    let contextState: ReturnType<typeof usePLYPointCloudContext> | null = null;
    try {
        contextState = usePLYPointCloudContext();
    } catch {
        // Fallback to props if context provider is not present
    }

    const renderMode = props.renderMode ?? contextState?.renderMode ?? "points";
    const setRenderMode = props.setRenderMode ?? contextState?.setRenderMode ?? (() => {});
    const wireframe = props.wireframe ?? contextState?.wireframe ?? true;
    const setWireframe = props.setWireframe ?? contextState?.setWireframe ?? (() => {});
    const pointSize = props.pointSize ?? contextState?.pointSize ?? 0.1;
    const setPointSize = props.setPointSize ?? contextState?.setPointSize ?? (() => {});
    const showHeightmap = props.showHeightmap ?? contextState?.showHeightmap ?? false;
    const setShowHeightmap = props.setShowHeightmap ?? contextState?.setShowHeightmap ?? (() => {});
    const heightmapMode = props.heightmapMode ?? contextState?.heightmapMode ?? "HEIGHT";
    const setHeightmapMode = props.setHeightmapMode ?? contextState?.setHeightmapMode ?? (() => {});
    const heightmapMapProvider = props.heightmapMapProvider ?? contextState?.heightmapMapProvider ?? "OpenStreetMaps";
    const setHeightmapMapProvider = props.setHeightmapMapProvider ?? contextState?.setHeightmapMapProvider ?? (() => {});
    const heightmapHeightProvider = props.heightmapHeightProvider ?? contextState?.heightmapHeightProvider ?? "Bathymetry";
    const setHeightmapHeightProvider = props.setHeightmapHeightProvider ?? contextState?.setHeightmapHeightProvider ?? (() => {});
    const isLoading = props.isLoading ?? contextState?.isLoading ?? false;
    const error = props.error ?? contextState?.error ?? null;
    const pointCount = props.pointCount ?? contextState?.pointCount ?? null;
    const keyLightIntensity = props.keyLightIntensity ?? contextState?.keyLightIntensity ?? 1.5;
    const setKeyLightIntensity = props.setKeyLightIntensity ?? contextState?.setKeyLightIntensity ?? (() => {});
    const fillLightIntensity = props.fillLightIntensity ?? contextState?.fillLightIntensity ?? 0.5;
    const setFillLightIntensity = props.setFillLightIntensity ?? contextState?.setFillLightIntensity ?? (() => {});
    const hemisphereLightIntensity = props.hemisphereLightIntensity ?? contextState?.hemisphereLightIntensity ?? 0.6;
    const setHemisphereLightIntensity = props.setHemisphereLightIntensity ?? contextState?.setHemisphereLightIntensity ?? (() => {});
    const ambientLightIntensity = props.ambientLightIntensity ?? contextState?.ambientLightIntensity ?? 0.4;
    const setAmbientLightIntensity = props.setAmbientLightIntensity ?? contextState?.setAmbientLightIntensity ?? (() => {});
    const showOutlines = props.showOutlines ?? contextState?.showOutlines ?? false;
    const setShowOutlines = props.setShowOutlines ?? contextState?.setShowOutlines ?? (() => {});

    const [datasets, setDatasets] = useState<PointCloudMetadataResponse[]>([]);
    const [searchQuery, setSearchQuery] = useState<string>("");

    const catalog = contextState?.catalog ?? datasets;

    useEffect(() => {
        const fetchDatasets = async () => {
            try {
                const res = await fetch(`${API_BASE_URL}/pointclouds/`);
                if (res.ok) {
                    const data = await res.json();
                    setDatasets(data);
                }
            } catch (err) {
                console.error("Failed to fetch available datasets for PLY sidebar:", err);
            }
        };

        fetchDatasets();
    }, []);

    return (
        <div className="pointcloud-sidebar">
            <div className="pointcloud-sidebar__header">
                DebugControls
            </div>

            {/* Multi-PointCloud Catalog List */}
            <div className="pointcloud-sidebar__section">
                <div className="pointcloud-sidebar__section-header">
                    <label className="pointcloud-sidebar__section-label">
                        PointCloud Catalog ({catalog.length})
                    </label>
                </div>

                <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search point clouds..."
                    className="pointcloud-sidebar__search-input"
                />

                <div className="pointcloud-sidebar__catalog-list">
                    {catalog.length === 0 ? (
                        <div className="pointcloud-sidebar__empty">
                            No point clouds available.
                        </div>
                    ) : (
                        catalog
                            .filter((item) => {
                                if (!searchQuery.trim()) return true;
                                const name = item.orig_filename || item.safe_filename || item.id;
                                return name.toLowerCase().includes(searchQuery.toLowerCase());
                            })
                            .map((item) => {
                                const name = item.orig_filename || item.safe_filename || item.id;

                                return (
                                    <div
                                        key={item.id}
                                        onClick={() => {
                                            const queryName = name ? `Query for ${name}` : undefined;
                                            if (contextState?.addCustomQuery) {
                                                contextState.addCustomQuery({
                                                    name: queryName,
                                                    filters: [
                                                        {
                                                            id: `rule-${Date.now()}`,
                                                            field: "pointcloud_id",
                                                            operator: "eq",
                                                            value: item.id,
                                                        },
                                                    ],
                                                });
                                            }
                                        }}
                                        className="pointcloud-sidebar__item"
                                    >
                                        <div className="pointcloud-sidebar__item-info">
                                            <span className="pointcloud-sidebar__item-title">
                                                {name}
                                            </span>
                                            <span className="pointcloud-sidebar__item-count">
                                                {item.number_of_points?.toLocaleString() ?? 0} pts
                                            </span>
                                        </div>
                                    </div>
                                );
                            })
                    )}
                </div>
            </div>

            {/* Display Settings */}
            <div className="pointcloud-sidebar__display-settings">
                <div className="pointcloud-sidebar__sub-title">
                    Display Settings
                </div>

                <div className="pointcloud-sidebar__control-row">
                    <label className="pointcloud-sidebar__label">
                        Render Mode:
                    </label>
                    <div className="pointcloud-sidebar__button-group">
                        <button
                            type="button"
                            onClick={() => setRenderMode("points")}
                            className={`pointcloud-sidebar__mode-btn ${renderMode === "points" ? "pointcloud-sidebar__mode-btn--active" : ""}`}
                        >
                            Points
                        </button>
                        <button
                            type="button"
                            onClick={() => setRenderMode("mesh")}
                            className={`pointcloud-sidebar__mode-btn ${renderMode === "mesh" ? "pointcloud-sidebar__mode-btn--active" : ""}`}
                        >
                            Mesh
                        </button>
                    </div>
                </div>

                {renderMode === "mesh" ? (
                    <label className="pointcloud-sidebar__checkbox-label">
                        <input
                            type="checkbox"
                            checked={wireframe}
                            onChange={(e) => setWireframe(e.target.checked)}
                            className="pointcloud-sidebar__checkbox"
                        />
                        Wireframe Overlay
                    </label>
                ) : (
                    <div className="pointcloud-sidebar__slider-group">
                        <div className="pointcloud-sidebar__slider-header">
                            <span>Point Size:</span>
                            <span className="pointcloud-sidebar__mono-val">{pointSize.toFixed(2)}</span>
                        </div>
                        <input
                            type="range"
                            min="0.01"
                            max="1.0"
                            step="0.01"
                            value={pointSize}
                            onChange={(e) => setPointSize(parseFloat(e.target.value))}
                            className="pointcloud-sidebar__slider"
                        />
                    </div>
                )}

                <label className="pointcloud-sidebar__checkbox-label" style={{ marginTop: "8px" }}>
                    <input
                        type="checkbox"
                        checked={showOutlines}
                        onChange={(e) => setShowOutlines(e.target.checked)}
                        className="pointcloud-sidebar__checkbox"
                    />
                    Show Chunk Outlines
                </label>

                {/* Geo-Three Heightmap Controls */}
                <div className="pointcloud-sidebar__dashed-divider">
                    <label className="pointcloud-sidebar__checkbox-label pointcloud-sidebar__checkbox-label--medium">
                        <input
                            type="checkbox"
                            checked={showHeightmap}
                            onChange={(e) => setShowHeightmap(e.target.checked)}
                            className="pointcloud-sidebar__checkbox"
                        />
                        Geo-Three Heightmap Terrain
                    </label>

                    {showHeightmap && (
                        <div className="pointcloud-sidebar__sub-group">
                            {/* Map Provider Select */}
                            <div className="pointcloud-sidebar__slider-group">
                                <label className="pointcloud-sidebar__sub-title">Map Imagery Provider:</label>
                                <select
                                    value={heightmapMapProvider}
                                    onChange={(e) => setHeightmapMapProvider(e.target.value as any)}
                                    className="pointcloud-sidebar__select"
                                >
                                    <option value="OpenStreetMaps" className="pointcloud-sidebar__select-option">OpenStreetMap</option>
                                    <option value="Bathymetry" className="pointcloud-sidebar__select-option">SeaSee Bathymetry</option>
                                    <option value="EmodnetWMS" className="pointcloud-sidebar__select-option">EMODnet WMS</option>
                                    <option value="EmodnetWCSBilinear" className="pointcloud-sidebar__select-option">EMODnet WCS Bilinear</option>
                                    <option value="EmodnetWCSNearestNeighbour" className="pointcloud-sidebar__select-option">EMODnet WCS Nearest Neighbour</option>
                                    <option value="Debug" className="pointcloud-sidebar__select-option">Debug Grid</option>
                                    <option value="MapTilerBasic" className="pointcloud-sidebar__select-option">Vector Map Tiler Basic</option>
                                    <option value="MapTilerOutdoor" className="pointcloud-sidebar__select-option">Vector Map Tiler Outdoor</option>
                                    <option value="MapTilerSatellite" className="pointcloud-sidebar__select-option">Satellite Maps Tiler</option>
                                    <option value="Bing" className="pointcloud-sidebar__select-option">Bing Maps</option>
                                </select>
                            </div>

                            {/* Height Provider Select */}
                            <div className="pointcloud-sidebar__slider-group">
                                <label className="pointcloud-sidebar__sub-title">Height Data Provider:</label>
                                <select
                                    value={heightmapHeightProvider}
                                    onChange={(e) => setHeightmapHeightProvider(e.target.value as any)}
                                    className="pointcloud-sidebar__select"
                                >
                                    <option value="Bathymetry" className="pointcloud-sidebar__select-option">SeaSeer Bathymetry</option>
                                    <option value="EmodnetWCSBilinear" className="pointcloud-sidebar__select-option">EMODnet WCS Bilinear</option>
                                    <option value="EmodnetWCSNearestNeighbour" className="pointcloud-sidebar__select-option">EMODnet WCS Nearest Neighbour</option>
                                    <option value="None" className="pointcloud-sidebar__select-option">None (Flat Surface)</option>
                                    <option value="Debug" className="pointcloud-sidebar__select-option">Height Debug Grid</option>
                                    <option value="MapTiler" className="pointcloud-sidebar__select-option">Height Map Tiler</option>
                                </select>
                            </div>

                            <div className="pointcloud-sidebar__slider-group">
                                <label className="pointcloud-sidebar__sub-title">Heightmap Mode:</label>
                                <select
                                    value={heightmapMode}
                                    onChange={(e) => setHeightmapMode(e.target.value as any)}
                                    className="pointcloud-sidebar__select"
                                >
                                    <option value="HEIGHT" className="pointcloud-sidebar__select-option">CPU Height (HeightNode)</option>
                                    <option value="HEIGHT_SHADER" className="pointcloud-sidebar__select-option">GPU Shader Height</option>
                                    <option value="MARTINI" className="pointcloud-sidebar__select-option">Martini Mesh</option>
                                    <option value="PLANAR" className="pointcloud-sidebar__select-option">Planar (2D Map)</option>
                                </select>
                            </div>

                            {/* Lighting Intensity Controls */}
                            <div className="pointcloud-sidebar__dashed-divider">
                                <div className="pointcloud-sidebar__sub-title">
                                    Lighting Intensity Controls
                                </div>

                                {/* Key Sun Light (NW) */}
                                <div className="pointcloud-sidebar__slider-group">
                                    <div className="pointcloud-sidebar__slider-header">
                                        <span>Key Sun Light (NW):</span>
                                        <span className="pointcloud-sidebar__mono-val">{keyLightIntensity.toFixed(1)}</span>
                                    </div>
                                    <input
                                        type="range"
                                        min="0"
                                        max="4.0"
                                        step="0.1"
                                        value={keyLightIntensity}
                                        onChange={(e) => setKeyLightIntensity(parseFloat(e.target.value))}
                                        className="pointcloud-sidebar__slider"
                                    />
                                </div>

                                {/* Fill Light (SE) */}
                                <div className="pointcloud-sidebar__slider-group">
                                    <div className="pointcloud-sidebar__slider-header">
                                        <span>Fill Light (SE):</span>
                                        <span className="pointcloud-sidebar__mono-val">{fillLightIntensity.toFixed(1)}</span>
                                    </div>
                                    <input
                                        type="range"
                                        min="0"
                                        max="3.0"
                                        step="0.1"
                                        value={fillLightIntensity}
                                        onChange={(e) => setFillLightIntensity(parseFloat(e.target.value))}
                                        className="pointcloud-sidebar__slider"
                                    />
                                </div>

                                {/* Hemisphere Sky/Ground Light */}
                                <div className="pointcloud-sidebar__slider-group">
                                    <div className="pointcloud-sidebar__slider-header">
                                        <span>Hemisphere Light:</span>
                                        <span className="pointcloud-sidebar__mono-val">{hemisphereLightIntensity.toFixed(1)}</span>
                                    </div>
                                    <input
                                        type="range"
                                        min="0"
                                        max="3.0"
                                        step="0.1"
                                        value={hemisphereLightIntensity}
                                        onChange={(e) => setHemisphereLightIntensity(parseFloat(e.target.value))}
                                        className="pointcloud-sidebar__slider"
                                    />
                                </div>

                                {/* Ambient Base Light */}
                                <div className="pointcloud-sidebar__slider-group">
                                    <div className="pointcloud-sidebar__slider-header">
                                        <span>Ambient Light:</span>
                                        <span className="pointcloud-sidebar__mono-val">{ambientLightIntensity.toFixed(1)}</span>
                                    </div>
                                    <input
                                        type="range"
                                        min="0"
                                        max="3.0"
                                        step="0.1"
                                        value={ambientLightIntensity}
                                        onChange={(e) => setAmbientLightIntensity(parseFloat(e.target.value))}
                                        className="pointcloud-sidebar__slider"
                                    />
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Status / Errors / Stats */}
            <div className="pointcloud-sidebar__status-bar">
                {isLoading ? (
                    <span className="pointcloud-sidebar__status--loading">Loading...</span>
                ) : error ? (
                    <span className="pointcloud-sidebar__status--error">{error}</span>
                ) : pointCount !== null ? (
                    <span className="pointcloud-sidebar__status--success">
                        {pointCount.toLocaleString()} pts loaded
                    </span>
                ) : (
                    <span className="pointcloud-sidebar__status--muted">No points loaded</span>
                )}
            </div>
        </div>
    );
}
