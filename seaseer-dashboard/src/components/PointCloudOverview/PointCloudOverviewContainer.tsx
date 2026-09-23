import React from "react";
import { usePLYPointCloudContext } from "../PointCloudPanel/PLYPointCloudContext";
import { PointCloudOverview } from "./PointCloudOverview";

export const PointCloudOverviewContainer: React.FC = () => {
    const {
        showHeightmap,
        heightmapMode,
        heightmapMapProvider,
        heightmapHeightProvider,
        showOutlines,
        queries,
        summaryMap,
        catalog,
        editingPointcloudId,
        gizmoMode,
        cameraTarget,
        cameraViewTarget,
        isCameraUpFixed,
        setIsCameraUpFixed,
        toggleCameraUpFixed,
        selectPointcloud,
        hoverPointcloud,
        focusCameraTarget,
        updatePointcloudTransform,
        setCameraView,
        setIsGizmoDragging,
        setPointCount,
        perfTestTrigger,
        isPerfTestRunning,
        setIsPerfTestRunning,
        setCurrentFps,
        setCurrentFrameTimeMs,
        setPerfTestMetrics,
        setPerfTestSummary,
    } = usePLYPointCloudContext();

    return (
        <PointCloudOverview
            showHeightmap={showHeightmap}
            heightmapMode={heightmapMode}
            heightmapMapProvider={heightmapMapProvider}
            heightmapHeightProvider={heightmapHeightProvider}
            showOutlines={showOutlines}
            queries={queries}
            summaryMap={summaryMap}
            catalog={catalog}
            editingPointcloudId={editingPointcloudId}
            gizmoMode={gizmoMode}
            cameraTarget={cameraTarget}
            cameraViewTarget={cameraViewTarget}
            isCameraUpFixed={isCameraUpFixed}
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
            onToggleCameraUpFixed={toggleCameraUpFixed}
            onSetIsCameraUpFixed={setIsCameraUpFixed}
            onPointCountChange={setPointCount}
            perfTestTrigger={perfTestTrigger}
            isPerfTestRunning={isPerfTestRunning}
            onPerfTestProgress={(fps, frameTimeMs, metric) => {
                setCurrentFps(fps);
                setCurrentFrameTimeMs(frameTimeMs);
                setPerfTestMetrics((prev) => [...prev, metric]);
            }}
            onPerfTestComplete={(summary) => {
                setPerfTestSummary(summary);
                setIsPerfTestRunning(false);
            }}
            onPerfTestCancel={() => {
                setIsPerfTestRunning(false);
            }}
        />
    );
};

export default PointCloudOverviewContainer;
