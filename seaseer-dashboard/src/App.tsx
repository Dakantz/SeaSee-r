import { Routes, Route } from "react-router-dom";
import "./App.css";

import Toolbar from "./components/Toolbar";
import Workspace from "./components/Workspace/Workspace";
import ExampleDiagnostics from "./components/ExampleDiagnostics.tsx";
import VideoUploadTestPage from "./components/VideoUploader/VideoUploadTestPage.tsx";
import PointCloudUploadTestPage from "./components/PointCloudUploader/PointCloudUploadTestPage.tsx";
import PointCloudEditorPage from "./components/PointCloudEditor/PointCloudEditorPage.tsx";
import TestRover from "./components/RovRenderer/testRover.tsx";
import TestRoverVideo from "./components/RovRenderer/testRoverVideo.tsx";
import StatusBar from "./components/StatusBar.tsx";

function App() {
    return (
        <div className="app">
            <Toolbar />
            <Routes>
                <Route path="/" element={<Workspace />} />
                <Route path="/example-diagnostics" element={<ExampleDiagnostics />} />
                <Route path="/video-upload-test" element={<VideoUploadTestPage />} />
                <Route path="/pointcloud-upload-test" element={<PointCloudUploadTestPage />} />
                <Route path="/pointcloud-editor" element={<PointCloudEditorPage />} />
                <Route path="/pointcloud-editor/:id" element={<PointCloudEditorPage />} />
                <Route path="/test-rover" element={<TestRover />} />
                <Route path="/test-rover-video" element={<TestRoverVideo />} />
            </Routes>
            <StatusBar />
        </div>
    );
}

export default App;