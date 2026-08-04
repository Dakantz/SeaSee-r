import { Canvas } from "@react-three/fiber";
import { OrbitControls, Grid} from "@react-three/drei";

import "./PointCloudPanel.css";
import PLYPointCloud from "./PLYPointCloud";

import type { ReactNode } from "react";


type PointCloudPanelProps = {
    children?: ReactNode;
};

export default function PointCloudPanel({ children }: PointCloudPanelProps)  {
    return (
        <div className="pointcloud-panel">

            <Canvas
                camera={{
                    position: [3, 3, 3],
                    fov: 50,
                    near: 0.001,
                    far: 100000,
                }}
            >

                <ambientLight intensity={2} />

                <Grid
                    infiniteGrid
                    cellSize={0.2}
                    sectionSize={10}
                    sectionThickness={0.5}
                    cellThickness={0.5}
                />

                <axesHelper args={[2]} />

                <PLYPointCloud />

                {children}

                <OrbitControls />

            </Canvas>
        </div>
    );
}