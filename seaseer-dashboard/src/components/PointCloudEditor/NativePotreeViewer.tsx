import React, { useRef } from 'react';
import { ViewerProvider } from './ViewerContext';
import { usePotreeViewer } from './hooks/usePotreeViewer';
import { useLoadPLY } from './hooks/useLoadPLY';
import { useLoadEPT } from './hooks/useLoadEPT';

interface NativePotreeViewerProps {
    eptUrl: string;
    isPly?: boolean;
}

const ViewerInner: React.FC<NativePotreeViewerProps> = ({ eptUrl, isPly = false }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    
    // Initialize Potree
    usePotreeViewer(containerRef);

    // Conditionally load point cloud based on type
    useLoadPLY(eptUrl, isPly);
    useLoadEPT(eptUrl, !isPly);

    return (
        <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0, zIndex: 0 }}></div>
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
