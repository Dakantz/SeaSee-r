import React, { useEffect, useState } from 'react';

import type { PointCloudMetadataResponse } from '../../client';

export type PointCloudItem = PointCloudMetadataResponse | string;

export interface PointCloudSidebarProps {
    onSelect?: (item: PointCloudItem) => void;
}

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

const PointCloudSidebar: React.FC<PointCloudSidebarProps> = ({ onSelect }) => {
    const [pointClouds, setPointClouds] = useState<PointCloudItem[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchPointClouds = async () => {
            setLoading(true);
            setError(null);
            try {
                const response = await fetch(`${API_BASE_URL}/pointclouds/`);
                if (!response.ok) {
                    throw new Error(`Failed to fetch point clouds: ${response.status} ${response.statusText}`);
                }
                const data = await response.json();
                setPointClouds(data);
            } catch (err: any) {
                console.error('Error fetching point clouds:', err);
                setError(err.message || 'An unexpected error occurred while fetching point clouds.');
            } finally {
                setLoading(false);
            }
        };

        fetchPointClouds();
    }, []);

    const renderItemName = (item: PointCloudItem) => {
        if (typeof item === 'string') {
            return item;
        }
        return item.orig_filename || item.safe_filename || item.id || 'Unnamed Point Cloud';
    };

    const handleItemClick = (item: PointCloudItem) => {
        if (onSelect) {
            onSelect(item);
        }
    };

    return (
        <aside style={{ position: 'fixed', left: 0, top: 0, width: '288px', height: '100vh', backgroundColor: '#0f172a', borderRight: '1px solid #1e293b', color: '#cbd5e1', display: 'flex', flexDirection: 'column', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)', zIndex: 50 }}>
            <div style={{ padding: '24px', borderBottom: '1px solid #1e293b', backgroundColor: 'rgba(15, 23, 42, 0.5)' }}>
                <h2 style={{ fontSize: '20px', fontWeight: 'bold', color: 'white', letterSpacing: '-0.025em', display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
                    <svg style={{ width: '20px', height: '20px', color: '#3b82f6' }} fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
                    </svg>
                    Point Clouds
                </h2>
                <p style={{ fontSize: '12px', color: '#64748b', marginTop: '4px', marginBottom: 0 }}>Select a dataset to view</p>
            </div>

            <div className="custom-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {loading ? (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '160px', gap: '16px' }}>
                        <div style={{ width: '32px', height: '32px', border: '4px solid #334155', borderTopColor: '#3b82f6', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
                        <span style={{ fontSize: '14px', color: '#94a3b8' }}>Loading datasets...</span>
                    </div>
                ) : error ? (
                    <div style={{ padding: '16px', backgroundColor: 'rgba(127, 29, 29, 0.2)', border: '1px solid rgba(153, 27, 27, 0.5)', borderRadius: '8px' }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                            <svg style={{ width: '20px', height: '20px', color: '#ef4444', flexShrink: 0, marginTop: '2px' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <p style={{ fontSize: '14px', color: '#fecaca', lineHeight: 1.5, margin: 0 }}>{error}</p>
                        </div>
                    </div>
                ) : pointClouds.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '24px', border: '1px dashed #334155', borderRadius: '8px', marginTop: '16px' }}>
                        <svg style={{ width: '32px', height: '32px', color: '#475569', margin: '0 auto 12px auto' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                        </svg>
                        <p style={{ fontSize: '14px', color: '#94a3b8', margin: 0 }}>No point clouds available</p>
                    </div>
                ) : (
                    <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {pointClouds.map((item, index) => {
                            const itemName = renderItemName(item);
                            // Generate a stable key if possible
                            const key = typeof item === 'string' ? item : item.id || index.toString();

                            return (
                                <li key={key}>
                                    <button
                                        onClick={() => handleItemClick(item)}
                                        className="sidebar-button"
                                        style={{
                                            width: '100%', textAlign: 'left', padding: '12px 16px', borderRadius: '12px',
                                            backgroundColor: 'rgba(30, 41, 59, 0.4)', transition: 'all 0.2s', border: '1px solid transparent',
                                            display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', color: '#e2e8f0'
                                        }}
                                        onMouseOver={(e) => { e.currentTarget.style.backgroundColor = '#1e293b'; e.currentTarget.style.borderColor = '#334155'; }}
                                        onMouseOut={(e) => { e.currentTarget.style.backgroundColor = 'rgba(30, 41, 59, 0.4)'; e.currentTarget.style.borderColor = 'transparent'; }}
                                    >
                                        <div style={{ flex: 1, paddingRight: '12px', overflow: 'hidden' }}>
                                            <span style={{ display: 'block', fontSize: '14px', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                {itemName}
                                            </span>
                                            {typeof item !== 'string' && (
                                                <span style={{ display: 'block', fontSize: '12px', color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: '2px' }}>
                                                    {item.number_of_points?.toLocaleString()} points
                                                </span>
                                            )}
                                        </div>
                                        <svg style={{ width: '16px', height: '16px', color: '#475569' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                        </svg>
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>
            
            {/* Add global styles for custom scrollbar within this component scope or in index.css */}
            <style dangerouslySetInnerHTML={{__html: `
                .custom-scrollbar::-webkit-scrollbar {
                    width: 6px;
                }
                .custom-scrollbar::-webkit-scrollbar-track {
                    background: transparent;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb {
                    background: #334155;
                    border-radius: 10px;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover {
                    background: #475569;
                }
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
            `}} />
        </aside>
    );
};

export default PointCloudSidebar;
