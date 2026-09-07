import React, { useEffect, useRef } from "react";
import { PointCloudOverviewEngine } from "./engine/PointCloudOverviewEngine";
import type { EngineCallbacks, EngineConfig } from "./engine/types";

export interface PointCloudOverviewProps extends EngineConfig, EngineCallbacks {
    style?: React.CSSProperties;
    className?: string;
}

export const PointCloudOverview: React.FC<PointCloudOverviewProps> = ({
    style, className, onSelectPointcloud, onHoverPointcloud, onFocusCameraTarget,
    onUpdatePointcloudTransform, onCameraViewChange, onSetIsCameraUpFixed,
    onSetIsGizmoDragging, onBenchmarkComplete, ...configProps
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const engineRef = useRef<PointCloudOverviewEngine | null>(null);

    const callbacksRef = useRef<EngineCallbacks>({
        onSelectPointcloud, onHoverPointcloud, onFocusCameraTarget,
        onUpdatePointcloudTransform, onCameraViewChange, onSetIsCameraUpFixed,
        onSetIsGizmoDragging, onBenchmarkComplete,
    });

    useEffect(() => {
        callbacksRef.current = {
            onSelectPointcloud, onHoverPointcloud, onFocusCameraTarget,
            onUpdatePointcloudTransform, onCameraViewChange, onSetIsCameraUpFixed,
            onSetIsGizmoDragging, onBenchmarkComplete,
        };
    }, [
        onSelectPointcloud, onHoverPointcloud, onFocusCameraTarget,
        onUpdatePointcloudTransform, onCameraViewChange, onSetIsCameraUpFixed,
        onSetIsGizmoDragging, onBenchmarkComplete,
    ]);

    useEffect(() => {
        if (!containerRef.current) return;
        const proxyCallbacks: EngineCallbacks = {
            onSelectPointcloud: (id) => callbacksRef.current.onSelectPointcloud?.(id),
            onHoverPointcloud: (id) => callbacksRef.current.onHoverPointcloud?.(id),
            onFocusCameraTarget: (c) => callbacksRef.current.onFocusCameraTarget?.(c),
            onUpdatePointcloudTransform: (id, m) => callbacksRef.current.onUpdatePointcloudTransform?.(id, m),
            onCameraViewChange: (v) => callbacksRef.current.onCameraViewChange?.(v),
            onSetIsCameraUpFixed: (f) => callbacksRef.current.onSetIsCameraUpFixed?.(f),
            onSetIsGizmoDragging: (d) => callbacksRef.current.onSetIsGizmoDragging?.(d),
            onBenchmarkComplete: (s) => callbacksRef.current.onBenchmarkComplete?.(s),
        };
        const engine = new PointCloudOverviewEngine(containerRef.current, proxyCallbacks, configProps);
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

    return (
        <div
            ref={containerRef}
            className={className}
            style={{ width: "100%", height: "100%", overflow: "hidden", position: "relative", ...style }}
        />
    );
};

export default PointCloudOverview;
