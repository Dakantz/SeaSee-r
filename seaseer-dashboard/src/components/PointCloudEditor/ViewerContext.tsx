import React, { createContext, useContext, useState, type ReactNode } from 'react';

export type MeasurementType = 'distance' | 'area' | 'volume' | 'none';

interface ViewerContextState {
    viewer: any | null; // Potree.Viewer instance
    scene: any | null; // Potree.Scene instance
    pointCloud: any | null; // THREE.Points (PLY) or Potree.PointCloud (EPT)
    
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

    // --- Tool API Implementations (Placeholders) ---

    const setTranslation = (x: number, y: number, z: number) => {
        if (!pointCloud) {
            console.warn("No point cloud loaded to translate.");
            return;
        }
        console.log(`Setting translation to X:${x}, Y:${y}, Z:${z}`);
        // If it's a THREE.Points (PLY) or Potree.PointCloud, they both inherit from Object3D
        pointCloud.position.set(x, y, z);
    };

    const setRotation = (x: number, y: number, z: number) => {
        if (!pointCloud) {
            console.warn("No point cloud loaded to rotate.");
            return;
        }
        console.log(`Setting rotation to X:${x}, Y:${y}, Z:${z}`);
        // Conversion from degrees to radians might be needed based on UI input, 
        // assuming radians here for Three.js native rotation.
        pointCloud.rotation.set(x, y, z);
    };

    const enableMeasurementTool = (type: MeasurementType) => {
        if (!viewer) {
            console.warn("Viewer not initialized.");
            return;
        }
        console.log(`Enabling measurement tool: ${type}`);
        // Example integration for Potree native tools:
        // if (type === 'distance') viewer.scene.addMeasurement(new Potree.Measure());
    };

    const enableClippingTool = (enabled: boolean) => {
        if (!viewer) {
            console.warn("Viewer not initialized.");
            return;
        }
        console.log(`Clipping tool enabled: ${enabled}`);
        // Example integration:
        // if (enabled) {
        //     viewer.setTool(new Potree.VolumeTool(viewer));
        // } else {
        //     viewer.setTool(null);
        // }
    };

    const value: ViewerContextState = {
        viewer,
        scene,
        pointCloud,
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
