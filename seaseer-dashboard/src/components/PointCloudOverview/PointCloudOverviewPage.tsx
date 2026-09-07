import { useState } from "react";
import { Panel, Group, Separator } from "react-resizable-panels";
import { PLYPointCloudProvider } from "../PointCloudPanel/PLYPointCloudContext";
import PointCloudOverviewContainer from "./PointCloudOverviewContainer";
import PLYPointCloudSidebar from "../PointCloudPanel/PLYPointCloudSidebar";
import CustomQueryManagerContainer from "../PointCloudPanel/CustomQueryManagerContainer";
import "../Workspace/Workspace.css";

export default function PointCloudOverviewPage() {
    const [isQueriesOpen, setIsQueriesOpen] = useState<boolean>(true);

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
                        <div style={{ position: "relative", width: "100%", height: "100%" }}>
                            <PointCloudOverviewContainer />
                            <PLYPointCloudSidebar />
                        </div>
                    </Panel>
                </Group>
            </div>
        </PLYPointCloudProvider>
    );
}
