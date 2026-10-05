import { Routes, Route, Navigate } from "react-router-dom";
import "./App.css";

import Toolbar from "./components/Toolbar";
import Workspace from "./components/Workspace/Workspace";
import HealthPage from "./components/HealthPage.tsx";
import VideoUploaderPage from "./components/VideoUploader/VideoUploaderPage.tsx";
import PointCloudUploadTestPage from "./components/PointCloudUploader/PointCloudUploadTestPage.tsx";
import PointCloudEditorPage from "./components/PointCloudEditor/PointCloudEditorPage.tsx";
import LogsPage from "./components/Logs/LogsPage.tsx";
import TestRover from "./components/RovRenderer/testRover.tsx";
import TestRoverVideo from "./components/RovRenderer/testRoverVideo.tsx";
import LodAlgorithmAnalyzerPage from "./components/LodAlgorithmAnalyzer/LodAlgorithmAnalyzerPage.tsx";
import PointCloudOverviewPage from "./components/PointCloudOverview/PointCloudOverviewPage.tsx";

function App() {
    return (
        <div className="app">
            <Toolbar />
            <Routes>
                <Route path="/" element={<PointCloudOverviewPage />} />
                <Route path="/pointcloud-overview" element={<Navigate to="/" replace />} />
                <Route path="/workspace" element={<Workspace />} />
                <Route path="/logs" element={<LogsPage />} />
                <Route path="/lod-algorithm-analyzer" element={<LodAlgorithmAnalyzerPage />} />
                <Route path="/health" element={<HealthPage />} />
                <Route path="/video-uploader" element={<VideoUploaderPage />} />
                <Route path="/video-upload-test" element={<Navigate to="/video-uploader" replace />} />
                <Route path="/pointcloud-upload-test" element={<PointCloudUploadTestPage />} />
                <Route path="/pointcloud-editor" element={<PointCloudEditorPage />} />
                <Route path="/pointcloud-editor/:id" element={<PointCloudEditorPage />} />
                <Route path="/test-rover" element={<TestRover />} />
                <Route path="/test-rover-video" element={<TestRoverVideo />} />
            </Routes>
        </div>
    );
}

export default App;
