import React, { useRef, useMemo, useEffect } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, Billboard } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import * as THREE from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { FiCompass, FiTarget } from "react-icons/fi";
import type { ComputedTelemetryPoint, PointCloudOption } from "./types";

interface Logs3DViewerProps {
    points: ComputedTelemetryPoint[];
    activeMap: PointCloudOption | null;
    activeIndex: number | null;
    hoveredIndex: number | null;
    onSelectIndex: (index: number) => void;
    onHoverIndex?: (index: number | null) => void;
}

function TrajectoryScene({
    points,
    activeIndex,
    hoveredIndex,
    onSelectIndex,
    onHoverIndex,
}: {
    points: ComputedTelemetryPoint[];
    activeIndex: number | null;
    hoveredIndex: number | null;
    onSelectIndex: (index: number) => void;
    onHoverIndex?: (index: number | null) => void;
}) {
    const { size } = useThree();
    const lineGroupRef = useRef<THREE.Group>(null);

    const lineObject = useMemo(() => {
        if (!points || points.length < 2) return null;

        const positions: number[] = [];
        points.forEach((p) => {
            positions.push(p.x, p.y, p.z);
        });

        const geometry = new LineGeometry();
        geometry.setPositions(positions);

        const material = new LineMaterial({
            color: 0x0284c7, // Sky blue
            linewidth: 3.5,
            transparent: true,
            opacity: 0.85,
        });
        material.resolution.set(size.width, size.height);

        const line = new Line2(geometry, material);
        line.computeLineDistances();
        return line;
    }, [points, size.width, size.height]);

    const activePoint = activeIndex !== null && points[activeIndex] ? points[activeIndex] : null;
    const hoveredPoint = hoveredIndex !== null && hoveredIndex !== activeIndex && points[hoveredIndex] ? points[hoveredIndex] : null;

    return (
        <group ref={lineGroupRef}>
            {lineObject && <primitive object={lineObject} />}

            {points.map((p, idx) => {
                if (idx === activeIndex) return null; // Avoid duplicate active mesh
                const isHovered = idx === hoveredIndex;
                const radius = isHovered ? 0.38 : 0.2;
                const color = isHovered ? "#38bdf8" : "#0284c7";

                return (
                    <mesh
                        key={p.id || idx}
                        position={[p.x, p.y, p.z]}
                        onClick={(e) => {
                            e.stopPropagation();
                            onSelectIndex(idx);
                        }}
                        onPointerOver={(e) => {
                            e.stopPropagation();
                            onHoverIndex?.(idx);
                        }}
                        onPointerOut={(e) => {
                            e.stopPropagation();
                            onHoverIndex?.(null);
                        }}
                    >
                        <sphereGeometry args={[radius, 16, 16]} />
                        <meshStandardMaterial
                            color={color}
                            emissive={color}
                            emissiveIntensity={isHovered ? 0.6 : 0.1}
                        />
                    </mesh>
                );
            })}

            {activePoint && (
                <group position={[activePoint.x, activePoint.y, activePoint.z]}>
                    <mesh>
                        <sphereGeometry args={[0.55, 16, 16]} />
                        <meshStandardMaterial
                            color="#f59e0b"
                            emissive="#f59e0b"
                            emissiveIntensity={0.6}
                        />
                    </mesh>

                    {activePoint.direction && (
                        <mesh
                            position={[
                                activePoint.direction[0] * 1.5,
                                activePoint.direction[1] * 1.5,
                                activePoint.direction[2] * 1.5,
                            ]}
                        >
                            <coneGeometry args={[0.25, 0.7, 16]} />
                            <meshStandardMaterial color="#ef4444" emissive="#ef4444" emissiveIntensity={0.6} />
                        </mesh>
                    )}

                    <Billboard>
                        <mesh>
                            <ringGeometry args={[0.9, 1.15, 32]} />
                            <meshBasicMaterial color="#f59e0b" transparent opacity={0.8} depthTest={false} />
                        </mesh>
                    </Billboard>
                </group>
            )}

            {hoveredPoint && (
                <group position={[hoveredPoint.x, hoveredPoint.y, hoveredPoint.z]}>
                    <Billboard>
                        <mesh>
                            <ringGeometry args={[0.7, 0.9, 32]} />
                            <meshBasicMaterial color="#38bdf8" transparent opacity={0.8} depthTest={false} />
                        </mesh>
                    </Billboard>
                </group>
            )}
        </group>
    );
}

