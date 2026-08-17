import React, { useState } from "react";
import type { CustomQuery, QuerySummaryData, ConnectedPointCloudMetadata } from "./CustomQueryManager";

export interface QuerySummaryProps {
  query: CustomQuery;
  summary?: QuerySummaryData | null;
  isLoading?: boolean;
  error?: string | null;
  onRefreshSummary: (queryId: string, queryText: string) => void;
  onFocusQuery: (query: CustomQuery) => void;
}

/**
 * ConnectedMetadataCard Component
 * Displays all possible information from a Connected Metadata record (PointCloudMetadata).
 */
const ConnectedMetadataCard: React.FC<{
  meta: ConnectedPointCloudMetadata;
  defaultExpanded?: boolean;
}> = ({ meta, defaultExpanded = false }) => {
  const [isExpanded, setIsExpanded] = useState<boolean>(defaultExpanded);

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
    "video_metadata_id",
    "min_x",
    "min_y",
    "min_z",
    "max_x",
    "max_y",
    "max_z",
    "center",
    "transform_matrix",
  ]);

  const extraKeys = Object.keys(meta).filter(
    (k) => !standardKeys.has(k) && meta[k] !== undefined && meta[k] !== null
  );

  return (
    <div className="query-summary__connected-card">
      <div
        className="query-summary__connected-card-header"
        onClick={() => setIsExpanded(!isExpanded)}
        title="Click to toggle metadata details"
      >
        <div className="query-summary__connected-card-title">
          <span>📁 {meta.orig_filename || meta.safe_filename || meta.id.substring(0, 8)}</span>
          <span className="query-summary__connected-badge">
            {(meta.number_of_points ?? 0).toLocaleString()} pts
          </span>
        </div>
        <button
          type="button"
          className="query-summary__connected-toggle-btn"
          aria-label={isExpanded ? "Collapse metadata details" : "Expand metadata details"}
        >
          {isExpanded ? "▲ Hide Details" : "▼ Details"}
        </button>
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
              <span className="query-summary__connected-field-label">Schema ID (pcid):</span>
              <span className="query-summary__connected-field-value mono">{meta.pcid ?? "N/A"}</span>
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
              <span className="query-summary__connected-field-label">Video Metadata ID:</span>
              <span className="query-summary__connected-field-value mono">{meta.video_metadata_id || "None"}</span>
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
              <span className="query-summary__connected-field-label">Transform Matrix (4x4):</span>
              <div className="query-summary__matrix-grid">
                {meta.transform_matrix.map((val, idx) => (
                  <span key={idx} className="query-summary__matrix-cell">
                    {typeof val === "number" ? val.toFixed(3) : val}
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
  onFocusQuery,
}) => {
  return (
    <div className="query-summary">
      <div className="query-summary__header">
        <span className="query-summary__title">
          📊 Query Summary
        </span>

        <button
          type="button"
          onClick={() => onRefreshSummary(query.id, query.queryText)}
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
          {/* Point Count Badge */}
          <div className="query-summary__count-row">
            <span className="query-summary__label">Selected Points:</span>
            <span className="query-summary__count-badge">
              ⚡ {(summary.total_points ?? 0).toLocaleString()} pts
            </span>
          </div>

          {/* 3D Bounding Box */}
          {summary.bounding_box ? (
            <div className="query-summary__bbox-section">
              <div className="query-summary__bbox-header">
                <span className="query-summary__label">Bounding Box (XYZ):</span>
                <button
                  type="button"
                  onClick={() => onFocusQuery(query)}
                  className="query-summary__focus-btn"
                  title="Focus camera to center of bounding box"
                >
                  🎯 Focus
                </button>
              </div>
              <div className="query-summary__bbox-grid">
                <div>
                  <span className="query-summary__bbox-label">Min:</span> [
                  {summary.bounding_box?.min_x !== null && summary.bounding_box?.min_x !== undefined
                    ? summary.bounding_box.min_x.toFixed(2)
                    : "N/A"}
                  ,{" "}
                  {summary.bounding_box?.min_y !== null && summary.bounding_box?.min_y !== undefined
                    ? summary.bounding_box.min_y.toFixed(2)
                    : "N/A"}
                  ,{" "}
                  {summary.bounding_box?.min_z !== null && summary.bounding_box?.min_z !== undefined
                    ? summary.bounding_box.min_z.toFixed(2)
                    : "N/A"}
                  ]
                </div>
                <div>
                  <span className="query-summary__bbox-label">Max:</span> [
                  {summary.bounding_box?.max_x !== null && summary.bounding_box?.max_x !== undefined
                    ? summary.bounding_box.max_x.toFixed(2)
                    : "N/A"}
                  ,{" "}
                  {summary.bounding_box?.max_y !== null && summary.bounding_box?.max_y !== undefined
                    ? summary.bounding_box.max_y.toFixed(2)
                    : "N/A"}
                  ,{" "}
                  {summary.bounding_box?.max_z !== null && summary.bounding_box?.max_z !== undefined
                    ? summary.bounding_box.max_z.toFixed(2)
                    : "N/A"}
                  ]
                </div>
              </div>
            </div>
          ) : (
            <div className="query-summary__message--empty">
              No 3D bounding box available
            </div>
          )}

          {/* Connected Point Clouds Metadata Section */}
          {summary.connected_pointclouds && summary.connected_pointclouds.length > 0 ? (
            <div className="query-summary__connected-section">
              <span className="query-summary__label">
                Connected Metadata ({summary.connected_pointclouds.length}):
              </span>
              <div className="query-summary__connected-list">
                {summary.connected_pointclouds.map((meta, idx) => (
                  <ConnectedMetadataCard
                    key={meta.id || `meta-${idx}`}
                    meta={meta}
                    defaultExpanded={summary.connected_pointclouds!.length === 1}
                  />
                ))}
              </div>
            </div>
          ) : (
            <div className="query-summary__message--empty">
              No connected metadata records found
            </div>
          )}

          {/* Connected Camera Headers List */}
          {summary.connected_camera_headers && summary.connected_camera_headers.length > 0 && (
            <div className="query-summary__connected-section">
              <span className="query-summary__label">
                Connected Camera Headers ({summary.connected_camera_headers.length}):
              </span>
              <div className="query-summary__chip-list">
                {summary.connected_camera_headers.map((cam) => (
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
      ) : (
        <div className="query-summary__message--empty">
          Click "Refresh" to calculate query info
        </div>
      )}
    </div>
  );
};

export default QuerySummary;

