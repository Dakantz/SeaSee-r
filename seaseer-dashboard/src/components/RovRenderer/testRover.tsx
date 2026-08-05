import { useEffect } from "react";
import { Canvas } from "@react-three/fiber";

import { RovRenderer } from "./rovRenderer";

import { OrbitControls } from "@react-three/drei";

import { useRoverStore } from "../../store/roverStore";
import { useTimelineStore } from "../../store/timelineStore";

const ROVER_LEFT_ID = "test-rover-left";
const ROVER_RIGHT_ID = "test-rover-right";

const ROTATION_URL_1 =
    "/test_jsons/rover_1/ROV-Log-2026-05-02-2026-05-05-0505205315.json";

const ROTATION_URL_2 =
    "/test_jsons/rover_4/ROV-Log-2026-05-02-2026-05-05-0505214749.json";

const POSITION_URL_1 = "/test_jsons/rover_3/shots.geojson";
const POSITION_URL_2 = "/test_jsons/rover_4/shots.geojson";

export default function TestRover() {

    const currentTime = useTimelineStore(
        (state) => state.currentTime
    );

    const isPlaying = useTimelineStore(
        (state) => state.isPlaying
    );

    const togglePlay = useTimelineStore(
        (state) => state.togglePlay
    );

    const reset = useTimelineStore(
        (state) => state.reset
    );

    const leftRover = useRoverStore(
        (state) => state.rovers[ROVER_LEFT_ID]
    );

    const rightRover = useRoverStore(
        (state) => state.rovers[ROVER_RIGHT_ID]
    );

    useEffect(() => {
        if (!isPlaying) {
            return;
        }

        let frameId: number;
        let previousTime = performance.now();

        const update = (time: number) => {
            const delta =
                (time - previousTime) / 1000;

            previousTime = time;

            const timeline =
                useTimelineStore.getState();

            timeline.setCurrentTime(
                timeline.currentTime + delta
            );

            frameId =
                requestAnimationFrame(update);
        };

        frameId =
            requestAnimationFrame(update);

        return () => {
            cancelAnimationFrame(frameId);
        };
    }, [isPlaying]);

    return (
        <div
            style={{
                position: "fixed",
                inset: 0,
                width: "100vw",
                height: "100vh",
            }}
        >
            <div
                style={{
                    position: "absolute",
                    top: 10,
                    left: 10,
                    zIndex: 10,
                    background: "white",
                    padding: 10,
                    color: "black",
                }}
            >
                <div>
                    Time: {currentTime.toFixed(2)}s
                </div>

                <div>
                    Left ROV Yaw:{" "}
                    {leftRover
                        ? leftRover.yaw.toFixed(2)
                        : "Loading"}
                </div>

                <div>
                    Right ROV Yaw:{" "}
                    {rightRover
                        ? rightRover.yaw.toFixed(2)
                        : "Loading"}
                </div>

                <button onClick={togglePlay}>
                    {isPlaying ? "Pause" : "Play"}
                </button>

                <button onClick={reset}>
                    Reset
                </button>
            </div>

            <Canvas
                camera={{
                    position: [0, 30, 120],
                    fov: 50,
                }}
            >
                <ambientLight intensity={1.5} />

                <directionalLight
                    position={[5, 10, 5]}
                    intensity={2}
                />

                <RovRenderer
                    roverId={ROVER_LEFT_ID}
                    name="Left Test Rover"
                    rotationUrl={ROTATION_URL_1}
                    positionUrl={POSITION_URL_1}
                    positionOffset={[0, 0, 10]}
                    showRover={true}
                    showTrajectory={true}
                    trajectoryProps={{
                        color: 0xff0000,
                        lineWidth: 3,
                    }}
                />

                <RovRenderer
                    roverId={ROVER_RIGHT_ID}
                    name="Right Test Rover"
                    rotationUrl={ROTATION_URL_2}
                    positionUrl={POSITION_URL_2}
                    positionOffset={[0, 0, -10]}
                    trajectoryProps={{
                        color: 0x00ff00,
                        lineWidth: 3,
                    }}
                />

                <OrbitControls />
            </Canvas>
        </div>
    );
}