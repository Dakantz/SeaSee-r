import React, { useState, useEffect, useRef } from "react";
import { usePLYPointCloudContext } from "./PLYPointCloudContext";
import { QuerySelector } from "./QuerySelector";
import type { FilterRule } from "./filterUtils";
import { fetchPointCloudSummary } from "./pointCloudApi";

export { QuerySelector } from "./QuerySelector";
export { QuerySummary } from "./QuerySummary";
export { FilterBuilder } from "./FilterBuilder";
export * from "./filterUtils";
export * from "./pointCloudApi";

/**
 * Interface representing a Custom Query item in the Query Manager.
 * Encapsulates structured filter rules, target pointcloud ID, summary data, and timestamps.
 */
export interface CustomQuery {
  id: string; // Unique identifier (UUID or key)
  name: string; // Display name / label for the query
  queryText: string; // Query text string (legacy compatibility)
  filters?: FilterRule[]; // Structured filter rules for field__operator=value queries
  pointcloudId?: string | null; // Connected target pointcloud ID
  summary?: QuerySummaryData | null; // Connected summary metadata & bounding box
  createdAt?: string; // ISO creation timestamp
  updatedAt?: string; // ISO update timestamp
}

/**
 * Backwards compatibility alias for code expecting PointCloudItem
 */
export type PointCloudItem = CustomQuery;

export const DEFAULT_POINTCLOUD_UUID = "e360394b-a241-49e5-bb66-97fee8bd85ef";

/**
 * Generates default SQL query text for a given pointcloud UUID.
 */
