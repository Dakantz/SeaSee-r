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
  const executeCustomQuery = contextState?.executeCustomQuery;
  const setCustomQuery = contextState?.setCustomQuery;

  const selectedItem = catalog.find((item) => item.id === selectedId);
  const selectedName = selectedItem
    ? selectedItem.orig_filename || selectedItem.safe_filename || selectedItem.id
    : null;

  const handleRunQuery = (query: CustomQuery) => {
    if (setCustomQuery) {
      setCustomQuery(query.queryText);
    }
    if (executeCustomQuery) {
      executeCustomQuery(query.queryText);
    }
  };

  return (
    <CustomQueryManager
      selectedPointCloudId={selectedId}
      selectedPointCloudName={selectedName}
      onRunQuery={handleRunQuery}
      onHover={hoverPointcloud}
      onMoveCamera={(id) => focusPointcloud(id)}
      onFocusCenter={(center) => focusCameraTarget(center)}
    />
  );
};

export const PointCloudListContainer = CustomQueryManagerContainer;

export default CustomQueryManagerContainer;
