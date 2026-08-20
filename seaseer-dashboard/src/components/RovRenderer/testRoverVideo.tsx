import { useEffect } from "react";
import { Canvas } from "@react-three/fiber";
import { RovRenderer } from "./rovRenderer";
import { OrbitControls } from "@react-three/drei";
import { useVideoStore } from "../../store/videoStore";
import FramePanel from "../CameraPanel/FramePanel";

const ROVER_ID = "rover-4";
const ROTATION_URL = "/test_jsons/rover_4/ROV-Log-2026-05-02-2026-05-05-0505214749.json";
const POSITION_URL = "/test_jsons/rover_4/shots.geojson";

export default function TestRoverVideo() {
    const addVideo = useVideoStore((state) => state.addVideo);
    const removeVideo = useVideoStore((state) => state.removeVideo);

    useEffect(() => {
        // Register the video in the store
        addVideo({
            id: "default",
            duration: 0,
            currentTime: 0,
            playing: false,
            fps: 30,
            width: 0,
            height: 0,
            videoUrl: "test_data/20260505_121047_180_N001.MP4",
        });

        return () => {
            removeVideo("default");
        };
    }, [addVideo, removeVideo]);

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
                    background: "rgba(0, 0, 0, 0.7)",
                    padding: "10px 15px",
                    borderRadius: "8px",
                    color: "white",
                    fontSize: "12px",
                    border: "1px solid rgba(255, 255, 255, 0.1)",
                }}
            >
                <div style={{ fontWeight: "bold", marginBottom: "4px" }}>
                    Hover & Click Demo (Rover 4)
                </div>
                <div>Hover over green trajectory line and click any point.</div>
            </div>

            <Canvas
                camera={{
                    position: [0, -120, 30],
                    up: [0, 0, 1],
                    fov: 50,
                }}
            >
                <ambientLight intensity={1.5} />
                <directionalLight position={[5, -5, 10]} intensity={2} />

                <RovRenderer
                    roverId={ROVER_ID}
                    name="Rover 4 Video Test"
                    rotationUrl={ROTATION_URL}
                    positionUrl={POSITION_URL}
                    videoId="default"
                    showRover={true}
                    showTrajectory={true}
                    trajectoryProps={{
                        color: 0x00ff00,
                        lineWidth: 3,
                    }}
                />

                <OrbitControls />
            </Canvas>

            <FramePanel />
        </div>
    );
}
