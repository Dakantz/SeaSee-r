import React, { useEffect, useRef, useState } from 'react';
import { useFrame, useThree, Canvas } from '@react-three/fiber';
import { Potree, PointColorType, PointSizeType, PointShape } from 'potree-core';
import * as THREE from 'three';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import PointCloudSidebar, { type PointCloudItem } from './PointCloudSidebar';

interface PointCloudSceneProps {
    eptUrl: string;
    isPly?: boolean;
}

const PointCloudScene: React.FC<PointCloudSceneProps> = ({ eptUrl, isPly = false }) => {
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
                            // Index handling
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

interface PointCloudViewerProps {
    initialUrl?: string;
    initialIsPly?: boolean;
}

const PointCloudViewer: React.FC<PointCloudViewerProps> = ({ initialUrl, initialIsPly = false }) => {
    const [selectedUrl, setSelectedUrl] = useState<string | undefined>(initialUrl);
    const [isPly, setIsPly] = useState<boolean>(initialIsPly);

    const handleSelect = (item: PointCloudItem) => {
        let newUrl = '';
        if (typeof item === 'string') {
            newUrl = item;
        } else if (item && item.id) {
            newUrl = item.id;
        } else if (item && item.safe_filename) {
            newUrl = item.safe_filename;
        } else if (item && item.orig_filename) {
            newUrl = item.orig_filename;
        }
        
        if (newUrl) {
            // Determine if PLY or EPT
            const isPlyFile = newUrl.toLowerCase().endsWith('.ply');
            setIsPly(isPlyFile);
            
            // Format URL if necessary
            const formattedUrl = newUrl.startsWith('http://') || newUrl.startsWith('https://')
                ? newUrl
                : newUrl.includes('/ept/') || newUrl.endsWith('.json') || newUrl.endsWith('.ply')
                ? \`http://localhost:8000/\${newUrl}\`
                : \`http://localhost:8000/ept/\${newUrl}/ept.json\`;
                
            setSelectedUrl(formattedUrl);
        }
    };

    return (
        <div className="flex h-screen w-full bg-slate-950 overflow-hidden relative">
            <PointCloudSidebar onSelect={handleSelect} />
            
            <div className="flex-1 ml-72 h-full w-full relative">
                {selectedUrl ? (
                    <Canvas className="w-full h-full">
                        <PointCloudScene eptUrl={selectedUrl} isPly={isPly} />
                    </Canvas>
                ) : (
                    <div className="flex items-center justify-center h-full text-slate-500">
                        <div className="text-center">
                            <svg className="w-16 h-16 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M14 10l-2 1m0 0l-2-1m2 1v2.5M20 7l-2 1m2-1l-2-1m2 1v2.5M14 4l-2-1-2 1M4 7l2-1M4 7l2 1M4 7v2.5M12 21l-2-1m2 1l2-1m-2 1v-2.5M6 18l-2-1v-2.5M18 18l2-1v-2.5" />
                            </svg>
                            <p className="text-lg font-medium">No point cloud selected</p>
                            <p className="text-sm mt-2">Please select a dataset from the sidebar to view it.</p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default PointCloudViewer;
