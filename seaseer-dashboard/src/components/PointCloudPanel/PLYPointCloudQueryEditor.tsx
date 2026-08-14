import { useState, useEffect } from "react";
import { usePLYPointCloudContext, DEFAULT_CUSTOM_QUERY } from "./PLYPointCloudContext";

export interface QueryExample {
    id: string;
    label: string;
    description: string;
    query: string;
}

export const QUERY_EXAMPLES: QueryExample[] = [
    {
        id: "default",
        label: "Default Query",
        description: "Streams all points for the selected dataset ID and Level of Detail.",
        query: DEFAULT_CUSTOM_QUERY,
    },
    {
        id: "positive_x",
        label: "Points Above 0 (X > 0)",
        description: "Filters patches containing points on the positive X axis, then strictly returns points where X > 0.",
        query: `SELECT pt
    FROM (
        -- Only explode patches that have at least SOME points on the positive X axis
        SELECT PC_Explode(patch) AS pt 
        FROM pointcloud_patches
        WHERE PC_PatchMax(patch, 'X') > 0
    ) AS exploded
    -- Then filter the exact points strictly
    WHERE PC_Get(pt, 'X') > 0`,
    },
    {
        id: "positive_z",
        label: "Points Above 0 (Z > 0)",
        description: "Filters patches containing points with elevation Z > 0, then strictly selects points with Z > 0.",
        query: `SELECT pt
    FROM (
        -- Only explode patches that have at least SOME points on the positive Z axis
        SELECT PC_Explode(patch) AS pt 
        FROM pointcloud_patches
        WHERE PC_PatchMax(patch, 'Z') > 0
    ) AS exploded
    -- Then filter the exact points strictly
    WHERE PC_Get(pt, 'Z') > 0`,
    },
];

export interface PLYPointCloudQueryEditorProps {
    className?: string;
    style?: React.CSSProperties;
}

