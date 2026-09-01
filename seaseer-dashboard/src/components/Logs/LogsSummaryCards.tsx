import React from "react";
import {
    FiNavigation,
    FiCompass,
    FiActivity,
    FiClock,
    FiCrosshair,
    FiDatabase,
} from "react-icons/fi";
import type { MissionSummary, ComputedTelemetryPoint } from "./types";

interface LogsSummaryCardsProps {
    summary: MissionSummary | null;
    activePoint: ComputedTelemetryPoint | null;
}

export const LogsSummaryCards: React.FC<LogsSummaryCardsProps> = ({
    summary,
    activePoint,
}) => {
    if (!summary) {
        return (
            <div className="logs-summary-grid">
                <div className="logs-kpi-card logs-kpi-empty">
                    <p>Select a point cloud to view telemetry metrics</p>
                </div>
            </div>
        );
    }

    const formatDistance = (meters: number) => {
        if (meters >= 1000) {
            return `${(meters / 1000).toFixed(2)} km`;
        }
        return `${meters.toFixed(1)} m`;
    };

    const formatDuration = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = (seconds % 60).toFixed(1);
        return `${mins > 0 ? `${mins}m ` : ""}${secs}s`;
    };

    return (
        <div className="logs-summary-grid">
            <div className="logs-kpi-card">
                <div className="logs-kpi-header">
                    <span className="logs-kpi-title">Total Distance</span>
                    <div className="logs-kpi-icon logs-icon-primary">
                        <FiNavigation size={15} />
                    </div>
                </div>
                <div className="logs-kpi-value-group">
                    <span className="logs-kpi-value">{formatDistance(summary.totalDistanceMeters)}</span>
                </div>
                <div className="logs-kpi-subtext">
                    Extents: {summary.extentX.toFixed(1)}m × {summary.extentY.toFixed(1)}m
                </div>
            </div>

            <div className="logs-kpi-card">
                <div className="logs-kpi-header">
                    <span className="logs-kpi-title">Depth Range</span>
                    <div className="logs-kpi-icon logs-icon-accent">
                        <FiCompass size={15} />
                    </div>
                </div>
                <div className="logs-kpi-value-group">
                    <span className="logs-kpi-value">
                        {summary.maxDepth.toFixed(1)} <span className="logs-kpi-unit">m</span>
                    </span>
                </div>
                <div className="logs-kpi-subtext">
                    Min: {summary.minDepth.toFixed(1)}m | Avg: {summary.avgDepth.toFixed(1)}m
                </div>
            </div>

            <div className="logs-kpi-card">
                <div className="logs-kpi-header">
                    <span className="logs-kpi-title">Segment Duration</span>
                    <div className="logs-kpi-icon logs-icon-warning">
                        <FiClock size={15} />
                    </div>
                </div>
                <div className="logs-kpi-value-group">
                    <span className="logs-kpi-value">{formatDuration(summary.durationSeconds)}</span>
                </div>
                <div className="logs-kpi-subtext">
                    {summary.totalFrames} trajectory waypoints
                </div>
            </div>

            <div className="logs-kpi-card">
                <div className="logs-kpi-header">
                    <span className="logs-kpi-title">Average Speed</span>
                    <div className="logs-kpi-icon logs-icon-success">
                        <FiActivity size={15} />
                    </div>
                </div>
                <div className="logs-kpi-value-group">
                    <span className="logs-kpi-value">
                        {summary.avgSpeed.toFixed(2)} <span className="logs-kpi-unit">m/s</span>
                    </span>
                </div>
                <div className="logs-kpi-subtext">
                    Max: {summary.maxSpeed.toFixed(2)} m/s
                </div>
            </div>

            <div className="logs-kpi-card">
                <div className="logs-kpi-header">
                    <span className="logs-kpi-title">Point Cloud Model</span>
                    <div className="logs-kpi-icon logs-icon-cyan">
                        <FiDatabase size={15} />
                    </div>
                </div>
                <div className="logs-kpi-value-group">
                    <span className="logs-kpi-value">
                        {(summary.totalPoints / 1_000_000).toFixed(2)} <span className="logs-kpi-unit">M</span>
                    </span>
                </div>
                <div className="logs-kpi-subtext">
                    {summary.totalPoints.toLocaleString()} spatial points
                </div>
            </div>

            <div className="logs-kpi-card logs-kpi-active">
                <div className="logs-kpi-header">
                    <span className="logs-kpi-title">
                        {activePoint ? `Waypoint #${activePoint.index + 1}` : "Waypoint Focus"}
                    </span>
                    <div className="logs-kpi-icon logs-icon-focus">
                        <FiCrosshair size={15} />
                    </div>
                </div>
                {activePoint ? (
                    <>
                        <div className="logs-kpi-value-group logs-coords-text">
                            [{activePoint.x.toFixed(1)}, {activePoint.y.toFixed(1)}, {activePoint.z.toFixed(1)}]
                        </div>
                        <div className="logs-kpi-subtext logs-truncate" title={activePoint.filename || undefined}>
                            Time: {activePoint.relativeTime.toFixed(2)}s | {activePoint.filename || ""}
                        </div>
                    </>
                ) : (
                    <div className="logs-kpi-subtext logs-muted">
                        Hover/click waypoint to inspect coordinates
                    </div>
                )}
            </div>
        </div>
    );
};
