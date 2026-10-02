import { useState, useEffect } from "react";
import { Panel, Group, Separator } from "react-resizable-panels";
import { PLYPointCloudProvider } from "../PointCloudPanel/PLYPointCloudContext";
import PointCloudOverviewContainer from "./PointCloudOverviewContainer";
import CustomQueryManagerContainer from "../PointCloudPanel/CustomQueryManagerContainer";
import { JobSystemOverview } from "../JobSystemOverview/JobSystemOverview";
import PLYPointCloudSidebar from "../PointCloudPanel/PLYPointCloudSidebar";
import { VideoLogsPanel } from "../Logs/VideoLogsPanel";
import { useTrajectoryLogSync } from "../Logs/hooks/useTrajectoryLogSync";
import "../Workspace/Workspace.css";
import "./PointCloudOverview.css";

export type ActiveRightPanel = "jobs" | "debug" | "videologs" | null;

export default function PointCloudOverviewPage() {
    const [isQueriesOpen, setIsQueriesOpen] = useState<boolean>(true);
    const [activeRightPanel, setActiveRightPanel] = useState<ActiveRightPanel>(null);

    const requestOpenLogsPanel = useTrajectoryLogSync((state) => state.requestOpenLogsPanel);

    useEffect(() => {
        if (requestOpenLogsPanel > 0) {
            setActiveRightPanel((prev) => (prev === "videologs" ? prev : "videologs"));
        }
    }, [requestOpenLogsPanel]);

    const renderToolbarButtons = () => (
        <>
            <button
                type="button"
                className={`pco-toggle-btn ${activeRightPanel === "debug" ? "active" : ""}`}
                onClick={() => setActiveRightPanel(prev => prev === "debug" ? null : "debug")}
                title="Toggle Debug Controls"
            >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path>
                    <circle cx="12" cy="12" r="3"></circle>
                </svg>
                <span>Debug Controls</span>
            </button>

            <button
                type="button"
                className={`pco-toggle-btn ${activeRightPanel === "jobs" ? "active" : ""}`}
                onClick={() => setActiveRightPanel(prev => prev === "jobs" ? null : "jobs")}
                title="Toggle Job System Overview"
            >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="6" y1="3" x2="6" y2="15"></line>
                    <circle cx="18" cy="6" r="3"></circle>
                    <circle cx="6" cy="18" r="3"></circle>
                    <path d="M18 9a9 9 0 0 1-9 9"></path>
                </svg>
                <span>Job System Overview</span>
            </button>

            <button
                type="button"
                className={`pco-toggle-btn ${activeRightPanel === "videologs" ? "active" : ""}`}
                onClick={() => setActiveRightPanel(prev => prev === "videologs" ? null : "videologs")}
                title="Toggle Video & Logs"
            >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="23 7 16 12 23 17 23 7"></polygon>
                    <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
                </svg>
                <span>Video & Logs</span>
            </button>
        </>
    );

    return (
        <PLYPointCloudProvider>
            <div className="workspace-container">
                {/* Top-Left Floating Toolbar when queries panel is collapsed */}
                {!isQueriesOpen && (
                    <div className="pco-top-left-toolbar pco-top-left-toolbar--floating">
                        <button
                            type="button"
                            className="pco-toggle-btn"
                            onClick={() => setIsQueriesOpen(true)}
                            title="Show Custom Queries"
                        >
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="3" y1="12" x2="21" y2="12"></line>
                                <line x1="3" y1="6" x2="21" y2="6"></line>
                                <line x1="3" y1="18" x2="21" y2="18"></line>
                            </svg>
                            <span>Custom Queries</span>
                        </button>
                    </div>
                )}

                {/* Top-Right Floating Toolbar when right panel is collapsed */}
                {activeRightPanel === null && (
                    <div className="pco-top-right-toolbar pco-top-right-toolbar--floating">
                        {renderToolbarButtons()}
                    </div>
                )}

                <Group orientation="horizontal" className="workspace">
                    {isQueriesOpen && (
                        <>
                            <Panel defaultSize="25%" minSize="15%" maxSize="45%" className="left-sidebar-panel">
                                <div className="left-sidebar-header">
                                    <span className="left-sidebar-title">
                                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <line x1="3" y1="12" x2="21" y2="12"></line>
                                            <line x1="3" y1="6" x2="21" y2="6"></line>
                                            <line x1="3" y1="18" x2="21" y2="18"></line>
                                        </svg>
                                        Custom Queries
                                    </span>
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

                    <Panel defaultSize="75%" minSize="30%">
                        <PointCloudOverviewContainer />
                    </Panel>

                    {activeRightPanel !== null && (
                        <>
                            <Separator className="resize-handle vertical" />
                            <Panel defaultSize="40%" minSize="15%" maxSize="60%" className="right-sidebar-panel">
                                <div className="pco-top-right-toolbar">
                                    {renderToolbarButtons()}
                                </div>
                                {activeRightPanel === "jobs" && (
                                    <>
                                        <div className="right-sidebar-header">
                                            <span className="right-sidebar-title">
                                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                    <line x1="6" y1="3" x2="6" y2="15"></line>
                                                    <circle cx="18" cy="6" r="3"></circle>
                                                    <circle cx="6" cy="18" r="3"></circle>
                                                    <path d="M18 9a9 9 0 0 1-9 9"></path>
                                                </svg>
                                                Job System Overview
                                            </span>
                                            <button
                                                type="button"
                                                className="right-sidebar-toggle-btn"
                                                onClick={() => setActiveRightPanel(null)}
                                                title="Collapse Right Sidebar"
                                            >
                                                ✕
                                            </button>
                                        </div>
                                        <div className="right-sidebar-content">
                                            <JobSystemOverview compact limit={0} />
                                        </div>
                                    </>
                                )}

                                {activeRightPanel === "debug" && (
                                    <>
                                        <div className="right-sidebar-header">
                                            <span className="right-sidebar-title">
                                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path>
                                                    <circle cx="12" cy="12" r="3"></circle>
                                                </svg>
                                                Debug Controls
                                            </span>
                                            <button
                                                type="button"
                                                className="right-sidebar-toggle-btn"
                                                onClick={() => setActiveRightPanel(null)}
                                                title="Collapse Right Sidebar"
                                            >
                                                ✕
                                            </button>
                                        </div>
                                        <div className="right-sidebar-content">
                                            <PLYPointCloudSidebar />
                                        </div>
                                    </>
                                )}

                                {activeRightPanel === "videologs" && (
                                    <>
                                        <div className="right-sidebar-header">
                                            <span className="right-sidebar-title">
                                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                    <polygon points="23 7 16 12 23 17 23 7"></polygon>
                                                    <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
                                                </svg>
                                                Video & Logs
                                            </span>
                                            <button
                                                type="button"
                                                className="right-sidebar-toggle-btn"
                                                onClick={() => setActiveRightPanel(null)}
                                                title="Collapse Right Sidebar"
                                            >
                                                ✕
                                            </button>
                                        </div>
                                        <div className="right-sidebar-content">
                                            <VideoLogsPanel />
                                        </div>
                                    </>
                                )}
                            </Panel>
                        </>
                    )}
                </Group>
            </div>
        </PLYPointCloudProvider>
    );
}

