import React, { useRef } from 'react';
import { ViewerProvider } from './ViewerContext';
import { usePotreeViewer } from './hooks/usePotreeViewer';
import { useLoadPLY } from './hooks/useLoadPLY';
import { useLoadEPT } from './hooks/useLoadEPT';

interface NativePotreeViewerProps {
    eptUrls: string[];
}

const PointCloudLoader: React.FC<{ url: string }> = ({ url }) => {
    const isPly = url.toLowerCase().endsWith('.ply');
    useLoadPLY(url, isPly);
    useLoadEPT(url, !isPly);
    return null;
};

const ViewerInner: React.FC<NativePotreeViewerProps> = ({ eptUrls }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    
    // Initialize Potree
    usePotreeViewer(containerRef);

    return (
        <>
            <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0, zIndex: 0 }}></div>
            {eptUrls.map((url, idx) => (
                <PointCloudLoader key={`${url}-${idx}`} url={url} />
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
