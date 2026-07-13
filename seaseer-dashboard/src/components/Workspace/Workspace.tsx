import {
    Panel,
    Group,
    Separator,
} from "react-resizable-panels";

import CameraPanel from "../CameraPanel/CameraPanel";
import PointCloudPanel from "../PointCloudPanel/PointCloudPanel";
import TelemetryPanel from "../TelemetoryPanel/TrajectoryPanel";

import "./Workspace.css";

export default function Workspace() {
    return (
        <Group orientation="horizontal" className="workspace">

            <Panel defaultSize="40%" minSize="20%">
                <CameraPanel />
            </Panel>

            <Separator className="resize-handle vertical" />
                <Panel defaultSize="60%" minSize="20%">
                    <div className="right-panel">
                        <div className="pointcloud-container">
                            <PointCloudPanel />
                        </div>

                        <div className="trajectory-container">
                            <TelemetryPanel />
                        </div>
                    </div>
                </Panel>
        </Group>
    );
}