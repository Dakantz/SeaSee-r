import { useState } from "react";
import { Panel, Group, Separator } from "react-resizable-panels";
import { PLYPointCloudProvider } from "../PointCloudPanel/PLYPointCloudContext";
import PointCloudOverviewContainer from "./PointCloudOverviewContainer";
import CustomQueryManagerContainer from "../PointCloudPanel/CustomQueryManagerContainer";
import { JobSystemOverview } from "../JobSystemOverview/JobSystemOverview";
import PLYPointCloudSidebar from "../PointCloudPanel/PLYPointCloudSidebar";
import { OpenSfMConfigPanel } from "../OpenSfMConfigModal/OpenSfMConfigModal";
import "../Workspace/Workspace.css";
import "./PointCloudOverview.css";

export type ActiveRightPanel = "jobs" | "debug" | "opensfm" | null;

export default function PointCloudOverviewPage() {
    const [isQueriesOpen, setIsQueriesOpen] = useState<boolean>(true);
    const [activeRightPanel, setActiveRightPanel] = useState<ActiveRightPanel>(null);

    return (
        <PLYPointCloudProvider>
            <div className="workspace-container">
                {!isQueriesOpen && (
                    <button
                        type="button"
                        className="left-sidebar-reopen-btn"
                        onClick={() => setIsQueriesOpen(true)}
                        title="Show Custom Queries"
                    >
                        ☰ Custom Queries
                    </button>
                )}

                {/* Top-Right Floating Toolbar with Toggle Buttons for Both Panels */}
                <div className="pco-top-right-toolbar">
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
                        className={`pco-toggle-btn ${activeRightPanel === "opensfm" ? "active" : ""}`}
                        onClick={() => setActiveRightPanel(prev => prev === "opensfm" ? null : "opensfm")}
                        title="Toggle OpenSfM Settings"
                    >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="3"></circle>
                            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                        </svg>
                        <span>OpenSfM Settings</span>
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
                </div>

                <Group orientation="horizontal" className="workspace">
                    {isQueriesOpen && (
                        <>
                            <Panel defaultSize="25%" minSize="15%" maxSize="45%" className="left-sidebar-panel">
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

                    <Panel defaultSize="75%" minSize="30%">
                        <PointCloudOverviewContainer />
                    </Panel>

                    {activeRightPanel !== null && (
                        <>
                            <Separator className="resize-handle vertical" />
                            <Panel defaultSize="40%" minSize="15%" maxSize="60%" className="right-sidebar-panel">
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
                                            <JobSystemOverview compact limit={10} />
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

                                {activeRightPanel === "opensfm" && (
                                    <>
                                        <div className="right-sidebar-header">
                                            <span className="right-sidebar-title">
                                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                    <circle cx="12" cy="12" r="3"></circle>
                                                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                                                </svg>
                                                OpenSfM Settings
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
                                            <OpenSfMConfigPanel />
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

