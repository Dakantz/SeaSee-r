import {
    useEffect,
    useMemo,
    useState,
} from "react";

import { useThree } from "@react-three/fiber";
import * as THREE from "three";

import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";

import { TelemetryPositionReader } from "../TelemetoryPanel/TelemetryPositionReader";
import { useTrajectoryHover } from "./hooks/useTrajectoryHover";
import { useTrajectoryClosestPoint } from "./hooks/useTrajectoryClosestPoint";
import { Billboard} from "@react-three/drei";
import { useVideoStore } from "../../store/videoStore";

let circleTexture: THREE.CanvasTexture | null = null;
function getCircleTexture(): THREE.CanvasTexture {
    if (!circleTexture && typeof document !== "undefined") {
        const canvas = document.createElement("canvas");
        canvas.width = 32;
        canvas.height = 32;
        const ctx = canvas.getContext("2d");
        if (ctx) {
            ctx.beginPath();
            ctx.arc(16, 16, 14, 0, 2 * Math.PI);
            ctx.fillStyle = "#ffffff";
            ctx.fill();
        }
        circleTexture = new THREE.CanvasTexture(canvas);
    }
    return circleTexture!;
}

export interface TrajectoryRendererProps {
    url: string;
    videoId?: string;
    color?: THREE.ColorRepresentation;
    lineWidth?: number;
    opacity?: number;
    visible?: boolean;
    position?: [number, number, number];
    rotation?: [number, number, number];
    scale?: [number, number, number];
    onInitialPositionLoaded?: () => void;
    showPoints?: boolean;
    pointSize?: number;
    showDirections?: boolean;
    directionLength?: number;
    directionColor?: THREE.ColorRepresentation;
}

