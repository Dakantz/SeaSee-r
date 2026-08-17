import React, { useState, useEffect } from "react";
import { usePLYPointCloudContext } from "./PLYPointCloudContext";
import CustomQueryManager, {
  type CustomQuery,
  createDefaultQuery,
  DEFAULT_POINTCLOUD_UUID,
} from "./CustomQueryManager";
import type { FilterRule } from "./filterUtils";

const STORAGE_KEY = "seaseer_custom_sql_queries";

/**
 * Container component for CustomQueryManager.
 * Acts as the SINGLE SOURCE OF TRUTH for managing custom queries:
 * - Loads queries from localStorage on mount.
 * - Automatically persists queries to localStorage whenever they change.
 * - Syncs query list with PLYPointCloudContext application state.
 * - Listens for global 'add_custom_query' events.
 */
export const CustomQueryManagerContainer: React.FC = () => {
  const contextState = usePLYPointCloudContext();
  const selectedId = contextState?.selectedId ?? null;
  const catalog = contextState?.catalog ?? [];
  const hoverPointcloud = contextState?.hoverPointcloud ?? (() => {});
  const focusPointcloud = contextState?.focusPointcloud ?? (() => {});
  const focusCameraTarget = contextState?.focusCameraTarget ?? (() => {});
  const setCustomQuery = contextState?.setCustomQuery;
  const startProgressiveStream = contextState?.startProgressiveStream;
  const unloadPointCloud = contextState?.unloadPointCloud;
  const loadedGeometries = contextState?.loadedGeometries ?? new Map();
  const loadingIds = contextState?.loadingIds ?? new Set();
  const setQueries = contextState?.setQueries;
  const identifier = contextState?.identifier;

  const selectedItem = catalog.find((item) => item.id === selectedId);
  const selectedName = selectedItem
    ? selectedItem.orig_filename || selectedItem.safe_filename || selectedItem.id
    : null;

  // Single Source of Truth: Initialize queries state from localStorage
  const [queries, setLocalQueries] = useState<CustomQuery[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved !== null) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch (e) {
      console.error("Failed to load queries from localStorage in CustomQueryManagerContainer:", e);
    }
    return [createDefaultQuery(selectedId || DEFAULT_POINTCLOUD_UUID, selectedName)];
  });

  // Automatically persist queries to localStorage AND update PLYPointCloudContext whenever queries change
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(queries));
    } catch (e) {
      console.error("Failed to persist queries to localStorage:", e);
    }
    if (setQueries) {
      setQueries(queries);
    }
  }, [queries, setQueries]);

  // Global event listener for custom queries added outside CustomQueryManager (e.g. PLYPointCloudSidebar)
  useEffect(() => {
    const handleAddQueryEvent = (e: Event) => {
      const customEvent = e as CustomEvent<{
        queryText?: string;
        name?: string;
        pointcloudId?: string;
        filters?: FilterRule[];
      }>;
      const { queryText, name, pointcloudId, filters } = customEvent.detail || {};

      const extractedMatch = queryText ? queryText.match(/pointcloud_id\s*=\s*['"]([^'"]+)['"]/i) : null;
      const extractedId = pointcloudId || (extractedMatch ? extractedMatch[1] : selectedId);

      const existing = queries.find((q) => {
        if (extractedId && (q.pointcloudId === extractedId || q.filters?.some((f) => f.field === "pointcloud_id" && f.value === extractedId))) {
          return true;
        }
        if (queryText && q.queryText.trim().replace(/\s+/g, " ") === queryText.trim().replace(/\s+/g, " ")) {
          return true;
        }
        return false;
      });
      if (existing) return;

      const now = new Date().toISOString();
      const defaultFilters: FilterRule[] = filters && filters.length > 0
        ? filters
        : extractedId
        ? [{ id: `rule-${Date.now()}`, field: "pointcloud_id", operator: "eq", value: extractedId }]
        : [];

      const newQuery: CustomQuery = {
        id: `query-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        name: name || `Custom Query #${queries.length + 1}`,
        queryText: queryText || (extractedId ? `SELECT PC_Explode(patch) AS pt FROM pointcloud_patches WHERE pointcloud_id = '${extractedId}'` : ""),
        filters: defaultFilters,
        pointcloudId: extractedId,
        createdAt: now,
        updatedAt: now,
      };

      setLocalQueries((prev) => [...prev, newQuery]);
    };

    window.addEventListener("add_custom_query", handleAddQueryEvent);
    return () => {
      window.removeEventListener("add_custom_query", handleAddQueryEvent);
    };
  }, [queries, selectedId]);

  const extractPointCloudId = (queryText: string): string | null => {
    const match = queryText.match(/pointcloud_id\s*=\s*['"]([^'"]+)['"]/i);
    return match ? match[1] : null;
  };

  const handleRunQuery = (query: CustomQuery) => {
    if (setCustomQuery) {
      setCustomQuery(query.queryText);
    }
    const extractedId = extractPointCloudId(query.queryText);
    const targetId =
      extractedId ||
      selectedId ||
      identifier ||
      (catalog.length > 0 ? catalog[0].id : null);

    if (targetId && targetId.trim() && startProgressiveStream) {
      if (contextState?.selectPointcloud && targetId !== selectedId) {
        contextState.selectPointcloud(targetId);
      }
      startProgressiveStream(targetId, 10, 0, query.queryText, query.id);
    }
  };

  const handleUnloadQuery = (query: CustomQuery) => {
    if (contextState?.selectPointcloud) {
      contextState.selectPointcloud(null);
    }
    if (contextState?.focusPointcloud) {
      contextState.focusPointcloud(null);
    }
    if (unloadPointCloud) {
      unloadPointCloud(query.id);
      const extractedId = extractPointCloudId(query.queryText);
      if (extractedId) {
        unloadPointCloud(extractedId);
      }

      const summary =
        contextState?.summaryMap?.[query.id] ||
        (extractedId ? contextState?.summaryMap?.[extractedId] : undefined);
      if (summary?.connected_pointclouds) {
        summary.connected_pointclouds.forEach((conn) => {
          if (conn.id) {
            unloadPointCloud(conn.id);
          }
        });
      }
      if (summary?.connected_camera_headers) {
        summary.connected_camera_headers.forEach((cam) => {
          if (cam.pointcloud_id) {
            unloadPointCloud(cam.pointcloud_id);
          }
        });
      }
    }
  };

  const handleRunMultipleQueries = (queriesToRun: CustomQuery[]) => {
    queriesToRun.forEach((q) => handleRunQuery(q));
  };

  const handleQueriesChange = (updatedQueries: CustomQuery[]) => {
    setLocalQueries(updatedQueries);
  };

  return (
    <CustomQueryManager
      queries={queries}
      selectedPointCloudId={selectedId}
      selectedPointCloudName={selectedName}
      loadedQueryIds={Array.from(loadedGeometries.keys())}
      loadingQueryIds={Array.from(loadingIds)}
      onRunQuery={handleRunQuery}
      onUnloadQuery={handleUnloadQuery}
      onRunMultipleQueries={handleRunMultipleQueries}
      onQueriesChange={handleQueriesChange}
      onDeleteQuery={(id) => setLocalQueries((prev) => prev.filter((q) => q.id !== id))}
      onHover={hoverPointcloud}
      onMoveCamera={(id) => focusPointcloud(id)}
      onFocusCenter={(center) => focusCameraTarget(center)}
    />
  );
};

export const PointCloudListContainer = CustomQueryManagerContainer;

export default CustomQueryManagerContainer;