export default function PLYPointCloudQueryEditor({ style }: PLYPointCloudQueryEditorProps) {
    const { customQuery, setCustomQuery, executeCustomQuery, isLoading, error } = usePLYPointCloudContext();
    const [localQuery, setLocalQuery] = useState<string>(customQuery);
    const [selectedPresetId, setSelectedPresetId] = useState<string>("default");

    // Synchronize local state with context when customQuery updates externally
    useEffect(() => {
        setLocalQuery(customQuery);
        const match = QUERY_EXAMPLES.find((ex) => ex.query.trim() === customQuery.trim());
        if (match) {
            setSelectedPresetId(match.id);
        } else {
            setSelectedPresetId("custom");
        }
    }, [customQuery]);

    const handlePresetChange = (presetId: string) => {
        setSelectedPresetId(presetId);
        const found = QUERY_EXAMPLES.find((ex) => ex.id === presetId);
        if (found) {
            setLocalQuery(found.query);
        }
    };

    const handleRunQuery = () => {
        executeCustomQuery(localQuery);
        if (localQuery && localQuery.trim()) {
            const foundPreset = QUERY_EXAMPLES.find((ex) => ex.query.trim() === localQuery.trim());
            const queryName = foundPreset ? foundPreset.label : undefined;
            window.dispatchEvent(
                new CustomEvent("add_custom_query", {
                    detail: {
                        queryText: localQuery,
                        name: queryName,
                    },
                })
            );
        }
    };

    const handleReset = () => {
        setLocalQuery(DEFAULT_CUSTOM_QUERY);
        setSelectedPresetId("default");
        executeCustomQuery(DEFAULT_CUSTOM_QUERY);
    };

    const isDefault = localQuery.trim() === DEFAULT_CUSTOM_QUERY.trim();

    return (
        <div
            style={{
                background: "var(--color-bg-card)",
                border: "1px solid var(--color-border-strong)",
                borderRadius: "var(--radius-lg)",
                padding: "var(--spacing-md)",
                display: "flex",
                flexDirection: "column",
                gap: "var(--spacing-sm)",
                fontFamily: "var(--font-sans)",
                color: "var(--color-text-primary)",
                ...style,
            }}
        >
            {/* Header / Title */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "var(--spacing-xs)" }}>
                    <span style={{ fontSize: "var(--font-size-sm)", fontWeight: "var(--font-weight-semibold)", color: "var(--color-accent-text)" }}>
                        🔍 Custom Query Editor
                    </span>
                </div>
                <span
                    style={{
                        fontSize: "var(--font-size-2xs)",
                        padding: "2px 8px",
                        borderRadius: "var(--radius-full)",
                        fontWeight: "var(--font-weight-medium)",
                        background: isDefault ? "var(--color-bg-subtle)" : "rgba(0, 229, 255, 0.15)",
                        color: isDefault ? "var(--color-text-muted)" : "#00e5ff",
                        border: isDefault ? "1px solid var(--color-border-subtle)" : "1px solid rgba(0, 229, 255, 0.4)",
                    }}
                >
                    {isDefault ? "Default Query" : "Custom SQL Active"}
                </span>
            </div>

            {/* Presets & Examples Quick Select */}
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-3xs)" }}>
                <label style={{ fontSize: "var(--font-size-2xs)", color: "var(--color-text-muted)", fontWeight: "var(--font-weight-medium)" }}>
                    Query Presets & Examples:
                </label>
                <select
                    value={selectedPresetId}
                    onChange={(e) => handlePresetChange(e.target.value)}
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
                    {QUERY_EXAMPLES.map((ex) => (
                        <option key={ex.id} value={ex.id} style={{ background: "var(--color-bg-card)", color: "var(--color-text-primary)" }}>
                            {ex.label}
                        </option>
                    ))}
                    {selectedPresetId === "custom" && (
                        <option value="custom" style={{ background: "var(--color-bg-card)", color: "var(--color-text-primary)" }}>
                            ✏️ Custom Query
                        </option>
                    )}
                </select>
            </div>

            {/* Quick Action Pill Buttons */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--spacing-3xs)" }}>
                {QUERY_EXAMPLES.map((ex) => {
                    const isActive = selectedPresetId === ex.id;
                    return (
                        <button
                            key={ex.id}
                            type="button"
                            onClick={() => handlePresetChange(ex.id)}
                            style={{
                                padding: "2px 8px",
                                fontSize: "11px",
                                borderRadius: "var(--radius-xs)",
                                border: isActive ? "1px solid var(--color-accent)" : "1px solid var(--color-border-subtle)",
                                background: isActive ? "rgba(0, 229, 255, 0.1)" : "var(--color-bg-subtle)",
                                color: isActive ? "var(--color-accent-text)" : "var(--color-text-muted)",
                                cursor: "pointer",
                                transition: "all 0.15s ease",
                            }}
                        >
                            {ex.label}
                        </button>
                    );
                })}
            </div>

            {/* Description Box */}
            {selectedPresetId !== "custom" && (
                <div style={{ fontSize: "11px", color: "var(--color-text-muted)", fontStyle: "italic", background: "var(--color-bg-subtle)", padding: "var(--spacing-3xs) var(--spacing-xs)", borderRadius: "var(--radius-xs)" }}>
                    {QUERY_EXAMPLES.find((ex) => ex.id === selectedPresetId)?.description}
                </div>
            )}

            {/* SQL Text Area Editor */}
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-3xs)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <label style={{ fontSize: "var(--font-size-2xs)", color: "var(--color-text-muted)", fontWeight: "var(--font-weight-medium)" }}>
                        PostGIS / pgPointCloud SQL:
                    </label>
                    <span style={{ fontSize: "10px", color: "var(--color-text-subtle)", fontFamily: "var(--font-mono)" }}>
                        Yields: pt
                    </span>
                </div>
                <textarea
                    rows={6}
                    value={localQuery}
                    onChange={(e) => {
                        setLocalQuery(e.target.value);
                        setSelectedPresetId("custom");
                        setCustomQuery(e.target.value);
                    }}
                    placeholder="Enter PostGIS point cloud SQL query..."
                    style={{
                        background: "var(--color-bg-subtle)",
                        border: "1px solid var(--color-border-strong)",
                        color: "#00e5ff",
                        fontFamily: "var(--font-mono)",
                        fontSize: "var(--font-size-2xs)",
                        lineHeight: "1.4",
                        padding: "var(--spacing-xs)",
                        borderRadius: "var(--radius-sm)",
                        resize: "vertical",
                        width: "100%",
                        boxSizing: "border-box",
                    }}
                />
            </div>

            {/* Parameter chips note */}
            <div style={{ display: "flex", gap: "var(--spacing-xs)", alignItems: "center", fontSize: "11px", color: "var(--color-text-muted)" }}>
                <span>Available bind variables:</span>
                <code style={{ background: "rgba(255, 255, 255, 0.08)", padding: "1px 4px", borderRadius: "3px", color: "#ffaa00" }}>:id</code>
                <code style={{ background: "rgba(255, 255, 255, 0.08)", padding: "1px 4px", borderRadius: "3px", color: "#ffaa00" }}>:lod</code>
            </div>

            {/* Controls / Actions */}
            <div style={{ display: "flex", gap: "var(--spacing-xs)", marginTop: "var(--spacing-3xs)" }}>
                <button
                    type="button"
                    onClick={handleRunQuery}
                    disabled={isLoading}
                    style={{
                        flex: 1,
                        background: "var(--color-accent)",
                        color: "var(--color-text-contrast)",
                        border: "none",
                        borderRadius: "var(--radius-xs)",
                        padding: "var(--spacing-2xs) var(--spacing-xs)",
                        fontSize: "var(--font-size-xs)",
                        fontWeight: "var(--font-weight-semibold)",
                        cursor: isLoading ? "not-allowed" : "pointer",
                        opacity: isLoading ? 0.7 : 1,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "var(--spacing-xs)",
                    }}
                >
                    {isLoading ? "⏳ Querying..." : "⚡ Run Query"}
                </button>
                <button
                    type="button"
                    onClick={handleReset}
                    disabled={isLoading || isDefault}
                    style={{
                        background: "var(--color-bg-subtle)",
                        color: isDefault ? "var(--color-text-subtle)" : "var(--color-text-secondary)",
                        border: "1px solid var(--color-border-strong)",
                        borderRadius: "var(--radius-xs)",
                        padding: "var(--spacing-2xs) var(--spacing-xs)",
                        fontSize: "var(--font-size-xs)",
                        cursor: isDefault ? "default" : "pointer",
                        opacity: isDefault ? 0.5 : 1,
                    }}
                >
                    🔄 Reset
                </button>
            </div>

            {error && (
                <div style={{ fontSize: "var(--font-size-2xs)", color: "var(--color-danger-text)", background: "var(--color-danger-subtle)", padding: "var(--spacing-xs)", borderRadius: "var(--radius-xs)", border: "1px solid var(--color-danger-text)" }}>
                    ⚠️ {error}
                </div>
            )}
        </div>
    );
}