function CameraSetup({
    center,
    extents,
}: {
    center: [number, number, number];
    extents: number;
}) {
    const { camera } = useThree();
    const initialized = useRef(false);

    useEffect(() => {
        if (!initialized.current && extents > 0) {
            camera.up.set(0, 0, 1);
            const dist = Math.max(extents * 1.6, 20);
            camera.position.set(center[0], center[1] - dist, center[2] + dist * 0.6);
            camera.lookAt(center[0], center[1], center[2]);
            initialized.current = true;
        }
    }, [center, extents, camera]);

    return null;
}

export const Logs3DViewer: React.FC<Logs3DViewerProps> = ({
    points,
    activeMap,
    activeIndex,
    hoveredIndex,
    onSelectIndex,
    onHoverIndex,
}) => {
    const controlsRef = useRef<OrbitControlsImpl>(null);

    const center = useMemo<[number, number, number]>(() => {
        if (activeMap?.center) return activeMap.center;
        if (points.length > 0) {
            const xs = points.map((p) => p.x);
            const ys = points.map((p) => p.y);
            const zs = points.map((p) => p.z);
            return [
                (Math.min(...xs) + Math.max(...xs)) / 2,
                (Math.min(...ys) + Math.max(...ys)) / 2,
                (Math.min(...zs) + Math.max(...zs)) / 2,
            ];
        }
        return [0, 0, 0];
    }, [activeMap, points]);

    const extents = useMemo<number>(() => {
        if (points.length === 0) return 50;
        const xs = points.map((p) => p.x);
        const ys = points.map((p) => p.y);
        const dx = Math.max(...xs) - Math.min(...xs);
        const dy = Math.max(...ys) - Math.min(...ys);
        return Math.max(dx, dy, 20);
    }, [points]);

    const resetCameraView = () => {
        if (controlsRef.current) {
            controlsRef.current.target.set(center[0], center[1], center[2]);
            controlsRef.current.object.position.set(center[0], center[1] - extents * 1.6, center[2] + extents * 0.6);
            controlsRef.current.update();
        }
    };

    useEffect(() => {
        if (activeIndex !== null && points[activeIndex] && controlsRef.current) {
            const pt = points[activeIndex];
            controlsRef.current.target.set(pt.x, pt.y, pt.z);
            controlsRef.current.update();
        }
    }, [activeIndex, points]);

    return (
        <div className="logs-3d-viewer-card">
            <div className="logs-3d-viewer-header">
                <div className="logs-3d-title-group">
                    <FiCompass className="logs-3d-title-icon" size={16} />
                    <span className="logs-3d-title">3D Trajectory & Spatial View</span>
                </div>
                <div className="logs-3d-actions-group">
                    <button
                        className="logs-viewer-action-btn"
                        onClick={resetCameraView}
                        title="Reset 3D Camera View to Center"
                    >
                        <FiTarget size={12} />
                        <span>Center</span>
                    </button>
                    <span className="logs-3d-controls-hint">Rotate: Left | Pan: Right</span>
                </div>
            </div>

            <div className="logs-3d-canvas-wrapper">
                <Canvas
                    camera={{
                        position: [center[0], center[1] - extents * 1.5, center[2] + extents * 0.8],
                        up: [0, 0, 1],
                        fov: 45,
                        near: 0.1,
                        far: 1e9,
                    }}
                >
                    <ambientLight intensity={1.2} />
                    <directionalLight position={[center[0] + 50, center[1] - 50, center[2] + 100]} intensity={1.5} />
                    <directionalLight position={[center[0] - 50, center[1] + 50, center[2] - 50]} intensity={0.5} />

                    <CameraSetup
                        center={center}
                        extents={extents}
                    />

                    <TrajectoryScene
                        points={points}
                        activeIndex={activeIndex}
                        hoveredIndex={hoveredIndex}
                        onSelectIndex={onSelectIndex}
                        onHoverIndex={onHoverIndex}
                    />

                    <OrbitControls
                        ref={controlsRef}
                        target={new THREE.Vector3(center[0], center[1], center[2])}
                        enableDamping={false}
                    />

                    <gridHelper
                        args={[extents * 2, 20, 0x334155, 0x1e293b]}
                        position={[center[0], center[1], Math.min(...(points.length > 0 ? points.map((p) => p.z) : [0])) - 0.5]}
                        rotation={[Math.PI / 2, 0, 0]}
                    />
                </Canvas>
            </div>
        </div>
    );
};
