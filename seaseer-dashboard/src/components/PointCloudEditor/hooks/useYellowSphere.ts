import { useEffect } from 'react';
import * as THREE from 'three';
import { useViewerContext } from '../ViewerContext';

/**
 * Hook to add a yellow sphere into the Potree / Three.js scene at specified coordinates.
 *
 * @param position Tuple of [x, y, z] coordinates where sphere will be rendered (default [0, 0, 0])
 * @param radius Radius of the sphere in scene units (default 1.0)
 */
export const useYellowSphere = (
    position: [number, number, number] = [0, 0, 0],
    radius: number = 1.0
) => {
    const { viewer } = useViewerContext();

    useEffect(() => {
        if (!viewer || !viewer.scene || !viewer.scene.scene) return;

        const threeScene = viewer.scene.scene;

        // Create 3D yellow sphere geometry & basic material so it shines brightly regardless of lighting
        const geometry = new THREE.SphereGeometry(radius, 32, 32);
        const material = new THREE.MeshBasicMaterial({ color: 0xffff00 });
        const sphere = new THREE.Mesh(geometry, material);

        sphere.position.set(position[0], position[1], position[2]);
        sphere.name = 'origin-yellow-sphere';

        threeScene.add(sphere);

        if (typeof viewer.setNeedsRedraw === 'function') {
            viewer.setNeedsRedraw();
        }

        return () => {
            threeScene.remove(sphere);
            geometry.dispose();
            material.dispose();
            if (typeof viewer.setNeedsRedraw === 'function') {
                viewer.setNeedsRedraw();
            }
        };
    }, [viewer, position[0], position[1], position[2], radius]);
};
