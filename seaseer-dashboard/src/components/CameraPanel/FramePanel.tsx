import { useEffect, useRef } from "react";
import { useVideoStore } from "../../store/videoStore";
import { IoClose } from "react-icons/io5";
import "./FramePanel.css";

export default function FramePanel() {
    const videoRef = useRef<HTMLVideoElement>(null);
    const selectedFrame = useVideoStore((state) => state.selectedFrame);
    const setSelectedFrame = useVideoStore((state) => state.setSelectedFrame);

    const video = useVideoStore(
        (state) => selectedFrame ? state.videos[selectedFrame.videoId] : null
    );

    useEffect(() => {
        const videoElement = videoRef.current;
        if (videoElement && selectedFrame) {
            videoElement.currentTime = selectedFrame.relativeTime;
        }
    }, [selectedFrame?.relativeTime]);

    if (!selectedFrame) {
        return null;
    }

    const handleClose = () => {
        setSelectedFrame(null);
    };

    const videoUrl = video?.videoUrl || "test_data/20260505_121047_180_N001.MP4";

    return (
        <div className="frame-panel-card">
            <div className="frame-panel-header">
                <span className="frame-panel-title">
                    Trajectory Snapshot
                </span>
                <button className="frame-panel-close-btn" onClick={handleClose}>
                    <IoClose size={18} />
                </button>
            </div>
            <div className="frame-panel-video-wrapper">
                <video
                    ref={videoRef}
                    className="frame-panel-video"
                    src={videoUrl}
                    controls={false}
                    muted
                    playsInline
                />
            </div>
            <div className="frame-panel-footer">
                <div className="frame-panel-meta">
                    <strong>Time:</strong> {selectedFrame.relativeTime.toFixed(2)}s
                </div>
                {selectedFrame.position && (
                    <div className="frame-panel-meta">
                        <strong>Pos:</strong> X: {selectedFrame.position[0].toFixed(1)}, Y: {selectedFrame.position[1].toFixed(1)}, Z: {selectedFrame.position[2].toFixed(1)}
                    </div>
                )}
            </div>
        </div>
    );
}
