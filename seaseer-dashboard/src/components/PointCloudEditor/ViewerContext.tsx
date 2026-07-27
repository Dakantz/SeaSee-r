import React, { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { useTimelineStore } from '../../store/timelineStore';

export type MeasurementType = 'distance' | 'area' | 'volume' | 'none';

interface ViewerContextState {
    viewer: any | null; // Potree.Viewer instance
    scene: any | null; // Potree.Scene instance
    pointCloud: any | null; // THREE.Points (PLY) or Potree.PointCloud (EPT)
    
    // Timeline animation state & actions (similar to testRover.tsx)
    currentTime: number;
    isPlaying: boolean;
    togglePlay: () => void;
    reset: () => void;

    // Setters for state
    setViewer: (viewer: any) => void;
    setScene: (scene: any) => void;
    setPointCloud: (pointCloud: any) => void;

    // Tool APIs (Placeholders for future implementation)
    setTranslation: (x: number, y: number, z: number) => void;
    setRotation: (x: number, y: number, z: number) => void;
    enableMeasurementTool: (type: MeasurementType) => void;
    enableClippingTool: (enabled: boolean) => void;
}

const ViewerContext = createContext<ViewerContextState | undefined>(undefined);

export const useViewerContext = () => {
    const context = useContext(ViewerContext);
    if (!context) {
        throw new Error("useViewerContext must be used within a ViewerProvider");
    }
    return context;
};

interface ViewerProviderProps {
    children: ReactNode;
}

export const ViewerProvider: React.FC<ViewerProviderProps> = ({ children }) => {
    const [viewer, setViewer] = useState<any | null>(null);
    const [scene, setScene] = useState<any | null>(null);
    const [pointCloud, setPointCloud] = useState<any | null>(null);

    // Timeline store integration (similar to testRover.tsx)
    const currentTime = useTimelineStore((state) => state.currentTime);
    const isPlaying = useTimelineStore((state) => state.isPlaying);
    const togglePlay = useTimelineStore((state) => state.togglePlay);
    const reset = useTimelineStore((state) => state.reset);

    // Animation frame loop driven by timelineStore (similar to testRover.tsx)
    useEffect(() => {
        if (!isPlaying) {
            return;
        }

        let frameId: number;
        let previousTime = performance.now();

        const update = (time: number) => {
            const delta = (time - previousTime) / 1000;
            previousTime = time;

            const timeline = useTimelineStore.getState();
            timeline.setCurrentTime(timeline.currentTime + delta);

            frameId = requestAnimationFrame(update);
        };

        frameId = requestAnimationFrame(update);

        return () => {
            cancelAnimationFrame(frameId);
        };
    }, [isPlaying]);

    // --- Tool API Implementations (Placeholders) ---

    const setTranslation = (x: number, y: number, z: number) => {
        if (!pointCloud) {
            console.warn("No point cloud loaded to translate.");
            return;
        }
        console.log(`Setting translation to X:${x}, Y:${y}, Z:${z}`);
        pointCloud.position.set(x, y, z);
    };

    const setRotation = (x: number, y: number, z: number) => {
        if (!pointCloud) {
            console.warn("No point cloud loaded to rotate.");
            return;
        }
        console.log(`Setting rotation to X:${x}, Y:${y}, Z:${z}`);
        pointCloud.rotation.set(x, y, z);
    };

    const enableMeasurementTool = (type: MeasurementType) => {
        if (!viewer) {
            console.warn("Viewer not initialized.");
            return;
        }
        console.log(`Enabling measurement tool: ${type}`);
    };

    const enableClippingTool = (enabled: boolean) => {
        if (!viewer) {
            console.warn("Viewer not initialized.");
            return;
        }
        console.log(`Clipping tool enabled: ${enabled}`);
    };

    const value: ViewerContextState = {
        viewer,
        scene,
        pointCloud,
        currentTime,
        isPlaying,
        togglePlay,
        reset,
        setViewer,
        setScene,
        setPointCloud,
        setTranslation,
        setRotation,
        enableMeasurementTool,
        enableClippingTool
    };

    return (
        <ViewerContext.Provider value={value}>
            {children}
        </ViewerContext.Provider>
    );
};