export const buildDefaultQueryText = (pointcloudId?: string | null): string => {
  const targetId = pointcloudId && pointcloudId.trim() !== "" ? pointcloudId : DEFAULT_POINTCLOUD_UUID;
  return `SELECT PC_Explode(patch) AS pt FROM pointcloud_patches WHERE pointcloud_id = '${targetId}'`;
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
  const now = new Date().toISOString();

  return {
    id: `query-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    name: `Query for ${displayName}${countLabel}`,
    queryText: buildDefaultQueryText(targetId),
    filters: [
      {
        id: `rule-${Date.now()}`,
        field: "pointcloud_id",
        operator: "eq",
        value: targetId,
      },
    ],
    pointcloudId: targetId,
    createdAt: now,
    updatedAt: now,
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
  center?: [number, number, number] | number[] | null;
  centerpoint?: [number, number, number] | number[] | null;
  connected_pointclouds?: Array<{
    id: string;
    orig_filename: string;
    number_of_points: number;
    created_at?: string;
    pcid?: number;
    [key: string]: any;
  }>;
  connected_camera_headers?: Array<{
    id: string;
    pointcloud_id: string;
    focal?: number | null;
    width?: number | null;
    height?: number | null;
    camera?: string | null;
    created_at?: string;
    [key: string]: any;
  }>;
}

/**
 * Retrieves the center 3D coordinates [x, y, z] from a query summary (calculated on backend).
 */
export const getBoundingBoxCenter = (
  summaryOrBbox?: QuerySummaryData | QuerySummaryData["bounding_box"] | null
): [number, number, number] | null => {
  if (!summaryOrBbox) return null;
  if ("centerpoint" in summaryOrBbox && summaryOrBbox.centerpoint && Array.isArray(summaryOrBbox.centerpoint) && summaryOrBbox.centerpoint.length === 3) {
    return [summaryOrBbox.centerpoint[0], summaryOrBbox.centerpoint[1], summaryOrBbox.centerpoint[2]];
  }
  if ("center" in summaryOrBbox && summaryOrBbox.center && Array.isArray(summaryOrBbox.center) && summaryOrBbox.center.length === 3) {
    return [summaryOrBbox.center[0], summaryOrBbox.center[1], summaryOrBbox.center[2]];
  }
  return null;
};

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
  /** Multi-selected query IDs */
  selectedQueryIds?: string[];
  /**
   * Trigger prop: When a pointcloud is selected in a different component,
   * passing a new selectedPointCloudId automatically generates and adds a query to the list.
   */
  selectedPointCloudId?: string | null;
  /** Optional human-readable name of the selected pointcloud */
  selectedPointCloudName?: string | null;
  /** Legacy selectedIds prop alias */
  selectedIds?: string[];
  /** List or Set of currently loaded query IDs in 3D scene */
  loadedQueryIds?: string[] | Set<string>;
  /** List or Set of currently loading query IDs */
  loadingQueryIds?: string[] | Set<string>;
  /** Callback triggered when a new query is added */
  onAddQuery?: (pointcloudId?: string) => void;
  /** Callback triggered when the user clicks "Run" / "Select" on a query */
  onRunQuery?: (query: CustomQuery) => void;
  /** Callback triggered when the user clicks "Unload" on a query */
  onUnloadQuery?: (query: CustomQuery) => void;
  /** Callback triggered when the user clicks "Stream Selected" */
  onRunMultipleQueries?: (queries: CustomQuery[]) => void;
  /** Callback triggered when active query selection changes */
  onSelectQuery?: (queryId: string) => void;
  /** Callback triggered when multi-selection changes */
  onSelectionChange?: (selectedIds: string[]) => void;
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
 * Manages state, client-side persistence (localStorage), and renders a list of QuerySelector items.
 */
export const CustomQueryManager: React.FC<CustomQueryManagerProps> = ({
  initialQueries,
  queries: externalQueries,
  activeQueryId: externalActiveQueryId,
  selectedPointCloudId,
  selectedPointCloudName,
  loadedQueryIds,
  loadingQueryIds,
  onAddQuery,
  onRunQuery,
  onUnloadQuery,
  onSelectQuery,
  onDeleteQuery,
  onUpdateQuery,
  onQueriesChange,
  onFocusCenter,
  onMoveCamera,
  onSelect,
}) => {
  // Helper to normalize SQL string for duplicate detection
  const normalizeSql = (sql: string): string => sql.trim().replace(/\s+/g, " ");

  // 1. Client-Side Storage & Local State Initialization
  const [internalQueries, setInternalQueries] = useState<CustomQuery[]>(() => {
    let list: CustomQuery[] = [];
    if (initialQueries !== undefined) {
      list = initialQueries;
    } else {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved !== null) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed)) {
            list = parsed;
          } else {
            list = [createDefaultQuery(selectedPointCloudId || DEFAULT_POINTCLOUD_UUID, selectedPointCloudName)];
          }
        } else {
          list = [createDefaultQuery(selectedPointCloudId || DEFAULT_POINTCLOUD_UUID, selectedPointCloudName)];
        }
      } catch (e) {
        console.error("Failed to load queries from localStorage:", e);
        list = [createDefaultQuery(selectedPointCloudId || DEFAULT_POINTCLOUD_UUID, selectedPointCloudName)];
      }
    }

    // Deduplicate on initial load
    const seen = new Set<string>();
    const deduplicated: CustomQuery[] = [];
    for (const item of list) {
      const norm = normalizeSql(item.queryText);
      if (!seen.has(norm)) {
        seen.add(norm);
        deduplicated.push(item);
      }
    }
    return deduplicated;
  });

  const [activeId, setActiveId] = useState<string | null>(() => {
    return externalActiveQueryId || (internalQueries.length > 0 ? internalQueries[0].id : null);
  });

  const queries = externalQueries || internalQueries;

  const [saveStatusMap, setSaveStatusMap] = useState<Record<string, string>>({});
  const [localSummaryMap, setLocalSummaryMap] = useState<Record<string, QuerySummaryData>>({});
  const [summaryLoadingMap, setSummaryLoadingMap] = useState<Record<string, boolean>>({});
  const [summaryErrorMap, setSummaryErrorMap] = useState<Record<string, string | null>>({});

  let contextSummaryMap: Record<string, QuerySummaryData> | undefined;
  let contextSetSummaryMap: React.Dispatch<React.SetStateAction<Record<string, QuerySummaryData>>> | undefined;
  try {
    const ctx = usePLYPointCloudContext();
    if (ctx) {
      contextSummaryMap = ctx.summaryMap;
      contextSetSummaryMap = ctx.setSummaryMap;
    }
  } catch {
    // Outside PLYPointCloudContext
  }

  const summaryMap = contextSummaryMap || localSummaryMap;
  const updateSummaryMap = (updater: (prev: Record<string, QuerySummaryData>) => Record<string, QuerySummaryData>) => {
    setLocalSummaryMap(updater);
    contextSetSummaryMap?.(updater);
  };

  const activeQueryId = externalActiveQueryId !== undefined ? externalActiveQueryId : activeId;

  const isQueryLoading = (id: string) => {
    if (!loadingQueryIds) return false;
    return loadingQueryIds instanceof Set ? loadingQueryIds.has(id) : loadingQueryIds.includes(id);
  };

  const isQueryLoaded = (id: string) => {
    if (!loadedQueryIds) return false;
    return loadedQueryIds instanceof Set ? loadedQueryIds.has(id) : loadedQueryIds.includes(id);
  };

  // Function to fetch summary information from /pointclouds/stream-summary
  const fetchQuerySummary = async (queryId: string, queryText?: string, filters?: FilterRule[], lod = 0): Promise<QuerySummaryData | null> => {
    setSummaryLoadingMap((prev) => ({ ...prev, [queryId]: true }));
    setSummaryErrorMap((prev) => ({ ...prev, [queryId]: null }));

    try {
      let data: QuerySummaryData;
      if (filters && filters.length > 0) {
        data = await fetchPointCloudSummary({ lod, filters });
      } else {
        const match = queryText ? queryText.match(/pointcloud_id\s*=\s*'([a-fA-F0-9-]+)'/i) : null;
        const targetPcId = match ? match[1] : null;
        const effectiveFilters: FilterRule[] = targetPcId
          ? [{ id: "auto-pc-id", field: "pointcloud_id", operator: "eq", value: targetPcId }]
          : [];
        data = await fetchPointCloudSummary({ lod, filters: effectiveFilters });
      }
      updateSummaryMap((prev) => ({ ...prev, [queryId]: data }));
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
        fetchQuerySummary(q.id, q.queryText, q.filters);
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
      onQueriesChange?.(internalQueries);
    }
  }, [internalQueries, externalQueries, onQueriesChange]);

  // Listen for custom queries executed elsewhere (e.g. PLYPointCloudSidebar) when un-controlled
  useEffect(() => {
    if (externalQueries) return; // Managed by Container

    const handleAddQueryEvent = (e: Event) => {
      const customEvent = e as CustomEvent<{
        queryText?: string;
        name?: string;
        pointcloudId?: string;
        filters?: FilterRule[];
      }>;
      const { queryText, name, pointcloudId, filters } = customEvent.detail || {};

      const extractedMatch = queryText ? queryText.match(/pointcloud_id\s*=\s*['"]([^'"]+)['"]/i) : null;
      const targetPcId = pointcloudId || (extractedMatch ? extractedMatch[1] : null);

      const existing = queries.find((q) => {
        if (targetPcId && (q.pointcloudId === targetPcId || q.filters?.some((f) => f.field === "pointcloud_id" && f.value === targetPcId))) {
          return true;
        }
        if (queryText && normalizeSql(q.queryText) === normalizeSql(queryText)) {
          return true;
        }
        return false;
      });

      if (existing) {
        setActiveId(existing.id);
        handleRun(existing);
        handleFocusQuery(existing);
        return;
      }

      const now = new Date().toISOString();
      const defaultFilters: FilterRule[] = filters && filters.length > 0
        ? filters
        : targetPcId
        ? [{ id: `rule-${Date.now()}`, field: "pointcloud_id", operator: "eq", value: targetPcId }]
        : [];

      const newQuery: CustomQuery = {
        id: `query-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        name: name || `Custom Query #${queries.length + 1}`,
        queryText: queryText || buildDefaultQueryText(targetPcId),
        filters: defaultFilters,
        pointcloudId: targetPcId,
        createdAt: now,
        updatedAt: now,
      };
      const updatedQueries = [...queries, newQuery];
      setInternalQueries(updatedQueries);
      setActiveId(newQuery.id);
      onQueriesChange?.(updatedQueries);
      handleRun(newQuery);
      handleFocusQuery(newQuery);
    };

    window.addEventListener("add_custom_query", handleAddQueryEvent);
    return () => {
      window.removeEventListener("add_custom_query", handleAddQueryEvent);
    };
  }, [queries, externalQueries, onQueriesChange]);

  // 3. Default Query Generation on prop change
  useEffect(() => {
    if (
      selectedPointCloudId &&
      selectedPointCloudId !== prevSelectedIdRef.current
    ) {
      prevSelectedIdRef.current = selectedPointCloudId;

      const candidateText = buildDefaultQueryText(selectedPointCloudId);
      const normCandidate = normalizeSql(candidateText);
      const existing = queries.find(
        (q) => q.id === selectedPointCloudId || normalizeSql(q.queryText) === normCandidate
      );

      if (existing) {
        setActiveId(existing.id);
        handleRun(existing);
        handleFocusQuery(existing);
        return;
      }

      const newQuery = createDefaultQuery(selectedPointCloudId, selectedPointCloudName, queries.length + 1);
      const updatedQueries = [...queries, newQuery];
      if (!externalQueries) {
        setInternalQueries(updatedQueries);
      }
      setActiveId(newQuery.id);
      
      onQueriesChange?.(updatedQueries);
      onAddQuery?.(selectedPointCloudId);
      handleRun(newQuery);
      handleFocusQuery(newQuery);
    }
  }, [selectedPointCloudId, selectedPointCloudName, queries, externalQueries, onQueriesChange, onAddQuery]);

  // Handler to manually add a new query
  const handleAddNewQuery = (targetPcId?: string) => {
    const pcId = targetPcId || selectedPointCloudId || DEFAULT_POINTCLOUD_UUID;
    const candidateText = buildDefaultQueryText(pcId);
    const normCandidate = normalizeSql(candidateText);
    const existing = queries.find((q) => normalizeSql(q.queryText) === normCandidate);

    if (existing) {
      setActiveId(existing.id);
      handleRun(existing);
      handleFocusQuery(existing);
      return;
    }

    const newQuery = createDefaultQuery(pcId, selectedPointCloudName, queries.length + 1);
    const updatedQueries = [...queries, newQuery];
    
    if (!externalQueries) {
      setInternalQueries(updatedQueries);
    }
    setActiveId(newQuery.id);
    onAddQuery?.(pcId);
    onQueriesChange?.(updatedQueries);
    handleRun(newQuery);
    handleFocusQuery(newQuery);
  };

  // Handler for text / title / filter updates
  const handleUpdateQuery = (id: string, field: string, value: any) => {
    const updatedTimestamp = new Date().toISOString();
    const updatedList = queries.map((q) =>
      q.id === id ? { ...q, [field]: value, updatedAt: updatedTimestamp } : q
    );

    if (!externalQueries) {
      setInternalQueries(updatedList);
    }

    const updatedQuery = updatedList.find((q) => q.id === id);
    if (updatedQuery) {
      onUpdateQuery?.(updatedQuery);
    }
    onQueriesChange?.(updatedList);

    // Auto-save feedback
    triggerSaveFeedback(id, "Auto-saved");
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
    const deletedQuery = queries.find((q) => q.id === id);
    if (deletedQuery && onUnloadQuery) {
      onUnloadQuery(deletedQuery);
    }
    const updatedQueries = queries.filter((q) => q.id !== id);
    if (!externalQueries) {
      setInternalQueries(updatedQueries);
    }
    if (activeId === id) {
      setActiveId(updatedQueries.length > 0 ? updatedQueries[0].id : null);
    }
    onDeleteQuery?.(id);
    onQueriesChange?.(updatedQueries);
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

    const center = getBoundingBoxCenter(summary);
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
        flex: 1,
        height: "100%",
        minHeight: 0,
        gap: "var(--spacing-sm, 12px)",
        background: "var(--color-bg-card, #1e1e24)",
        border: "1px solid var(--color-border-strong, #2a2b36)",
        borderRadius: "var(--radius-lg, 8px)",
        padding: "var(--spacing-md, 16px)",
        color: "var(--color-text-primary, #f0f0f5)",
        fontFamily: "var(--font-sans, system-ui, sans-serif)",
        fontSize: "var(--font-size-sm, 14px)",
        boxSizing: "border-box",
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
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            paddingRight: "2px",
          }}
        >
          {queries.map((q) => {
            const isActive = q.id === activeQueryId;
            const extractedMatch = q.queryText.match(/pointcloud_id\s*=\s*['"]([^'"]+)['"]/i);
            const extractedId = extractedMatch ? extractedMatch[1] : null;
            const summary = summaryMap[q.id];
            const connectedPcs = summary?.connected_pointclouds || [];
            const isLoadingStream =
              isQueryLoading(q.id) ||
              (extractedId ? isQueryLoading(extractedId) : false) ||
              connectedPcs.some((pc) => isQueryLoading(pc.id));
            const isLoadedStream =
              isQueryLoaded(q.id) ||
              (extractedId ? isQueryLoaded(extractedId) : false) ||
              connectedPcs.some((pc) => isQueryLoaded(pc.id));
            const saveStatus = saveStatusMap[q.id];

            return (
              <QuerySelector
                key={q.id}
                query={q}
                isActive={isActive}
                isLoadingStream={isLoadingStream}
                isLoadedStream={isLoadedStream}
                saveStatus={saveStatus}
                summary={summary}
                summaryLoading={summaryLoadingMap[q.id]}
                summaryError={summaryErrorMap[q.id]}
                onUpdateQuery={handleUpdateQuery}
                onDeleteQuery={handleDeleteQuery}
                onRunQuery={handleRun}
                onUnloadQuery={onUnloadQuery}
                onFocusQuery={handleFocusQuery}
                onRefreshSummary={fetchQuerySummary}
              />
            );
          })}
        </div>
      )}
    </div>
  );
};

export const PointCloudList = CustomQueryManager;

export default CustomQueryManager;
