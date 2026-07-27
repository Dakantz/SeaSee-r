import React, { useRef } from 'react';
import { ViewerProvider } from './ViewerContext';
import { usePotreeViewer } from './hooks/usePotreeViewer';
import { useLoadPLY } from './hooks/useLoadPLY';
import { useLoadEPT } from './hooks/useLoadEPT';
import { useTransformControls } from './hooks/useTransformControls';
import { useYellowSphere } from './hooks/useYellowSphere';
import { usePotreeRovRenderer } from './hooks/usePotreeRovRenderer';

interface NativePotreeViewerProps {
    pointCloudIds: string[];
    gizmoMode?: 'translate' | 'rotate' | 'scale' | null;
    editingPointcloudId?: string | null;
}

const PointCloudLoader: React.FC<{ identifier: string }> = ({ identifier }) => {
    const isPly = identifier.toLowerCase().endsWith('.ply');
    useLoadPLY(identifier, isPly);
    useLoadEPT(identifier, !isPly);
    return null;
};

const ViewerInner: React.FC<NativePotreeViewerProps> = ({ pointCloudIds, gizmoMode = null, editingPointcloudId = null }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    
    // Initialize Potree
    usePotreeViewer(containerRef);

    // Initialize TransformControls (Gizmo)
    useTransformControls(gizmoMode, editingPointcloudId);

    // Add yellow sphere at coordinates (0, 0, 0)
    useYellowSphere([0, 0, 0], 1.0);

    // Add ROV 3D model & Trajectory Path into Potree scene
    usePotreeRovRenderer();

    return (
        <>
            <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0, zIndex: 0 }}></div>
            {pointCloudIds.map((identifier, idx) => (
                <PointCloudLoader key={`${identifier}-${idx}`} identifier={identifier} />
            ))}
        </>
    );
};

const NativePotreeViewer: React.FC<NativePotreeViewerProps> = (props) => {
    return (
        <ViewerProvider>
            <ViewerInner {...props} />
        </ViewerProvider>
    );
};

export default NativePotreeViewer;
