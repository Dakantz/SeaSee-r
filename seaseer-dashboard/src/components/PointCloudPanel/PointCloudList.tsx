import React from "react";

/**
 * Interface representing a 3D PointCloud item in the dashboard catalog.
 */
export interface PointCloudItem {
  id: string; // UUID
  name: string;
  totalPoints: number;
  selectedPoints: number; // Used to calculate the selection %
}

/**
 * Props for the PointCloudList component.
 * 
 * State Lifting & Future-Proofing Strategy:
 * The selection state (`selectedIds`) and handlers are lifted up to the parent container / application context.
 * In future iterations, spatial point query components (e.g. bounding box filters, threshold filters like `x > 0`)
 * will update `selectedIds` or `selectedPoints` externally, automatically reflecting spatial search results across
 * all active pointclouds without modifying this presentation component.
 */
export interface PointCloudListProps {
  pointclouds: PointCloudItem[];
  selectedIds: string[];
  hoveredId?: string | null;
  onSelectionChange?: (selectedIds: string[]) => void;
  onMoveCamera: (pointcloudId: string) => void;
  onEdit: (pointcloudId: string) => void;
  onHover?: (pointcloudId: string | null) => void;
  onSelect?: (pointcloudId: string) => void;
}

/**
 * PointCloudList Component
 * 
 * Manages rendering a sidebar list of available 3D point cloud datasets.
 * Supports selection percentage calculation, camera trajectory navigation,
 * hover highlighting connected to 3D center markers, and edit hooks for 3D point cloud assets.
 */
