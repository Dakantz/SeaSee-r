import React, { useState, useMemo, useEffect, useRef } from "react";
import { FiSearch, FiDownload, FiList, FiCheckCircle } from "react-icons/fi";
import type { ComputedTelemetryPoint, MissionSummary } from "./types";

interface LogsTableProps {
    points: ComputedTelemetryPoint[];
    summary: MissionSummary | null;
    activeIndex: number | null;
    hoveredIndex?: number | null;
    onSelectIndex: (index: number) => void;
    onHoverIndex?: (index: number | null) => void;
}

export const LogsTable: React.FC<LogsTableProps> = ({
    points,
    summary,
    activeIndex,
    hoveredIndex,
    onSelectIndex,
    onHoverIndex,
}) => {
    const [searchQuery, setSearchQuery] = useState("");
    const rowRefs = useRef<Map<number, HTMLTableRowElement>>(new Map());
    const scrollContainerRef = useRef<HTMLDivElement | null>(null);

    // Filter points by search query
    const filteredPoints = useMemo(() => {
        if (!searchQuery.trim()) return points;
        const q = searchQuery.toLowerCase();
        return points.filter((p) => {
            const matchIndex = (p.index + 1).toString().includes(q);
            const matchFilename = p.filename?.toLowerCase().includes(q) ?? false;
            const matchTime = p.relativeTime.toFixed(2).includes(q);
            const matchCoords = `${p.x.toFixed(2)} ${p.y.toFixed(2)} ${p.z.toFixed(2)}`.includes(q);
            return matchIndex || matchFilename || matchTime || matchCoords;
        });
    }, [points, searchQuery]);

    // Auto-scroll ONLY on clicks/selection (activeIndex), never on hover
    useEffect(() => {
        if (activeIndex !== null && activeIndex !== undefined) {
            const el = rowRefs.current.get(activeIndex);
            const container = scrollContainerRef.current;

            if (el && container) {
                const headerHeight = 32; // Height of sticky thead + padding
                const containerTop = container.scrollTop;
                const containerHeight = container.clientHeight;
                const containerBottom = containerTop + containerHeight;

                const rowTop = el.offsetTop;
                const rowHeight = el.offsetHeight || 26;
                const rowBottom = rowTop + rowHeight;

                if (rowTop < containerTop + headerHeight) {
                    container.scrollTo({
                        top: Math.max(0, rowTop - headerHeight + 10),
                        behavior: "smooth",
                    });
                }
                else if (rowBottom > containerBottom) {
                    container.scrollTo({
                        top: rowBottom - containerHeight,
                        behavior: "smooth",
                    });
                }
            }
        }
    }, [activeIndex]);

    // Export CSV function
    const exportCSV = () => {
        if (points.length === 0) return;

        const headers = [
            "Index",
            "Time_s",
            "Timestamp",
            "X",
            "Y",
            "Z",
            "Depth_m",
            "DistanceTravelled_m",
            "Speed_mps",
            "Filename",
        ];

        const rows = points.map((p) => [
            p.index + 1,
            p.relativeTime.toFixed(3),
            p.timestamp,
            p.x.toFixed(3),
            p.y.toFixed(3),
            p.z.toFixed(3),
            p.depth.toFixed(3),
            p.distanceTravelled.toFixed(3),
            p.speed.toFixed(3),
            `"${p.filename || ""}"`,
        ]);

        const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `mission_logs_${summary?.mapName || "dataset"}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    return (
        <div className="logs-table-panel">
            <div className="logs-table-header">
                <div className="logs-table-title-group">
                    <FiList className="logs-table-title-icon" size={15} />
                    <span className="logs-table-title">Log Stream</span>
                    <span className="logs-table-count">({filteredPoints.length} entries)</span>
                </div>

                <div className="logs-table-actions">
                    <div className="logs-search-wrapper">
                        <FiSearch className="logs-search-icon" size={13} />
                        <input
                            type="text"
                            placeholder="Filter by time, coords, filename..."
                            className="logs-search-input"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>

                    <button className="logs-export-button" onClick={exportCSV} disabled={points.length === 0}>
                        <FiDownload size={13} />
                        <span>Export CSV</span>
                    </button>
                </div>
            </div>

            <div className="logs-table-scroll-container" ref={scrollContainerRef}>
                <table className="logs-data-table">
                    <thead>
                        <tr>
                            <th>#</th>
                            <th>Time</th>
                            <th>Depth</th>
                            <th>Position (X, Y, Z)</th>
                            <th>Distance</th>
                            <th>Speed</th>
                            <th>Image File</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredPoints.length === 0 ? (
                            <tr>
                                <td colSpan={7} className="logs-table-no-data">
                                    No records found
                                </td>
                            </tr>
                        ) : (
                            filteredPoints.map((p) => {
                                const isActive = p.index === activeIndex;
                                const isHovered = p.index === hoveredIndex && !isActive;

                                return (
                                    <tr
                                        key={p.id || p.index}
                                        ref={(el) => {
                                            if (el) rowRefs.current.set(p.index, el);
                                            else rowRefs.current.delete(p.index);
                                        }}
                                        className={`${isActive ? "logs-row-active" : ""} ${isHovered ? "logs-row-hovered" : ""}`}
                                        onClick={() => onSelectIndex(p.index)}
                                        onMouseEnter={() => onHoverIndex?.(p.index)}
                                        onMouseLeave={() => onHoverIndex?.(null)}
                                    >
                                        <td className="logs-col-idx">
                                            {isActive && <FiCheckCircle size={11} className="logs-active-check" />}
                                            {p.index + 1}
                                        </td>
                                        <td className="logs-col-time">{p.relativeTime.toFixed(2)}s</td>
                                        <td className="logs-col-depth">{p.depth.toFixed(2)}m</td>
                                        <td className="logs-col-pos">
                                            [{p.x.toFixed(1)}, {p.y.toFixed(1)}, {p.z.toFixed(1)}]
                                        </td>
                                        <td className="logs-col-dist">{p.distanceTravelled.toFixed(1)}m</td>
                                        <td className="logs-col-speed">{p.speed.toFixed(2)}m/s</td>
                                        <td className="logs-col-filename" title={p.filename || undefined}>
                                            {p.filename || "—"}
                                        </td>
                                    </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};
