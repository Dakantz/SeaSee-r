import { useEffect, useState } from "react";
import type { PointCloudMetadataResponse, BatchOverviewResponse } from "../../client";
import { usePLYPointCloudContext, type MapProviderChoice, type HeightProviderChoice } from "./PLYPointCloudContext";
import OpenSfMConfigModal from "../OpenSfMConfigModal/OpenSfMConfigModal";

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
    pauseCubicLodUpdate?: boolean;
    setPauseCubicLodUpdate?: (pause: boolean) => void;
}

import { getApiBaseUrl } from "../../utils/apiConfig";

const API_BASE_URL = getApiBaseUrl();

export default function PLYPointCloudSidebar(props: PLYPointCloudSidebarProps) {
    const [isOpenSfMModalOpen, setIsOpenSfMModalOpen] = useState(false);
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
    const pauseCubicLodUpdate = props.pauseCubicLodUpdate ?? contextState?.pauseCubicLodUpdate ?? false;
    const setPauseCubicLodUpdate = props.setPauseCubicLodUpdate ?? contextState?.setPauseCubicLodUpdate ?? (() => {});
    const startPerfTest = contextState?.startPerfTest ?? (() => {});
    const stopPerfTest = contextState?.stopPerfTest ?? (() => {});
    const isPerfTestRunning = contextState?.isPerfTestRunning ?? false;
    const perfTestMetrics = contextState?.perfTestMetrics ?? [];
    const perfTestSummary = contextState?.perfTestSummary ?? null;
    const currentFps = contextState?.currentFps ?? null;
    const currentFrameTimeMs = contextState?.currentFrameTimeMs ?? null;

    const [datasets, setDatasets] = useState<PointCloudMetadataResponse[]>([]);
    const [searchQuery, setSearchQuery] = useState<string>("");

    const [batches, setBatches] = useState<BatchOverviewResponse[]>([]);
    const [batchSearchQuery, setBatchSearchQuery] = useState<string>("");
    const [isLoadingBatches, setIsLoadingBatches] = useState<boolean>(false);

    const catalog = contextState?.catalog ?? datasets;

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

    const fetchBatches = async () => {
        setIsLoadingBatches(true);
        try {
            const res = await fetch(`${API_BASE_URL}/videos/batches?processed_only=true`);
            if (res.ok) {
                const data = await res.json();
                setBatches(data);
            }
        } catch (err) {
            console.error("Failed to fetch processed batches for PLY sidebar:", err);
        } finally {
            setIsLoadingBatches(false);
        }
    };

    useEffect(() => {
        fetchDatasets();
        fetchBatches();
    }, []);

    const formatVideoLength = (seconds: number): string => {
        if (!seconds || seconds <= 0) return "0s";
        const totalSecs = Math.round(seconds);
        const hrs = Math.floor(totalSecs / 3600);
        const mins = Math.floor((totalSecs % 3600) / 60);
        const secs = totalSecs % 60;
        if (hrs > 0) {
            return `${hrs}h ${mins}m ${secs}s`;
        }
        if (mins > 0) {
            return `${mins}m ${secs}s`;
        }
        return `${secs}s`;
    };

    return (
        <div className="pointcloud-sidebar">
            <div className="pointcloud-sidebar__header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>DebugControls</span>
                <button
                    type="button"
                    onClick={() => setIsOpenSfMModalOpen(true)}
                    style={{
                        background: "rgba(56, 189, 248, 0.15)",
                        border: "1px solid rgba(56, 189, 248, 0.4)",
                        color: "#38bdf8",
                        borderRadius: "4px",
                        padding: "3px 8px",
                        fontSize: "11px",
                        fontWeight: 600,
                        cursor: "pointer"
                    }}
                    title="Open OpenSfM configuration popup"
                >
                    ⚙️ OpenSfM Setup
                </button>
            </div>
            <OpenSfMConfigModal
                isOpen={isOpenSfMModalOpen}
                onClose={() => setIsOpenSfMModalOpen(false)}
            />

            {/* Processed Batches Catalog */}
            <div className="pointcloud-sidebar__section">
                <div className="pointcloud-sidebar__section-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <label className="pointcloud-sidebar__section-label">
                        Batch Catalog ({batches.length})
                    </label>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        {isLoadingBatches && (
                            <span style={{ fontSize: "10px", color: "var(--color-text-muted, #94a3b8)" }}>
                                Loading...
                            </span>
                        )}
                        <button
                            type="button"
                            onClick={() => fetchBatches()}
                            title="Refresh processed batches"
                            style={{
                                background: "transparent",
                                border: "none",
                                color: "var(--color-text-muted, #94a3b8)",
                                cursor: "pointer",
                                fontSize: "11px",
                                padding: "0 2px"
                            }}
                        >
                            🔄
                        </button>
                    </div>
                </div>

                <input
                    type="text"
                    value={batchSearchQuery}
                    onChange={(e) => setBatchSearchQuery(e.target.value)}
                    placeholder="Search batches by video or ID..."
                    className="pointcloud-sidebar__search-input"
                />

                <div className="pointcloud-sidebar__catalog-list">
                    {batches.length === 0 ? (
                        <div className="pointcloud-sidebar__empty">
                            {isLoadingBatches ? "Loading batches..." : "No processed batches available."}
                        </div>
                    ) : (
                        batches
                            .filter((item) => {
                                if (!batchSearchQuery.trim()) return true;
                                const q = batchSearchQuery.toLowerCase();
                                const name = item.first_video_filename || "";
                                const bid = item.batch_id || "";
                                return name.toLowerCase().includes(q) || bid.toLowerCase().includes(q);
                            })
                            .map((item) => {
                                const displayName = item.first_video_filename || `Batch ${item.batch_id.slice(0, 8)}`;
                                const isQueryActive = contextState?.queries?.some((q) =>
                                    q.filters?.some((f) => f.field === "batch_id" && String(f.value) === String(item.batch_id))
                                );

                                return (
                                    <div
                                        key={item.batch_id}
                                        onClick={() => {
                                            const queryName = item.first_video_filename
                                                ? `Batch: ${item.first_video_filename}`
                                                : `Batch ${item.batch_id.slice(0, 8)}`;
                                            if (contextState?.addCustomQuery) {
                                                contextState.addCustomQuery({
                                                    name: queryName,
                                                    filters: [
                                                        {
                                                            id: `rule-${Date.now()}`,
                                                            field: "batch_id",
                                                            operator: "eq",
                                                            value: item.batch_id,
                                                        },
                                                    ],
                                                });
                                            }
                                        }}
                                        className={`pointcloud-sidebar__item ${isQueryActive ? "pointcloud-sidebar__item--selected" : ""}`}
                                        title={`Batch ID: ${item.batch_id}\nClick to create custom query filtering for this batch`}
                                    >
                                        <div className="pointcloud-sidebar__item-info">
                                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "6px" }}>
                                                <span className="pointcloud-sidebar__item-title" title={displayName}>
                                                    {displayName}
                                                </span>
                                                <span
                                                    className={`pointcloud-sidebar__item-badge ${isQueryActive ? "pointcloud-sidebar__item-badge--active" : "pointcloud-sidebar__item-badge--cyan"}`}
                                                >
                                                    {item.batch_id.slice(0, 8)}
                                                </span>
                                            </div>

                                            <div className="pointcloud-sidebar__item-subinfo">
                                                <span title="Number of videos in this batch">
                                                    📹 {item.video_count ?? 0} {(item.video_count ?? 0) === 1 ? "video" : "videos"}
                                                </span>
                                                <span>•</span>
                                                <span title="Total video length">
                                                    ⏱️ {formatVideoLength(item.total_video_length ?? 0)}
                                                </span>
                                                <span>•</span>
                                                <span title="Number of reconstructed point clouds" style={{ color: "#38bdf8", fontWeight: 500 }}>
                                                    ☁️ {item.pointcloud_count ?? 0} {(item.pointcloud_count ?? 0) === 1 ? "cloud" : "clouds"}
                                                </span>
                                                {(item.total_points ?? 0) > 0 && (
                                                    <span style={{ fontSize: "9px", color: "#94a3b8" }}>
                                                        ({(item.total_points ?? 0) >= 1_000_000
                                                            ? `${((item.total_points ?? 0) / 1_000_000).toFixed(1)}M`
                                                            : (item.total_points ?? 0) >= 1_000
                                                            ? `${((item.total_points ?? 0) / 1_000).toFixed(0)}k`
                                                            : item.total_points} pts)
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })
                    )}
                </div>
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
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
                                                <span className="pointcloud-sidebar__item-count">
                                                    {item.number_of_points?.toLocaleString() ?? 0} pts
                                                </span>
                                                {item.batch_id && (
                                                    <span style={{
                                                        fontSize: '10px',
                                                        padding: '1px 5px',
                                                        borderRadius: '4px',
                                                        backgroundColor: 'rgba(56, 189, 248, 0.15)',
                                                        color: '#38bdf8',
                                                        fontFamily: 'monospace'
                                                    }} title={`Batch ID: ${item.batch_id}`}>
                                                        batch:{item.batch_id.slice(0, 8)}
                                                    </span>
                                                )}
                                            </div>
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

                <label className="pointcloud-sidebar__checkbox-label" style={{ marginTop: "8px" }}>
                    <input
                        type="checkbox"
                        checked={pauseCubicLodUpdate}
                        onChange={(e) => setPauseCubicLodUpdate(e.target.checked)}
                        className="pointcloud-sidebar__checkbox"
                    />
                    Freeze Cubic LOD Updates
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

            {/* Performance Test Section */}
            <div className="pointcloud-sidebar__section" style={{ marginTop: "12px", borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: "12px" }}>
                <div className="pointcloud-sidebar__section-header" style={{ marginBottom: "8px" }}>
                    <label className="pointcloud-sidebar__section-label" style={{ display: "flex", alignItems: "center", gap: "6px", color: "#38bdf8", fontWeight: "bold" }}>
                        ⚡ PLYPointCloud Performance Test
                    </label>
                </div>

                <div style={{ backgroundColor: "rgba(15, 23, 42, 0.6)", padding: "10px", borderRadius: "6px", border: "1px solid rgba(255, 255, 255, 0.08)" }}>
                    {isPerfTestRunning ? (
                        <button
                            type="button"
                            onClick={stopPerfTest}
                            style={{
                                width: "100%",
                                padding: "8px 12px",
                                backgroundColor: "#dc2626",
                                color: "#ffffff",
                                border: "none",
                                borderRadius: "4px",
                                cursor: "pointer",
                                fontWeight: "bold",
                                fontSize: "12px",
                                marginBottom: "8px",
                                transition: "background-color 0.2s ease",
                            }}
                        >
                            🛑 Cancel Performance Test
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={startPerfTest}
                            style={{
                                width: "100%",
                                padding: "8px 12px",
                                backgroundColor: "#2563eb",
                                color: "#ffffff",
                                border: "none",
                                borderRadius: "4px",
                                cursor: "pointer",
                                fontWeight: "bold",
                                fontSize: "12px",
                                marginBottom: "8px",
                                transition: "background-color 0.2s ease",
                            }}
                        >
                            {perfTestSummary ? "Restart Performance Test" : "Run Performance Test"}
                        </button>
                    )}

                    {isPerfTestRunning && (
                        <div style={{ fontSize: "11px", color: "#facc15", marginBottom: "6px", fontFamily: "monospace" }}>
                            ⏱️ Measuring... {currentFps !== null ? `${currentFps} FPS (${currentFrameTimeMs} ms)` : "Calculating..."}
                        </div>
                    )}

                    {!isPerfTestRunning && perfTestSummary && (
                        <div style={{ backgroundColor: "#0f172a", padding: "8px", borderRadius: "4px", marginBottom: "8px", border: "1px solid #1e293b" }}>
                            <div style={{ color: "#4ade80", fontWeight: "bold", fontSize: "12px", marginBottom: "4px" }}>
                                Test Complete ✅
                            </div>
                            <div style={{ fontSize: "13px", color: "#60a5fa", fontFamily: "monospace" }}>
                                Average FPS: <strong>{perfTestSummary.averageFps}</strong> ({perfTestSummary.averageFrameTimeMs} ms)
                            </div>
                            <div style={{ fontSize: "10px", color: "#94a3b8", marginTop: "2px" }}>
                                Total Frames: {perfTestSummary.totalFrames} | Duration: {perfTestSummary.totalDurationSec}s
                            </div>
                        </div>
                    )}

                    {perfTestMetrics.length > 0 && (
                        <div style={{ maxHeight: "120px", overflowY: "auto", fontSize: "11px", fontFamily: "monospace", background: "#090d16", padding: "6px 8px", borderRadius: "4px", border: "1px solid #1e293b" }}>
                            <div style={{ color: "#94a3b8", marginBottom: "4px", borderBottom: "1px solid #1e293b", paddingBottom: "2px" }}>
                                Per-Second Breakdown:
                            </div>
                            {perfTestMetrics.map((m) => (
                                <div key={m.second} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1px 0", gap: "6px" }}>
                                    <span style={{ color: "#cbd5e1" }}>Sec {m.second}s:</span>
                                    <span style={{ color: "#94a3b8", fontSize: "10px" }}>
                                        {m.pointsCount !== undefined ? `${m.pointsCount.toLocaleString()} pts` : ""}
                                    </span>
                                    <span style={{ fontWeight: "bold", color: m.fps >= 50 ? "#4ade80" : m.fps >= 30 ? "#facc15" : "#f87171" }}>
                                        {m.fps} FPS ({m.frameTimeMs} ms)
                                    </span>
                                </div>
                            ))}
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
