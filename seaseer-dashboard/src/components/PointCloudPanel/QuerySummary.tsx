import React, { useState, useContext, useMemo } from "react";
import { Link } from "react-router-dom";
import { FiExternalLink } from "react-icons/fi";
import { isPointCloudCameraVisible, type CustomQuery, type QuerySummaryData, type ConnectedPointCloudMetadata } from "./CustomQueryManager";
import PointProgressBar from "./PointProgressBar";
import { PLYPointCloudContext } from "./PLYPointCloudContext";
import { useTrajectoryLogSync } from "../Logs/hooks/useTrajectoryLogSync";
import type { FilterRule } from "./utils/filterUtils.ts";

export interface QuerySummaryProps {
  query: CustomQuery;
  summary?: QuerySummaryData | null;
  isLoading?: boolean;
  error?: string | null;
  onRefreshSummary: (queryId: string, filters?: FilterRule[]) => void;
  onFocusQuery: (query: CustomQuery) => void;
  loadedPoints?: number;
  isLoadingStream?: boolean;
  isLoadedStream?: boolean;
  onUpdateQuery?: (id: string, field: string | Record<string, any>, value?: any) => void;
  onSelectedConnectedChange?: (queryId: string, selectedIds: string[]) => void;
  onEdit?: (pointcloudId: string | null) => void;
  onTogglePointcloudCameras?: (queryId: string, pointCloudId: string) => void;
}

/**
 * Helper to extract or aggregate 3D bounding box boundaries (min_x, min_y, min_z, max_x, max_y, max_z)
 * from a QuerySummaryData record.
 */
export function getQueryBoundingBox(summary?: QuerySummaryData | null): {
  min_x: number;
  min_y: number;
  min_z: number;
  max_x: number;
  max_y: number;
  max_z: number;
} | null {
  if (!summary) return null;
  if (
    summary.bounding_box &&
    typeof summary.bounding_box.min_x === "number" &&
    typeof summary.bounding_box.max_x === "number" &&
    typeof summary.bounding_box.min_y === "number" &&
    typeof summary.bounding_box.max_y === "number" &&
    typeof summary.bounding_box.min_z === "number" &&
    typeof summary.bounding_box.max_z === "number"
  ) {
    return {
      min_x: summary.bounding_box.min_x,
      min_y: summary.bounding_box.min_y,
      min_z: summary.bounding_box.min_z,
      max_x: summary.bounding_box.max_x,
      max_y: summary.bounding_box.max_y,
      max_z: summary.bounding_box.max_z,
    };
  }

  if (summary.connected_pointclouds && summary.connected_pointclouds.length > 0) {
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    let count = 0;

    for (const pc of summary.connected_pointclouds) {
      if (
        typeof pc.min_x === "number" && typeof pc.max_x === "number" &&
        typeof pc.min_y === "number" && typeof pc.max_y === "number" &&
        typeof pc.min_z === "number" && typeof pc.max_z === "number"
      ) {
        if (pc.min_x < minX) minX = pc.min_x;
        if (pc.min_y < minY) minY = pc.min_y;
        if (pc.min_z < minZ) minZ = pc.min_z;
        if (pc.max_x > maxX) maxX = pc.max_x;
        if (pc.max_y > maxY) maxY = pc.max_y;
        if (pc.max_z > maxZ) maxZ = pc.max_z;
        count++;
      }
    }
    if (count > 0) {
      return { min_x: minX, min_y: minY, min_z: minZ, max_x: maxX, max_y: maxY, max_z: maxZ };
    }
  }

  return null;
}

/**
 * ConnectedMetadataCard Component
 * Displays all possible information from a Connected Metadata record (PointCloudMetadata).
 */
