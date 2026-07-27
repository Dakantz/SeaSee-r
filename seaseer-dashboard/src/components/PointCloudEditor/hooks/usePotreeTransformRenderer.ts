import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import { useViewerContext } from '../ViewerContext';
import { useRoverStore } from '../../../store/roverStore';
import { TelemetryAttitudeReader } from '../../TelemetoryPanel/TelemetryRotationReader';
import { TelemetryPositionReader } from '../../TelemetoryPanel/TelemetryPositionReader';
import { slerpAttitude } from '../../../utils/slerp_interpolation';
import { lerpPosition } from '../../../utils/lerp_interpolation';
import { useTelemetryInterpolationLoop } from '../../../hooks/useTelemetryInterpolationLoop';

const MODEL_URL = '/model-assets/fifishModel.glb';

export interface UsePotreeTransformRendererProps {
    roverId: string;
    rotationUrl: string;
    positionUrl: string;
    rotationOffset?: [number, number, number];
    positionOffset?: [number, number, number];
}

/**
 * Hook to render and animate the ROV 3D GLTF model directly in Potree's Three.js scene.
 */
export function usePotreeTransformRenderer({
    roverId,
    rotationUrl,
    positionUrl,
    rotationOffset = [0, 0, 0],
    positionOffset = [0, 0, 0],
}: UsePotreeTransformRendererProps) {
    const { viewer } = useViewerContext();

    const addRover = useRoverStore((state) => state.addRover);
    const removeRover = useRoverStore((state) => state.removeRover);
    const setOrientation = useRoverStore((state) => state.setOrientation);
    const setPosition = useRoverStore((state) => state.setPosition);

    const modelRef = useRef<THREE.Group | null>(null);

    const hasRotationTelemetry = rotationUrl.trim().length > 0;
    const hasPositionTelemetry = positionUrl.trim().length > 0;

    const attitudeReader = useMemo(
        () => (hasRotationTelemetry ? new TelemetryAttitudeReader(rotationUrl) : null),
        [hasRotationTelemetry, rotationUrl]
    );

    const positionReader = useMemo(
        () => (hasPositionTelemetry ? new TelemetryPositionReader(positionUrl) : null),
        [hasPositionTelemetry, positionUrl]
    );

    // Register rover in store
    useEffect(() => {
        addRover({
            id: roverId,
            name: roverId,
            position: positionOffset,
            yaw: rotationOffset[0],
            pitch: rotationOffset[1],
            roll: rotationOffset[2],
            rotationUrl,
            positionUrl,
        });

        return () => {
            removeRover(roverId);
        };
    }, [addRover, removeRover, roverId, rotationUrl, positionUrl, positionOffset, rotationOffset]);

    // Load GLTF Model into Potree Scene
    useEffect(() => {
        if (!viewer || !viewer.scene || !viewer.scene.scene) return;
        const threeScene = viewer.scene.scene;
        let cancelled = false;

        // Ensure ambient and directional lights exist in Potree scene
        if (!threeScene.getObjectByName('potree-ambient-light')) {
            const ambientLight = new THREE.AmbientLight(0xffffff, 2.0);
            ambientLight.name = 'potree-ambient-light';
            threeScene.add(ambientLight);
        }

        if (!threeScene.getObjectByName('potree-dir-light')) {
            const dirLight = new THREE.DirectionalLight(0xffffff, 2.0);
            dirLight.position.set(10, 20, 10);
            dirLight.name = 'potree-dir-light';
            threeScene.add(dirLight);
        }

        const loader = new GLTFLoader();
        loader.load(
            MODEL_URL,
            (gltf) => {
                if (cancelled) return;
                const model = gltf.scene;
                model.name = `potree-rov-model-${roverId}`;

                // Ensure textures have valid encoding to prevent WebGLProgram unsupported encoding warnings
                model.traverse((child) => {
                    if ((child as THREE.Mesh).isMesh) {
                        const mesh = child as THREE.Mesh;
                        if (mesh.material) {
                            const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
                            materials.forEach((mat: any) => {
                                if (mat.map && mat.map.encoding === undefined) {
                                    mat.map.encoding = (THREE as any).LinearEncoding ?? 3000;
                                }
                                if (mat.emissiveMap && mat.emissiveMap.encoding === undefined) {
                                    mat.emissiveMap.encoding = (THREE as any).LinearEncoding ?? 3000;
                                }
                            });
                        }
                    }
                });

                // Check store for initial telemetry sample coordinates already resolved
                const currentRover = useRoverStore.getState().rovers[roverId];
                if (currentRover) {
                    model.position.set(...currentRover.position);
                    model.rotation.set(
                        THREE.MathUtils.degToRad(currentRover.pitch),
                        THREE.MathUtils.degToRad(currentRover.yaw),
                        THREE.MathUtils.degToRad(currentRover.roll)
                    );
                } else {
                    model.position.set(...positionOffset);
                    model.rotation.set(
                        THREE.MathUtils.degToRad(rotationOffset[1]),
                        THREE.MathUtils.degToRad(rotationOffset[0]),
                        THREE.MathUtils.degToRad(rotationOffset[2])
                    );
                }

                modelRef.current = model;
                threeScene.add(model);

                if (typeof viewer.setNeedsRedraw === 'function') {
                    viewer.setNeedsRedraw();
                }
            },
            undefined,
            (error) => {
                console.error('[usePotreeTransformRenderer] Failed to load GLTF model:', error);
            }
        );

        return () => {
            cancelled = true;
            if (modelRef.current && threeScene) {
                threeScene.remove(modelRef.current);
                modelRef.current.traverse((child) => {
                    if ((child as THREE.Mesh).isMesh) {
                        const mesh = child as THREE.Mesh;
                        mesh.geometry?.dispose();
                        if (Array.isArray(mesh.material)) {
                            mesh.material.forEach((m) => m.dispose());
                        } else if (mesh.material) {
                            mesh.material.dispose();
                        }
                    }
                });
                modelRef.current = null;
                if (typeof viewer.setNeedsRedraw === 'function') {
                    viewer.setNeedsRedraw();
                }
            }
        };
    }, [viewer, roverId, positionOffset[0], positionOffset[1], positionOffset[2], rotationOffset[0], rotationOffset[1], rotationOffset[2]]);

    // Attitude Telemetry Interpolation Loop
    useTelemetryInterpolationLoop({
        enabled: hasRotationTelemetry,
        reader: attitudeReader,
        interpolationName: 'attitude',
        interpolate: slerpAttitude,
        applySample: (attitude) => {
            const yaw = attitude.yaw + rotationOffset[0];
            const pitch = attitude.pitch + rotationOffset[1];
            const roll = attitude.roll + rotationOffset[2];

            setOrientation(roverId, yaw, pitch, roll);

            if (modelRef.current) {
                modelRef.current.rotation.set(
                    THREE.MathUtils.degToRad(pitch),
                    THREE.MathUtils.degToRad(yaw),
                    THREE.MathUtils.degToRad(roll)
                );
                if (viewer && typeof viewer.setNeedsRedraw === 'function') {
                    viewer.setNeedsRedraw();
                }
            }
        },
    });

    // Position Telemetry Interpolation Loop
    useTelemetryInterpolationLoop({
        enabled: hasPositionTelemetry,
        reader: positionReader,
        interpolationName: 'position',
        interpolate: lerpPosition,
        applySample: (pos) => {
            const newPos: [number, number, number] = [
                pos.x + positionOffset[0],
                pos.y + positionOffset[1],
                pos.z + positionOffset[2],
            ];

            setPosition(roverId, newPos);

            if (modelRef.current) {
                modelRef.current.position.set(...newPos);
                if (viewer && typeof viewer.setNeedsRedraw === 'function') {
                    viewer.setNeedsRedraw();
                }
            }
        },
    });
}