export const PointCloudList: React.FC<PointCloudListProps> = ({
  pointclouds,
  selectedIds,
  hoveredId,
  onSelectionChange: _onSelectionChange,
  onMoveCamera,
  onEdit,
  onHover,
  onSelect,
}) => {
  const calculatePercentage = (selected: number, total: number): number => {
    if (!total || total <= 0) return 0;
    const pct = (selected / total) * 100;
    return Math.min(100, Math.max(0, Math.round(pct * 10) / 10));
  };

  const formatNumber = (num: number): string => {
    return num.toLocaleString();
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
            Point Clouds ({pointclouds.length})
          </span>
        </div>

        {selectedIds.length > 0 && (
          <span
            style={{
              fontSize: "var(--font-size-xs, 12px)",
              color: "var(--color-text-muted, #9ca3af)",
              background: "var(--color-bg-subtle, #14151b)",
              padding: "2px 8px",
              borderRadius: "var(--radius-sm, 4px)",
            }}
          >
            {selectedIds.length} selected
          </span>
        )}
      </div>

      {/* Pointcloud List Items */}
      {pointclouds.length === 0 ? (
        <div
          style={{
            textAlign: "center",
            padding: "var(--spacing-lg, 24px) var(--spacing-sm, 12px)",
            color: "var(--color-text-muted, #9ca3af)",
            fontSize: "var(--font-size-xs, 12px)",
            fontStyle: "italic",
          }}
        >
          No point clouds available.
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--spacing-xs, 8px)",
            maxHeight: "360px",
            overflowY: "auto",
            paddingRight: "2px",
          }}
        >
          {pointclouds.map((pc) => {
            const isSelected = selectedIds.includes(pc.id);
            const isHovered = pc.id === hoveredId;
            const percentage = calculatePercentage(pc.selectedPoints, pc.totalPoints);

            return (
              <div
                key={pc.id}
                onMouseEnter={() => onHover?.(pc.id)}
                onMouseLeave={() => onHover?.(null)}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "6px",
                  padding: "10px 12px",
                  borderRadius: "var(--radius-md, 6px)",
                  background: isSelected
                    ? "var(--color-bg-accent-subtle, rgba(59, 130, 246, 0.12))"
                    : isHovered
                    ? "rgba(255, 170, 0, 0.15)"
                    : "var(--color-bg-subtle, #14151b)",
                  border: isSelected
                    ? "1px solid var(--color-accent, #3b82f6)"
                    : isHovered
                    ? "1px solid #ffaa00"
                    : "1px solid var(--color-border-subtle, #2a2b36)",
                  transition: "all 0.15s ease-in-out",
                  cursor: "pointer",
                }}
                /*
                 * SELECTION HANDLER HOOK:
                 * Clicking on a pointcloud card item triggers `onSelect(pc.id)` to load the pointcloud dataset without moving the camera.
                 */
                onClick={() => {
                  onSelect?.(pc.id);
                }}
              >
                {/* Item Top Row: Name and Actions */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "8px",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    <span
                      style={{
                        fontWeight: isSelected ? 600 : 500,
                        color: isSelected
                          ? "var(--color-text-primary, #ffffff)"
                          : "var(--color-text-secondary, #d1d5db)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={pc.name}
                    >
                      {pc.name}
                    </span>
                  </div>

                  {/* Actions: Edit & Move Camera Buttons */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      flexShrink: 0,
                    }}
                  >
                    {/*
                     * CAMERA FLY-TO BUTTON:
                     * Triggers direct camera animation to the dataset's camera routes.
                     */}
                    <button
                      type="button"
                      title="Navigate camera to pointcloud"
                      onClick={(e) => {
                        e.stopPropagation();
                        onMoveCamera(pc.id);
                      }}
                      style={{
                        background: "transparent",
                        border: "1px solid var(--color-border-strong, #374151)",
                        color: "var(--color-text-muted, #9ca3af)",
                        borderRadius: "var(--radius-sm, 4px)",
                        padding: "3px 6px",
                        fontSize: "var(--font-size-xs, 11px)",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: "3px",
                        transition: "all 0.15s ease",
                      }}
                    >
                      📷 Focus
                    </button>

                    {/*
                     * EDIT BUTTON HANDLER HOOK:
                     * Wired to `onEdit(pc.id)`. In the future, this will launch the point cloud editor panel
                     * (e.g. point cloud property inspector, color ramp controls, or cropping tools).
                     */}
                    <button
                      type="button"
                      title="Edit pointcloud properties"
                      onClick={(e) => {
                        e.stopPropagation();
                        onEdit(pc.id);
                      }}
                      style={{
                        background: "var(--color-bg-button, #2563eb)",
                        border: "none",
                        color: "#ffffff",
                        borderRadius: "var(--radius-sm, 4px)",
                        padding: "3px 8px",
                        fontSize: "var(--font-size-xs, 11px)",
                        fontWeight: 500,
                        cursor: "pointer",
                        transition: "background 0.15s ease",
                      }}
                    >
                      Edit
                    </button>
                  </div>
                </div>

                {/* Item Details: Point Count & Selection Percentage */}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    fontSize: "var(--font-size-xs, 11px)",
                    color: "var(--color-text-muted, #9ca3af)",
                    marginTop: "2px",
                  }}
                >
                  <span>
                    Points: {formatNumber(pc.selectedPoints)} / {formatNumber(pc.totalPoints)}
                  </span>
                  <span
                    style={{
                      fontWeight: 600,
                      color:
                        percentage > 0
                          ? "var(--color-accent-text, #60a5fa)"
                          : "var(--color-text-muted, #6b7280)",
                    }}
                  >
                    Selected: {percentage}%
                  </span>
                </div>

                {/* Selection Visual Progress Bar */}
                <div
                  style={{
                    width: "100%",
                    height: "4px",
                    background: "var(--color-bg-card, #1f2937)",
                    borderRadius: "2px",
                    overflow: "hidden",
                    marginTop: "2px",
                  }}
                >
                  <div
                    style={{
                      width: `${percentage}%`,
                      height: "100%",
                      background:
                        percentage === 100
                          ? "var(--color-success, #10b981)"
                          : "var(--color-accent, #3b82f6)",
                      transition: "width 0.3s ease-in-out",
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default PointCloudList;
