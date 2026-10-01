import React, { useMemo } from "react";
import {
    FiDroplet,
    FiThermometer,
    FiRadio,
    FiTarget,
    FiNavigation,
} from "react-icons/fi";
import type { MissionSummary, ComputedTelemetryPoint } from "./types";
import { useTrajectoryLogSync } from "./hooks/useTrajectoryLogSync";

interface LogsSummaryCardsProps {
    summary?: MissionSummary | null;
    activePoint?: ComputedTelemetryPoint | null;
    points?: ComputedTelemetryPoint[];
    activeIndex?: number | null;
}

export const LogsSummaryCards: React.FC<LogsSummaryCardsProps> = ({
    activePoint,
    points,
    activeIndex,
}) => {
    const activeTabValues = useTrajectoryLogSync((state) => state.activeTabValues);
    const activeSyncPoint = useTrajectoryLogSync((state) => state.activePoint);

    // Resolve the active waypoint or point for fallback
    const effectivePoint = useMemo(() => {
        if (activePoint) return activePoint;
        if (activeIndex !== null && activeIndex !== undefined && points && points[activeIndex]) {
            return points[activeIndex];
        }
        if (activeSyncPoint && activeSyncPoint.index !== undefined && points && points[activeSyncPoint.index]) {
            return points[activeSyncPoint.index];
        }
        return points && points.length > 0 ? points[0] : null;
    }, [activePoint, activeIndex, points, activeSyncPoint]);

    const effectiveIndex = useMemo(() => {
        if (activeIndex !== null && activeIndex !== undefined) return activeIndex;
        if (activePoint?.index !== undefined) return activePoint.index;
        if (activeSyncPoint?.index !== undefined) return activeSyncPoint.index;
        if (effectivePoint?.index !== undefined) return effectivePoint.index;
        return null;
    }, [activeIndex, activePoint, activeSyncPoint, effectivePoint]);

    const formatDistance = (meters: number | null) => {
        if (meters === null || !Number.isFinite(meters)) return "--";
        if (meters >= 1000) {
            return `${(meters / 1000).toFixed(2)} km`;
        }
        return `${meters.toFixed(1)} m`;
    };

    const currentLogDepth = activeTabValues?.logDepth ?? effectivePoint?.depth ?? null;
    const currentLogTemp = activeTabValues?.logTemp ?? null;
    const currentSonarAltitude = activeTabValues?.sonarAltitude ?? null;
    const currentSonarFront = activeTabValues?.sonarFront ?? null;
    const currentDistance = activeTabValues?.distance ?? effectivePoint?.distanceTravelled ?? null;

    const subtextPrefix = effectiveIndex !== null ? `Point #${effectiveIndex + 1}` : "Active value";

    return (
        <div className="logs-summary-grid">
            {/* 1. Depth */}
            <div className="logs-kpi-card">
                <div className="logs-kpi-header">
                    <span className="logs-kpi-title">Depth</span>
                    <div className="logs-kpi-icon logs-icon-cyan">
                        <FiDroplet size={15} />
                    </div>
                </div>
                <div className="logs-kpi-value-group">
                    {currentLogDepth !== null ? (
                        <span className="logs-kpi-value">
                            {currentLogDepth.toFixed(2)} <span className="logs-kpi-unit">m</span>
                        </span>
                    ) : (
                        <span className="logs-kpi-value">--</span>
                    )}
                </div>
                <div className="logs-kpi-subtext">
                    {currentLogDepth !== null ? `${subtextPrefix} depth` : "No depth data"}
                </div>
            </div>

            {/* 2. Temp */}
            <div className="logs-kpi-card">
                <div className="logs-kpi-header">
                    <span className="logs-kpi-title">Temp</span>
                    <div className="logs-kpi-icon" style={{ background: "rgba(249, 115, 22, 0.15)", color: "#fb923c" }}>
                        <FiThermometer size={15} />
                    </div>
                </div>
                <div className="logs-kpi-value-group">
                    {currentLogTemp !== null ? (
                        <span className="logs-kpi-value">
                            {currentLogTemp.toFixed(1)} <span className="logs-kpi-unit">°C</span>
                        </span>
                    ) : (
                        <span className="logs-kpi-value">--</span>
                    )}
                </div>
                <div className="logs-kpi-subtext">
                    {currentLogTemp !== null ? `${subtextPrefix} temperature` : "No temp data"}
                </div>
            </div>

            {/* 3. Sonar Altitude */}
            <div className="logs-kpi-card">
                <div className="logs-kpi-header">
                    <span className="logs-kpi-title">Sonar Altitude</span>
                    <div className="logs-kpi-icon" style={{ background: "rgba(59, 130, 246, 0.15)", color: "#60a5fa" }}>
                        <FiRadio size={15} />
                    </div>
                </div>
                <div className="logs-kpi-value-group">
                    {currentSonarAltitude !== null ? (
                        <span className="logs-kpi-value">
                            {currentSonarAltitude.toFixed(2)} <span className="logs-kpi-unit">m</span>
                        </span>
                    ) : (
                        <span className="logs-kpi-value">--</span>
                    )}
                </div>
                <div className="logs-kpi-subtext">
                    {currentSonarAltitude !== null ? `${subtextPrefix} altitude` : "No altitude data"}
                </div>
            </div>

            {/* 4. Sonar Front */}
            <div className="logs-kpi-card">
                <div className="logs-kpi-header">
                    <span className="logs-kpi-title">Sonar Front</span>
                    <div className="logs-kpi-icon" style={{ background: "rgba(16, 185, 129, 0.15)", color: "#34d399" }}>
                        <FiTarget size={15} />
                    </div>
                </div>
                <div className="logs-kpi-value-group">
                    {currentSonarFront !== null ? (
                        <span className="logs-kpi-value">
                            {currentSonarFront.toFixed(2)} <span className="logs-kpi-unit">m</span>
                        </span>
                    ) : (
                        <span className="logs-kpi-value">--</span>
                    )}
                </div>
                <div className="logs-kpi-subtext">
                    {currentSonarFront !== null ? `${subtextPrefix} front sonar` : "No front distance data"}
                </div>
            </div>

            {/* 5. Calculated Distance */}
            <div className="logs-kpi-card">
                <div className="logs-kpi-header">
                    <span className="logs-kpi-title">Calculated Distance</span>
                    <div className="logs-kpi-icon" style={{ background: "rgba(139, 92, 246, 0.15)", color: "#c084fc" }}>
                        <FiNavigation size={15} />
                    </div>
                </div>
                <div className="logs-kpi-value-group">
                    <span className="logs-kpi-value">{formatDistance(currentDistance)}</span>
                </div>
                <div className="logs-kpi-subtext">
                    {currentDistance !== null ? `${subtextPrefix} distance` : "No distance data"}
                </div>
            </div>
        </div>
    );
};
