import React, { useRef } from 'react';
import { usePotreeViewer } from './hooks/usePotreeViewer';
import { useLoadPLY } from './hooks/useLoadPLY';
import { useLoadEPT } from './hooks/useLoadEPT';
import { useTransformControls } from './hooks/useTransformControls';

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

const NativePotreeViewer: React.FC<NativePotreeViewerProps> = ({ pointCloudIds, gizmoMode = null, editingPointcloudId = null }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const renderAreaRef = useRef<HTMLDivElement>(null);

    // Initialize Potree
    usePotreeViewer(containerRef, renderAreaRef);

    // Initialize TransformControls (Gizmo)
    useTransformControls(gizmoMode, editingPointcloudId);


    return (
        <div ref={containerRef} className="potree_container" style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0, zIndex: 0 }}>
            <div id="potree_render_area" ref={renderAreaRef} style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0 }}></div>
            <div id="potree_sidebar_container"></div>
            {pointCloudIds.map((identifier, idx) => (
                <PointCloudLoader key={`${identifier}-${idx}`} identifier={identifier} />
            ))}
        </div>
    );
};

export default NativePotreeViewer;
