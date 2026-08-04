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
import { Billboard } from "@react-three/drei";

export interface TrajectoryRendererProps {
    url: string;
    color?: THREE.ColorRepresentation;
    lineWidth?: number;
    opacity?: number;
    visible?: boolean;
    position?: [number, number, number];
    rotation?: [number, number, number];
    scale?: [number, number, number];
    onInitialPositionLoaded?: () => void;
}

export function TrajectoryRenderer({
    url,
    color = 0x00ff00,
    lineWidth = 3,
    opacity = 1,
    visible = true,
    position = [0, 0, 0],
    rotation = [0, 0, 0],
    scale = [1, 1, 1],
    onInitialPositionLoaded,
}: TrajectoryRendererProps) {

    const { size } = useThree();
    const { isHovered, hoverProps } = useTrajectoryHover(url);
    const { hoveredPoint, pointerMoveProps } = useTrajectoryClosestPoint();

    const reader = useMemo(
        () => new TelemetryPositionReader(url),
        [url]
    );

    const [group, setGroup] =
        useState<THREE.Group | null>(null);

    useEffect(() => {
        let cancelled = false;

        async function build() {
            const samples =
                await reader.getPositionData();

            if (cancelled) {
                return;
            }

            if (samples.length > 0) {
                TrajectoryRenderer.initialPositions[url] = [
                    samples[0].x,
                    samples[0].y,
                    samples[0].z,
                ];
                if (onInitialPositionLoaded) {
                    onInitialPositionLoaded();
                }
            }

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
    ]);

    if (!group) {
        return null;
    }

    return (
        <group>
            <primitive
                object={group}
                onPointerOver={hoverProps.onPointerOver}
                onPointerMove={pointerMoveProps.onPointerMove}
                onPointerOut={(e: any) => {
                    hoverProps.onPointerOut(e);
                    pointerMoveProps.onPointerOut(e);
                }}
            />
            {hoveredPoint && (
                <group
                    position={position}
                    rotation={rotation}
                    scale={scale}
                >
                    <Billboard position={hoveredPoint}>
                        <mesh>
                            <ringGeometry args={[0.4, 0.6, 32]} />
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