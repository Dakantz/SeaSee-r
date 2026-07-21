import { useEffect } from 'react';
import { useViewerContext } from '../ViewerContext';

export const useLoadEPT = (url: string, enabled: boolean) => {
    const { viewer, setPointCloud } = useViewerContext();

    useEffect(() => {
        if (!viewer || !url || !enabled) return;

        let isCancelled = false;
        let loadedPotreeCloud: any = null;

        (window as any).Potree.loadPointCloud(url, "Point Cloud", (e: any) => {
            if (isCancelled) return;

            let scene = viewer.scene;
            let pointcloud = e.pointcloud;

            loadedPotreeCloud = pointcloud;

            let material = pointcloud.material;
            material.size = 1.0;
            material.pointSizeType = (window as any).Potree.PointSizeType.FIXED;
            material.shape = (window as any).Potree.PointShape.SQUARE;

            scene.addPointCloud(pointcloud);
            viewer.fitToScreen();

            setPointCloud(pointcloud);
        });

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
