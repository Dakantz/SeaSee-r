import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import NativePotreeViewer from './NativePotreeViewer';
import { usePotreeScripts } from '../../hooks/usePotreeScripts';

const PointCloudEditorPage: React.FC = () => {
    const { id } = useParams<{ id: string }>();
    const [pointCloudUrl, setPointCloudUrl] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [pointBudget, setPointBudget] = useState<number>(2000000);
    const [pointSize, setPointSize] = useState<number>(1.0);

    // Load standard Potree dependencies
    const { loaded: scriptsLoaded, error: scriptsError } = usePotreeScripts();

    useEffect(() => {
        if (!id) {
            setError('No point cloud ID provided');
            setLoading(false);
            return;
        }
        
        const url = id.startsWith('http://') || id.startsWith('https://')
            ? id
            : id.includes('/ept/') || id.endsWith('.json')
            ? `http://localhost:8000/${id}`
            : `http://localhost:8000/ept/${id}/ept.json`;

        setPointCloudUrl(url);
        setLoading(false);
    }, [id]);

    const handlePointBudgetChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = Number(e.target.value);
        setPointBudget(val);
        const viewer = (window as any).viewer;
        if (viewer && typeof viewer.setPointBudget === 'function') {
            viewer.setPointBudget(val);
        }
    };

    const handlePointSizeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = Number(e.target.value);
        setPointSize(val);
        const viewer = (window as any).viewer;
        if (viewer && viewer.scene && viewer.scene.pointclouds) {
            viewer.scene.pointclouds.forEach((pc: any) => {
                if (pc.material) {
                    pc.material.size = val;
                }
            });
        }
    };

    if (loading || !scriptsLoaded) {
        return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: 'white', background: '#111' }}>Loading Point Cloud Engine...</div>;
    }

    if (error || scriptsError || !pointCloudUrl) {
        return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: 'red', background: '#111' }}>Error: {error || scriptsError?.message || 'Failed to load'}</div>;
    }

    return (
        <div style={{ width: '100%', height: '100vh', background: '#000', position: 'relative' }}>
            
            {/* Native Potree DOM Container */}
            <NativePotreeViewer eptUrl={pointCloudUrl} isPly={false} />
            
            {/* Custom React Toolbar floating over the 3D Canvas */}
            <div style={{
                position: 'absolute',
                top: 20,
                left: 20,
                zIndex: 10,
                background: 'rgba(20, 20, 25, 0.85)',
                padding: '15px',
                borderRadius: '8px',
                border: '1px solid #333',
                color: 'white',
                fontFamily: 'sans-serif',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
                boxShadow: '0 4px 15px rgba(0,0,0,0.5)',
                backdropFilter: 'blur(10px)',
                minWidth: '220px'
            }}>
                <h3 style={{ margin: '0 0 5px 0', fontSize: '16px', fontWeight: '500' }}>Tools</h3>

                {/* Point Budget Slider */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', marginBottom: '5px' }}>
                    <label style={{ fontSize: '12px', color: '#ccc', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>Point Budget:</span>
                        <span style={{ fontWeight: 'bold', color: '#4caf50' }}>
                            {pointBudget >= 1000000 ? `${(pointBudget / 1000000).toFixed(1)}M` : `${(pointBudget / 1000).toFixed(0)}k`} pts
                        </span>
                    </label>
                    <input 
                        type="range" 
                        min={100000} 
                        max={10000000} 
                        step={100000} 
                        value={pointBudget} 
                        onChange={handlePointBudgetChange} 
                        style={{ width: '100%', cursor: 'pointer', accentColor: '#2a5b84' }}
                    />
                </div>

                {/* Point Size Slider */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', marginBottom: '5px' }}>
                    <label style={{ fontSize: '12px', color: '#ccc', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>Point Size:</span>
                        <span style={{ fontWeight: 'bold', color: '#64b5f6' }}>
                            {pointSize.toFixed(1)}
                        </span>
                    </label>
                    <input 
                        type="range" 
                        min={0.1} 
                        max={5.0} 
                        step={0.1} 
                        value={pointSize} 
                        onChange={handlePointSizeChange} 
                        style={{ width: '100%', cursor: 'pointer', accentColor: '#2a5b84' }}
                    />
                </div>
                
                <button 
                    onClick={() => {
                        const viewer = (window as any).viewer;
                        if (viewer) {
                            viewer.measuringTool.startInsertion({
                                showDistances: true,
                                showAngles: false,
                                showCoordinates: false,
                                showArea: false,
                                closed: false,
                                maxMarkers: 2,
                                name: 'Distance'
                            });
                        }
                    }}
                    style={{
                        background: '#2a5b84',
                        color: 'white',
                        border: 'none',
                        padding: '8px 12px',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '13px',
                        transition: 'background 0.2s'
                    }}
                    onMouseOver={(e) => e.currentTarget.style.background = '#3672a3'}
                    onMouseOut={(e) => e.currentTarget.style.background = '#2a5b84'}
                >
                    Measure Distance
                </button>
                
                <button 
                    onClick={() => {
                        const viewer = (window as any).viewer;
                        if (viewer) {
                            viewer.measuringTool.scene.removeAllChildren();
                        }
                    }}
                    style={{
                        background: '#84312a',
                        color: 'white',
                        border: 'none',
                        padding: '8px 12px',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '13px',
                        transition: 'background 0.2s'
                    }}
                    onMouseOver={(e) => e.currentTarget.style.background = '#a33b32'}
                    onMouseOut={(e) => e.currentTarget.style.background = '#84312a'}
                >
                    Clear Measurements
                </button>
            </div>
            
        </div>
    );
};

export default PointCloudEditorPage;
