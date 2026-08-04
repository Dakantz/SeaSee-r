import { useRef, useEffect } from "react";

import { useVideoStore } from "../../store/videoStore";

import "./CameraPanel.css";

const DEFAULT_VIDEO_ID = "default";

export default function CameraPanel() {
    const videoRef = useRef<HTMLVideoElement>(null);

    const addVideo = useVideoStore((state) => state.addVideo);
    const removeVideo = useVideoStore((state) => state.removeVideo);

    const {
        setDuration,
        setCurrentTime,
        setPlaying,
        setResolution,
        setFPS,
    } = useVideoStore();

    // Register video state on mount
    useEffect(() => {
        addVideo({
            id: DEFAULT_VIDEO_ID,
            duration: 0,
            currentTime: 0,
            playing: false,
            fps: 30,
            width: 0,
            height: 0,
        });

        return () => {
            removeVideo(DEFAULT_VIDEO_ID);
        };
    }, [addVideo, removeVideo]);

    const handleLoadedMetadata = () => {
        const video = videoRef.current;
        if (!video) return;

        setDuration(DEFAULT_VIDEO_ID, video.duration);
        setResolution(DEFAULT_VIDEO_ID, video.videoWidth, video.videoHeight);
        setFPS(DEFAULT_VIDEO_ID, 30); // Default to 30 if frameRate is not available
    };

    const handleTimeUpdate = () => {
        const video = videoRef.current;
        if (!video) return;

        setCurrentTime(DEFAULT_VIDEO_ID, video.currentTime);
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
                onPlay={() => setPlaying(DEFAULT_VIDEO_ID, true)}
                onPause={() => setPlaying(DEFAULT_VIDEO_ID, false)}
            />
        </div>
    );
}