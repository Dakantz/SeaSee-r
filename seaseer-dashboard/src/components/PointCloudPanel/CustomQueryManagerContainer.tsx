import React from "react";
import { usePLYPointCloudContext } from "./PLYPointCloudContext";
import CustomQueryManager, { type CustomQuery } from "./CustomQueryManager";

/**
 * Container component for CustomQueryManager.
 * Connects CustomQueryManager to the PLYPointCloudContext application state,
 * rendering it as a standalone widget.
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
  const identifier = contextState?.identifier;

  const selectedItem = catalog.find((item) => item.id === selectedId);
  const selectedName = selectedItem
    ? selectedItem.orig_filename || selectedItem.safe_filename || selectedItem.id
    : null;

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

  return (
    <CustomQueryManager
      selectedPointCloudId={selectedId}
      selectedPointCloudName={selectedName}
      loadedQueryIds={Array.from(loadedGeometries.keys())}
      loadingQueryIds={Array.from(loadingIds)}
      onRunQuery={handleRunQuery}
      onUnloadQuery={handleUnloadQuery}
      onRunMultipleQueries={handleRunMultipleQueries}
      onHover={hoverPointcloud}
      onMoveCamera={(id) => focusPointcloud(id)}
      onFocusCenter={(center) => focusCameraTarget(center)}
    />
  );
};

export const PointCloudListContainer = CustomQueryManagerContainer;

export default CustomQueryManagerContainer;
