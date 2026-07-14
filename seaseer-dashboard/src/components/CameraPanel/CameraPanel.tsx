import { useRef } from "react";

import { useVideoStore } from "../../store/videoStore";

import "./CameraPanel.css";

export default function CameraPanel() {
    const videoRef = useRef<HTMLVideoElement>(null);

    const {
        setDuration,
        setCurrentTime,
        setPlaying,
        setResolution,
        setFPS,
    } = useVideoStore();

    const handleLoadedMetadata = () => {
        const video = videoRef.current;
        if (!video) return;

        setDuration(video.duration);
        setResolution(video.videoWidth, video.videoHeight);
        setFPS(30); // Default to 30 if frameRate is not available
    };

    const handleTimeUpdate = () => {
        const video = videoRef.current;
        if (!video) return;

        setCurrentTime(video.currentTime);
    };

    return (
        <div className="camera-panel">
            <video
                ref={videoRef}
                className="camera-video"
                src="test_data/20260505_121047_180_N001.MP4"
                controls
                onLoadedMetadata={handleLoadedMetadata}
                onTimeUpdate={handleTimeUpdate}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
            />
        </div>
    );
}