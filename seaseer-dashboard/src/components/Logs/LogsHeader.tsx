import React from "react";
import { FiLayers, FiRefreshCw, FiMapPin } from "react-icons/fi";
import type { PointCloudOption, MissionSummary } from "./types";

interface LogsHeaderProps {
    maps: PointCloudOption[];
    selectedMapId: string | null;
    onSelectMap: (id: string) => void;
    summary: MissionSummary | null;
    loading: boolean;
    onRefresh: () => void;
}

export const LogsHeader: React.FC<LogsHeaderProps> = ({
    maps,
    selectedMapId,
    onSelectMap,
    loading,
    onRefresh,
}) => {
    return (
        <div className="logs-header-container">
            <div className="logs-header-left">
                <div className="logs-title-group">
                    <div className="logs-badge-icon">
                        <FiLayers size={18} />
                    </div>
                    <div>
                        <h1 className="logs-main-title">Mission Logs & Telemetry</h1>
                        <p className="logs-subtitle">
                            Photogrammetric Trajectory, Depth Profiles & Mission Analytics
                        </p>
                    </div>
                </div>
            </div>

            <div className="logs-header-right">
                <button
                    className="logs-all-datasets-btn"
                    onClick={() => onSelectMap("")}
                    title="Back to All Datasets Map Picker"
                >
                    <FiLayers size={13} />
                    <span>All Datasets</span>
                </button>

                <div className="logs-map-selector-wrapper">
                    <label htmlFor="map-select" className="logs-selector-label">
                        <FiMapPin size={13} /> Active Map:
                    </label>
                    <select
                        id="map-select"
                        className="logs-map-select"
                        value={selectedMapId || ""}
                        onChange={(e) => onSelectMap(e.target.value)}
                        disabled={loading || maps.length === 0}
                    >
                        {maps.length === 0 ? (
                            <option value="">No point clouds available</option>
                        ) : (
                            maps.map((m) => (
                                <option key={m.id} value={m.id}>
                                    {m.name} ({m.number_of_points.toLocaleString()} pts)
                                </option>
                            ))
                        )}
                    </select>
                </div>

                <button
                    className="logs-refresh-button"
                    onClick={onRefresh}
                    disabled={loading}
                    title="Refresh Maps & Trajectories"
                >
                    <FiRefreshCw className={loading ? "logs-spin" : ""} size={14} />
                    <span>Refresh</span>
                </button>
            </div>
        </div>
    );
};
