import { useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { FiVideo, FiX } from "react-icons/fi";

import PointCloudPanel from "../PointCloudPanel/PointCloudPanel";
import TelemetryPanel from "../TelemetoryPanel/TrajectoryPanel";
import { JobSystemOverview } from "../JobSystemOverview";
import { PLYPointCloudProvider } from "../PointCloudPanel/PLYPointCloudContext";
import PLYPointCloudSidebar from "../PointCloudPanel/PLYPointCloudSidebar";
import CustomQueryManagerContainer from "../PointCloudPanel/CustomQueryManagerContainer";
import { VideoLogsPanel } from "../Logs/VideoLogsPanel";

import "./Workspace.css";

export default function Workspace() {
    const [isQueriesOpen, setIsQueriesOpen] = useState<boolean>(true);
    const [isJobsOpen, setIsJobsOpen] = useState<boolean>(true);
    const [isVideoLogsOpen, setIsVideoLogsOpen] = useState<boolean>(true);

    return (
        <PLYPointCloudProvider>
            <div className="workspace-container">
                <Group orientation="horizontal" className="workspace">
                    {/* Left Collapsible Panel: Custom Queries */}
                    {isQueriesOpen && (
                        <>
                            <Panel defaultSize="20%" minSize="14%" maxSize="30%" className="left-sidebar-panel">
                                <div className="left-sidebar-header">
                                    <span className="left-sidebar-title">Custom Queries</span>
                                    <button
                                        type="button"
                                        className="panel-close-btn"
                                        onClick={() => setIsQueriesOpen(false)}
                                        title="Collapse Custom Queries"
                                    >
                                        <FiX size={16} />
                                    </button>
                                </div>
                                <div className="left-sidebar-content">
                                    <CustomQueryManagerContainer />
                                </div>
                            </Panel>
                            <Separator className="resize-handle vertical" />
                        </>
                    )}

                    {/* Center Panel: PointCloud + Telemetry */}
                    <Panel defaultSize="38%" minSize="20%">
                        <div className="right-panel">
                            {/* Re-open toggle buttons floating cleanly over the 3D viewport without extending sidebars */}
                            {!isQueriesOpen && (
                                <button
                                    type="button"
                                    className="workspace-reopen-btn workspace-reopen-left"
                                    onClick={() => setIsQueriesOpen(true)}
                                    title="Expand Custom Queries"
                                >
                                    Custom Queries
                                </button>
                            )}

                            {(!isJobsOpen || !isVideoLogsOpen) && (
                                <div className="workspace-reopen-group-right">
                                    {!isJobsOpen && (
                                        <button
                                            type="button"
                                            className="workspace-reopen-btn"
                                            onClick={() => setIsJobsOpen(true)}
                                            title="Expand Controls & Jobs"
                                        >
                                            Controls & Jobs
                                        </button>
                                    )}
                                    {!isVideoLogsOpen && (
                                        <button
                                            type="button"
                                            className="workspace-reopen-btn"
                                            onClick={() => setIsVideoLogsOpen(true)}
                                            title="Expand Video & Logs"
                                        >
                                            <FiVideo size={13} />
                                            <span>Video & Logs</span>
                                        </button>
                                    )}
                                </div>
                            )}

                            <div className="pointcloud-container">
                                <PointCloudPanel />
                            </div>

                            <div className="trajectory-container">
                                <TelemetryPanel />
                            </div>
                        </div>
                    </Panel>

                    {/* Controls & Jobs Panel (Independent panel with clean non-extending header) */}
                    {isJobsOpen && (
                        <>
                            <Separator className="resize-handle vertical" />
                            <Panel defaultSize="18%" minSize="14%" maxSize="30%" className="jobs-sidebar-panel">
                                <div className="jobs-sidebar-header">
                                    <span className="jobs-sidebar-title">Controls & Jobs</span>
                                    <button
                                        type="button"
                                        className="panel-close-btn"
                                        onClick={() => setIsJobsOpen(false)}
                                        title="Collapse Controls & Jobs"
                                    >
                                        <FiX size={16} />
                                    </button>
                                </div>
                                <div className="jobs-sidebar-content">
                                    {/* DebugControls Panel */}
                                    <PLYPointCloudSidebar />

                                    <hr className="jobs-sidebar-divider" />

                                    <div className="jobs-section-header">
                                        <span className="jobs-sidebar-title">System Jobs</span>
                                    </div>
                                    <JobSystemOverview compact limit={0} />
                                </div>
                            </Panel>
                        </>
                    )}

                    {/* Video & Logs Panel (Independent panel with clean non-extending header) */}
                    {isVideoLogsOpen && (
                        <>
                            <Separator className="resize-handle vertical" />
                            <Panel defaultSize="24%" minSize="24%" maxSize="24%" className="videologs-sidebar-panel">
                                <div className="videologs-sidebar-header">
                                    <div className="videologs-sidebar-title-group">
                                        <FiVideo size={14} style={{ color: "#38bdf8" }} />
                                        <span className="videologs-sidebar-title">Video & Logs</span>
                                    </div>
                                    <button
                                        type="button"
                                        className="panel-close-btn"
                                        onClick={() => setIsVideoLogsOpen(false)}
                                        title="Collapse Video & Logs"
                                    >
                                        <FiX size={16} />
                                    </button>
                                </div>
                                <div className="videologs-sidebar-content">
                                    <VideoLogsPanel />
                                </div>
                            </Panel>
                        </>
                    )}
                </Group>
            </div>
        </PLYPointCloudProvider>
    );
}