import React from "react";
import type { CustomQuery, QuerySummaryData } from "./CustomQueryManager";

export interface QuerySummaryProps {
  query: CustomQuery;
  summary?: QuerySummaryData | null;
  isLoading?: boolean;
  error?: string | null;
  onRefreshSummary: (queryId: string, queryText: string) => void;
  onFocusQuery: (query: CustomQuery) => void;
}

/**
 * QuerySummary Component
 * Displays summary metadata for a Custom Query including total point count,
 * 3D bounding box limits (min/max XYZ), connected pointcloud files, and camera headers.
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
          onClick={() => onRefreshSummary(query.id, query.queryText)}
          disabled={isLoading}
          style={{
            background: "transparent",
            border: "none",
            color: "#9ca3af",
            fontSize: "10px",
            cursor: isLoading ? "not-allowed" : "pointer",
            padding: "0 2px",
            textDecoration: "underline",
          }}
          title="Fetch / refresh query summary"
        >
          {isLoading ? "Calculating..." : "🔄 Refresh"}
        </button>
      </div>

      {isLoading ? (
        <div style={{ color: "#9ca3af", fontStyle: "italic", fontSize: "10px" }}>
          Calculating total points & 3D bounding box...
        </div>
      ) : error ? (
        <div style={{ color: "#f87171", fontSize: "10px" }}>
          ⚠️ {error}
        </div>
      ) : summary ? (
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
              ⚡ {(summary.total_points ?? 0).toLocaleString()} pts
            </span>
          </div>

          {/* 3D Bounding Box */}
          {summary.bounding_box ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ color: "#9ca3af", fontSize: "10px" }}>Bounding Box (XYZ):</span>
                <button
                  type="button"
                  onClick={() => onFocusQuery(query)}
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
                  <span style={{ color: "#94a3b8" }}>Max:</span> [
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
            <div style={{ color: "#64748b", fontSize: "10px", fontStyle: "italic" }}>
              No 3D bounding box available
            </div>
          )}

          {/* Connected Point Clouds List */}
          {summary.connected_pointclouds && summary.connected_pointclouds.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
              <span style={{ color: "#9ca3af", fontSize: "10px" }}>
                Connected Metadata ({summary.connected_pointclouds.length}):
              </span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                {summary.connected_pointclouds.map((meta) => (
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

          {/* Connected Camera Headers List */}
          {summary.connected_camera_headers && summary.connected_camera_headers.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
              <span style={{ color: "#9ca3af", fontSize: "10px" }}>
                Connected Camera Headers ({summary.connected_camera_headers.length}):
              </span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                {summary.connected_camera_headers.map((cam) => (
                  <span
                    key={cam.id}
                    title={`Camera Header ID: ${cam.id} | PointCloud ID: ${cam.pointcloud_id} | Focal: ${cam.focal ?? "N/A"} | Res: ${cam.width ?? "?"}x${cam.height ?? "?"} | Model: ${cam.camera || "N/A"}`}
                    style={{
                      background: "rgba(168, 85, 247, 0.15)",
                      border: "1px solid rgba(168, 85, 247, 0.3)",
                      color: "#c084fc",
                      fontSize: "10px",
                      padding: "1px 6px",
                      borderRadius: "4px",
                      fontFamily: "var(--font-mono, monospace)",
                    }}
                  >
                    📷 {cam.camera || "Camera"} ({cam.width && cam.height ? `${cam.width}x${cam.height}` : cam.id.substring(0, 8)})
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div style={{ color: "#64748b", fontSize: "10px", fontStyle: "italic" }}>
          Click "Refresh" to calculate query info
        </div>
      )}
    </div>
  );
};

export default QuerySummary;
