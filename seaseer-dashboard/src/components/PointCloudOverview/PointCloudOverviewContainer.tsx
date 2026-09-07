import React from "react";
import { usePLYPointCloudContext } from "../PointCloudPanel/PLYPointCloudContext";
import { PointCloudOverview } from "./PointCloudOverview";

export const PointCloudOverviewContainer: React.FC = () => {
    const {
        keyLightIntensity,
        fillLightIntensity,
        hemisphereLightIntensity,
        ambientLightIntensity,
        showHeightmap,
        heightmapMode,
        heightmapMapProvider,
        heightmapHeightProvider,
        queries,
        summaryMap,
        catalog,
        hoveredId,
        showCameraTrajectories,
        editingPointcloudId,
        gizmoMode,
        cameraViewTarget,
        isCameraUpFixed,
        pointCount,
        selectPointcloud,
        hoverPointcloud,
        focusCameraTarget,
        updatePointcloudTransform,
        setCameraView,
        setIsCameraUpFixed,
        setIsGizmoDragging,
        setPerfTestSummary,
    } = usePLYPointCloudContext();

    return (
        <PointCloudOverview
            keyLightIntensity={keyLightIntensity}
            fillLightIntensity={fillLightIntensity}
            hemisphereLightIntensity={hemisphereLightIntensity}
            ambientLightIntensity={ambientLightIntensity}
            showHeightmap={showHeightmap}
            heightmapMode={heightmapMode}
            heightmapMapProvider={heightmapMapProvider}
            heightmapHeightProvider={heightmapHeightProvider}
            queries={queries}
            summaryMap={summaryMap}
            catalog={catalog}
            hoveredId={hoveredId}
            showCameraTrajectories={showCameraTrajectories}
            editingPointcloudId={editingPointcloudId}
            gizmoMode={gizmoMode}
            cameraViewTarget={cameraViewTarget}
            isCameraUpFixed={isCameraUpFixed}
            pointCount={pointCount}
            onSelectPointcloud={selectPointcloud}
            onHoverPointcloud={hoverPointcloud}
            onFocusCameraTarget={focusCameraTarget}
            onUpdatePointcloudTransform={updatePointcloudTransform}
            onCameraViewChange={(view) => {
                if (view.position) {
                    setCameraView(view as { position: [number, number, number]; quaternion?: [number, number, number, number]; fov?: number });
                }
            }}
            onSetIsCameraUpFixed={setIsCameraUpFixed}
            onSetIsGizmoDragging={setIsGizmoDragging}
            onBenchmarkComplete={setPerfTestSummary}
        />
    );
};

export default PointCloudOverviewContainer;
