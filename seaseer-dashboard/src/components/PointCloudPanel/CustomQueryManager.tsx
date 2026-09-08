import React, { useState, useEffect, useRef } from "react";
import { usePLYPointCloudContext } from "./PLYPointCloudContext";
import { QuerySelector } from "./QuerySelector";
import { type FilterRule, sanitizeNonSpatialFilters } from "./utils/filterUtils.ts";
import { fetchPointCloudSummary } from "./utils/pointCloudApi.ts";

export { QuerySelector } from "./QuerySelector";
export { QuerySummary } from "./QuerySummary";
export { FilterBuilder } from "./FilterBuilder";
export * from "./utils/filterUtils.ts";
export * from "./utils/pointCloudApi.ts";

/**
 * Interface representing a Custom Query item in the Query Manager.
 * Encapsulates structured filter rules, target pointcloud ID, summary data, and timestamps.
 */
export interface CustomQuery {
  id: string; // Unique identifier (UUID or key)
  name: string; // Display name / label for the query
  filters?: FilterRule[]; // Structured filter rules for field__operator=value queries
  summary?: QuerySummaryData | null; // Connected summary metadata & bounding box
  createdAt?: string; // ISO creation timestamp
  updatedAt?: string; // ISO update timestamp
}

/**
 * Backwards compatibility alias for code expecting PointCloudItem
 */
export type PointCloudItem = CustomQuery;

/**
 * Creates a new CustomQuery object with sensible defaults.
 */
