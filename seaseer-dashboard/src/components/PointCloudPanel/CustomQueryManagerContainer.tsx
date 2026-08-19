import React from "react";
import { usePLYPointCloudContext } from "./PLYPointCloudContext";
import CustomQueryManager, {
  type CustomQuery,
} from "./CustomQueryManager";

/**
 * Container component for CustomQueryManager.
 * Connects CustomQueryManager to PLYPointCloudContext application state:
 * - Syncs query list with PLYPointCloudContext application state.
 * - Handles query execution, progressive streaming, and camera focusing via React Context.
 */
export const CustomQueryManagerContainer: React.FC = () => {
  const contextState = usePLYPointCloudContext();
  const queries = contextState?.queries ?? [];
  const setQueries = contextState?.setQueries;
  const hoverPointcloud = contextState?.hoverPointcloud ?? (() => { });
  const focusCameraTarget = contextState?.focusCameraTarget ?? (() => { });
  const startProgressiveStream = contextState?.startProgressiveStream;
  const unloadPointCloud = contextState?.unloadPointCloud;
  const loadedGeometries = contextState?.loadedGeometries ?? new Map();
  const loadingIds = contextState?.loadingIds ?? new Set();

  const handleRunQuery = (query: CustomQuery) => {
    if (startProgressiveStream) {
      startProgressiveStream(query.id, 10, 0, query.filters);
    }
  };

  const handleUnloadQuery = (query: CustomQuery) => {
    if (unloadPointCloud) {
      unloadPointCloud(query.id);
    }
  };

  const handleRunMultipleQueries = (queriesToRun: CustomQuery[]) => {
    queriesToRun.forEach((q) => handleRunQuery(q));
  };

  const handleQueriesChange = (updatedQueries: CustomQuery[]) => {
    if (setQueries) {
      setQueries(updatedQueries);
    }
  };

  return (
    <CustomQueryManager
      queries={queries}
      loadedQueryIds={Array.from(loadedGeometries.keys())}
      loadingQueryIds={Array.from(loadingIds)}
      hoveredId={contextState?.hoveredId ?? null}
      onRunQuery={handleRunQuery}
      onUnloadQuery={handleUnloadQuery}
      onRunMultipleQueries={handleRunMultipleQueries}
      onQueriesChange={handleQueriesChange}
      onDeleteQuery={(id) => setQueries?.((prev) => prev.filter((q) => q.id !== id))}
      onHover={hoverPointcloud}
      onFocusCenter={(center, offset) => focusCameraTarget(center, offset)}
    />
  );
};

export const PointCloudListContainer = CustomQueryManagerContainer;

export default CustomQueryManagerContainer;
