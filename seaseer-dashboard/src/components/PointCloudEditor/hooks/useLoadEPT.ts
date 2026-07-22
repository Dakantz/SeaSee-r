import { useEffect } from 'react';
import { useViewerContext } from '../ViewerContext';
import * as THREE from 'three';
import { listPointclouds } from '../../../client/sdk.gen';

export const useLoadEPT = (url: string, enabled: boolean) => {
    const { viewer, setPointCloud } = useViewerContext();

    useEffect(() => {
        if (!viewer || !url || !enabled) return;

        let isCancelled = false;
        let loadedPotreeCloud: any = null;

        const loadCloud = async () => {
            let metadata: any = null;
            const uuidMatch = url.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);
            if (uuidMatch) {
                try {
                    const res = await listPointclouds();
                    if (res.data) {
                        metadata = res.data.find((p: any) => p.id === uuidMatch[0]) || null;
                    }
                } catch (e) {
                    console.error('Failed to fetch pointclouds', e);
                }
            }

            if (isCancelled) return;

            (window as any).Potree.loadPointCloud(url, "Point Cloud", (e: any) => {
                if (isCancelled) return;

                let scene = viewer.scene;
                let pointcloud = e.pointcloud;

                loadedPotreeCloud = pointcloud;

                let material = pointcloud.material;
                material.size = 1.0;
                material.pointSizeType = (window as any).Potree.PointSizeType.FIXED;
                material.shape = (window as any).Potree.PointShape.SQUARE;

                if (metadata && metadata.transform_matrix) {
                    const matrix = new THREE.Matrix4();
                    matrix.fromArray(metadata.transform_matrix);
                    pointcloud.applyMatrix4(matrix);
                    pointcloud.matrix.decompose(pointcloud.position, pointcloud.quaternion, pointcloud.scale);
                }

                scene.addPointCloud(pointcloud);
                viewer.fitToScreen();

                setPointCloud(pointcloud);
            });
        };

        loadCloud();

        return () => {
            isCancelled = true;
            if (loadedPotreeCloud) {
                const pointclouds = viewer.scene.pointclouds;
                const index = pointclouds.indexOf(loadedPotreeCloud);
                if (index > -1) {
                    pointclouds.splice(index, 1);
                }
                viewer.scene.scenePointCloud.remove(loadedPotreeCloud);
                
                if (loadedPotreeCloud.dispose) {
                    loadedPotreeCloud.dispose();
                }
            }
            // Avoid setting to null if it has already been overwritten by a new load
            setPointCloud((prev: any) => (prev === loadedPotreeCloud ? null : prev));
        };
    }, [url, enabled, viewer, setPointCloud]);
};
