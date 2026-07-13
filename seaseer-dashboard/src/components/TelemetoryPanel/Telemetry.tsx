import { useCurrentFrame, useVideoStore } from "../../store/videoStore";

import "./TrajectoryPanel.css";

export default function Telemetry() {
    const currentFrame = useCurrentFrame();

    const {
        currentTime,
        duration,
        playing,
        fps,
        width,
        height,
    } = useVideoStore();

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