import { useEffect } from "react";
import { Canvas } from "@react-three/fiber";

import { RoverRenderer } from "./rovRenderer";

import { useRoverStore } from "../../store/roverStore";
import { useTimelineStore } from "../../store/timelineStore";

const ROVER_ID = "test-rover";

const ROTATION_URL =
    "/test_jsons/rover_3/ROV-Log-2026-05-02-2026-05-05-0505205315.json";

const POSITION_URL = "";

export default function TestRoverRotation() {
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

    const rover = useRoverStore(
        (state) => state.rovers[ROVER_ID]
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

                {rover && (
                    <>
                        <div>
                            Yaw: {rover.yaw.toFixed(2)}
                        </div>

                        <div>
                            Pitch: {rover.pitch.toFixed(2)}
                        </div>

                        <div>
                            Roll: {rover.roll.toFixed(2)}
                        </div>
                    </>
                )}

                <button onClick={togglePlay}>
                    {isPlaying ? "Pause" : "Play"}
                </button>

                <button onClick={reset}>
                    Reset
                </button>
            </div>

            <Canvas
                camera={{
                    position: [0, 1, 5],
                    fov: 50,
                }}
            >
                <ambientLight intensity={1.5} />

                <directionalLight
                    position={[5, 10, 5]}
                    intensity={2}
                />

                <RoverRenderer
                    roverId={ROVER_ID}
                    name="Test Rover"
                    rotationUrl={ROTATION_URL}
                    positionUrl={POSITION_URL}
                />

            </Canvas>
        </div>
    );
}