const ConnectedMetadataCard: React.FC<{
  meta: ConnectedPointCloudMetadata;
  cameraHeaders?: QuerySummaryData["connected_camera_headers"];
  defaultExpanded?: boolean;
  queryId?: string;
  queryFilters?: FilterRule[];
  onRefreshSummary?: (queryId: string, filters?: FilterRule[]) => void;
  isChecked?: boolean;
  onToggleSelect?: (id: string) => void;
  onEdit?: (id: string | null) => void;
  query?: CustomQuery;
  onUpdateQuery?: (id: string, field: string | Record<string, any>, value?: any) => void;
  onTogglePointcloudCameras?: (queryId: string, pointCloudId: string) => void;
}> = ({
  meta,
  cameraHeaders = [],
  defaultExpanded = false,
  queryId,
  queryFilters,
  onRefreshSummary,
  isChecked = true,
  onToggleSelect,
  onEdit,
  query,
  onUpdateQuery,
  onTogglePointcloudCameras,
}) => {
  const [isExpanded, setIsExpanded] = useState<boolean>(defaultExpanded);

  const ctx = useContext(PLYPointCloudContext);

  const isEditing = Boolean(meta.id && ctx?.editingPointcloudId === meta.id);

  const handleToggleEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!meta.id) return;
    if (isEditing) {
      ctx?.setEditingPointcloudId(null);
      ctx?.setGizmoMode(null);
      onEdit?.(null);
    } else {
      ctx?.setEditingPointcloudId(meta.id);
      ctx?.setGizmoMode("translate");
      onEdit?.(meta.id);
    }
  };

  const handleResetPointcloudTransform = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const IDENTITY_MATRIX = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    if (ctx?.updatePointcloudTransform && meta.id) {
      await ctx.updatePointcloudTransform(meta.id, IDENTITY_MATRIX);
    }
    if (queryId && onRefreshSummary) {
      onRefreshSummary(queryId, queryFilters);
    }
  };

  const hasBounds =
    meta.min_x !== null &&
    meta.min_x !== undefined &&
    meta.max_x !== null &&
    meta.max_x !== undefined &&
    meta.min_y !== null &&
    meta.min_y !== undefined &&
    meta.max_y !== null &&
    meta.max_y !== undefined &&
    meta.min_z !== null &&
    meta.min_z !== undefined &&
    meta.max_z !== null &&
    meta.max_z !== undefined;

  const dx = hasBounds ? meta.max_x! - meta.min_x! : null;
  const dy = hasBounds ? meta.max_y! - meta.min_y! : null;
  const dz = hasBounds ? meta.max_z! - meta.min_z! : null;

  const centerCoords = meta.center
    ? meta.center
    : hasBounds
      ? [
        ((meta.min_x! + meta.max_x!) / 2).toFixed(2),
        ((meta.min_y! + meta.max_y!) / 2).toFixed(2),
        ((meta.min_z! + meta.max_z!) / 2).toFixed(2),
      ]
      : null;

  const standardKeys = new Set([
    "id",
    "orig_filename",
    "safe_filename",
    "number_of_points",
    "created_at",
    "pcid",
    "job_id",
    "batch_id",
    "min_x",
    "min_y",
    "min_z",
    "max_x",
    "max_y",
    "max_z",
    "center",
    "transform_matrix",
    "reconstruction_index",
    "views",
    "sparse_points",
    "dense_points",
  ]);

  const extraKeys = Object.keys(meta).filter(
    (k) => !standardKeys.has(k) && meta[k] !== undefined && meta[k] !== null
  );

  const focusedTrajectoryId = useTrajectoryLogSync((state) => state.focusedTrajectoryId);
  const focusedQueryId = useTrajectoryLogSync((state) => state.focusedQueryId);

  const effectiveQueryId = queryId || query?.id;

  const currentSelectedPointcloudId = focusedTrajectoryId || ctx?.selectedPointcloudId || null;
  const currentSelectedQueryId = focusedQueryId || ctx?.selectedQueryId || null;

  const isSelected =
    Boolean(meta.id) &&
    Boolean(effectiveQueryId) &&
    currentSelectedPointcloudId === meta.id &&
    currentSelectedQueryId === effectiveQueryId;

  const handleSelectDataset = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!meta.id) return;

    if (isSelected) {
      if (ctx?.selectPointcloud) {
        ctx.selectPointcloud(null, null);
      }
      useTrajectoryLogSync.getState().focusTrajectory(null);
      return;
    }

    if (ctx?.selectPointcloud) {
      ctx.selectPointcloud(meta.id, effectiveQueryId);
    }
    useTrajectoryLogSync.getState().focusTrajectory(meta.id, true, effectiveQueryId);
  };

  const isCamerasVisible = Boolean(
    query && isPointCloudCameraVisible(query, meta.id)
  );

  const handleToggleCameras = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!queryId || !meta.id) return;
    if (!isChecked && onToggleSelect) {
      onToggleSelect(meta.id);
    }
    if (onTogglePointcloudCameras) {
      onTogglePointcloudCameras(queryId, meta.id);
    } else if (onUpdateQuery && query) {
      const summaryPcs = (query.summary?.connected_pointclouds || []).map((p) => p.id);
      const currentlyVisible = isPointCloudCameraVisible(query, meta.id);
      let nextVisibleIds: string[];
      if (query.visibleCameraPointCloudIds !== undefined) {
        nextVisibleIds = currentlyVisible
          ? query.visibleCameraPointCloudIds.filter((id) => id !== meta.id)
          : [...query.visibleCameraPointCloudIds, meta.id];
      } else {
        nextVisibleIds = currentlyVisible
          ? summaryPcs.filter((id) => id !== meta.id)
          : [meta.id];
      }
      onUpdateQuery(queryId, {
        showCameraPositions: nextVisibleIds.length > 0,
        visibleCameraPointCloudIds: nextVisibleIds,
      });
    }
  };

  return (
    <div className={`query-summary__connected-card ${isSelected ? "query-summary__connected-card--selected" : ""} ${isEditing ? "query-summary__connected-card--editing" : ""}`}>
      <div
        className="query-summary__connected-card-header"
        onClick={() => setIsExpanded(!isExpanded)}
        title="Click to toggle metadata details"
      >
        <div className="query-summary__connected-card-title">
          <input
            type="checkbox"
            checked={isChecked}
            onChange={(e) => {
              e.stopPropagation();
              onToggleSelect?.(meta.id);
            }}
            onClick={(e) => e.stopPropagation()}
            className="query-summary__connected-checkbox"
            title={isChecked ? "Deselect this point cloud" : "Select this point cloud"}
            aria-label={`Select point cloud ${meta.orig_filename || meta.safe_filename || meta.id}`}
          />
          <span>{meta.orig_filename || meta.safe_filename || meta.id.substring(0, 8)}</span>
          <span className="query-summary__connected-badge">
            {(meta.number_of_points ?? 0).toLocaleString()} pts
          </span>
          {cameraHeaders && cameraHeaders.length > 0 && (
            <span
              className="query-summary__connected-badge query-summary__connected-badge--camera"
              title={`${cameraHeaders.length} Connected Camera Header(s)`}
            >
              📷 {cameraHeaders.length}
            </span>
          )}
        </div>
        <div className="query-summary__connected-actions">
          <button
            type="button"
            className={`query-summary__connected-select-btn ${isSelected ? "query-summary__connected-select-btn--active" : ""}`}
            onClick={handleSelectDataset}
            title={isSelected ? "Click to deselect dataset" : "Click to select dataset for video logs and telemetry"}
          >
            {isSelected ? "✓ Selected" : "Select"}
          </button>
          <button
            type="button"
            className={`query-summary__connected-edit-btn ${isEditing ? "query-summary__connected-edit-btn--active" : ""}`}
            onClick={handleToggleEdit}
            title={isEditing ? `Stop editing transform for ${meta.orig_filename || meta.safe_filename || meta.id}` : `Edit spatial transform (Move/Rotate/Scale) for ${meta.orig_filename || meta.safe_filename || meta.id}`}
          >
            ✏️ {isEditing ? "Editing" : "Edit"}
          </button>
          <button
            type="button"
            className={`query-summary__connected-camera-btn ${isCamerasVisible ? "active" : ""}`}
            onClick={handleToggleCameras}
            title={isCamerasVisible ? `Hide camera positions for ${meta.orig_filename || meta.safe_filename || meta.id}` : `Display camera positions for ${meta.orig_filename || meta.safe_filename || meta.id}`}
            style={{
              background: isCamerasVisible ? "rgba(14, 165, 233, 0.25)" : "rgba(51, 65, 85, 0.4)",
              border: isCamerasVisible ? "1px solid #0ea5e9" : "1px solid #475569",
              color: isCamerasVisible ? "#38bdf8" : "#94a3b8",
              borderRadius: "4px",
              padding: "2px 7px",
              fontSize: "11px",
              fontWeight: 500,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              transition: "all 0.15s ease",
            }}
          >
            📷 {isCamerasVisible ? "Cameras On" : "Cameras"}
          </button>
          {meta.id && (
            <Link
              to={effectiveQueryId ? `/logs?map=${meta.id}&query=${effectiveQueryId}` : `/logs?map=${meta.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="query-summary__connected-link-btn"
              onClick={(e) => {
                e.stopPropagation();
                if (ctx?.selectPointcloud) {
                  ctx.selectPointcloud(meta.id, effectiveQueryId);
                }
                useTrajectoryLogSync.getState().focusTrajectory(meta.id, true, effectiveQueryId);
              }}
              title={`Open dedicated logs page for dataset ${meta.id} in a new tab`}
            >
              <span>Logs</span>
              <FiExternalLink size={10} />
            </Link>
          )}
          <button
            type="button"
            className="query-summary__connected-toggle-btn"
            aria-label={isExpanded ? "Collapse metadata details" : "Expand metadata details"}
          >
            {isExpanded ? "▲ Hide Details" : "▼ Details"}
          </button>
        </div>
      </div>

      {isExpanded && (
        <div className="query-summary__connected-details">
          <div className="query-summary__connected-grid">
            <div className="query-summary__connected-field">
              <span className="query-summary__connected-field-label">ID:</span>
              <span className="query-summary__connected-field-value mono">{meta.id}</span>
            </div>

            {meta.safe_filename && (
              <div className="query-summary__connected-field">
                <span className="query-summary__connected-field-label">Safe Filename:</span>
                <span className="query-summary__connected-field-value mono">{meta.safe_filename}</span>
              </div>
            )}

            <div className="query-summary__connected-field">
              <span className="query-summary__connected-field-label">Point Count:</span>
              <span className="query-summary__connected-field-value bold">
                {(meta.number_of_points ?? 0).toLocaleString()} points
              </span>
            </div>

            <div className="query-summary__connected-field">
              <span className="query-summary__connected-field-label">Created At:</span>
              <span className="query-summary__connected-field-value">
                {meta.created_at ? new Date(meta.created_at).toLocaleString() : "N/A"}
              </span>
            </div>

            <div className="query-summary__connected-field">
              <span className="query-summary__connected-field-label">Job ID:</span>
              <span className="query-summary__connected-field-value mono">{meta.job_id || "None"}</span>
            </div>

            <div className="query-summary__connected-field">
              <span className="query-summary__connected-field-label">Batch ID:</span>
              <span className="query-summary__connected-field-value mono">{meta.batch_id || "None"}</span>
            </div>

            {/* OpenSfM Statistics */}
            <div className="query-summary__connected-field">
              <span className="query-summary__connected-field-label">Reconstruction Index:</span>
              <span className="query-summary__connected-field-value mono">
                {meta.reconstruction_index !== undefined && meta.reconstruction_index !== null ? meta.reconstruction_index : 0}
              </span>
            </div>

            <div className="query-summary__connected-field">
              <span className="query-summary__connected-field-label">Views:</span>
              <span className="query-summary__connected-field-value mono">
                {meta.views !== undefined && meta.views !== null ? meta.views : "N/A"}
              </span>
            </div>

            <div className="query-summary__connected-field">
              <span className="query-summary__connected-field-label">Sparse Points:</span>
              <span className="query-summary__connected-field-value mono">
                {meta.sparse_points !== undefined && meta.sparse_points !== null ? meta.sparse_points.toLocaleString() : "N/A"}
              </span>
            </div>

            <div className="query-summary__connected-field">
              <span className="query-summary__connected-field-label">Dense Points:</span>
              <span className="query-summary__connected-field-value mono">
                {meta.dense_points !== undefined && meta.dense_points !== null ? meta.dense_points.toLocaleString() : "N/A"}
              </span>
            </div>

            {/* Bounding Box Min/Max */}
            {hasBounds ? (
              <>
                <div className="query-summary__connected-field">
                  <span className="query-summary__connected-field-label">Min (XYZ):</span>
                  <span className="query-summary__connected-field-value mono">
                    [{meta.min_x!.toFixed(2)}, {meta.min_y!.toFixed(2)}, {meta.min_z!.toFixed(2)}]
                  </span>
                </div>
                <div className="query-summary__connected-field">
                  <span className="query-summary__connected-field-label">Max (XYZ):</span>
                  <span className="query-summary__connected-field-value mono">
                    [{meta.max_x!.toFixed(2)}, {meta.max_y!.toFixed(2)}, {meta.max_z!.toFixed(2)}]
                  </span>
                </div>
                <div className="query-summary__connected-field">
                  <span className="query-summary__connected-field-label">Extents (ΔX, ΔY, ΔZ):</span>
                  <span className="query-summary__connected-field-value mono">
                    {dx!.toFixed(2)}m × {dy!.toFixed(2)}m × {dz!.toFixed(2)}m
                  </span>
                </div>
              </>
            ) : (
              <div className="query-summary__connected-field">
                <span className="query-summary__connected-field-label">3D Bounding Box:</span>
                <span className="query-summary__connected-field-value">N/A</span>
              </div>
            )}

            {centerCoords && (
              <div className="query-summary__connected-field">
                <span className="query-summary__connected-field-label">Center (XYZ):</span>
                <span className="query-summary__connected-field-value mono">
                  [{Array.isArray(centerCoords) ? centerCoords.map((v) => (typeof v === "number" ? v.toFixed(2) : v)).join(", ") : centerCoords}]
                </span>
              </div>
            )}

            {/* Extra Dynamic Attributes */}
            {extraKeys.map((key) => (
              <div key={key} className="query-summary__connected-field">
                <span className="query-summary__connected-field-label">{key}:</span>
                <span className="query-summary__connected-field-value mono">
                  {typeof meta[key] === "object" ? JSON.stringify(meta[key]) : String(meta[key])}
                </span>
              </div>
            ))}
          </div>

          {/* Transform Matrix 4x4 */}
          {meta.transform_matrix && meta.transform_matrix.length === 16 && (
            <div className="query-summary__matrix-section">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <span className="query-summary__connected-field-label">Transform Matrix (4x4):</span>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button
                    type="button"
                    title={isEditing ? `Stop editing transform for ${meta.orig_filename || meta.safe_filename || meta.id}` : `Edit spatial transform (Move/Rotate/Scale) for ${meta.orig_filename || meta.safe_filename || meta.id}`}
                    onClick={handleToggleEdit}
                    className={`query-summary__connected-edit-btn ${isEditing ? "query-summary__connected-edit-btn--active" : ""}`}
                  >
                    ✏️ {isEditing ? "Editing Transform" : "Edit Transform"}
                  </button>
                  <button
                    type="button"
                    title={`Reset transform matrix for pointcloud ${meta.id} to identity matrix`}
                    onClick={handleResetPointcloudTransform}
                    className="query-summary__btn--reset-matrix"
                  >
                    ↺ Reset Matrix
                  </button>
                </div>
              </div>
              <div className="query-summary__matrix-grid">
                {meta.transform_matrix.map((val, idx) => (
                  <span key={idx} className="query-summary__matrix-cell">
                    {typeof val === "number" ? val.toFixed(3) : val}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Connected Camera Headers */}
          {cameraHeaders && cameraHeaders.length > 0 && (
            <div className="query-summary__camera-headers-section">
              <span className="query-summary__connected-field-label">
                Connected Camera Headers ({cameraHeaders.length}):
              </span>
              <div className="query-summary__chip-list">
                {cameraHeaders.map((cam) => (
                  <span
                    key={cam.id}
                    title={`Camera Header ID: ${cam.id} | PointCloud ID: ${cam.pointcloud_id} | Focal: ${cam.focal ?? "N/A"} | Res: ${cam.width ?? "?"}x${cam.height ?? "?"} | Model: ${cam.camera || "N/A"}`}
                    className="query-summary__chip--camera"
                  >
                    📷 {cam.camera || "Camera"} ({cam.width && cam.height ? `${cam.width}x${cam.height}` : cam.id.substring(0, 8)})
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/**
 * QuerySummary Component
 * Displays summary metadata for a Custom Query including total point count,
 * 3D bounding box limits (min/max XYZ), connected pointcloud metadata, and camera headers.
 */
export const QuerySummary: React.FC<QuerySummaryProps> = ({
  query,
  summary,
  isLoading,
  error,
  onRefreshSummary,
  onFocusQuery: _onFocusQuery,
  loadedPoints = 0,
  isLoadingStream = false,
  isLoadedStream = false,
  onUpdateQuery,
  onSelectedConnectedChange,
  onEdit,
  onTogglePointcloudCameras,
}) => {
  const sortedConnectedPointclouds = useMemo(() => {
    if (!summary?.connected_pointclouds || summary.connected_pointclouds.length === 0) {
      return [];
    }
    return [...summary.connected_pointclouds].sort((a, b) => {
      // 1. Sort by Batch ID first
      const batchA = a.batch_id != null ? String(a.batch_id) : "";
      const batchB = b.batch_id != null ? String(b.batch_id) : "";
      if (batchA !== batchB) {
        if (batchA && !batchB) return -1;
        if (!batchA && batchB) return 1;
        const cmp = batchA.localeCompare(batchB, undefined, { numeric: true });
        if (cmp !== 0) return cmp;
      }

      // 2. Sort by Reconstruction Index
      const recA =
        a.reconstruction_index != null && !isNaN(Number(a.reconstruction_index))
          ? Number(a.reconstruction_index)
          : 0;
      const recB =
        b.reconstruction_index != null && !isNaN(Number(b.reconstruction_index))
          ? Number(b.reconstruction_index)
          : 0;
      if (recA !== recB) {
        return recA - recB;
      }

      // 3. Fallback deterministic tie-breaker
      return (a.orig_filename || a.id || "").localeCompare(b.orig_filename || b.id || "");
    });
  }, [summary?.connected_pointclouds]);

  const allConnectedIds = useMemo(() => {
    return (summary?.connected_pointclouds ?? []).map((pc) => pc.id);
  }, [summary?.connected_pointclouds]);

  const [internalSelectedIds, setInternalSelectedIds] = useState<string[] | undefined>(
    query.selectedConnectedPointCloudIds
  );

  React.useEffect(() => {
    if (query.selectedConnectedPointCloudIds !== undefined) {
      setInternalSelectedIds(query.selectedConnectedPointCloudIds);
    }
  }, [query.selectedConnectedPointCloudIds]);

  const selectedIds = useMemo(() => {
    if (query.selectedConnectedPointCloudIds !== undefined) {
      return query.selectedConnectedPointCloudIds;
    }
    if (internalSelectedIds !== undefined) {
      return internalSelectedIds;
    }
    return allConnectedIds;
  }, [query.selectedConnectedPointCloudIds, internalSelectedIds, allConnectedIds]);

  const updateSelection = (newSelectedIds: string[]) => {
    setInternalSelectedIds(newSelectedIds);
    if (onSelectedConnectedChange) {
      onSelectedConnectedChange(query.id, newSelectedIds);
    } else if (onUpdateQuery) {
      onUpdateQuery(query.id, "selectedConnectedPointCloudIds", newSelectedIds);
    }
  };

  const handleToggleMetadata = (metadataId: string) => {
    const isCurrentlySelected = selectedIds.includes(metadataId);
    const newSelectedIds = isCurrentlySelected
      ? selectedIds.filter((id) => id !== metadataId)
      : [...selectedIds, metadataId];
    updateSelection(newSelectedIds);
  };

  const handleSelectAll = () => {
    updateSelection([...allConnectedIds]);
  };

  const handleDeselectAll = () => {
    updateSelection([]);
  };

  const allSelected = allConnectedIds.length > 0 && selectedIds.length === allConnectedIds.length;
  return (
    <div className="query-summary">
      <div className="query-summary__header">
        <span className="query-summary__title">
          📊 Query Summary
        </span>

        <button
          type="button"
          onClick={() => onRefreshSummary(query.id, query.filters)}
          disabled={isLoading}
          className="query-summary__refresh-btn"
          title="Fetch / refresh query summary"
        >
          {isLoading ? "Calculating..." : "🔄 Refresh"}
        </button>
      </div>

      {isLoading ? (
        <div className="query-summary__message--loading">
          Calculating total points & 3D bounding box...
        </div>
      ) : error ? (
        <div className="query-summary__message--error">
          ⚠️ {error}
        </div>
      ) : summary ? (
        <div className="query-summary__content">
          {/* Point Load Progress Bar */}
          <PointProgressBar
            loadedPoints={loadedPoints}
            totalPoints={summary.total_points}
            isLoadingStream={isLoadingStream}
            isLoadedStream={isLoadedStream}
          />

          {/* Query Summary Spatial Boundaries */}
          {(() => {
            const bbox = getQueryBoundingBox(summary);
            if (!bbox) return null;
            const dx = bbox.max_x - bbox.min_x;
            const dy = bbox.max_y - bbox.min_y;
            const dz = bbox.max_z - bbox.min_z;

            return (
              <div className="query-summary__connected-section" style={{ marginBottom: "12px" }}>
                <span className="query-summary__label">
                  Query Bounding Box Boundaries:
                </span>
                <div className="query-summary__connected-card" style={{ marginTop: "4px" }}>
                  <div className="query-summary__connected-details" style={{ display: "block", padding: "10px" }}>
                    <div className="query-summary__connected-grid">
                      <div className="query-summary__connected-field">
                        <span className="query-summary__connected-field-label">Min (XYZ):</span>
                        <span className="query-summary__connected-field-value mono">
                          [{bbox.min_x.toFixed(2)}, {bbox.min_y.toFixed(2)}, {bbox.min_z.toFixed(2)}]
                        </span>
                      </div>
                      <div className="query-summary__connected-field">
                        <span className="query-summary__connected-field-label">Max (XYZ):</span>
                        <span className="query-summary__connected-field-value mono">
                          [{bbox.max_x.toFixed(2)}, {bbox.max_y.toFixed(2)}, {bbox.max_z.toFixed(2)}]
                        </span>
                      </div>
                      <div className="query-summary__connected-field">
                        <span className="query-summary__connected-field-label">Extents (ΔX, ΔY, ΔZ):</span>
                        <span className="query-summary__connected-field-value mono">
                          {dx.toFixed(2)}m × {dy.toFixed(2)}m × {dz.toFixed(2)}m
                        </span>
                      </div>
                      <div className="query-summary__connected-field">
                        <span className="query-summary__connected-field-label">Center (XYZ):</span>
                        <span className="query-summary__connected-field-value mono">
                          [{((bbox.min_x + bbox.max_x) / 2).toFixed(2)}, {((bbox.min_y + bbox.max_y) / 2).toFixed(2)}, {((bbox.min_z + bbox.max_z) / 2).toFixed(2)}]
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Connected Point Clouds Metadata Section */}
          {summary.connected_pointclouds && summary.connected_pointclouds.length > 0 ? (
            <div className="query-summary__connected-section">
              <div className="query-summary__connected-header">
                <span className="query-summary__label">
                  Connected Metadata ({selectedIds.length}/{summary.connected_pointclouds.length}):
                </span>
                <div className="query-summary__connected-bulk-actions">
                  <button
                    type="button"
                    className="query-summary__bulk-btn"
                    onClick={handleSelectAll}
                    disabled={allSelected}
                    title="Select all connected point clouds"
                  >
                    Select All
                  </button>
                  <button
                    type="button"
                    className="query-summary__bulk-btn"
                    onClick={handleDeselectAll}
                    disabled={selectedIds.length === 0}
                    title="Deselect all connected point clouds"
                  >
                    Deselect All
                  </button>
                </div>
              </div>
              <div className="query-summary__connected-list">
                {sortedConnectedPointclouds.map((meta, idx) => {
                  const matchingCameraHeaders = summary.connected_camera_headers?.filter(
                    (cam) => cam.pointcloud_id === meta.id
                  );
                  const isChecked = selectedIds.includes(meta.id);
                  return (
                    <ConnectedMetadataCard
                      key={meta.id || `meta-${idx}`}
                      meta={meta}
                      cameraHeaders={matchingCameraHeaders}
                      defaultExpanded={false}
                      queryId={query.id}
                      queryFilters={query.filters}
                      onRefreshSummary={onRefreshSummary}
                      isChecked={isChecked}
                      onToggleSelect={handleToggleMetadata}
                      onEdit={onEdit}
                      query={query}
                      onUpdateQuery={onUpdateQuery}
                      onTogglePointcloudCameras={onTogglePointcloudCameras}
                    />
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="query-summary__message--empty">
              No connected metadata records found
            </div>
          )}

          {/* Unmatched Connected Camera Headers List (if any exist without a matching metadata card) */}
          {(() => {
            const matchedIds = new Set(
              summary.connected_pointclouds?.flatMap((meta) =>
                summary.connected_camera_headers
                  ?.filter((cam) => cam.pointcloud_id === meta.id)
                  .map((cam) => cam.id)
              ) || []
            );
            const unmatched = summary.connected_camera_headers?.filter(
              (cam) => !matchedIds.has(cam.id)
            );
            if (!unmatched || unmatched.length === 0) return null;
            return (
              <div className="query-summary__connected-section">
                <span className="query-summary__label">
                  Other Camera Headers ({unmatched.length}):
                </span>
                <div className="query-summary__chip-list">
                  {unmatched.map((cam) => (
                    <span
                      key={cam.id}
                      title={`Camera Header ID: ${cam.id} | PointCloud ID: ${cam.pointcloud_id} | Focal: ${cam.focal ?? "N/A"} | Res: ${cam.width ?? "?"}x${cam.height ?? "?"} | Model: ${cam.camera || "N/A"}`}
                      className="query-summary__chip--camera"
                    >
                      📷 {cam.camera || "Camera"} ({cam.width && cam.height ? `${cam.width}x${cam.height}` : cam.id.substring(0, 8)})
                    </span>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>
      ) : (
        <div className="query-summary__message--empty">
          Click "Refresh" to calculate query info
        </div>
      )}
    </div>
  );
};

export default QuerySummary;

