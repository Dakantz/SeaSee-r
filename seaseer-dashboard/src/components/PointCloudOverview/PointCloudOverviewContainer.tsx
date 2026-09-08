import React from "react";
import { usePLYPointCloudContext } from "../PointCloudPanel/PLYPointCloudContext";
import { PointCloudOverview } from "./PointCloudOverview";

export const PointCloudOverviewContainer: React.FC = () => {
    const {
        showHeightmap,
        heightmapMode,
        heightmapMapProvider,
        heightmapHeightProvider,
        queries,
        summaryMap,
        catalog,
        editingPointcloudId,
        gizmoMode,
        cameraViewTarget,
        selectPointcloud,
        hoverPointcloud,
        focusCameraTarget,
        updatePointcloudTransform,
        setCameraView,
        setIsGizmoDragging,
        setPointCount,
    } = usePLYPointCloudContext();

    return (
        <PointCloudOverview
            showHeightmap={showHeightmap}
            heightmapMode={heightmapMode}
            heightmapMapProvider={heightmapMapProvider}
            heightmapHeightProvider={heightmapHeightProvider}
            queries={queries}
            summaryMap={summaryMap}
            catalog={catalog}
            editingPointcloudId={editingPointcloudId}
            gizmoMode={gizmoMode}
            cameraViewTarget={cameraViewTarget}
            onSelectPointcloud={selectPointcloud}
            onHoverPointcloud={hoverPointcloud}
            onFocusCameraTarget={focusCameraTarget}
            onUpdatePointcloudTransform={updatePointcloudTransform}
            onCameraViewChange={(view) => {
                if (view.position) {
                    setCameraView(view as { position: [number, number, number]; quaternion?: [number, number, number, number]; fov?: number });
                }
            }}
            onSetIsGizmoDragging={setIsGizmoDragging}
            onPointCountChange={setPointCount}
        />
    );
};

export default PointCloudOverviewContainer;
