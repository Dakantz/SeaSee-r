import React, { useEffect, useRef } from "react";
import { PointCloudOverviewEngine } from "./engine/PointCloudOverviewEngine";
import type { EngineCallbacks, EngineConfig } from "./engine/types";
import "./PointCloudOverview.css";

export interface PointCloudOverviewProps extends EngineConfig, EngineCallbacks {
    style?: React.CSSProperties;
    className?: string;
    defaultShowJobOverview?: boolean;
}

export const PointCloudOverview: React.FC<PointCloudOverviewProps> = ({
    style, className, onSelectPointcloud, onHoverPointcloud, onFocusCameraTarget,
    onPreviewPointcloudTransform, onUpdatePointcloudTransform, onCameraViewChange,
    onSetIsGizmoDragging, onToggleCameraUpFixed, onSetIsCameraUpFixed, onPointCountChange,
    onPerfTestProgress, onPerfTestComplete, onPerfTestCancel,
    perfTestTrigger, isPerfTestRunning, cameraTarget, cameraViewTarget,
    defaultShowJobOverview = false, ...configProps
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const engineRef = useRef<PointCloudOverviewEngine | null>(null);

    const lastCameraTargetRef = useRef<any>(null);
    const lastCameraTargetTimestampRef = useRef<number | null>(null);
    const lastCameraViewTargetRef = useRef<any>(null);
    const lastCameraViewTargetTimestampRef = useRef<number | null>(null);

    const callbacksRef = useRef<EngineCallbacks>({
        onSelectPointcloud, onHoverPointcloud, onFocusCameraTarget,
        onPreviewPointcloudTransform, onUpdatePointcloudTransform, onCameraViewChange,
        onSetIsGizmoDragging, onToggleCameraUpFixed, onSetIsCameraUpFixed, onPointCountChange,
        onPerfTestProgress, onPerfTestComplete, onPerfTestCancel,
    });

    useEffect(() => {
        callbacksRef.current = {
            onSelectPointcloud, onHoverPointcloud, onFocusCameraTarget,
            onPreviewPointcloudTransform, onUpdatePointcloudTransform, onCameraViewChange,
            onSetIsGizmoDragging, onToggleCameraUpFixed, onSetIsCameraUpFixed, onPointCountChange,
            onPerfTestProgress, onPerfTestComplete, onPerfTestCancel,
        };
    }, [
        onSelectPointcloud, onHoverPointcloud, onFocusCameraTarget,
        onPreviewPointcloudTransform, onUpdatePointcloudTransform, onCameraViewChange,
        onSetIsGizmoDragging, onToggleCameraUpFixed, onSetIsCameraUpFixed, onPointCountChange,
        onPerfTestProgress, onPerfTestComplete, onPerfTestCancel,
    ]);

    useEffect(() => {
        if (!containerRef.current) return;
        const proxyCallbacks: EngineCallbacks = {
            onSelectPointcloud: (id) => callbacksRef.current.onSelectPointcloud?.(id),
            onHoverPointcloud: (id) => callbacksRef.current.onHoverPointcloud?.(id),
            onFocusCameraTarget: (c, o) => callbacksRef.current.onFocusCameraTarget?.(c, o),
            onPreviewPointcloudTransform: (id, m) => callbacksRef.current.onPreviewPointcloudTransform?.(id, m),
            onUpdatePointcloudTransform: (id, m) => callbacksRef.current.onUpdatePointcloudTransform?.(id, m),
            onCameraViewChange: (v) => callbacksRef.current.onCameraViewChange?.(v),
            onSetIsGizmoDragging: (d) => callbacksRef.current.onSetIsGizmoDragging?.(d),
            onToggleCameraUpFixed: () => callbacksRef.current.onToggleCameraUpFixed?.(),
            onSetIsCameraUpFixed: (f) => callbacksRef.current.onSetIsCameraUpFixed?.(f),
            onPointCountChange: (c) => callbacksRef.current.onPointCountChange?.(c),
            onPerfTestProgress: (fps, ft, m) => callbacksRef.current.onPerfTestProgress?.(fps, ft, m),
            onPerfTestComplete: (s) => callbacksRef.current.onPerfTestComplete?.(s),
            onPerfTestCancel: () => callbacksRef.current.onPerfTestCancel?.(),
        };
        const engine = new PointCloudOverviewEngine(containerRef.current, proxyCallbacks, {
            ...configProps,
            cameraTarget,
            cameraViewTarget,
        });
        engineRef.current = engine;
        return () => {
            engine.destroy();
            engineRef.current = null;
        };
    }, []);

    useEffect(() => {
        if (engineRef.current) {
            engineRef.current.updateConfig(configProps);
        }
    }, [configProps]);

    useEffect(() => {
        if (engineRef.current && configProps.showOutlines !== undefined) {
            engineRef.current.setShowOutlines(configProps.showOutlines);
        }
    }, [configProps.showOutlines]);

    useEffect(() => {
        if (!engineRef.current || !cameraTarget) return;
        const { x, y, z, offset, timestamp } = cameraTarget;
        const hasNewTimestamp = timestamp !== undefined && timestamp !== lastCameraTargetTimestampRef.current;
        const hasNewRef = timestamp === undefined && cameraTarget !== lastCameraTargetRef.current;
        if (!hasNewTimestamp && !hasNewRef) return;

        lastCameraTargetTimestampRef.current = timestamp ?? Date.now();
        lastCameraTargetRef.current = cameraTarget;

        if (typeof x === "number" && typeof y === "number" && typeof z === "number") {
            engineRef.current.focusCameraTarget([x, y, z], offset);
        }
    }, [cameraTarget]);

    useEffect(() => {
        if (!engineRef.current || !cameraViewTarget) return;
        const timestamp = cameraViewTarget.timestamp;
        const hasNewTimestamp = timestamp !== undefined && timestamp !== lastCameraViewTargetTimestampRef.current;
        const hasNewRef = timestamp === undefined && cameraViewTarget !== lastCameraViewTargetRef.current;
        if (!hasNewTimestamp && !hasNewRef) return;

        lastCameraViewTargetTimestampRef.current = timestamp ?? Date.now();
        lastCameraViewTargetRef.current = cameraViewTarget;

        engineRef.current.applyCameraViewTarget(cameraViewTarget);
    }, [cameraViewTarget]);

    useEffect(() => {
        if (!engineRef.current) return;
        if (perfTestTrigger && perfTestTrigger > 0) {
            engineRef.current.startPerformanceTest();
        }
    }, [perfTestTrigger]);

    useEffect(() => {
        if (!engineRef.current) return;
        if (isPerfTestRunning === false && engineRef.current.isPerformanceTestRunning()) {
            engineRef.current.stopPerformanceTest(true);
        }
    }, [isPerfTestRunning]);

    return (
        <div
            className={`pointcloud-overview-container ${className || ""}`}
            style={{ width: "100%", height: "100%", overflow: "hidden", position: "relative", ...style }}
        >
            <div
                ref={containerRef}
                className="pointcloud-overview-canvas"
                style={{ width: "100%", height: "100%", position: "relative", overflow: "hidden" }}
            />
        </div>
    );
};

export default PointCloudOverview;