export const createDefaultQuery = (
  pointcloudId?: string | null,
  pointcloudName?: string | null,
  indexHint?: number
): CustomQuery => {
  const targetId = pointcloudId && pointcloudId.trim() !== "" ? pointcloudId.trim() : null;
  const displayName = pointcloudName && pointcloudName.trim() !== ""
    ? pointcloudName
    : (targetId ? (targetId.length > 8 ? targetId.substring(0, 8) : targetId) : "Point Cloud");
  const countLabel = indexHint ? ` #${indexHint}` : "";
  const now = new Date().toISOString();

  return {
    id: `query-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    name: `Query for ${displayName}${countLabel}`,
    filters: targetId
      ? [
        {
          id: `rule-${Date.now()}`,
          field: "pointcloud_id",
          operator: "eq",
          value: targetId,
        },
      ]
      : [],
    createdAt: now,
    updatedAt: now,
  };
};

export interface ConnectedPointCloudMetadata {
  id: string;
  orig_filename: string;
  safe_filename?: string | null;
  number_of_points: number;
  created_at?: string;
  pcid?: number;
  job_id?: string | null;
  video_metadata_id?: string | null;
  min_x?: number | null;
  min_y?: number | null;
  min_z?: number | null;
  max_x?: number | null;
  max_y?: number | null;
  max_z?: number | null;
  center?: [number, number, number] | number[] | null;
  transform_matrix?: number[];
  [key: string]: any;
}

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
  connected_pointclouds?: ConnectedPointCloudMetadata[];
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
  if ("bounding_box" in summaryOrBbox && summaryOrBbox.bounding_box) {
    const bbox = summaryOrBbox.bounding_box;
    if (
      typeof bbox.min_x === "number" && typeof bbox.max_x === "number" &&
      typeof bbox.min_y === "number" && typeof bbox.max_y === "number" &&
      typeof bbox.min_z === "number" && typeof bbox.max_z === "number"
    ) {
      return [
        (bbox.min_x + bbox.max_x) / 2,
        (bbox.min_y + bbox.max_y) / 2,
        (bbox.min_z + bbox.max_z) / 2,
      ];
    }
  }
  if (
    "min_x" in summaryOrBbox && typeof summaryOrBbox.min_x === "number" && typeof summaryOrBbox.max_x === "number" &&
    "min_y" in summaryOrBbox && typeof summaryOrBbox.min_y === "number" && typeof summaryOrBbox.max_y === "number" &&
    "min_z" in summaryOrBbox && typeof summaryOrBbox.min_z === "number" && typeof summaryOrBbox.max_z === "number"
  ) {
    return [
      (summaryOrBbox.min_x + summaryOrBbox.max_x) / 2,
      (summaryOrBbox.min_y + summaryOrBbox.max_y) / 2,
      (summaryOrBbox.min_z + summaryOrBbox.max_z) / 2,
    ];
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
  /** Callback triggered when multi-selection changes */
  onSelectionChange?: (selectedIds: string[]) => void;
  /** Callback triggered when a query is deleted */
  onDeleteQuery?: (queryId: string) => void;
  /** Callback triggered when a query is updated */
  onUpdateQuery?: (query: CustomQuery) => void;
  /** Callback triggered whenever the list of queries changes */
  onQueriesChange?: (queries: CustomQuery[]) => void;
  /** Callback triggered to focus the camera on specific 3D coordinates */
  onFocusCenter?: (center: [number, number, number] | { x: number; y: number; z: number }, offset?: [number, number, number] | number) => void;

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
  selectedPointCloudId,
  selectedPointCloudName,
  loadedQueryIds,
  loadingQueryIds,
  hoveredId: externalHoveredId,
  onAddQuery,
  onRunQuery,
  onUnloadQuery,
  onDeleteQuery,
  onUpdateQuery,
  onQueriesChange,
  onFocusCenter,
  onMoveCamera,
  onSelect,
  onHover: externalOnHover,
}) => {
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
          }
        }
      } catch (e) {
        console.error("Failed to load queries from localStorage:", e);
      }
    }

    // Deduplicate and sanitize on initial load
    const seen = new Set<string>();
    const deduplicated: CustomQuery[] = [];
    for (const item of list) {
      const cleanItem = {
        ...item,
        filters: sanitizeNonSpatialFilters(item.filters),
      };
      if (!seen.has(cleanItem.id)) {
        seen.add(cleanItem.id);
        deduplicated.push(cleanItem);
      }
    }
    return deduplicated;
  });

  const queries = externalQueries || internalQueries;

  const [saveStatusMap] = useState<Record<string, string>>({});
  const [localSummaryMap, setLocalSummaryMap] = useState<Record<string, QuerySummaryData>>({});
  const [summaryLoadingMap, setSummaryLoadingMap] = useState<Record<string, boolean>>({});
  const [summaryErrorMap, setSummaryErrorMap] = useState<Record<string, string | null>>({});

  let contextSummaryMap: Record<string, QuerySummaryData> | undefined;
  let contextSetSummaryMap: React.Dispatch<React.SetStateAction<Record<string, QuerySummaryData>>> | undefined;
  let contextHoveredId: string | null | undefined;
  let contextHoverPointcloud: ((id: string | null) => void) | undefined;
  let editingPointcloudId: string | null = null;
  let setEditingPointcloudId: ((id: string | null) => void) | undefined;
  let gizmoMode: "translate" | "rotate" | "scale" | null = null;
  let setGizmoMode: ((mode: "translate" | "rotate" | "scale" | null) => void) | undefined;

  try {
    const ctx = usePLYPointCloudContext();
    if (ctx) {
      contextSummaryMap = ctx.summaryMap;
      contextSetSummaryMap = ctx.setSummaryMap;
      contextHoveredId = ctx.hoveredId;
      contextHoverPointcloud = ctx.hoverPointcloud;
      editingPointcloudId = ctx.editingPointcloudId;
      setEditingPointcloudId = ctx.setEditingPointcloudId;
      gizmoMode = ctx.gizmoMode;
      setGizmoMode = ctx.setGizmoMode;
    }
  } catch {
    // Outside PLYPointCloudContext
  }

  const summaryMap = contextSummaryMap || localSummaryMap;
  const updateSummaryMap = (updater: (prev: Record<string, QuerySummaryData>) => Record<string, QuerySummaryData>) => {
    setLocalSummaryMap(updater);
    contextSetSummaryMap?.(updater);
  };

  const effectiveHoveredId = externalHoveredId !== undefined ? externalHoveredId : (contextHoveredId ?? null);
  const handleHover = externalOnHover ?? contextHoverPointcloud;

  const isQueryLoading = (id: string) => {
    if (!loadingQueryIds) return false;
    return loadingQueryIds instanceof Set ? loadingQueryIds.has(id) : loadingQueryIds.includes(id);
  };

  const isQueryLoaded = (id: string) => {
    if (!loadedQueryIds) return false;
    return loadedQueryIds instanceof Set ? loadedQueryIds.has(id) : loadedQueryIds.includes(id);
  };

  // Function to fetch summary information from /pointclouds/stream-summary
  const fetchQuerySummary = async (queryId: string, filters?: FilterRule[], lod = 0): Promise<QuerySummaryData | null> => {
    setSummaryLoadingMap((prev) => ({ ...prev, [queryId]: true }));
    setSummaryErrorMap((prev) => ({ ...prev, [queryId]: null }));

    try {
      const data = await fetchPointCloudSummary({ lod, filters });
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
        fetchQuerySummary(q.id, q.filters);
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

  // 3. Default Query Generation on prop change
  useEffect(() => {
    if (
      selectedPointCloudId &&
      selectedPointCloudId !== prevSelectedIdRef.current
    ) {
      prevSelectedIdRef.current = selectedPointCloudId;

      const existing = queries.find(
        (q) => q.id === selectedPointCloudId || q.filters?.some((f) => f.field === "pointcloud_id" && String(f.value) === String(selectedPointCloudId))
      );

      if (existing) {
        handleRun(existing);
        handleFocusQuery(existing);
        return;
      }

      const newQuery = createDefaultQuery(selectedPointCloudId, selectedPointCloudName, queries.length + 1);
      const updatedQueries = [...queries, newQuery];
      if (!externalQueries) {
        setInternalQueries(updatedQueries);
      }

      onQueriesChange?.(updatedQueries);
      onAddQuery?.(selectedPointCloudId ?? undefined);
      handleRun(newQuery);
      handleFocusQuery(newQuery);
    }
  }, [selectedPointCloudId, selectedPointCloudName, queries, externalQueries, onQueriesChange, onAddQuery]);

  // Handler to manually add a new query
  const handleAddNewQuery = (targetPcId?: string) => {
    const pcId = targetPcId || selectedPointCloudId || undefined;
    const existing = pcId ? queries.find((q) => q.filters?.some((f) => f.field === "pointcloud_id" && String(f.value) === String(pcId))) : undefined;

    if (existing) {
      handleRun(existing);
      handleFocusQuery(existing);
      return;
    }

    const newQuery = createDefaultQuery(pcId, selectedPointCloudName, queries.length + 1);
    const updatedQueries = [...queries, newQuery];

    if (!externalQueries) {
      setInternalQueries(updatedQueries);
    }
    onAddQuery?.(pcId);
    onQueriesChange?.(updatedQueries);
    handleRun(newQuery);
    handleFocusQuery(newQuery);
  };

  // Handler for title / filter updates
  const handleUpdateQuery = (id: string, field: string, value: any) => {
    const updatedTimestamp = new Date().toISOString();
    const updatedList = queries.map((q) => {
      if (q.id !== id) return q;
      if (field === "filters") {
        const filtersList = sanitizeNonSpatialFilters((value as FilterRule[]) || []);
        return {
          ...q,
          filters: filtersList,
          updatedAt: updatedTimestamp,
        };
      }
      return { ...q, [field]: value, updatedAt: updatedTimestamp };
    });

    if (!externalQueries) {
      setInternalQueries(updatedList);
    }

    const updatedQuery = updatedList.find((q) => q.id === id);
    if (updatedQuery) {
      onUpdateQuery?.(updatedQuery);
      if (field === "filters") {
        fetchQuerySummary(id, updatedQuery.filters);
      }
    }
    onQueriesChange?.(updatedList);
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
    onDeleteQuery?.(id);
    onQueriesChange?.(updatedQueries);
  };

  // Handler to execute/run a query
  const handleRun = (query: CustomQuery) => {
    onSelect?.(query.id);
    onRunQuery?.(query);
  };

  // Handler to focus camera onto the 3D bounding box center of a query, moving camera closer
  const handleFocusQuery = async (query: CustomQuery) => {
    let summary: QuerySummaryData | null = summaryMap[query.id] || null;
    if (!summary || !summary.bounding_box) {
      summary = await fetchQuerySummary(query.id, query.filters);
    }

    const center = getBoundingBoxCenter(summary);
    if (center) {
      let offset: [number, number, number] | number = [0, 150, 150];
      if (summary?.bounding_box) {
        const bbox = summary.bounding_box;
        if (
          typeof bbox.min_x === "number" && typeof bbox.max_x === "number" &&
          typeof bbox.min_y === "number" && typeof bbox.max_y === "number" &&
          typeof bbox.min_z === "number" && typeof bbox.max_z === "number"
        ) {
          const dx = Math.abs(bbox.max_x - bbox.min_x);
          const dy = Math.abs(bbox.max_y - bbox.min_y);
          const dz = Math.abs(bbox.max_z - bbox.min_z);
          const maxDim = Math.max(dx, dy, dz);
          if (maxDim > 0) {
            const dist = Math.max(30, Math.min(maxDim * 1.2, 300));
            offset = [0, dist, dist];
          }
        }
      }
      onFocusCenter?.(center, offset);
    } else {
      if (onMoveCamera && selectedPointCloudId) {
        onMoveCamera(selectedPointCloudId);
      }
    }
  };

  return (
    <div className="custom-query-manager">
      {/* Header & Catalog Summary */}
      <div className="custom-query-manager__header">
        <span className="custom-query-manager__title">
          Custom Queries ({queries.length})
        </span>

        <button
          type="button"
          onClick={() => handleAddNewQuery()}
          className="custom-query-manager__add-btn"
          title="Add a new custom query"
        >
          + New Query
        </button>
      </div>

      {editingPointcloudId && (
        <div style={{
          background: 'rgba(30, 41, 59, 0.95)',
          border: '1px solid #3b82f6',
          borderRadius: '6px',
          padding: '10px 12px',
          marginBottom: '12px',
          color: '#f8fafc',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: '#60a5fa' }}>
              ✏️ Gizmo Controls (Transforming Active)
            </span>
            <button
              type="button"
              onClick={() => { setEditingPointcloudId?.(null); setGizmoMode?.(null); }}
              style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '13px' }}
              title="Stop editing transform"
            >
              ✕
            </button>
          </div>
          <div style={{ display: 'flex', gap: '4px' }}>
            <button
              type="button"
              onClick={() => setGizmoMode?.('translate')}
              style={{
                flex: 1, padding: '4px 6px', borderRadius: '4px', border: 'none', cursor: 'pointer', fontSize: '11px', fontWeight: 500,
                backgroundColor: gizmoMode === 'translate' ? '#2563eb' : '#334155', color: 'white'
              }}
            >
              Move
            </button>
            <button
              type="button"
              onClick={() => setGizmoMode?.('rotate')}
              style={{
                flex: 1, padding: '4px 6px', borderRadius: '4px', border: 'none', cursor: 'pointer', fontSize: '11px', fontWeight: 500,
                backgroundColor: gizmoMode === 'rotate' ? '#2563eb' : '#334155', color: 'white'
              }}
            >
              Rotate
            </button>
            <button
              type="button"
              onClick={() => setGizmoMode?.('scale')}
              style={{
                flex: 1, padding: '4px 6px', borderRadius: '4px', border: 'none', cursor: 'pointer', fontSize: '11px', fontWeight: 500,
                backgroundColor: gizmoMode === 'scale' ? '#2563eb' : '#334155', color: 'white'
              }}
            >
              Scale
            </button>
            <button
              type="button"
              onClick={() => setGizmoMode?.(null)}
              style={{
                flex: 1, padding: '4px 6px', borderRadius: '4px', border: 'none', cursor: 'pointer', fontSize: '11px', fontWeight: 500,
                backgroundColor: gizmoMode === null ? '#991b1b' : '#334155', color: 'white'
              }}
            >
              Off
            </button>
          </div>
        </div>
      )}

      {/* Query Cards List */}
      {queries.length === 0 ? (
        <div className="custom-query-manager__empty">
          No custom queries available. Click "+ New Query" to add one.
        </div>
      ) : (
        <div className="custom-query-manager__list">
          {queries.map((q) => {
            const pcIdRule = q.filters?.find((f) => f.field === "pointcloud_id" && (f.operator === "eq" || !f.operator))?.value;
            const extractedId = pcIdRule ? String(pcIdRule) : null;
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
            const isHovered = q.id === effectiveHoveredId;

            return (
              <QuerySelector
                key={q.id}
                query={q}
                isHovered={isHovered}
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
                onHover={handleHover}
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
