import { useEffect } from 'react';
import { useViewerContext } from '../ViewerContext';
import * as THREE from 'three';
import { listPointclouds } from '../../../client/sdk.gen';
import { routeParentMetadataCache } from '../PointCloudSidebar';

export const useLoadEPT = (identifier: string, enabled: boolean) => {
    const { viewer, setPointCloud } = useViewerContext();

    useEffect(() => {
        if (!viewer || !identifier || !enabled) return;

        const API_BASE_URL = (import.meta.env.VITE_API_URL || 'http://localhost:8000').replace(/\/+$/, '');
        const url = `${API_BASE_URL}/ept/${identifier}/ept.json`;

        let isCancelled = false;
        let loadedPotreeCloud: any = null;

        const loadCloud = async () => {
            let metadata: any = null;

            try {
                const res = await listPointclouds();
                if (res.data) {
                    metadata = res.data.find((p: any) => p.id === identifier) || null;
                }
            } catch (e) {
                console.error('Failed to fetch pointclouds', e);
            }

            if (isCancelled) return;

            (window as any).Potree.loadPointCloud(url, url, (e: any) => {
                if (isCancelled) return;

                let scene = viewer.scene;
                let pointcloud = e.pointcloud;

                pointcloud.customUrl = url;

                loadedPotreeCloud = pointcloud;

                let material = pointcloud.material;

                const isCameraRoute = !metadata;
                let transformMetadata = metadata || routeParentMetadataCache[identifier] || null;

                pointcloud.isCameraRoute = isCameraRoute;
                if (isCameraRoute && transformMetadata && transformMetadata.id) {
                    pointcloud.parentPointcloudId = transformMetadata.id;
                }
                material.size = isCameraRoute ? 10.0 : 1.0;
                material.pointSizeType = (window as any).Potree.PointSizeType.FIXED;
                material.shape = (window as any).Potree.PointShape.SQUARE;

                if (transformMetadata && transformMetadata.transform_matrix) {
                    const matrix = new THREE.Matrix4();
                    matrix.fromArray(transformMetadata.transform_matrix);
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
    }, [identifier, enabled, viewer, setPointCloud]);
};
