import { useEffect, useState } from "react";
import type { PointCloudMetadataResponse } from "../../client";
import { usePLYPointCloudContext, type MapProviderChoice, type HeightProviderChoice } from "./PLYPointCloudContext";
import PLYPointCloudQueryEditor from "./PLYPointCloudQueryEditor";



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
    heightmapProvider?: MapProviderChoice;
    setHeightmapProvider?: (provider: MapProviderChoice) => void;
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
    const heightmapMapProvider = props.heightmapMapProvider ?? contextState?.heightmapMapProvider ?? props.heightmapProvider ?? contextState?.heightmapProvider ?? "OpenStreetMaps";
    const setHeightmapMapProvider = props.setHeightmapMapProvider ?? contextState?.setHeightmapMapProvider ?? props.setHeightmapProvider ?? contextState?.setHeightmapProvider ?? (() => {});
    const heightmapHeightProvider = props.heightmapHeightProvider ?? contextState?.heightmapHeightProvider ?? "Bathymetry";
    const setHeightmapHeightProvider = props.setHeightmapHeightProvider ?? contextState?.setHeightmapHeightProvider ?? (() => {});
    const lod = props.lod ?? contextState?.lod ?? 0;
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

    const [datasets, setDatasets] = useState<PointCloudMetadataResponse[]>([]);
    const [searchQuery, setSearchQuery] = useState<string>("");

    const catalog = contextState?.catalog ?? datasets;
    const selectedId = contextState?.selectedId ?? null;
    const hoveredId = contextState?.hoveredId ?? null;
    const focusPointcloud = contextState?.focusPointcloud ?? (() => {});
    const loadedGeometries = contextState?.loadedGeometries ?? new Map();
    const loadingIds = contextState?.loadingIds ?? new Set();
    const toggleStreamPointCloud = contextState?.toggleStreamPointCloud ?? (async () => {});

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
        <div
            style={{
                background: "var(--color-bg-card)",
                border: "1px solid var(--color-border-strong)",
                borderRadius: "var(--radius-lg)",
                padding: "var(--spacing-md)",
                color: "var(--color-text-primary)",
                fontFamily: "var(--font-sans)",
                fontSize: "var(--font-size-sm)",
            }}
        >
            <div
                style={{
                    fontWeight: "var(--font-weight-semibold)",
                    fontSize: "var(--font-size-sm)",
                    marginBottom: "var(--spacing-sm)",
                    color: "var(--color-accent-text)",
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--spacing-xs)",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                }}
            >
                DebugControls
            </div>

            {/* Multi-PointCloud Catalog List */}
            <div style={{ marginTop: "var(--spacing-3xs)", display: "flex", flexDirection: "column", gap: "var(--spacing-xs)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <label style={{ fontSize: "var(--font-size-xs)", fontWeight: "var(--font-weight-semibold)", color: "var(--color-accent-text)" }}>
                        PointCloud Catalog ({catalog.length})
                    </label>
                </div>

                <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search point clouds..."
                    style={{
                        background: "var(--color-bg-subtle)",
                        border: "1px solid var(--color-border-strong)",
                        color: "var(--color-text-secondary)",
                        padding: "var(--spacing-2xs) var(--spacing-xs)",
                        borderRadius: "var(--radius-sm)",
                        fontSize: "var(--font-size-xs)",
                        width: "100%",
                        boxSizing: "border-box",
                    }}
                />

                <div
                    style={{
                        maxHeight: "220px",
                        overflowY: "auto",
                        display: "flex",
                        flexDirection: "column",
                        gap: "var(--spacing-3xs)",
                        background: "var(--color-bg-subtle)",
                        border: "1px solid var(--color-border-subtle)",
                        borderRadius: "var(--radius-sm)",
                        padding: "var(--spacing-3xs)",
                    }}
                >
                    {catalog.length === 0 ? (
                        <div style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)", padding: "var(--spacing-xs)", textAlign: "center" }}>
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
                                const isSelected = item.id === selectedId;
                                const isHovered = item.id === hoveredId;
                                const isStreamed = loadedGeometries.has(item.id);
                                const isLoadingStream = loadingIds.has(item.id);

                                return (
                                    <div
                                        key={item.id}
                                        onClick={() => {
                                            const queryText = `SELECT PC_Explode(patch) AS pt FROM pointcloud_patches WHERE pointcloud_id = '${item.id}'`;
                                            const queryName = name ? `Query for ${name}` : undefined;
                                            window.dispatchEvent(
                                                new CustomEvent("add_custom_query", {
                                                    detail: {
                                                        queryText,
                                                        name: queryName,
                                                    },
                                                })
                                            );
                                        }}
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "space-between",
                                            padding: "var(--spacing-2xs) var(--spacing-xs)",
                                            borderRadius: "var(--radius-xs)",
                                            background: isSelected
                                                ? "rgba(255, 51, 68, 0.2)"
                                                : isHovered
                                                ? "rgba(255, 170, 0, 0.15)"
                                                : "transparent",
                                            borderLeft: isSelected ? "3px solid #ff3344" : isHovered ? "3px solid #ffaa00" : "3px solid transparent",
                                            cursor: "pointer",
                                            transition: "all 0.15s ease",
                                        }}
                                    >
                                        <div style={{ display: "flex", flexDirection: "column", overflow: "hidden", marginRight: "var(--spacing-xs)", flex: 1 }}>
                                            <span style={{ fontSize: "var(--font-size-xs)", fontWeight: "var(--font-weight-medium)", color: "var(--color-text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                                {name}
                                            </span>
                                            <span style={{ fontSize: "10px", color: "var(--color-text-muted)" }}>
                                                {item.number_of_points?.toLocaleString() ?? 0} pts
                                            </span>
                                        </div>

                                        <div style={{ display: "flex", gap: "var(--spacing-3xs)", flexShrink: 0 }}>
                                            <button
                                                type="button"
                                                title="Focus 3D Camera"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    focusPointcloud(item.id);
                                                }}
                                                style={{
                                                    background: "rgba(0, 229, 255, 0.15)",
                                                    border: "1px solid rgba(0, 229, 255, 0.4)",
                                                    color: "#00e5ff",
                                                    borderRadius: "var(--radius-xs)",
                                                    padding: "2px 6px",
                                                    fontSize: "11px",
                                                    cursor: "pointer",
                                                }}
                                            >
                                                🎯 Focus
                                            </button>
                                            <button
                                                type="button"
                                                title={isStreamed ? "Unload Stream" : "Stream Full Geometry"}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    toggleStreamPointCloud(item.id, lod);
                                                }}
                                                disabled={isLoadingStream}
                                                style={{
                                                    background: isStreamed ? "rgba(0, 230, 118, 0.2)" : "var(--color-bg-card)",
                                                    border: isStreamed ? "1px solid #00e676" : "1px solid var(--color-border-strong)",
                                                    color: isStreamed ? "#00e676" : "var(--color-text-muted)",
                                                    borderRadius: "var(--radius-xs)",
                                                    padding: "2px 6px",
                                                    fontSize: "11px",
                                                    cursor: "pointer",
                                                }}
                                            >
                                                {isLoadingStream ? "⏳" : isStreamed ? "👁️ Loaded" : "⚡ Stream"}
                                            </button>
                                        </div>
                                    </div>
                                );
                            })
                    )}
                </div>
            </div>

            {/* Custom Query Editor */}
            <PLYPointCloudQueryEditor style={{ marginTop: "var(--spacing-md)" }} />

            {/* Display Settings */}
            <div
                style={{
                    marginTop: "var(--spacing-md)",
                    paddingTop: "var(--spacing-xs)",
                    borderTop: "1px solid var(--color-border-subtle)",
                    display: "flex",
                    flexDirection: "column",
                    gap: "var(--spacing-xs)",
                }}
            >
                <div
                    style={{
                        fontWeight: "var(--font-weight-semibold)",
                        fontSize: "var(--font-size-2xs)",
                        color: "var(--color-text-muted)",
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                    }}
                >
                    Display Settings
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "var(--spacing-xs)" }}>
                    <label style={{ flex: 1, fontSize: "var(--font-size-xs)", color: "var(--color-text-secondary)" }}>
                        Render Mode:
                    </label>
                    <div
                        style={{
                            display: "flex",
                            gap: "var(--spacing-3xs)",
                            background: "var(--color-bg-subtle)",
                            padding: "var(--spacing-3xs)",
                            borderRadius: "var(--radius-sm)",
                        }}
                    >
                        <button
                            type="button"
                            onClick={() => setRenderMode("points")}
                            style={{
                                padding: "var(--spacing-3xs) var(--spacing-xs)",
                                background: renderMode === "points" ? "var(--color-accent)" : "transparent",
                                color: renderMode === "points" ? "var(--color-text-contrast)" : "var(--color-text-muted)",
                                border: "none",
                                borderRadius: "var(--radius-xs)",
                                cursor: "pointer",
                                fontSize: "var(--font-size-xs)",
                                fontWeight: "var(--font-weight-medium)",
                            }}
                        >
                            Points
                        </button>
                        <button
                            type="button"
                            onClick={() => setRenderMode("mesh")}
                            style={{
                                padding: "var(--spacing-3xs) var(--spacing-xs)",
                                background: renderMode === "mesh" ? "var(--color-accent)" : "transparent",
                                color: renderMode === "mesh" ? "var(--color-text-contrast)" : "var(--color-text-muted)",
                                border: "none",
                                borderRadius: "var(--radius-xs)",
                                cursor: "pointer",
                                fontSize: "var(--font-size-xs)",
                                fontWeight: "var(--font-weight-medium)",
                            }}
                        >
                            Mesh
                        </button>
                    </div>
                </div>

                {renderMode === "mesh" ? (
                    <label style={{ display: "flex", alignItems: "center", gap: "var(--spacing-xs)", fontSize: "var(--font-size-xs)", color: "var(--color-text-secondary)", cursor: "pointer" }}>
                        <input
                            type="checkbox"
                            checked={wireframe}
                            onChange={(e) => setWireframe(e.target.checked)}
                            style={{ cursor: "pointer" }}
                        />
                        Wireframe Overlay
                    </label>
                ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-3xs)" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "var(--font-size-xs)", color: "var(--color-text-secondary)" }}>
                            <span>Point Size:</span>
                            <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--font-size-2xs)" }}>{pointSize.toFixed(2)}</span>
                        </div>
                        <input
                            type="range"
                            min="0.01"
                            max="1.0"
                            step="0.01"
                            value={pointSize}
                            onChange={(e) => setPointSize(parseFloat(e.target.value))}
                            style={{ width: "100%", cursor: "pointer" }}
                        />
                    </div>
                )}

                {/* Geo-Three Heightmap Controls */}
                <div style={{ marginTop: "var(--spacing-xs)", paddingTop: "var(--spacing-xs)", borderTop: "1px dashed var(--color-border-subtle)", display: "flex", flexDirection: "column", gap: "var(--spacing-xs)" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: "var(--spacing-xs)", fontSize: "var(--font-size-xs)", color: "var(--color-text-secondary)", cursor: "pointer", fontWeight: "var(--font-weight-medium)" }}>
                        <input
                            type="checkbox"
                            checked={showHeightmap}
                            onChange={(e) => setShowHeightmap(e.target.checked)}
                            style={{ cursor: "pointer" }}
                        />
                        Geo-Three Heightmap Terrain
                    </label>

                    {showHeightmap && (
                        <div style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-xs)", paddingLeft: "var(--spacing-xs)" }}>
                            {/* Map Provider Select */}
                            <div style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-3xs)" }}>
                                <label style={{ fontSize: "var(--font-size-2xs)", color: "var(--color-text-muted)" }}>Map Imagery Provider:</label>
                                <select
                                    value={heightmapMapProvider}
                                    onChange={(e) => setHeightmapMapProvider(e.target.value as any)}
                                    style={{
                                        background: "var(--color-bg-subtle)",
                                        border: "1px solid var(--color-border-strong)",
                                        color: "var(--color-text-secondary)",
                                        padding: "var(--spacing-3xs) var(--spacing-xs)",
                                        borderRadius: "var(--radius-xs)",
                                        fontSize: "var(--font-size-xs)",
                                        width: "100%",
                                        cursor: "pointer",
                                    }}
                                >
                                    <option value="OpenStreetMaps" style={{ background: "var(--color-bg-card)", color: "var(--color-text-primary)" }}>OpenStreetMap</option>
                                    <option value="Bathymetry" style={{ background: "var(--color-bg-card)", color: "var(--color-text-primary)" }}>SeaSee Bathymetry</option>
                                    <option value="Emodnet" style={{ background: "var(--color-bg-card)", color: "var(--color-text-primary)" }}>EMODnet Bathymetry</option>
                                    <option value="Debug" style={{ background: "var(--color-bg-card)", color: "var(--color-text-primary)" }}>Debug Grid</option>
                                    <option value="MapTilerBasic" style={{ background: "var(--color-bg-card)", color: "var(--color-text-primary)" }}>Vector Map Tiler Basic</option>
                                    <option value="MapTilerOutdoor" style={{ background: "var(--color-bg-card)", color: "var(--color-text-primary)" }}>Vector Map Tiler Outdoor</option>
                                    <option value="MapTilerSatellite" style={{ background: "var(--color-bg-card)", color: "var(--color-text-primary)" }}>Satellite Maps Tiler</option>
                                    <option value="Bing" style={{ background: "var(--color-bg-card)", color: "var(--color-text-primary)" }}>Bing Maps</option>
                                </select>
                            </div>

                            {/* Height Provider Select */}
                            <div style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-3xs)" }}>
                                <label style={{ fontSize: "var(--font-size-2xs)", color: "var(--color-text-muted)" }}>Height Data Provider:</label>
                                <select
                                    value={heightmapHeightProvider}
                                    onChange={(e) => setHeightmapHeightProvider(e.target.value as any)}
                                    style={{
                                        background: "var(--color-bg-subtle)",
                                        border: "1px solid var(--color-border-strong)",
                                        color: "var(--color-text-secondary)",
                                        padding: "var(--spacing-3xs) var(--spacing-xs)",
                                        borderRadius: "var(--radius-xs)",
                                        fontSize: "var(--font-size-xs)",
                                        width: "100%",
                                        cursor: "pointer",
                                    }}
                                >
                                    <option value="Bathymetry" style={{ background: "var(--color-bg-card)", color: "var(--color-text-primary)" }}>SeaSeer Bathymetry</option>
                                    <option value="Emodnet" style={{ background: "var(--color-bg-card)", color: "var(--color-text-primary)" }}>EMODnet Bathymetry</option>
                                    <option value="None" style={{ background: "var(--color-bg-card)", color: "var(--color-text-primary)" }}>None (Flat Surface)</option>
                                    <option value="Debug" style={{ background: "var(--color-bg-card)", color: "var(--color-text-primary)" }}>Height Debug Grid</option>
                                    <option value="MapTiler" style={{ background: "var(--color-bg-card)", color: "var(--color-text-primary)" }}>Height Map Tiler</option>
                                </select>
                            </div>

                            <div style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-3xs)" }}>
                                <label style={{ fontSize: "var(--font-size-2xs)", color: "var(--color-text-muted)" }}>Heightmap Mode:</label>
                                <select
                                    value={heightmapMode}
                                    onChange={(e) => setHeightmapMode(e.target.value as any)}
                                    style={{
                                        background: "var(--color-bg-subtle)",
                                        border: "1px solid var(--color-border-strong)",
                                        color: "var(--color-text-secondary)",
                                        padding: "var(--spacing-3xs) var(--spacing-xs)",
                                        borderRadius: "var(--radius-xs)",
                                        fontSize: "var(--font-size-xs)",
                                        width: "100%",
                                        cursor: "pointer",
                                    }}
                                >
                                    <option value="HEIGHT" style={{ background: "var(--color-bg-card)", color: "var(--color-text-primary)" }}>CPU Height (HeightNode)</option>
                                    <option value="HEIGHT_SHADER" style={{ background: "var(--color-bg-card)", color: "var(--color-text-primary)" }}>GPU Shader Height</option>
                                    <option value="MARTINI" style={{ background: "var(--color-bg-card)", color: "var(--color-text-primary)" }}>Martini Mesh</option>
                                    <option value="PLANAR" style={{ background: "var(--color-bg-card)", color: "var(--color-text-primary)" }}>Planar (2D Map)</option>
                                </select>
                            </div>

                            {/* Lighting Intensity Controls */}
                            <div style={{ marginTop: "var(--spacing-xs)", paddingTop: "var(--spacing-xs)", borderTop: "1px dashed var(--color-border-subtle)", display: "flex", flexDirection: "column", gap: "var(--spacing-xs)" }}>
                                <div style={{ fontWeight: "var(--font-weight-semibold)", fontSize: "var(--font-size-2xs)", color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                                    Lighting Intensity Controls
                                </div>

                                {/* Key Sun Light (NW) */}
                                <div style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-3xs)" }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "var(--font-size-xs)", color: "var(--color-text-secondary)" }}>
                                        <span>Key Sun Light (NW):</span>
                                        <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--font-size-2xs)" }}>{keyLightIntensity.toFixed(1)}</span>
                                    </div>
                                    <input
                                        type="range"
                                        min="0"
                                        max="4.0"
                                        step="0.1"
                                        value={keyLightIntensity}
                                        onChange={(e) => setKeyLightIntensity(parseFloat(e.target.value))}
                                        style={{ width: "100%", cursor: "pointer" }}
                                    />
                                </div>

                                {/* Fill Light (SE) */}
                                <div style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-3xs)" }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "var(--font-size-xs)", color: "var(--color-text-secondary)" }}>
                                        <span>Fill Light (SE):</span>
                                        <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--font-size-2xs)" }}>{fillLightIntensity.toFixed(1)}</span>
                                    </div>
                                    <input
                                        type="range"
                                        min="0"
                                        max="3.0"
                                        step="0.1"
                                        value={fillLightIntensity}
                                        onChange={(e) => setFillLightIntensity(parseFloat(e.target.value))}
                                        style={{ width: "100%", cursor: "pointer" }}
                                    />
                                </div>

                                {/* Hemisphere Sky/Ground Light */}
                                <div style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-3xs)" }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "var(--font-size-xs)", color: "var(--color-text-secondary)" }}>
                                        <span>Hemisphere Light:</span>
                                        <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--font-size-2xs)" }}>{hemisphereLightIntensity.toFixed(1)}</span>
                                    </div>
                                    <input
                                        type="range"
                                        min="0"
                                        max="3.0"
                                        step="0.1"
                                        value={hemisphereLightIntensity}
                                        onChange={(e) => setHemisphereLightIntensity(parseFloat(e.target.value))}
                                        style={{ width: "100%", cursor: "pointer" }}
                                    />
                                </div>

                                {/* Ambient Base Light */}
                                <div style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-3xs)" }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "var(--font-size-xs)", color: "var(--color-text-secondary)" }}>
                                        <span>Ambient Light:</span>
                                        <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--font-size-2xs)" }}>{ambientLightIntensity.toFixed(1)}</span>
                                    </div>
                                    <input
                                        type="range"
                                        min="0"
                                        max="3.0"
                                        step="0.1"
                                        value={ambientLightIntensity}
                                        onChange={(e) => setAmbientLightIntensity(parseFloat(e.target.value))}
                                        style={{ width: "100%", cursor: "pointer" }}
                                    />
                                </div>
                            </div>
                        </div>
                    )}
                </div>


            </div>

            {/* Status / Errors / Stats */}
            <div
                style={{
                    marginTop: "var(--spacing-sm)",
                    paddingTop: "var(--spacing-xs)",
                    borderTop: "1px solid var(--color-border-subtle)",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                }}
            >
                {isLoading ? (
                    <span style={{ color: "var(--color-warning)", fontStyle: "italic", fontSize: "var(--font-size-xs)" }}>Loading...</span>
                ) : error ? (
                    <span style={{ color: "var(--color-danger-text)", fontSize: "var(--font-size-2xs)" }}>{error}</span>
                ) : pointCount !== null ? (
                    <span style={{ color: "var(--color-success-text)", fontWeight: "var(--font-weight-medium)", fontSize: "var(--font-size-xs)" }}>
                        {pointCount.toLocaleString()} pts loaded
                    </span>
                ) : (
                    <span style={{ color: "var(--color-text-subtle)", fontSize: "var(--font-size-xs)" }}>No points loaded</span>
                )}
            </div>
        </div>
    );
}
