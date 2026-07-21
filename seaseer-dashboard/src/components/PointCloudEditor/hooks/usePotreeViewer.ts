import { useEffect, useState, useRef, type RefObject } from 'react';
import { useViewerContext } from '../ViewerContext';

export const usePotreeViewer = (containerRef: RefObject<HTMLDivElement | null>) => {
    const { setViewer, setScene } = useViewerContext();
    const [potreeReady, setPotreeReady] = useState<boolean>(false);
    const viewerInitializedRef = useRef<boolean>(false);

    // 1. Wait for Potree to be available on window
    useEffect(() => {
        let timeoutId: any;
        const checkPotree = () => {
            if ((window as any).Potree) {
                setPotreeReady(true);
            } else {
                timeoutId = setTimeout(checkPotree, 100);
            }
        };
        checkPotree();

        return () => {
            if (timeoutId) clearTimeout(timeoutId);
        };
    }, []);

    // 2. Initialize Viewer exactly once
    useEffect(() => {
        if (!containerRef.current || !potreeReady || viewerInitializedRef.current) return;

        viewerInitializedRef.current = true;
        const viewer = new (window as any).Potree.Viewer(containerRef.current);
        
        // Expose to window for debugging and Potree internals
        (window as any).viewer = viewer;

        viewer.setEDLEnabled(true);
        viewer.setFOV(60);
        viewer.setPointBudget(2_000_000);
        viewer.setBackground("skybox");

        // Update Context
        setViewer(viewer);
        setScene(viewer.scene);

        return () => {
            viewerInitializedRef.current = false;
            if (containerRef.current) {
                containerRef.current.innerHTML = '';
            }
            if ((window as any).viewer === viewer) {
                (window as any).viewer = null;
            }
            
            // Explicitly dispose of the Three.js WebGL renderer to prevent context leaks
            if (viewer.renderer) {
                viewer.renderer.dispose();
            }

            setViewer(null);
            setScene(null);
        };
    }, [potreeReady, containerRef, setViewer, setScene]);

    return { potreeReady, isInitialized: viewerInitializedRef.current };
};
