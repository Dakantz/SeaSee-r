import { useCurrentFrame, useVideoStore } from "../../store/videoStore";

import "./TelemetryPanel.css";

const DEFAULT_VIDEO_ID = "default";

export default function Telemetry() {
    const currentFrame = useCurrentFrame(DEFAULT_VIDEO_ID);

    const video = useVideoStore(
        (state) => state.videos[DEFAULT_VIDEO_ID]
    );

    const {
        currentTime = 0,
        duration = 0,
        playing = false,
        fps = 30,
        width = 0,
        height = 0,
    } = video || {};

    return (
        <div className="telemetry">

            <div>
                <strong>Frame</strong><br />
                {currentFrame}
            </div>

            <div>
                <strong>Time</strong><br />
                {currentTime.toFixed(2)} / {duration.toFixed(2)} s
            </div>

            <div>
                <strong>FPS</strong><br />
                {fps.toFixed(2)}
            </div>

            <div>
                <strong>Resolution</strong><br />
                {width} × {height}
            </div>

            <div>
                <strong>Status</strong><br />
                {playing ? "Playing" : "Paused"}
            </div>

        </div>
    );
}