import { useLogsData } from "./useLogsData";
import { LogsHeader } from "./LogsHeader";
import { LogsSummaryCards } from "./LogsSummaryCards";
import { LogsCharts } from "./LogsCharts";
import { Logs3DViewer } from "./Logs3DViewer";
import { LogsTable } from "./LogsTable";
import { FiAlertCircle } from "react-icons/fi";
import "./LogsPage.css";

export default function LogsPage() {
    const {
        maps,
        activeMap,
        selectedMapId,
        selectMap,
        loadingMaps,
        loadingFrames,
        error,
        telemetryPoints,
        summary,
        activeIndex,
        setActiveIndex,
        hoveredIndex,
        setHoveredIndex,
        activePoint,
        refetch,
    } = useLogsData();

    return (
        <div className="logs-page-root">
            {/* Header / Map Selector */}
            <LogsHeader
                maps={maps}
                selectedMapId={selectedMapId}
                onSelectMap={selectMap}
                summary={summary}
                loading={loadingMaps || loadingFrames}
                onRefresh={refetch}
            />

            {/* Error Notification */}
            {error && (
                <div className="logs-alert-banner">
                    <FiAlertCircle size={18} />
                    <span>{error}</span>
                </div>
            )}

            {/* Main Content Area */}
            <div className="logs-content-scroll">
                <LogsSummaryCards summary={summary} activePoint={activePoint} />

                <div className="logs-visualization-grid">
                    <Logs3DViewer
                        points={telemetryPoints}
                        activeMap={activeMap || null}
                        activeIndex={activeIndex}
                        hoveredIndex={hoveredIndex}
                        onSelectIndex={setActiveIndex}
                        onHoverIndex={setHoveredIndex}
                    />
                    <LogsCharts
                        points={telemetryPoints}
                        activeIndex={activeIndex}
                        hoveredIndex={hoveredIndex}
                        onSelectIndex={setActiveIndex}
                        onHoverIndex={setHoveredIndex}
                    />
                </div>

                <div className="logs-table-section">
                    <LogsTable
                        points={telemetryPoints}
                        summary={summary}
                        activeIndex={activeIndex}
                        hoveredIndex={hoveredIndex}
                        onSelectIndex={setActiveIndex}
                        onHoverIndex={setHoveredIndex}
                    />
                </div>
            </div>
        </div>
    );
}
