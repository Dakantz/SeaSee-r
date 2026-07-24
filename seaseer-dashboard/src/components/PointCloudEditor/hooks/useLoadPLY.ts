import { useEffect } from 'react';
import * as THREE from 'three';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { useViewerContext } from '../ViewerContext';

export const useLoadPLY = (identifier: string, enabled: boolean) => {
    const { viewer, setPointCloud } = useViewerContext();

    useEffect(() => {
        if (!viewer || !identifier || !enabled) return;

        const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
        const url = `${API_BASE_URL}/pointclouds/${identifier}`;

        let isCancelled = false;
        let loadedMesh: THREE.Points | null = null;
        let loadedGeometry: THREE.BufferGeometry | null = null;
        let loadedMaterial: THREE.PointsMaterial | null = null;

        const loader = new PLYLoader();
        loader.load(url, (geometry: any) => {
            if (isCancelled) {
                geometry.dispose();
                return;
            }

            geometry.computeVertexNormals();

            // Convert Float64Array to Float32Array for WebGL compatibility
            for (const key in geometry.attributes) {
                const attribute = geometry.attributes[key];
                if (attribute.array instanceof Float64Array) {
                    geometry.setAttribute(key, new THREE.Float32BufferAttribute(attribute.array, attribute.itemSize));
                }
            }

            geometry.computeBoundingBox();
            
            // Dynamic point size based on bounding box size
            const size = geometry.boundingBox 
                ? geometry.boundingBox.getSize(new THREE.Vector3()).length() / 500 
                : 0.002;

            const material = new THREE.PointsMaterial({ size, vertexColors: geometry.hasAttribute('color') });
            const mesh = new THREE.Points(geometry, material);
            mesh.name = url; // Set name so TransformControls can find it

            loadedGeometry = geometry;
            loadedMaterial = material;
            loadedMesh = mesh;

            // Add mesh to viewer's internal three.js scene
            viewer.scene.scene.add(mesh);

            // Center the mesh
            if (geometry.boundingBox) {
                const center = geometry.boundingBox.getCenter(new THREE.Vector3());
                mesh.position.sub(center);

                const radius = geometry.boundingBox.getSize(new THREE.Vector3()).length() / 2;
                viewer.scene.view.position.set(radius, radius, radius);
                viewer.scene.view.lookAt(new THREE.Vector3(0, 0, 0));
            }

            setPointCloud(mesh);
        }, undefined, (err: any) => {
            if (!isCancelled) console.error("Failed to load PLY", err);
        });

        return () => {
            isCancelled = true;
            if (loadedMesh) {
                viewer.scene.scene.remove(loadedMesh);
            }
            if (loadedGeometry) {
                loadedGeometry.dispose();
            }
            if (loadedMaterial) {
                loadedMaterial.dispose();
            }
            // Avoid setting to null if it has already been overwritten by a new load
            setPointCloud((prev: any) => (prev === loadedMesh ? null : prev));
        };
    }, [identifier, enabled, viewer, setPointCloud]);
};
