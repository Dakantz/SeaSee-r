import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useViewerContext } from '../ViewerContext';
import { TelemetryPositionReader } from '../../TelemetoryPanel/TelemetryPositionReader';

export interface UsePotreeTrajectoryRendererProps {
    url: string;
    color?: THREE.ColorRepresentation;
    lineWidth?: number;
    opacity?: number;
    visible?: boolean;
    position?: [number, number, number];
    rotation?: [number, number, number];
    scale?: [number, number, number];
    showDirections?: boolean;
    directionLength?: number;
    directionColor?: THREE.ColorRepresentation;
}

/**
 * Hook to render an ROV trajectory path line directly in Potree's Three.js scene.
 * Uses standard Three.js Mesh (TubeGeometry) and MeshBasicMaterial to avoid custom ShaderMaterial include errors in Potree.
 */
export function usePotreeTrajectoryRenderer({
    url,
    color = 0x00ff00,
    lineWidth = 3,
    opacity = 1,
    visible = true,
    position = [0, 0, 0],
    rotation = [0, 0, 0],
    scale = [1, 1, 1],
    showDirections = true,
    directionLength = 3.0,
    directionColor = 0xffaa00,
}: UsePotreeTrajectoryRendererProps) {
    const { viewer } = useViewerContext();

    const reader = useMemo(
        () => (url ? new TelemetryPositionReader(url) : null),
        [url]
    );

    useEffect(() => {
        if (!viewer || !viewer.scene || !viewer.scene.scene || !reader) return;

        const threeScene = viewer.scene.scene;
        let cancelled = false;
        let group: THREE.Group | null = null;

        async function build() {
            try {
                const samples = await reader!.getPositionData();
                if (cancelled || !samples || samples.length === 0) return;

                const points = samples.map((s) => new THREE.Vector3(s.x, s.y, s.z));
                group = new THREE.Group();
                group.name = 'potree-rov-trajectory';
                group.visible = visible;
                group.position.set(...position);
                group.rotation.set(...rotation);
                group.scale.set(...scale);

                const threeColor = new THREE.Color(color);

                if (points.length >= 2) {
                    const curve = new THREE.CatmullRomCurve3(points);
                    const tubeRadius = 0.05 * (lineWidth || 1);
                    const geometry = new THREE.TubeGeometry(
                        curve,
                        Math.max(points.length * 2, 20),
                        tubeRadius,
                        8,
                        false
                    );
                    const material = new THREE.MeshBasicMaterial({
                        color: threeColor,
                        opacity,
                        transparent: opacity < 1,
                    });
                    const mesh = new THREE.Mesh(geometry, material);
                    group.add(mesh);
                } else {
                    const geometry = new THREE.BufferGeometry().setFromPoints(points);
                    const material = new THREE.LineBasicMaterial({
                        color: threeColor,
                        opacity,
                        transparent: opacity < 1,
                    });
                    const line = new THREE.Line(geometry, material);
                    group.add(line);
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
                        'position',
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

                threeScene.add(group);

                if (typeof viewer.setNeedsRedraw === 'function') {
                    viewer.setNeedsRedraw();
                }
            } catch (err) {
                console.error('[usePotreeTrajectoryRenderer] Error loading trajectory:', err);
            }
        }

        build();

        return () => {
            cancelled = true;
            if (group && threeScene) {
                threeScene.remove(group);
                group.traverse((object) => {
                    const mesh = object as THREE.Mesh;
                    if ('geometry' in mesh && mesh.geometry) {
                        mesh.geometry.dispose();
                    }
                    const mat = (mesh as any).material;
                    if (Array.isArray(mat)) {
                        mat.forEach((m: THREE.Material) => m.dispose());
                    } else if (mat) {
                        mat.dispose();
                    }
                });
                if (typeof viewer.setNeedsRedraw === 'function') {
                    viewer.setNeedsRedraw();
                }
            }
        };
    }, [
        viewer,
        reader,
        color,
        lineWidth,
        opacity,
        visible,
        position[0], position[1], position[2],
        rotation[0], rotation[1], rotation[2],
        scale[0], scale[1], scale[2],
    ]);
}
