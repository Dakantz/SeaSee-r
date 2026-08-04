import { useEffect, useState } from "react";
import type { PointCloudMetadataResponse } from "../../client";
import { usePLYPointCloudContext } from "./PLYPointCloudContext";

export interface PLYPointCloudSidebarProps {
    mode?: "binary" | "plyFile" | "plyUrl";
    setMode?: (mode: "binary" | "plyFile" | "plyUrl") => void;
    renderMode?: "points" | "mesh";
    setRenderMode?: (mode: "points" | "mesh") => void;
    wireframe?: boolean;
    setWireframe?: (wireframe: boolean) => void;
    pointSize?: number;
    setPointSize?: (size: number) => void;
    identifier?: string;
    setIdentifier?: (id: string) => void;
    plyUrl?: string;
    setPlyUrl?: (url: string) => void;
    lod?: number;
    setLod?: (lod: number) => void;
    isLoading?: boolean;
    error?: string | null;
    pointCount?: number | null;
    selectedFileName?: string | null;
    onLoadBinary?: (id: string, lod: number) => void;
    onLoadPlyUrl?: (url: string) => void;
    onLoadPlyFile?: (file: File) => void;
}

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

export default function PLYPointCloudSidebar(props: PLYPointCloudSidebarProps) {
    let contextState: ReturnType<typeof usePLYPointCloudContext> | null = null;
    try {
        contextState = usePLYPointCloudContext();
    } catch {
        // Fallback to props if context provider is not present
    }

    const mode = props.mode ?? contextState?.mode ?? "binary";
    const setMode = props.setMode ?? contextState?.setMode ?? (() => {});
    const renderMode = props.renderMode ?? contextState?.renderMode ?? "points";
    const setRenderMode = props.setRenderMode ?? contextState?.setRenderMode ?? (() => {});
    const wireframe = props.wireframe ?? contextState?.wireframe ?? true;
    const setWireframe = props.setWireframe ?? contextState?.setWireframe ?? (() => {});
    const pointSize = props.pointSize ?? contextState?.pointSize ?? 0.1;
    const setPointSize = props.setPointSize ?? contextState?.setPointSize ?? (() => {});
    const identifier = props.identifier ?? contextState?.identifier ?? "";
    const setIdentifier = props.setIdentifier ?? contextState?.setIdentifier ?? (() => {});
    const plyUrl = props.plyUrl ?? contextState?.plyUrl ?? "";
    const setPlyUrl = props.setPlyUrl ?? contextState?.setPlyUrl ?? (() => {});
    const lod = props.lod ?? contextState?.lod ?? 0;
    const setLod = props.setLod ?? contextState?.setLod ?? (() => {});
    const isLoading = props.isLoading ?? contextState?.isLoading ?? false;
    const error = props.error ?? contextState?.error ?? null;
    const pointCount = props.pointCount ?? contextState?.pointCount ?? null;
    const selectedFileName = props.selectedFileName ?? contextState?.selectedFileName ?? null;
    const onLoadBinary = props.onLoadBinary ?? contextState?.loadBinaryPointCloud ?? (() => {});
    const onLoadPlyUrl = props.onLoadPlyUrl ?? contextState?.loadPlyUrl ?? (() => {});
    const onLoadPlyFile = props.onLoadPlyFile ?? contextState?.loadPlyFile ?? (() => {});

    const [datasets, setDatasets] = useState<PointCloudMetadataResponse[]>([]);
    const [_fetchingDatasets, setFetchingDatasets] = useState<boolean>(false);

    useEffect(() => {
        const fetchDatasets = async () => {
            setFetchingDatasets(true);
            try {
                const res = await fetch(`${API_BASE_URL}/pointclouds/`);
                if (res.ok) {
                    const data = await res.json();
                    setDatasets(data);
                }
            } catch (err) {
                console.error("Failed to fetch available datasets for PLY sidebar:", err);
            } finally {
                setFetchingDatasets(false);
            }
        };

        fetchDatasets();
    }, []);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setMode("plyFile");
            onLoadPlyFile(e.target.files[0]);
        }
    };

    const handleSelectDataset = (id: string) => {
        setIdentifier(id);
        onLoadBinary(id, lod);
    };

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
                Point Cloud Controls
            </div>

            {/* Mode Tabs */}
            <div
                style={{
                    display: "flex",
                    gap: "var(--spacing-2xs)",
                    marginBottom: "var(--spacing-md)",
                    background: "var(--color-bg-subtle)",
                    padding: "var(--spacing-3xs)",
                    borderRadius: "var(--radius-md)",
                }}
            >
                <button
                    type="button"
                    onClick={() => setMode("binary")}
                    style={{
                        flex: 1,
                        padding: "var(--spacing-xs) var(--spacing-2xs)",
                        background: mode === "binary" ? "var(--color-accent)" : "transparent",
                        color: mode === "binary" ? "var(--color-text-contrast)" : "var(--color-text-muted)",
                        border: "none",
                        borderRadius: "var(--radius-sm)",
                        cursor: "pointer",
                        fontSize: "var(--font-size-xs)",
                        fontWeight: "var(--font-weight-medium)",
                        transition: "var(--transition-normal)",
                    }}
                >
                    Binary Stream
                </button>
                <button
                    type="button"
                    onClick={() => setMode("plyFile")}
                    style={{
                        flex: 1,
                        padding: "var(--spacing-xs) var(--spacing-2xs)",
                        background: mode === "plyFile" ? "var(--color-accent)" : "transparent",
                        color: mode === "plyFile" ? "var(--color-text-contrast)" : "var(--color-text-muted)",
                        border: "none",
                        borderRadius: "var(--radius-sm)",
                        cursor: "pointer",
                        fontSize: "var(--font-size-xs)",
                        fontWeight: "var(--font-weight-medium)",
                        transition: "var(--transition-normal)",
                    }}
                >
                    .PLY File
                </button>
                <button
                    type="button"
                    onClick={() => setMode("plyUrl")}
                    style={{
                        flex: 1,
                        padding: "var(--spacing-xs) var(--spacing-2xs)",
                        background: mode === "plyUrl" ? "var(--color-accent)" : "transparent",
                        color: mode === "plyUrl" ? "var(--color-text-contrast)" : "var(--color-text-muted)",
                        border: "none",
                        borderRadius: "var(--radius-sm)",
                        cursor: "pointer",
                        fontSize: "var(--font-size-xs)",
                        fontWeight: "var(--font-weight-medium)",
                        transition: "var(--transition-normal)",
                    }}
                >
                    PLY URL
                </button>
            </div>

            {/* Mode Content */}
            {mode === "binary" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-xs)" }}>
                    {datasets.length > 0 && (
                        <>
                            <label style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)" }}>
                                Available Datasets:
                            </label>
                            <select
                                value={identifier}
                                onChange={(e) => handleSelectDataset(e.target.value)}
                                style={{
                                    background: "var(--color-bg-subtle)",
                                    border: "1px solid var(--color-border-strong)",
                                    color: "var(--color-text-secondary)",
                                    padding: "var(--spacing-xs) var(--spacing-sm)",
                                    borderRadius: "var(--radius-sm)",
                                    fontSize: "var(--font-size-xs)",
                                    width: "100%",
                                    boxSizing: "border-box",
                                    cursor: "pointer",
                                }}
                            >
                                <option value="" style={{ background: "var(--color-bg-card)", color: "var(--color-text-primary)" }}>
                                    -- Select Dataset --
                                </option>
                                {datasets.map((d) => {
                                    const label = d.orig_filename || d.safe_filename || d.id;
                                    return (
                                        <option
                                            key={d.id}
                                            value={d.id}
                                            style={{ background: "var(--color-bg-card)", color: "var(--color-text-primary)" }}
                                        >
                                            {label} ({d.number_of_points?.toLocaleString() ?? "N/A"} pts)
                                        </option>
                                    );
                                })}
                            </select>
                        </>
                    )}

                    <label style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)" }}>
                        Backend Identifier / UUID:
                    </label>
                    <input
                        type="text"
                        value={identifier}
                        onChange={(e) => setIdentifier(e.target.value)}
                        placeholder="Identifier UUID"
                        style={{
                            background: "var(--color-bg-subtle)",
                            border: "1px solid var(--color-border-strong)",
                            color: "var(--color-text-secondary)",
                            padding: "var(--spacing-xs) var(--spacing-sm)",
                            borderRadius: "var(--radius-sm)",
                            fontSize: "var(--font-size-xs)",
                            fontFamily: "var(--font-mono)",
                            width: "100%",
                            boxSizing: "border-box",
                        }}
                    />

                    <label style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)" }}>
                        Level of Detail (LOD):
                    </label>
                    <select
                        value={lod}
                        onChange={(e) => {
                            const newLod = Number(e.target.value);
                            setLod(newLod);
                            if (identifier.trim()) {
                                onLoadBinary(identifier, newLod);
                            }
                        }}
                        style={{
                            background: "var(--color-bg-subtle)",
                            border: "1px solid var(--color-border-strong)",
                            color: "var(--color-text-secondary)",
                            padding: "var(--spacing-xs) var(--spacing-sm)",
                            borderRadius: "var(--radius-sm)",
                            fontSize: "var(--font-size-xs)",
                            width: "100%",
                            boxSizing: "border-box",
                            cursor: "pointer",
                        }}
                    >
                        <option value={0} style={{ background: "var(--color-bg-card)", color: "var(--color-text-primary)" }}>LOD 0 (Full - 100%)</option>
                        <option value={1} style={{ background: "var(--color-bg-card)", color: "var(--color-text-primary)" }}>LOD 1 (High - 50%)</option>
                        <option value={2} style={{ background: "var(--color-bg-card)", color: "var(--color-text-primary)" }}>LOD 2 (Medium - 25%)</option>
                        <option value={3} style={{ background: "var(--color-bg-card)", color: "var(--color-text-primary)" }}>LOD 3 (Low - 12.5%)</option>
                    </select>

                    <button
                        type="button"
                        onClick={() => onLoadBinary(identifier, lod)}
                        disabled={isLoading || !identifier.trim()}
                        style={{
                            marginTop: "var(--spacing-2xs)",
                            background: isLoading || !identifier.trim() ? "var(--color-border-solid)" : "var(--color-accent)",
                            color: "var(--color-text-contrast)",
                            border: "none",
                            padding: "var(--spacing-xs) var(--spacing-lg)",
                            borderRadius: "var(--radius-sm)",
                            cursor: isLoading || !identifier.trim() ? "not-allowed" : "pointer",
                            fontWeight: "var(--font-weight-medium)",
                            fontSize: "var(--font-size-xs)",
                        }}
                    >
                        {isLoading ? "Streaming Binary..." : "Stream Binary"}
                    </button>
                </div>
            )}

            {mode === "plyFile" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-xs)" }}>
                    <label style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)" }}>
                        Select .PLY File:
                    </label>
                    <input
                        type="file"
                        accept=".ply,.PLY"
                        onChange={handleFileChange}
                        style={{
                            fontSize: "var(--font-size-xs)",
                            color: "var(--color-text-body)",
                        }}
                    />
                    {selectedFileName && (
                        <div style={{ fontSize: "var(--font-size-2xs)", color: "var(--color-accent-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            Selected: {selectedFileName}
                        </div>
                    )}
                </div>
            )}

            {mode === "plyUrl" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-xs)" }}>
                    <label style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)" }}>
                        PLY File URL:
                    </label>
                    <input
                        type="text"
                        value={plyUrl}
                        onChange={(e) => setPlyUrl(e.target.value)}
                        style={{
                            background: "var(--color-bg-subtle)",
                            border: "1px solid var(--color-border-strong)",
                            color: "var(--color-text-secondary)",
                            padding: "var(--spacing-xs) var(--spacing-sm)",
                            borderRadius: "var(--radius-sm)",
                            fontSize: "var(--font-size-xs)",
                            width: "100%",
                            boxSizing: "border-box",
                        }}
                    />
                    <button
                        type="button"
                        onClick={() => onLoadPlyUrl(plyUrl)}
                        disabled={isLoading}
                        style={{
                            marginTop: "var(--spacing-2xs)",
                            background: isLoading ? "var(--color-border-solid)" : "var(--color-accent)",
                            color: "var(--color-text-contrast)",
                            border: "none",
                            padding: "var(--spacing-xs) var(--spacing-lg)",
                            borderRadius: "var(--radius-sm)",
                            cursor: isLoading ? "not-allowed" : "pointer",
                            fontWeight: "var(--font-weight-medium)",
                            fontSize: "var(--font-size-xs)",
                        }}
                    >
                        {isLoading ? "Loading PLY..." : "Load PLY URL"}
                    </button>
                </div>
            )}

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
