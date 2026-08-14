import React, { useState, useEffect, useRef } from "react";

/**
 * Interface representing a Custom SQL Query item in the Custom Query Manager.
 */
export interface CustomQuery {
  id: string; // Unique identifier (UUID or key)
  name: string; // Display name / label for the query
  queryText: string; // SQL query text string
}

/**
 * Backwards compatibility alias for code expecting PointCloudItem
 */
export type PointCloudItem = CustomQuery;

export const DEFAULT_POINTCLOUD_UUID = "550e8400-e29b-41d4-a716-446655440000";

/**
 * Generates default SQL query text for a given pointcloud UUID.
 */
export const buildDefaultQueryText = (pointcloudId?: string | null): string => {
  const targetId = pointcloudId && pointcloudId.trim() !== "" ? pointcloudId : DEFAULT_POINTCLOUD_UUID;
  return `SELECT PC_Explode(patch) AS pt FROM pointcloud_patches_lod0 WHERE pointcloud_id = '${targetId}'`;
};

/**
 * Creates a new CustomQuery object with sensible defaults.
 */
export const createDefaultQuery = (
  pointcloudId?: string | null,
  pointcloudName?: string | null,
  indexHint?: number
): CustomQuery => {
  const targetId = pointcloudId && pointcloudId.trim() !== "" ? pointcloudId : DEFAULT_POINTCLOUD_UUID;
  const displayName = pointcloudName && pointcloudName.trim() !== ""
    ? pointcloudName
    : (targetId.length > 8 ? targetId.substring(0, 8) : targetId);
  const countLabel = indexHint ? ` #${indexHint}` : "";

  return {
    id: `query-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    name: `Query for ${displayName}${countLabel}`,
    queryText: buildDefaultQueryText(targetId),
  };
};

export interface QuerySummaryData {
  total_points: number;
  number_of_points: number;
  bounding_box?: {
    min_x?: number | null;
    min_y?: number | null;
    min_z?: number | null;
    max_x?: number | null;
    max_y?: number | null;
    max_z?: number | null;
  } | null;
  connected_pointclouds?: Array<{
    id: string;
    orig_filename: string;
    number_of_points: number;
    created_at?: string;
    pcid?: number;
    [key: string]: any;
  }>;
}

/**
 * Calculates the center 3D coordinates [x, y, z] of a query bounding box.
 */
export const getBoundingBoxCenter = (
  bbox?: QuerySummaryData["bounding_box"]
): [number, number, number] | null => {
  if (
    !bbox ||
    bbox.min_x == null || bbox.max_x == null ||
    bbox.min_y == null || bbox.max_y == null ||
    bbox.min_z == null || bbox.max_z == null
  ) {
    return null;
  }
  return [
    (bbox.min_x + bbox.max_x) / 2,
    (bbox.min_y + bbox.max_y) / 2,
    (bbox.min_z + bbox.max_z) / 2,
  ];
};

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

const STORAGE_KEY = "seaseer_custom_sql_queries";

/**
 * Props for the CustomQueryManager component.
 */
export interface CustomQueryManagerProps {
  /** Optional initial custom queries */
  initialQueries?: CustomQuery[];
  /** Controlled queries array (if managed externally) */
  queries?: CustomQuery[];
  /** Currently selected/active query ID */
  activeQueryId?: string | null;
  /**
   * Trigger prop: When a pointcloud is selected in a different component,
   * passing a new selectedPointCloudId automatically generates and adds a query to the list.
   */
  selectedPointCloudId?: string | null;
  /** Optional human-readable name of the selected pointcloud */
  selectedPointCloudName?: string | null;
  /** Legacy selectedIds prop alias */
  selectedIds?: string[];
  /** Callback triggered when a new query is added */
  onAddQuery?: (pointcloudId?: string) => void;
  /** Callback triggered when the user clicks "Run" / "Select" on a query */
  onRunQuery?: (query: CustomQuery) => void;
  /** Callback triggered when query selection changes */
  onSelectQuery?: (queryId: string) => void;
  /** Callback triggered when a query is deleted */
  onDeleteQuery?: (queryId: string) => void;
  /** Callback triggered when a query is updated */
  onUpdateQuery?: (query: CustomQuery) => void;
  /** Callback triggered whenever the list of queries changes */
  onQueriesChange?: (queries: CustomQuery[]) => void;
  /** Callback triggered to focus the camera on specific 3D coordinates */
  onFocusCenter?: (center: [number, number, number] | { x: number; y: number; z: number }) => void;

  /* Legacy props maintained for component API compatibility */
  hoveredId?: string | null;
  onSelectionChange?: (selectedIds: string[]) => void;
  onMoveCamera?: (pointcloudId: string) => void;
  onEdit?: (pointcloudId: string) => void;
  onHover?: (pointcloudId: string | null) => void;
  onSelect?: (pointcloudId: string) => void;
  pointclouds?: any[];
}

/** Legacy type alias */
export type PointCloudListProps = CustomQueryManagerProps;

/**
 * Custom Query Manager Component
 * 
 * Manages rendering, manual editing, client-side persistence (localStorage),
 * and automatic generation of custom SQL queries for PostGIS / pgPointCloud datasets.
 */
export const CustomQueryManager: React.FC<CustomQueryManagerProps> = ({
  initialQueries,
  queries: externalQueries,
  activeQueryId: externalActiveQueryId,
  selectedPointCloudId,
  selectedPointCloudName,
  onAddQuery,
  onRunQuery,
  onSelectQuery,
  onDeleteQuery,
  onUpdateQuery,
  onQueriesChange,
  onFocusCenter,
  onMoveCamera,
  onSelect,
}) => {
  // 1. Client-Side Storage & Local State Initialization
  const [internalQueries, setInternalQueries] = useState<CustomQuery[]>(() => {
    if (initialQueries && initialQueries.length > 0) {
      return initialQueries;
    }
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch (e) {
      console.error("Failed to load queries from localStorage:", e);
    }
    return [createDefaultQuery(selectedPointCloudId || DEFAULT_POINTCLOUD_UUID, selectedPointCloudName)];
  });

  const [activeId, setActiveId] = useState<string | null>(() => {
    return externalActiveQueryId || (internalQueries.length > 0 ? internalQueries[0].id : null);
  });

  const [saveStatusMap, setSaveStatusMap] = useState<Record<string, string>>({});
  const [summaryMap, setSummaryMap] = useState<Record<string, QuerySummaryData>>({});
  const [summaryLoadingMap, setSummaryLoadingMap] = useState<Record<string, boolean>>({});
  const [summaryErrorMap, setSummaryErrorMap] = useState<Record<string, string | null>>({});

  const queries = externalQueries || internalQueries;
  const activeQueryId = externalActiveQueryId !== undefined ? externalActiveQueryId : activeId;

  // Function to fetch summary information from /pointclouds/stream-summary
  const fetchQuerySummary = async (queryId: string, queryText: string, lod = 0): Promise<QuerySummaryData | null> => {
    if (!queryText || !queryText.trim()) return null;

    setSummaryLoadingMap((prev) => ({ ...prev, [queryId]: true }));
    setSummaryErrorMap((prev) => ({ ...prev, [queryId]: null }));

    try {
      const url = `${API_BASE_URL}/pointclouds/stream-summary?lod=${lod}&query=${encodeURIComponent(queryText.trim())}`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Server returned HTTP ${response.status}`);
      }
      const data: QuerySummaryData = await response.json();
      setSummaryMap((prev) => ({ ...prev, [queryId]: data }));
      return data;
    } catch (err: any) {
      console.error(`Error fetching summary for query ${queryId}:`, err);
      setSummaryErrorMap((prev) => ({
        ...prev,
        [queryId]: err.message || "Failed to fetch summary",
      }));
      return null;
    } finally {
      setSummaryLoadingMap((prev) => ({ ...prev, [queryId]: false }));
    }
  };

  // Automatically fetch query summaries for any query missing summary data
  useEffect(() => {
    queries.forEach((q) => {
      if (!summaryMap[q.id] && !summaryLoadingMap[q.id]) {
        fetchQuerySummary(q.id, q.queryText);
      }
    });
  }, [queries]);

  // Track previous selectedPointCloudId to detect new selections
  const prevSelectedIdRef = useRef<string | null | undefined>(selectedPointCloudId);

  // 2. Client-Side Storage Sync (localStorage + useEffect)
  useEffect(() => {
    if (!externalQueries) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(internalQueries));
      } catch (e) {
        console.error("Failed to persist queries to localStorage:", e);
      }
    }
    onQueriesChange?.(queries);
  }, [internalQueries, externalQueries, queries, onQueriesChange]);

  // Listen for custom queries executed elsewhere (e.g. PLYPointCloudQueryEditor)
  useEffect(() => {
    const handleAddQueryEvent = (e: Event) => {
      const customEvent = e as CustomEvent<{ queryText: string; name?: string }>;
      const { queryText, name } = customEvent.detail || {};
      if (!queryText || !queryText.trim()) return;

      setInternalQueries((prev) => {
        const trimmedNew = queryText.trim();
        const existing = prev.find((q) => q.queryText.trim() === trimmedNew);
        if (existing) {
          setActiveId(existing.id);
          return prev;
        }

        const newQuery: CustomQuery = {
          id: `query-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          name: name || `Custom Query #${prev.length + 1}`,
          queryText: queryText,
        };
        setActiveId(newQuery.id);
        return [...prev, newQuery];
      });
    };

    window.addEventListener("add_custom_query", handleAddQueryEvent);
    return () => {
      window.removeEventListener("add_custom_query", handleAddQueryEvent);
    };
  }, []);

  // 3. Default Query Generation on prop change
  useEffect(() => {
    if (
      selectedPointCloudId &&
      selectedPointCloudId !== prevSelectedIdRef.current
    ) {
      prevSelectedIdRef.current = selectedPointCloudId;

      const newQuery = createDefaultQuery(selectedPointCloudId, selectedPointCloudName, queries.length + 1);
      
      setInternalQueries((prev) => [...prev, newQuery]);
      setActiveId(newQuery.id);
      
      onAddQuery?.(selectedPointCloudId);
    }
  }, [selectedPointCloudId, selectedPointCloudName, queries.length, onAddQuery]);

  // Handler to manually add a new query
  const handleAddNewQuery = (targetPcId?: string) => {
    const pcId = targetPcId || selectedPointCloudId || DEFAULT_POINTCLOUD_UUID;
    const newQuery = createDefaultQuery(pcId, selectedPointCloudName, queries.length + 1);
    
    setInternalQueries((prev) => [...prev, newQuery]);
    setActiveId(newQuery.id);
    onAddQuery?.(pcId);
  };

  // Handler for text / title updates
  const handleUpdateQuery = (id: string, field: "name" | "queryText", value: string) => {
    setInternalQueries((prev) =>
      prev.map((q) => (q.id === id ? { ...q, [field]: value } : q))
    );

    const updatedQuery = queries.find((q) => q.id === id);
    if (updatedQuery) {
      onUpdateQuery?.({ ...updatedQuery, [field]: value });
    }

    // Auto-save feedback
    triggerSaveFeedback(id, "Auto-saved");
  };

  // Manual save handler
  const handleManualSave = (id: string) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(queries));
      triggerSaveFeedback(id, "Saved ✓");
    } catch (e) {
      console.error("Manual save to localStorage failed:", e);
      triggerSaveFeedback(id, "Error saving");
    }
  };

  const triggerSaveFeedback = (id: string, message: string) => {
    setSaveStatusMap((prev) => ({ ...prev, [id]: message }));
    setTimeout(() => {
      setSaveStatusMap((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }, 2000);
  };

  // Handler to delete a query
  const handleDeleteQuery = (id: string) => {
    if (queries.length <= 1) {
      alert("At least one query must remain in the manager.");
      return;
    }
    setInternalQueries((prev) => prev.filter((q) => q.id !== id));
    if (activeId === id) {
      const remaining = queries.filter((q) => q.id !== id);
      if (remaining.length > 0) {
        setActiveId(remaining[0].id);
      }
    }
    onDeleteQuery?.(id);
  };

  // Handler to execute/run a query
  const handleRun = (query: CustomQuery) => {
    setActiveId(query.id);
    onSelectQuery?.(query.id);
    onSelect?.(query.id);
    onRunQuery?.(query);
  };

  // Handler to focus camera onto the 3D bounding box center of a query
  const handleFocusQuery = async (query: CustomQuery) => {
    setActiveId(query.id);
    let summary: QuerySummaryData | null = summaryMap[query.id] || null;
    if (!summary || !summary.bounding_box) {
      summary = await fetchQuerySummary(query.id, query.queryText);
    }

    const center = getBoundingBoxCenter(summary?.bounding_box);
    if (center) {
      onFocusCenter?.(center);
      window.dispatchEvent(
        new CustomEvent("focus_camera_target", {
          detail: { x: center[0], y: center[1], z: center[2] },
        })
      );
    } else {
      if (onMoveCamera && selectedPointCloudId) {
        onMoveCamera(selectedPointCloudId);
      }
    }
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--spacing-sm, 12px)",
        background: "var(--color-bg-card, #1e1e24)",
        border: "1px solid var(--color-border-strong, #2a2b36)",
        borderRadius: "var(--radius-lg, 8px)",
        padding: "var(--spacing-md, 16px)",
        color: "var(--color-text-primary, #f0f0f5)",
        fontFamily: "var(--font-sans, system-ui, sans-serif)",
        fontSize: "var(--font-size-sm, 14px)",
      }}
    >
      {/* Header & Catalog Summary */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          paddingBottom: "var(--spacing-xs, 8px)",
          borderBottom: "1px solid var(--color-border-subtle, #2d2e3d)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span
            style={{
              fontWeight: "var(--font-weight-semibold, 600)",
              fontSize: "var(--font-size-xs, 12px)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              color: "var(--color-accent-text, #93c5fd)",
            }}
          >
            Custom Queries ({queries.length})
          </span>
        </div>

        <button
          type="button"
          onClick={() => handleAddNewQuery()}
          style={{
            background: "var(--color-bg-button, #2563eb)",
            border: "none",
            color: "#ffffff",
            borderRadius: "var(--radius-sm, 4px)",
            padding: "4px 10px",
            fontSize: "var(--font-size-xs, 12px)",
            fontWeight: 500,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "4px",
            transition: "background 0.15s ease",
          }}
          title="Add a new custom SQL query"
        >
          + New Query
        </button>
      </div>

      {/* Query Cards List */}
      {queries.length === 0 ? (
        <div
          style={{
            textAlign: "center",
            padding: "var(--spacing-lg, 24px) var(--spacing-sm, 12px)",
            color: "var(--color-text-muted, #9ca3af)",
            fontSize: "var(--font-size-xs, 12px)",
            fontStyle: "italic",
          }}
        >
          No custom queries available. Click "+ New Query" to add one.
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--spacing-sm, 12px)",
            maxHeight: "420px",
            overflowY: "auto",
            paddingRight: "2px",
          }}
        >
          {queries.map((q) => {
            const isActive = q.id === activeQueryId;
            const saveStatus = saveStatusMap[q.id];

            return (
              <div
                key={q.id}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                  padding: "12px",
                  borderRadius: "var(--radius-md, 6px)",
                  background: isActive
                    ? "var(--color-bg-accent-subtle, rgba(59, 130, 246, 0.12))"
                    : "var(--color-bg-subtle, #14151b)",
                  border: isActive
                    ? "1px solid var(--color-accent, #3b82f6)"
                    : "1px solid var(--color-border-subtle, #2a2b36)",
                  transition: "all 0.15s ease-in-out",
                }}
              >
                {/* Item Top Row: Name Editor and Delete Action */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "8px",
                  }}
                >
                  <input
                    type="text"
                    value={q.name}
                    onChange={(e) => handleUpdateQuery(q.id, "name", e.target.value)}
                    placeholder="Query Name..."
                    style={{
                      background: "transparent",
                      border: "1px solid transparent",
                      borderRadius: "var(--radius-sm, 4px)",
                      color: isActive
                        ? "var(--color-text-primary, #ffffff)"
                        : "var(--color-text-secondary, #d1d5db)",
                      fontWeight: isActive ? 600 : 500,
                      fontSize: "var(--font-size-sm, 13px)",
                      padding: "2px 4px",
                      outline: "none",
                      flex: 1,
                    }}
                    onFocus={(e) => {
                      e.target.style.border = "1px solid var(--color-border-strong, #374151)";
                      e.target.style.background = "var(--color-bg-card, #1e1e24)";
                    }}
                    onBlur={(e) => {
                      e.target.style.border = "1px solid transparent";
                      e.target.style.background = "transparent";
                    }}
                  />

                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      flexShrink: 0,
                    }}
                  >
                    {isActive && (
                      <span
                        style={{
                          fontSize: "10px",
                          padding: "2px 6px",
                          borderRadius: "var(--radius-sm, 4px)",
                          background: "rgba(59, 130, 246, 0.2)",
                          color: "#60a5fa",
                          fontWeight: 500,
                        }}
                      >
                        Active
                      </span>
                    )}

                    <button
                      type="button"
                      title="Delete query"
                      onClick={() => handleDeleteQuery(q.id)}
                      style={{
                        background: "rgba(248, 113, 113, 0.1)",
                        border: "1px solid rgba(248, 113, 113, 0.3)",
                        color: "#f87171",
                        borderRadius: "var(--radius-sm, 4px)",
                        padding: "3px 6px",
                        fontSize: "11px",
                        cursor: "pointer",
                        transition: "all 0.15s ease",
                      }}
                    >
                      🗑️
                    </button>
                  </div>
                </div>

                {/* SQL Query Textarea */}
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <textarea
                    rows={4}
                    value={q.queryText}
                    onChange={(e) => handleUpdateQuery(q.id, "queryText", e.target.value)}
                    placeholder="Enter SQL query (e.g. SELECT PC_Explode(patch)...)"
                    style={{
                      background: "var(--color-bg-card, #1e1e24)",
                      border: "1px solid var(--color-border-strong, #2a2b36)",
                      color: "#00e5ff",
                      fontFamily: "var(--font-mono, monospace)",
                      fontSize: "11px",
                      lineHeight: "1.4",
                      padding: "8px",
                      borderRadius: "var(--radius-sm, 4px)",
                      resize: "vertical",
                      width: "100%",
                      boxSizing: "border-box",
                      outline: "none",
                    }}
                  />
                </div>

                {/* Summary Information Display Panel */}
                <div
                  style={{
                    padding: "8px 10px",
                    borderRadius: "var(--radius-sm, 6px)",
                    background: "rgba(15, 17, 26, 0.7)",
                    border: "1px solid rgba(255, 255, 255, 0.08)",
                    fontSize: "11px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "6px",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <span
                      style={{
                        fontWeight: 600,
                        color: "var(--color-accent-text, #93c5fd)",
                        fontSize: "11px",
                        display: "flex",
                        alignItems: "center",
                        gap: "4px",
                      }}
                    >
                      📊 Query Summary
                    </span>

                    <button
                      type="button"
                      onClick={() => fetchQuerySummary(q.id, q.queryText)}
                      disabled={summaryLoadingMap[q.id]}
                      style={{
                        background: "transparent",
                        border: "none",
                        color: "#9ca3af",
                        fontSize: "10px",
                        cursor: summaryLoadingMap[q.id] ? "not-allowed" : "pointer",
                        padding: "0 2px",
                        textDecoration: "underline",
                      }}
                      title="Fetch / refresh query summary"
                    >
                      {summaryLoadingMap[q.id] ? "Calculating..." : "🔄 Refresh"}
                    </button>
                  </div>

                  {summaryLoadingMap[q.id] ? (
                    <div style={{ color: "#9ca3af", fontStyle: "italic", fontSize: "10px" }}>
                      Calculating total points & 3D bounding box...
                    </div>
                  ) : summaryErrorMap[q.id] ? (
                    <div style={{ color: "#f87171", fontSize: "10px" }}>
                      ⚠️ {summaryErrorMap[q.id]}
                    </div>
                  ) : summaryMap[q.id] ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      {/* Point Count Badge */}
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <span style={{ color: "#9ca3af", fontSize: "10px" }}>Selected Points:</span>
                        <span
                          style={{
                            fontWeight: 700,
                            color: "#10b981",
                            background: "rgba(16, 185, 129, 0.12)",
                            padding: "2px 6px",
                            borderRadius: "4px",
                            fontSize: "11px",
                          }}
                        >
                          ⚡ {(summaryMap[q.id].total_points ?? 0).toLocaleString()} pts
                        </span>
                      </div>

                      {/* 3D Bounding Box */}
                      {summaryMap[q.id].bounding_box ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span style={{ color: "#9ca3af", fontSize: "10px" }}>Bounding Box (XYZ):</span>
                            <button
                              type="button"
                              onClick={() => handleFocusQuery(q)}
                              style={{
                                background: "rgba(59, 130, 246, 0.15)",
                                border: "1px solid rgba(59, 130, 246, 0.3)",
                                color: "#60a5fa",
                                borderRadius: "4px",
                                padding: "1px 6px",
                                fontSize: "10px",
                                cursor: "pointer",
                                display: "flex",
                                alignItems: "center",
                                gap: "3px",
                              }}
                              title="Focus camera to center of bounding box"
                            >
                              🎯 Focus
                            </button>
                          </div>
                          <div
                            style={{
                              fontFamily: "var(--font-mono, monospace)",
                              fontSize: "10px",
                              color: "#cbd5e1",
                              background: "rgba(255, 255, 255, 0.03)",
                              padding: "4px 6px",
                              borderRadius: "4px",
                              display: "grid",
                              gridTemplateColumns: "1fr 1fr",
                              gap: "2px 8px",
                            }}
                          >
                            <div>
                              <span style={{ color: "#94a3b8" }}>Min:</span> [
                              {summaryMap[q.id].bounding_box?.min_x !== null && summaryMap[q.id].bounding_box?.min_x !== undefined
                                ? summaryMap[q.id].bounding_box!.min_x!.toFixed(2)
                                : "N/A"}
                              ,{" "}
                              {summaryMap[q.id].bounding_box?.min_y !== null && summaryMap[q.id].bounding_box?.min_y !== undefined
                                ? summaryMap[q.id].bounding_box!.min_y!.toFixed(2)
                                : "N/A"}
                              ,{" "}
                              {summaryMap[q.id].bounding_box?.min_z !== null && summaryMap[q.id].bounding_box?.min_z !== undefined
                                ? summaryMap[q.id].bounding_box!.min_z!.toFixed(2)
                                : "N/A"}
                              ]
                            </div>
                            <div>
                              <span style={{ color: "#94a3b8" }}>Max:</span> [
                              {summaryMap[q.id].bounding_box?.max_x !== null && summaryMap[q.id].bounding_box?.max_x !== undefined
                                ? summaryMap[q.id].bounding_box!.max_x!.toFixed(2)
                                : "N/A"}
                              ,{" "}
                              {summaryMap[q.id].bounding_box?.max_y !== null && summaryMap[q.id].bounding_box?.max_y !== undefined
                                ? summaryMap[q.id].bounding_box!.max_y!.toFixed(2)
                                : "N/A"}
                              ,{" "}
                              {summaryMap[q.id].bounding_box?.max_z !== null && summaryMap[q.id].bounding_box?.max_z !== undefined
                                ? summaryMap[q.id].bounding_box!.max_z!.toFixed(2)
                                : "N/A"}
                              ]
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div style={{ color: "#64748b", fontSize: "10px", fontStyle: "italic" }}>
                          No 3D bounding box available
                        </div>
                      )}

                      {/* Connected Point Clouds List */}
                      {summaryMap[q.id].connected_pointclouds && summaryMap[q.id].connected_pointclouds!.length > 0 ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                          <span style={{ color: "#9ca3af", fontSize: "10px" }}>
                            Connected Metadata ({summaryMap[q.id].connected_pointclouds!.length}):
                          </span>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                            {summaryMap[q.id].connected_pointclouds!.map((meta) => (
                              <span
                                key={meta.id}
                                title={`ID: ${meta.id} | Total Points: ${meta.number_of_points?.toLocaleString() || "N/A"}`}
                                style={{
                                  background: "rgba(59, 130, 246, 0.15)",
                                  border: "1px solid rgba(59, 130, 246, 0.3)",
                                  color: "#93c5fd",
                                  fontSize: "10px",
                                  padding: "1px 6px",
                                  borderRadius: "4px",
                                  fontFamily: "var(--font-mono, monospace)",
                                }}
                              >
                                📁 {meta.orig_filename || meta.id.substring(0, 8)} ({meta.number_of_points ? meta.number_of_points.toLocaleString() : "0"} pts)
                              </span>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div style={{ color: "#64748b", fontSize: "10px", fontStyle: "italic" }}>
                          No connected metadata records found
                        </div>
                      )}
                    </div>
                  ) : (
                    <div style={{ color: "#64748b", fontSize: "10px", fontStyle: "italic" }}>
                      Click "Refresh" to calculate query info
                    </div>
                  )}
                </div>

                {/* Card Controls & Status Bar */}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginTop: "2px",
                  }}
                >
                  <span
                    style={{
                      fontSize: "11px",
                      color: saveStatus === "Error saving" ? "#f87171" : "var(--color-text-muted, #9ca3af)",
                      fontStyle: "italic",
                    }}
                  >
                    {saveStatus ? saveStatus : "Auto-saved"}
                  </span>

                  <div style={{ display: "flex", gap: "6px" }}>
                    <button
                      type="button"
                      title="Save query edits"
                      onClick={() => handleManualSave(q.id)}
                      style={{
                        background: "transparent",
                        border: "1px solid var(--color-border-strong, #374151)",
                        color: "var(--color-text-muted, #9ca3af)",
                        borderRadius: "var(--radius-sm, 4px)",
                        padding: "3px 8px",
                        fontSize: "11px",
                        cursor: "pointer",
                        transition: "all 0.15s ease",
                      }}
                    >
                      💾 Save
                    </button>

                    <button
                      type="button"
                      title="Focus camera on bounding box center"
                      onClick={() => handleFocusQuery(q)}
                      style={{
                        background: "rgba(16, 185, 129, 0.15)",
                        border: "1px solid rgba(16, 185, 129, 0.3)",
                        color: "#34d399",
                        borderRadius: "var(--radius-sm, 4px)",
                        padding: "3px 8px",
                        fontSize: "11px",
                        fontWeight: 600,
                        cursor: "pointer",
                        transition: "all 0.15s ease",
                        display: "flex",
                        alignItems: "center",
                        gap: "4px",
                      }}
                    >
                      🎯 Focus
                    </button>

                    <button
                      type="button"
                      title="Run / Select this query"
                      onClick={() => handleRun(q)}
                      style={{
                        background: isActive
                          ? "var(--color-bg-button, #2563eb)"
                          : "var(--color-bg-subtle, #1f2937)",
                        border: isActive ? "none" : "1px solid var(--color-border-strong, #374151)",
                        color: "#ffffff",
                        borderRadius: "var(--radius-sm, 4px)",
                        padding: "3px 10px",
                        fontSize: "11px",
                        fontWeight: 600,
                        cursor: "pointer",
                        transition: "background 0.15s ease",
                      }}
                    >
                      ⚡ Run
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export const PointCloudList = CustomQueryManager;

export default CustomQueryManager;
