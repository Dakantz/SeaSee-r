import React, { useEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Potree, PointColorType, PointSizeType, PointShape } from 'potree-core';
import * as THREE from 'three';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';

interface PointCloudViewerProps {
    eptUrl: string;
    isPly?: boolean;
}

const PointCloudViewer: React.FC<PointCloudViewerProps> = ({ eptUrl, isPly = false }) => {
    const potreeRef = useRef<any>(null);
    const pointcloudRef = useRef<any>(null);
    const { scene, camera, gl } = useThree();
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        if (!isPly) {
            const potree = new Potree();
            potreeRef.current = potree;
        }

        const loadCloud = async () => {
            try {
                if (isPly) {
                    const loader = new PLYLoader();
                    loader.load(eptUrl, (geometry: any) => {
                        geometry.computeVertexNormals();
                        
                        // Convert Float64Array to Float32Array for WebGL compatibility
                        for (const key in geometry.attributes) {
                            const attribute = geometry.attributes[key];
                            if (attribute.array instanceof Float64Array) {
                                geometry.setAttribute(key, new THREE.Float32BufferAttribute(attribute.array, attribute.itemSize));
                            }
                        }
                        
                        if (geometry.index && geometry.index.array instanceof Uint32Array) {
                            // Index might also be problematic depending on WebGL1 vs WebGL2, but usually position/normals are the issue.
                        }

                        const material = new THREE.PointsMaterial({ size: 0.002, vertexColors: geometry.hasAttribute('color') });
                        const mesh = new THREE.Points(geometry, material);
                        
                        scene.add(mesh);
                        pointcloudRef.current = mesh;
                        setLoaded(true);

                        // Center the mesh
                        geometry.computeBoundingBox();
                        if (geometry.boundingBox) {
                            const center = geometry.boundingBox.getCenter(new THREE.Vector3());
                            mesh.position.sub(center);
                            
                            const radius = geometry.boundingBox.getSize(new THREE.Vector3()).length() / 2;
                            camera.position.set(radius, radius, radius);
                            camera.lookAt(new THREE.Vector3(0, 0, 0));
                        }
                    }, undefined, (err: any) => {
                        console.error("Failed to load PLY", err);
                    });
                } else {
                    const urlObj = new URL(eptUrl, window.location.origin);
                    const filename = urlObj.pathname.split('/').pop() || 'ept.json';
                    const baseUrl = eptUrl.substring(0, eptUrl.lastIndexOf('/') + 1);

                    const pointcloud = await potreeRef.current.loadPointCloud(filename, baseUrl);
                    
                    const material = pointcloud.material;
                    material.size = 1;
                    material.pointColorType = PointColorType.RGB;
                    material.pointSizeType = PointSizeType.ADAPTIVE;
                    material.shape = PointShape.SQUARE;
                    
                    potreeRef.current.pointBudget = 2_000_000;

                    scene.add(pointcloud);
                    pointcloudRef.current = pointcloud;
                    setLoaded(true);
                    
                    const box = pointcloud.boundingBox;
                    if (box) {
                        const center = box.getCenter(new THREE.Vector3());
                        camera.position.set(center.x, center.y, center.z + 100);
                        camera.lookAt(center);
                    }
                }
            } catch (err) {
                console.error("Failed to load pointcloud", err);
            }
        };
        
        loadCloud();

        return () => {
            if (pointcloudRef.current) {
                scene.remove(pointcloudRef.current);
                if (pointcloudRef.current.geometry) {
                    pointcloudRef.current.geometry.dispose();
                }
                if (pointcloudRef.current.material) {
                    pointcloudRef.current.material.dispose();
                }
            }
        };
    }, [eptUrl, isPly, scene, camera]);

    useFrame(() => {
        if (!isPly && potreeRef.current && loaded && pointcloudRef.current) {
            potreeRef.current.updatePointClouds([pointcloudRef.current], camera, gl);
        }
    });

    return null;
};

export default PointCloudViewer;