export function TrajectoryRenderer({
    url,
    videoId,
    color = 0x00ff00,
    lineWidth = 3,
    opacity = 1,
    visible = true,
    position = [0, 0, 0],
    rotation = [0, 0, 0],
    scale = [1, 1, 1],
    onInitialPositionLoaded,
    showPoints = true,
    pointSize = 0.5,
    showDirections = true,
    directionLength = 3.0,
    directionColor = 0xffaa00,
}: TrajectoryRendererProps) {

    const [group, setGroup] = useState<THREE.Group | null>(null);
    const { size, gl } = useThree();
    const { isHovered} = useTrajectoryHover(url);
    const [samples, setSamples] = useState<any[]>([]);
    const { hoveredPoint, hoveredSample } = useTrajectoryClosestPoint(
        samples,
        size,
        30,
        !!videoId,
        group
    );
    const setSelectedFrame = useVideoStore((state) => state.setSelectedFrame);

    const reader = useMemo(
        () => new TelemetryPositionReader(url),
        [url]
    );

    useEffect(() => {
        const handleCanvasClick = (_e: MouseEvent) => {
            if (videoId && hoveredSample) {
                setSelectedFrame({
                    videoId: videoId,
                    relativeTime: hoveredSample.relativeTime,
                    position: [hoveredSample.x, hoveredSample.y, hoveredSample.z],
                });
            }
        };
        gl.domElement.addEventListener("click", handleCanvasClick);
        return () => {
            gl.domElement.removeEventListener("click", handleCanvasClick);
        };
    }, [gl, videoId, hoveredSample, setSelectedFrame]);

    useEffect(() => {
        let cancelled = false;

        async function build() {
            const samples =
                await reader.getPositionData();

            if (cancelled) {
                return;
            }

            if (samples.length === 0) {
                setSamples([]);
                setGroup(null);
                return;
            }

            TrajectoryRenderer.initialPositions[url] = [
                samples[0].x,
                samples[0].y,
                samples[0].z,
            ];
            if (onInitialPositionLoaded) {
                onInitialPositionLoaded();
            }

            setSamples(samples);

            const positions: number[] = [];

            for (const sample of samples) {
                positions.push(
                    sample.x,
                    sample.y,
                    sample.z
                );
            }

            const geometry =
                new LineGeometry();

            geometry.setPositions(
                positions
            );

            const material =
                new LineMaterial({
                    color,
                    linewidth: isHovered ? lineWidth * 1.5 : lineWidth,
                    opacity,
                    transparent:
                        opacity < 1,
                });

            material.resolution.set(
                size.width,
                size.height
            );

            const line =
                new Line2(
                    geometry,
                    material
                );

            line.computeLineDistances();

            const group =
                new THREE.Group();

            group.visible = visible;

            group.position.set(
                ...position
            );

            group.rotation.set(
                ...rotation
            );

            group.scale.set(
                ...scale
            );

            group.add(line);

            if (showPoints) {
                const pointsGeometry = new THREE.BufferGeometry();
                pointsGeometry.setAttribute(
                    "position",
                    new THREE.Float32BufferAttribute(positions, 3)
                );

                const pointsMaterial = new THREE.PointsMaterial({
                    color,
                    size: pointSize,
                    map: getCircleTexture(),
                    transparent: true,
                    alphaTest: 0.5,
                    sizeAttenuation: true,
                });

                const points = new THREE.Points(pointsGeometry, pointsMaterial);
                group.add(points);
            }

            if (showDirections) {
                const dirLinePositions: number[] = [];

                for (let i = 0; i < samples.length; i++) {
                    const s = samples[i];
                    let dirVec = new THREE.Vector3();

                    if (s.direction && Array.isArray(s.direction) && s.direction.length === 3) {
                        dirVec.set(s.direction[0], s.direction[1], s.direction[2]);
                    }

                    if (dirVec.lengthSq() < 1e-6) {
                        if (i < samples.length - 1) {
                            const next = samples[i + 1];
                            dirVec.set(next.x - s.x, next.y - s.y, next.z - s.z);
                        } else if (i > 0) {
                            const prev = samples[i - 1];
                            dirVec.set(s.x - prev.x, s.y - prev.y, s.z - prev.z);
                        }
                    }

                    if (dirVec.lengthSq() < 1e-6) {
                        dirVec.set(0, 0, 1);
                    } else {
                        dirVec.normalize();
                    }

                    const startX = s.x;
                    const startY = s.y;
                    const startZ = s.z;

                    const endX = startX + dirVec.x * directionLength;
                    const endY = startY + dirVec.y * directionLength;
                    const endZ = startZ + dirVec.z * directionLength;

                    dirLinePositions.push(startX, startY, startZ, endX, endY, endZ);
                }

                const dirGeom = new THREE.BufferGeometry();
                dirGeom.setAttribute(
                    "position",
                    new THREE.Float32BufferAttribute(dirLinePositions, 3)
                );
                const dirMat = new THREE.LineBasicMaterial({
                    color: directionColor,
                    transparent: opacity < 1,
                    opacity,
                });
                const dirLines = new THREE.LineSegments(dirGeom, dirMat);

                group.add(dirLines);
            }

            setGroup(group);
        }

        build();

        return () => {
            cancelled = true;

            if (group) {
                group.traverse(
                    (object) => {
                        const mesh =
                            object as THREE.Mesh;

                        if (
                            "geometry" in
                            mesh
                        ) {
                            mesh.geometry?.dispose();
                        }

                        const material =
                            (
                                mesh as any
                            ).material;

                        if (
                            Array.isArray(
                                material
                            )
                        ) {
                            material.forEach(
                                (
                                    m: THREE.Material
                                ) =>
                                    m.dispose()
                            );
                        } else {
                            material?.dispose();
                        }
                    }
                );
            }
        };
    }, [
        reader,
        color,
        lineWidth,
        opacity,
        visible,
        position,
        rotation,
        scale,
        size,
        isHovered,
        showPoints,
        pointSize,
    ]);

    if (!group) {
        return null;
    }

    return (
        <group>
            <primitive
                object={group}
            />
            {hoveredPoint && (
                <group
                    position={position}
                    rotation={rotation}
                    scale={scale}
                >
                    <Billboard position={hoveredPoint}>
                        <mesh>
                            <ringGeometry args={[0.15, 0.25, 32]} />
                            <meshBasicMaterial
                                color={0xffff00}
                                depthTest={false}
                                transparent
                                opacity={0.8}
                            />
                        </mesh>
                    </Billboard>
                </group>
            )}
        </group>
    );
}

TrajectoryRenderer.initialPositions = {} as Record<string, [number, number, number]>;