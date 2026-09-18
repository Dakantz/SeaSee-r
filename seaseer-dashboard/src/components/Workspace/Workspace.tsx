import { useState } from "react";
import {
    Panel,
    Group,
    Separator,
} from "react-resizable-panels";


import PointCloudPanel from "../PointCloudPanel/PointCloudPanel";
import TelemetryPanel from "../TelemetoryPanel/TrajectoryPanel";
import { JobSystemOverview } from "../JobSystemOverview";
import { PLYPointCloudProvider } from "../PointCloudPanel/PLYPointCloudContext";
import PLYPointCloudSidebar from "../PointCloudPanel/PLYPointCloudSidebar";
import CustomQueryManagerContainer from "../PointCloudPanel/CustomQueryManagerContainer";

import "./Workspace.css";

export default function Workspace() {
    const [isQueriesOpen, setIsQueriesOpen] = useState<boolean>(true);
    const [isJobsOpen, setIsJobsOpen] = useState<boolean>(true);

    return (
        <PLYPointCloudProvider>
            <div className="workspace-container">
                <Group orientation="horizontal" className="workspace">
                    {/* Left Collapsible Panel: Custom Queries */}
                    {isQueriesOpen && (
                        <>
                            <Panel defaultSize="25%" minSize="15%" maxSize="35%" className="left-sidebar-panel">
                                <div className="left-sidebar-header">
                                    <span className="left-sidebar-title">Custom Queries</span>
                                    <button
                                        type="button"
                                        className="left-sidebar-toggle-btn"
                                        onClick={() => setIsQueriesOpen(false)}
                                        title="Collapse Left Sidebar"
                                    >
                                        ✕
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
                    <Panel defaultSize="50%" minSize="20%">
                        <div className="right-panel">
                            <div className="pointcloud-container">
                                <PointCloudPanel />
                            </div>

                            <div className="trajectory-container">
                                <TelemetryPanel />
                            </div>
                        </div>
                    </Panel>

                    {/* Right Collapsible Sidebar Widget: DebugControls & Job System Overview */}
                    {isJobsOpen && (
                        <>
                            <Separator className="resize-handle vertical" />
                            <Panel defaultSize="25%" minSize="15%" maxSize="35%" className="jobs-sidebar-panel">
                                <div className="jobs-sidebar-header">
                                    <span className="jobs-sidebar-title">Controls & Jobs</span>
                                    <button
                                        type="button"
                                        className="jobs-sidebar-toggle-btn"
                                        onClick={() => setIsJobsOpen(false)}
                                        title="Collapse Sidebar"
                                    >
                                        ✕
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
                </Group>

                {/* Re-open toggle buttons when sidebar widgets are collapsed */}
                {!isQueriesOpen && (
                    <button
                        type="button"
                        className="left-sidebar-reopen-btn"
                        onClick={() => setIsQueriesOpen(true)}
                        title="Expand Custom Queries"
                    >
                        Custom Queries
                    </button>
                )}

                {!isJobsOpen && (
                    <button
                        type="button"
                        className="jobs-sidebar-reopen-btn"
                        onClick={() => setIsJobsOpen(true)}
                        title="Expand Sidebar"
                    >
                        Controls & Jobs
                    </button>
                )}
            </div>
        </PLYPointCloudProvider>
    );
}