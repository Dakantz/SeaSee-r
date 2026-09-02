import { Canvas } from "@react-three/fiber";
import { Grid } from "@react-three/drei";

import "./PointCloudPanel.css";
import PLYPointCloud from "./PLYPointCloud";

import type { ReactNode } from "react";


type PointCloudPanelProps = {
    children?: ReactNode;
};

const TARGET_X = 1622520.9730428709;
const TARGET_Y = -5522707.795739262;

export default function PointCloudPanel({ children }: PointCloudPanelProps)  {
    return (
        <div className="pointcloud-panel">

            <Canvas
                camera={{
                    position: [TARGET_X, TARGET_Y - 2000, 2000],
                    up: [0, 0, 1],
                    fov: 50,
                    near: 0.1,
                    far: 1e9,
                }}
            >

                {/* Target Location Beacon Marker */}
                <mesh position={[TARGET_X, TARGET_Y, 0]}>
                    <sphereGeometry args={[100, 32, 32]} />
                    <meshStandardMaterial color="#ff2233" emissive="#ff1122" emissiveIntensity={0.8} />
                </mesh>

                <Grid
                    infiniteGrid
                    cellSize={100}
                    sectionSize={1000}
                    sectionThickness={1}
                    cellThickness={0.5}
                    position={[TARGET_X, TARGET_Y, 0]}
                    rotation={[Math.PI / 2, 0, 0]}
                />

                <axesHelper args={[500]} />

                <PLYPointCloud />

                {children}

            </Canvas>
        </div>
    );
}