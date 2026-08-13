import React, { useState, useMemo } from "react";
import { usePLYPointCloudContext } from "./PLYPointCloudContext";
import PointCloudList, { type PointCloudItem } from "./PointCloudList";

/**
 * Container component for PointCloudList.
 * Connects PointCloudList to the PLYPointCloudContext application state,
 * rendering it as a standalone widget outside of DebugControls.
 */
export const PointCloudListContainer: React.FC = () => {
  const contextState = usePLYPointCloudContext();
  const selectedId = contextState?.selectedId ?? null;
  const focusPointcloud = contextState?.focusPointcloud ?? (() => {});
  const pointCount = contextState?.pointCount ?? null;

  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const pointCloudItems: PointCloudItem[] = useMemo(() => {
    const catalogList = contextState?.catalog ?? [];
    const geomsMap = contextState?.loadedGeometries;

    return catalogList.map((item) => {
      const name = item.orig_filename || item.safe_filename || item.id;
      const geom = geomsMap?.get(item.id);
      const loadedPoints = geom
        ? geom.attributes.position
          ? geom.attributes.position.count
          : 0
        : item.id === selectedId && pointCount
        ? pointCount
        : 0;
      const total = item.number_of_points || 100000;

      return {
        id: item.id,
        name: name,
        totalPoints: total,
        selectedPoints: loadedPoints,
      };
    });
  }, [contextState?.catalog, contextState?.loadedGeometries, selectedId, pointCount]);

  return (
    <PointCloudList
      pointclouds={pointCloudItems}
      selectedIds={selectedIds}
      onSelectionChange={setSelectedIds}
      onMoveCamera={(id) => focusPointcloud(id)}
      onEdit={(id) => {
        console.log(`Edit requested for PointCloud ID: ${id}`);
      }}
    />
  );
};

export default PointCloudListContainer;
