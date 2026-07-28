import { useEffect, useState, useRef, type RefObject } from 'react';
import { useViewerContext } from '../ViewerContext';

export const usePotreeViewer = (
    containerRef: RefObject<HTMLDivElement | null>,
    renderAreaRef?: RefObject<HTMLDivElement | null>
) => {
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
        const targetEl = renderAreaRef?.current || containerRef.current;
        if (!targetEl || !potreeReady || viewerInitializedRef.current) return;

        viewerInitializedRef.current = true;
        const viewer = new (window as any).Potree.Viewer(targetEl);
        
        // Expose to window for debugging and Potree internals
        (window as any).viewer = viewer;

        viewer.setEDLEnabled(true);
        viewer.setFOV(60);
        viewer.setPointBudget(2_000_000);
        viewer.setBackground("skybox");
        viewer.setControls(viewer.earthControls);

        if (viewer.renderer) {
            viewer.renderer.outputEncoding = (window as any).THREE?.LinearEncoding ?? 3000;
        }

        // Load Potree built-in GUI controls panel if available
        if (typeof viewer.loadGUI === 'function') {
            viewer.loadGUI(() => {
                viewer.setLanguage('en');
                if ((window as any).$) {
                    (window as any).$("#menu_tools")?.next()?.show();
                    (window as any).$("#menu_clipping")?.next()?.show();
                }
            });
        }

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
    }, [potreeReady, containerRef, renderAreaRef, setViewer, setScene]);

    return { potreeReady, isInitialized: viewerInitializedRef.current };
};
