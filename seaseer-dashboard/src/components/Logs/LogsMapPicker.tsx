import React, { useState } from "react";
import { Link } from "react-router-dom";
import {
    FiLayers,
    FiSearch,
    FiRefreshCw,
    FiDatabase,
    FiArrowRight,
    FiCalendar,
    FiFolderMinus,
    FiEye,
} from "react-icons/fi";
import type { PointCloudOption } from "./types";

interface LogsMapPickerProps {
    maps: PointCloudOption[];
    onSelectMap: (id: string) => void;
    loading: boolean;
    onRefresh: () => void;
}

export const LogsMapPicker: React.FC<LogsMapPickerProps> = ({
    maps,
    onSelectMap,
    loading,
    onRefresh,
}) => {
    const [searchQuery, setSearchQuery] = useState("");

    const filteredMaps = maps.filter((m) => {
        if (!searchQuery.trim()) return true;
        const q = searchQuery.toLowerCase();
        return (
            m.name.toLowerCase().includes(q) ||
            m.id.toLowerCase().includes(q) ||
            (m.safe_filename && m.safe_filename.toLowerCase().includes(q))
        );
    });

    return (
        <div className="logs-picker-container">
            <div className="logs-picker-hero">
                <div className="logs-picker-hero-content">
                    <div className="logs-picker-badge">
                        <FiLayers size={14} />
                        <span>Telemetry & Flight Analysis</span>
                    </div>
                    <h1 className="logs-picker-title">Select Mission Dataset</h1>
                    <p className="logs-picker-subtitle">
                        Choose a point cloud dataset to inspect its 3D photogrammetric camera trajectory, dive profiles, velocity telemetry, and synchronized camera logs.
                    </p>
                </div>

                <div className="logs-picker-actions">
                    <div className="logs-picker-search-wrap">
                        <FiSearch className="logs-picker-search-icon" size={14} />
                        <input
                            type="text"
                            placeholder="Filter point clouds..."
                            className="logs-picker-search-input"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>

                    <button
                        className="logs-picker-refresh-btn"
                        onClick={onRefresh}
                        disabled={loading}
                        title="Refresh dataset list from backend"
                    >
                        <FiRefreshCw className={loading ? "logs-spin" : ""} size={14} />
                        <span>Refresh</span>
                    </button>
                </div>
            </div>

            {/* Content Area */}
            <div className="logs-picker-content">
                {loading ? (
                    <div className="logs-picker-loading-state">
                        <div className="logs-spinner"></div>
                        <p>Loading available point cloud datasets from server...</p>
                    </div>
                ) : filteredMaps.length === 0 ? (
                    <div className="logs-picker-empty-card">
                        <div className="logs-empty-icon-wrap">
                            <FiFolderMinus size={36} />
                        </div>
                        <h2 className="logs-empty-title">No Point Cloud Datasets Found</h2>
                        <p className="logs-empty-description">
                            {maps.length === 0
                                ? "No 3D point cloud models or camera routes have been reconstructed yet on the server."
                                : `No datasets matched your search "${searchQuery}".`}
                        </p>

                        <div className="logs-empty-action-group">
                            <button
                                className="logs-empty-btn-primary"
                                onClick={onRefresh}
                            >
                                <FiRefreshCw size={14} />
                                <span>Reload Datasets</span>
                            </button>
                            <Link to="/" className="logs-empty-btn-secondary">
                                <FiEye size={14} />
                                <span>Open PointCloud Overview</span>
                            </Link>
                        </div>
                    </div>
                ) : (
                    <div className="logs-picker-grid">
                        {filteredMaps.map((map) => {
                            const dx = Math.abs((map.max_x ?? 0) - (map.min_x ?? 0));
                            const dy = Math.abs((map.max_y ?? 0) - (map.min_y ?? 0));
                            const dz = Math.abs((map.max_z ?? 0) - (map.min_z ?? 0));
                            const volume = dx * dy * dz;
                            const hasBounds = dx > 0 || dy > 0;

                            const formattedDate = map.created_at
                                ? new Date(map.created_at).toLocaleDateString(undefined, {
                                      year: "numeric",
                                      month: "short",
                                      day: "numeric",
                                  })
                                : null;

                            return (
                                <div
                                    key={map.id}
                                    className="logs-picker-card"
                                    onClick={() => onSelectMap(map.id)}
                                >
                                    <div className="logs-card-header">
                                        <div className="logs-card-icon-wrap">
                                            <FiDatabase size={18} />
                                        </div>
                                        <div className="logs-card-title-group">
                                            <h3 className="logs-card-title" title={map.name}>
                                                {map.name}
                                            </h3>
                                            <span className="logs-card-id">{map.id}</span>
                                        </div>
                                    </div>

                                    <div className="logs-card-body">
                                        <div className="logs-card-stat">
                                            <span className="logs-stat-label">Point Density</span>
                                            <span className="logs-stat-val">
                                                {map.number_of_points > 1_000_000
                                                    ? `${(map.number_of_points / 1_000_000).toFixed(2)} M pts`
                                                    : `${map.number_of_points.toLocaleString()} pts`}
                                            </span>
                                        </div>

                                        {hasBounds && (
                                            <>
                                                <div className="logs-card-stat">
                                                    <span className="logs-stat-label">Footprint</span>
                                                    <span className="logs-stat-val">
                                                        {dx.toFixed(1)}m × {dy.toFixed(1)}m
                                                    </span>
                                                </div>

                                                <div className="logs-card-stat">
                                                    <span className="logs-stat-label">Bounding Volume</span>
                                                    <span className="logs-stat-val">
                                                        {volume.toFixed(1)} m³
                                                    </span>
                                                </div>
                                            </>
                                        )}

                                        {formattedDate && (
                                            <div className="logs-card-date">
                                                <FiCalendar size={12} />
                                                <span>{formattedDate}</span>
                                            </div>
                                        )}
                                    </div>

                                    <div className="logs-card-footer">
                                        <button className="logs-card-cta-btn">
                                            <span>Inspect Trajectory & Logs</span>
                                            <FiArrowRight size={14} />
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};
