import React, { useState, useEffect, useCallback, useRef } from 'react';
import { getApiBaseUrl } from '../../utils/apiConfig';

export interface BatchItem {
  batch_id: string;
  first_video_filename?: string | null;
  video_count: number;
  total_video_length: number;
  pointcloud_count: number;
  total_points: number;
  created_at?: string | null;
  log_count?: number;
  video_filenames?: string[];
  log_filenames?: string[];
}

export interface UploadedBatchesManagerProps {
  onPipelineStarted?: (batchId: string, pipelines: any[]) => void;
  highlightedBatchId?: string;
}

const formatDuration = (seconds: number): string => {
  if (!seconds || seconds <= 0) return '0s';
  const totalSecs = Math.round(seconds);
  const hrs = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;
  if (hrs > 0) return `${hrs}h ${mins}m ${secs}s`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
};

const formatPoints = (points: number): string => {
  if (!points || points <= 0) return '0';
  if (points >= 1_000_000) return `${(points / 1_000_000).toFixed(1)}M`;
  if (points >= 1_000) return `${(points / 1_000).toFixed(1)}K`;
  return points.toLocaleString();
};

const formatDate = (isoString?: string | null): string => {
  if (!isoString) return 'Unknown date';
  try {
    const d = new Date(isoString);
    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return isoString;
  }
};

export const UploadedBatchesManager: React.FC<UploadedBatchesManagerProps> = ({
  onPipelineStarted,
  highlightedBatchId: externalHighlightedBatchId,
}) => {
  const [batches, setBatches] = useState<BatchItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterType, setFilterType] = useState<'all' | 'reconstructed' | 'pending'>('all');
  const [expandedFiles, setExpandedFiles] = useState<Record<string, boolean>>({});
  const [expandedLauncher, setExpandedLauncher] = useState<Record<string, boolean>>({});

  const [batchParams, setBatchParams] = useState<
    Record<string, { fps: string; blurThreshold: string }>
  >({});
  const [startingBatches, setStartingBatches] = useState<Record<string, boolean>>({});
  const [batchMessages, setBatchMessages] = useState<
    Record<string, { type: 'success' | 'error'; text: string }>
  >({});
  const [copiedBatchId, setCopiedBatchId] = useState<string | null>(null);
  const [activeHighlightId, setActiveHighlightId] = useState<string | undefined>(
    externalHighlightedBatchId
  );

  const batchCardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const apiBaseUrl = getApiBaseUrl();

  const isBatchRecentlyUploaded = useCallback((batchId: string) => {
    return Boolean(activeHighlightId && batchId === activeHighlightId);
  }, [activeHighlightId]);

  const fetchBatches = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBaseUrl}/videos/batches?processed_only=false&limit=500`);
      if (!res.ok) {
        throw new Error(`Failed to load batches: ${res.status} ${res.statusText}`);
      }
      const data: BatchItem[] = await res.json();
      setBatches(data);
    } catch (err: any) {
      console.error('Error fetching batches:', err);
      setError(err.message || 'Failed to fetch uploaded batches');
    } finally {
      setIsLoading(false);
    }
  }, [apiBaseUrl]);

  useEffect(() => {
    try {
      sessionStorage.removeItem('seaseer_recent_uploaded_batch_id');
    } catch {}
  }, []);

  useEffect(() => {
    fetchBatches();

    const handleUploadCompleted = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.batchId) {
        setActiveHighlightId(detail.batchId);
        setExpandedLauncher((prev) => ({ ...prev, [detail.batchId]: true }));
      }
      fetchBatches();
    };

    window.addEventListener('batch-upload-completed', handleUploadCompleted);
    return () => {
      window.removeEventListener('batch-upload-completed', handleUploadCompleted);
    };
  }, [fetchBatches]);

  useEffect(() => {
    if (externalHighlightedBatchId) {
      setActiveHighlightId(externalHighlightedBatchId);
      setExpandedLauncher((prev) => ({ ...prev, [externalHighlightedBatchId]: true }));
    }
  }, [externalHighlightedBatchId]);

  useEffect(() => {
    if (activeHighlightId && batchCardRefs.current[activeHighlightId]) {
      batchCardRefs.current[activeHighlightId]?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    }
  }, [activeHighlightId, batches]);

  const handleCopyId = (batchId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(batchId);
    setCopiedBatchId(batchId);
    setTimeout(() => {
      setCopiedBatchId((prev) => (prev === batchId ? null : prev));
    }, 2000);
  };

  const toggleFiles = (batchId: string) => {
    setExpandedFiles((prev) => ({ ...prev, [batchId]: !prev[batchId] }));
  };

  const toggleLauncher = (batchId: string) => {
    setExpandedLauncher((prev) => {
      const isCurrentlyExpanded = prev[batchId] !== undefined
        ? prev[batchId]
        : isBatchRecentlyUploaded(batchId);
      return { ...prev, [batchId]: !isCurrentlyExpanded };
    });
  };

  const getParamsForBatch = (batchId: string) => {
    return batchParams[batchId] || { fps: '1', blurThreshold: '50' };
  };

  const updateBatchParam = (
    batchId: string,
    field: 'fps' | 'blurThreshold',
    value: string
  ) => {
    setBatchParams((prev) => ({
      ...prev,
      [batchId]: {
        ...getParamsForBatch(batchId),
        [field]: value,
      },
    }));
  };

  const handleStartPipeline = async (batch: BatchItem) => {
    const batchId = batch.batch_id;
    const params = getParamsForBatch(batchId);
    const currentFps = parseFloat(params.fps) > 0 ? parseFloat(params.fps) : 1;
    const duration = batch.total_video_length > 0 ? batch.total_video_length : 0;
    const calculatedFrames = duration > 0
      ? Math.max(1, Math.round(currentFps * duration))
      : Math.max(1, Math.round(currentFps * 180));
    const blurThreshold = parseFloat(params.blurThreshold) >= 0 ? parseFloat(params.blurThreshold) : 50.0;

    setStartingBatches((prev) => ({ ...prev, [batchId]: true }));
    setBatchMessages((prev) => {
      const next = { ...prev };
      delete next[batchId];
      return next;
    });

    try {
      const res = await fetch(`${apiBaseUrl}/videos/batches/${batchId}/pipeline`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fps_list: [currentFps],
          frame_counts: [calculatedFrames],
          blur_thresholds: [blurThreshold],
        }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(
          errorData.detail || `Pipeline start failed with HTTP ${res.status}`
        );
      }

      const pipelines = await res.json();
      setBatchMessages((prev) => ({
        ...prev,
        [batchId]: {
          type: 'success',
          text: `Successfully created pipeline with ${calculatedFrames.toLocaleString()} frames (${currentFps} FPS, blur threshold ${blurThreshold})! Jobs are running in the pipeline overview below.`,
        },
      }));

      window.dispatchEvent(new CustomEvent('job-system-updated'));
      onPipelineStarted?.(batchId, pipelines);

      // Auto expand the launcher to show confirmation
      setExpandedLauncher((prev) => ({ ...prev, [batchId]: true }));
    } catch (err: any) {
      console.error(`Failed to launch pipeline for batch ${batchId}:`, err);
      setBatchMessages((prev) => ({
        ...prev,
        [batchId]: {
          type: 'error',
          text: err.message || 'Failed to start reconstruction pipeline',
        },
      }));
    } finally {
      setStartingBatches((prev) => ({ ...prev, [batchId]: false }));
    }
  };

  // Filter batches
  const filteredBatches = batches.filter((b) => {
    if (filterType === 'reconstructed' && b.pointcloud_count <= 0) return false;
    if (filterType === 'pending' && b.pointcloud_count > 0) return false;

    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    if (b.batch_id.toLowerCase().includes(q)) return true;
    if (b.first_video_filename && b.first_video_filename.toLowerCase().includes(q)) return true;
    if (b.video_filenames?.some((fn) => fn.toLowerCase().includes(q))) return true;
    if (b.log_filenames?.some((fn) => fn.toLowerCase().includes(q))) return true;
    return false;
  });

  const processedCount = batches.filter((b) => b.pointcloud_count > 0).length;
  const pendingCount = batches.length - processedCount;

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Header bar */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: '16px',
        padding: '20px 24px',
        backgroundColor: 'rgba(30, 41, 59, 0.45)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: '16px',
        backdropFilter: 'blur(10px)',
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '22px' }}>🗃️</span>
            <h2 style={{ fontSize: '20px', fontWeight: 600, color: '#f8fafc', margin: 0 }}>
              Uploaded Video & Log Batches
            </h2>
            <span style={{
              fontSize: '12px',
              fontWeight: 600,
              backgroundColor: 'rgba(56, 189, 248, 0.15)',
              color: '#38bdf8',
              border: '1px solid rgba(56, 189, 248, 0.3)',
              padding: '2px 10px',
              borderRadius: '12px',
            }}>
              {batches.length} total
            </span>
          </div>
          <p style={{ margin: '6px 0 0 0', fontSize: '13px', color: '#94a3b8' }}>
            Select any uploaded batch to configure parameters and run OpenSfM reconstruction. You can start or re-run pipelines on any batch at any time.
          </p>
        </div>

        <button
          onClick={fetchBatches}
          disabled={isLoading}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 16px',
            backgroundColor: 'rgba(255, 255, 255, 0.05)',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            borderRadius: '8px',
            color: '#cbd5e1',
            fontSize: '13px',
            fontWeight: 500,
            cursor: isLoading ? 'not-allowed' : 'pointer',
            transition: 'all 0.2s ease',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.1)')}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.05)')}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              animation: isLoading ? 'spin 1s linear infinite' : 'none',
            }}
          >
            <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
          </svg>
          Refresh Batches
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '12px',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        {/* Filter Pills */}
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            onClick={() => setFilterType('all')}
            style={{
              padding: '6px 14px',
              fontSize: '13px',
              fontWeight: 500,
              borderRadius: '8px',
              border: filterType === 'all' ? '1px solid rgba(56, 189, 248, 0.5)' : '1px solid rgba(255, 255, 255, 0.08)',
              backgroundColor: filterType === 'all' ? 'rgba(56, 189, 248, 0.15)' : 'rgba(15, 23, 42, 0.5)',
              color: filterType === 'all' ? '#38bdf8' : '#94a3b8',
              cursor: 'pointer',
            }}
          >
            All Batches ({batches.length})
          </button>
          <button
            onClick={() => setFilterType('reconstructed')}
            style={{
              padding: '6px 14px',
              fontSize: '13px',
              fontWeight: 500,
              borderRadius: '8px',
              border: filterType === 'reconstructed' ? '1px solid rgba(16, 185, 129, 0.5)' : '1px solid rgba(255, 255, 255, 0.08)',
              backgroundColor: filterType === 'reconstructed' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(15, 23, 42, 0.5)',
              color: filterType === 'reconstructed' ? '#34d399' : '#94a3b8',
              cursor: 'pointer',
            }}
          >
            ✓ Reconstructed ({processedCount})
          </button>
          <button
            onClick={() => setFilterType('pending')}
            style={{
              padding: '6px 14px',
              fontSize: '13px',
              fontWeight: 500,
              borderRadius: '8px',
              border: filterType === 'pending' ? '1px solid rgba(251, 191, 36, 0.5)' : '1px solid rgba(255, 255, 255, 0.08)',
              backgroundColor: filterType === 'pending' ? 'rgba(251, 191, 36, 0.15)' : 'rgba(15, 23, 42, 0.5)',
              color: filterType === 'pending' ? '#fbbf24' : '#94a3b8',
              cursor: 'pointer',
            }}
          >
            ⏳ Unprocessed ({pendingCount})
          </button>
        </div>

        {/* Search input */}
        <div style={{ position: 'relative', minWidth: '280px', flex: '1', maxWidth: '400px' }}>
          <input
            type="text"
            placeholder="Search by UUID, video name, or log name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: '100%',
              backgroundColor: 'rgba(15, 23, 42, 0.6)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: '8px',
              padding: '8px 12px 8px 36px',
              fontSize: '13px',
              color: '#f8fafc',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#94a3b8"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)' }}
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div style={{
          padding: '16px',
          backgroundColor: 'rgba(239, 68, 68, 0.12)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          borderRadius: '10px',
          color: '#fca5a5',
          fontSize: '14px',
        }}>
          ⚠️ {error}
        </div>
      )}

      {/* Loading state */}
      {isLoading && batches.length === 0 && (
        <div style={{
          padding: '48px',
          textAlign: 'center',
          backgroundColor: 'rgba(15, 23, 42, 0.3)',
          borderRadius: '16px',
          border: '1px dashed rgba(255, 255, 255, 0.1)',
          color: '#94a3b8',
        }}>
          <div style={{ fontSize: '28px', marginBottom: '12px' }}>⏳</div>
          <div style={{ fontSize: '15px', fontWeight: 500, color: '#f1f5f9' }}>Loading uploaded batches...</div>
          <div style={{ fontSize: '13px', marginTop: '4px' }}>Querying database for upload metadata and point cloud stats</div>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && filteredBatches.length === 0 && (
        <div style={{
          padding: '48px',
          textAlign: 'center',
          backgroundColor: 'rgba(15, 23, 42, 0.3)',
          borderRadius: '16px',
          border: '1px dashed rgba(255, 255, 255, 0.1)',
          color: '#94a3b8',
        }}>
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>🔍</div>
          <div style={{ fontSize: '16px', fontWeight: 500, color: '#f1f5f9' }}>No matching batches found</div>
          <div style={{ fontSize: '13px', marginTop: '6px' }}>
            {searchQuery ? 'Try clearing your search query or switching filters.' : 'Upload videos and log files using the uploader above.'}
          </div>
        </div>
      )}

      {/* Batches List (1 Entry per batch) */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {filteredBatches.map((batch) => {
          const isRecentUpload = isBatchRecentlyUploaded(batch.batch_id);
          const isHighlighted = isRecentUpload;
          const isCopied = copiedBatchId === batch.batch_id;
          const isExpanded = expandedFiles[batch.batch_id] || false;
          const isLauncherExpanded = expandedLauncher[batch.batch_id] !== undefined
            ? expandedLauncher[batch.batch_id]
            : isRecentUpload;
          const isStarting = startingBatches[batch.batch_id] || false;
          const message = batchMessages[batch.batch_id];
          const params = getParamsForBatch(batch.batch_id);
          const currentFps = parseFloat(params.fps) > 0 ? parseFloat(params.fps) : 1;
          const duration = batch.total_video_length > 0 ? batch.total_video_length : 0;
          const calculatedFrames = duration > 0
            ? Math.max(1, Math.round(currentFps * duration))
            : Math.max(1, Math.round(currentFps * 180));
          const currentBlur = parseFloat(params.blurThreshold) >= 0 ? parseFloat(params.blurThreshold) : 50;

          const videoCount = batch.video_count || (batch.video_filenames ? batch.video_filenames.length : 0);
          const logCount = batch.log_count ?? (batch.log_filenames ? batch.log_filenames.length : 0);
          const isReconstructed = batch.pointcloud_count > 0;

          return (
            <div
              key={batch.batch_id}
              ref={(el) => {
                batchCardRefs.current[batch.batch_id] = el;
              }}
              style={{
                backgroundColor: isHighlighted ? 'rgba(30, 58, 95, 0.35)' : 'rgba(30, 41, 59, 0.45)',
                border: isHighlighted ? '1px solid rgba(56, 189, 248, 0.5)' : '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '16px',
                padding: '20px 24px',
                boxShadow: isHighlighted
                  ? '0 0 20px rgba(56, 189, 248, 0.15)'
                  : '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                backdropFilter: 'blur(8px)',
                transition: 'all 0.2s ease',
              }}
            >
              {/* Batch Card Header */}
              <div style={{
                display: 'flex',
                flexWrap: 'wrap',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                gap: '12px',
                paddingBottom: '16px',
                borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
              }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '16px', fontWeight: 600, color: '#f8fafc' }}>
                      {batch.first_video_filename || 'Batch Upload'}
                    </span>

                    {/* Batch UUID Badge + Copy */}
                    <div
                      onClick={(e) => handleCopyId(batch.batch_id, e)}
                      title="Click to copy full Batch UUID"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        fontSize: '11px',
                        fontFamily: 'monospace',
                        color: isCopied ? '#34d399' : '#38bdf8',
                        backgroundColor: isCopied ? 'rgba(16, 185, 129, 0.15)' : 'rgba(56, 189, 248, 0.1)',
                        border: isCopied ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid rgba(56, 189, 248, 0.25)',
                        padding: '3px 8px',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <span>UUID: {batch.batch_id.slice(0, 8)}...</span>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        {isCopied ? (
                          <polyline points="20 6 9 17 4 12" />
                        ) : (
                          <>
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                          </>
                        )}
                      </svg>
                      {isCopied && <span style={{ fontSize: '10px', fontWeight: 600 }}>Copied!</span>}
                    </div>

                    {/* Status Badge */}
                    {isRecentUpload && (
                      <span style={{
                        fontSize: '11px',
                        fontWeight: 600,
                        backgroundColor: 'rgba(56, 189, 248, 0.15)',
                        color: '#38bdf8',
                        border: '1px solid rgba(56, 189, 248, 0.3)',
                        padding: '2px 8px',
                        borderRadius: '12px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '5px',
                      }}>
                        ⭐ Recently Uploaded
                      </span>
                    )}

                    {isReconstructed ? (
                      <span style={{
                        fontSize: '11px',
                        fontWeight: 600,
                        backgroundColor: 'rgba(16, 185, 129, 0.15)',
                        color: '#34d399',
                        border: '1px solid rgba(16, 185, 129, 0.3)',
                        padding: '2px 8px',
                        borderRadius: '12px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '5px',
                      }}>
                        <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#34d399' }} />
                        Reconstructed ({batch.pointcloud_count} clouds, {formatPoints(batch.total_points)} pts)
                      </span>
                    ) : (
                      <span style={{
                        fontSize: '11px',
                        fontWeight: 600,
                        backgroundColor: 'rgba(251, 191, 36, 0.12)',
                        color: '#fbbf24',
                        border: '1px solid rgba(251, 191, 36, 0.25)',
                        padding: '2px 8px',
                        borderRadius: '12px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '5px',
                      }}>
                        <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#fbbf24' }} />
                        Ready for Pipeline
                      </span>
                    )}
                  </div>

                  <span style={{ fontSize: '12px', color: '#94a3b8' }}>
                    Uploaded on {formatDate(batch.created_at)}
                  </span>
                </div>

                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <button
                    onClick={() => toggleFiles(batch.batch_id)}
                    style={{
                      padding: '5px 12px',
                      backgroundColor: isExpanded ? 'rgba(56, 189, 248, 0.12)' : 'rgba(255, 255, 255, 0.05)',
                      border: isExpanded ? '1px solid rgba(56, 189, 248, 0.3)' : '1px solid rgba(255, 255, 255, 0.1)',
                      borderRadius: '6px',
                      color: isExpanded ? '#38bdf8' : '#cbd5e1',
                      fontSize: '12px',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {isExpanded ? 'Hide File Details' : 'View File Details'}
                  </button>

                  <button
                    onClick={() => toggleLauncher(batch.batch_id)}
                    style={{
                      padding: '5px 12px',
                      backgroundColor: isLauncherExpanded ? 'rgba(56, 189, 248, 0.12)' : 'rgba(255, 255, 255, 0.05)',
                      border: isLauncherExpanded ? '1px solid rgba(56, 189, 248, 0.3)' : '1px solid rgba(255, 255, 255, 0.1)',
                      borderRadius: '6px',
                      color: isLauncherExpanded ? '#38bdf8' : '#cbd5e1',
                      fontSize: '12px',
                      fontWeight: 500,
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {isLauncherExpanded ? '⚙️ Hide OpenSfM Pipeline' : '⚙️ OpenSfM Pipeline'}
                  </button>
                </div>
              </div>

              {/* Metrics Row */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: '12px',
                marginTop: '16px',
              }}>
                {/* Videos metric */}
                <div style={{
                  padding: '12px 14px',
                  backgroundColor: 'rgba(15, 23, 42, 0.4)',
                  borderRadius: '10px',
                  border: '1px solid rgba(255, 255, 255, 0.05)',
                }}>
                  <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    📹 Video Stream
                  </div>
                  <div style={{ fontSize: '15px', fontWeight: 600, color: '#f8fafc' }}>
                    {videoCount} {videoCount === 1 ? 'Video' : 'Videos'}
                  </div>
                  <div style={{ fontSize: '12px', color: '#38bdf8', marginTop: '2px' }}>
                    ⏱️ Total: {formatDuration(batch.total_video_length)}
                  </div>
                </div>

                {/* Log Data metric */}
                <div style={{
                  padding: '12px 14px',
                  backgroundColor: 'rgba(15, 23, 42, 0.4)',
                  borderRadius: '10px',
                  border: '1px solid rgba(255, 255, 255, 0.05)',
                }}>
                  <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    📋 Log & Telemetry Data
                  </div>
                  <div style={{ fontSize: '15px', fontWeight: 600, color: '#f8fafc' }}>
                    {logCount > 0 ? `${logCount} Log File${logCount > 1 ? 's' : ''}` : 'No Log Data'}
                  </div>
                  <div style={{ fontSize: '12px', color: logCount > 0 ? '#34d399' : '#f59e0b', marginTop: '2px' }}>
                    {logCount > 0 ? '✓ Telemetry attached' : '⚠️ No log file in batch'}
                  </div>
                </div>

                {/* Point Cloud metric */}
                <div style={{
                  padding: '12px 14px',
                  backgroundColor: 'rgba(15, 23, 42, 0.4)',
                  borderRadius: '10px',
                  border: '1px solid rgba(255, 255, 255, 0.05)',
                }}>
                  <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    ☁️ 3D Point Clouds
                  </div>
                  <div style={{ fontSize: '15px', fontWeight: 600, color: '#f8fafc' }}>
                    {batch.pointcloud_count > 0 ? `${batch.pointcloud_count} Reconstructed` : '0 Datasets'}
                  </div>
                  <div style={{ fontSize: '12px', color: batch.pointcloud_count > 0 ? '#a78bfa' : '#94a3b8', marginTop: '2px' }}>
                    {batch.pointcloud_count > 0 ? `${formatPoints(batch.total_points)} points generated` : 'Awaiting pipeline run'}
                  </div>
                </div>
              </div>

              {/* Expandable File Details Drawer */}
              {isExpanded && (
                <div style={{
                  marginTop: '16px',
                  padding: '14px',
                  backgroundColor: 'rgba(15, 23, 42, 0.6)',
                  borderRadius: '10px',
                  border: '1px solid rgba(255, 255, 255, 0.06)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                }}>
                  {/* Videos list */}
                  <div>
                    <div style={{ fontSize: '12px', fontWeight: 600, color: '#cbd5e1', marginBottom: '6px' }}>
                      📹 Uploaded Videos ({batch.video_filenames?.length || 0}):
                    </div>
                    {batch.video_filenames && batch.video_filenames.length > 0 ? (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        {batch.video_filenames.map((fname, i) => (
                          <span
                            key={i}
                            style={{
                              fontSize: '11px',
                              fontFamily: 'monospace',
                              backgroundColor: 'rgba(56, 189, 248, 0.08)',
                              border: '1px solid rgba(56, 189, 248, 0.2)',
                              color: '#93c5fd',
                              padding: '3px 8px',
                              borderRadius: '4px',
                            }}
                          >
                            {fname}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span style={{ fontSize: '12px', color: '#94a3b8' }}>{batch.first_video_filename || 'No video names available'}</span>
                    )}
                  </div>

                  {/* Logs list */}
                  <div>
                    <div style={{ fontSize: '12px', fontWeight: 600, color: '#cbd5e1', marginBottom: '6px' }}>
                      📋 Uploaded Telemetry / Log Files ({batch.log_filenames?.length || 0}):
                    </div>
                    {batch.log_filenames && batch.log_filenames.length > 0 ? (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        {batch.log_filenames.map((fname, i) => (
                          <span
                            key={i}
                            style={{
                              fontSize: '11px',
                              fontFamily: 'monospace',
                              backgroundColor: 'rgba(16, 185, 129, 0.08)',
                              border: '1px solid rgba(16, 185, 129, 0.2)',
                              color: '#6ee7b7',
                              padding: '3px 8px',
                              borderRadius: '4px',
                            }}
                          >
                            {fname}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span style={{ fontSize: '12px', color: '#94a3b8' }}>None uploaded in this batch</span>
                    )}
                  </div>
                </div>
              )}

              {/* Launcher & Parameter Control Section */}
              {isLauncherExpanded && (
                <div style={{
                  marginTop: '16px',
                  padding: '16px 18px',
                  backgroundColor: 'rgba(15, 23, 42, 0.5)',
                  borderRadius: '12px',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '14px' }}>⚡</span>
                      <span style={{ fontSize: '13px', fontWeight: 600, color: '#f8fafc' }}>
                        Reconstruction Pipeline Parameters
                      </span>
                    </div>
                    <span style={{
                      fontSize: '11px',
                      color: '#38bdf8',
                      backgroundColor: 'rgba(56, 189, 248, 0.1)',
                      border: '1px solid rgba(56, 189, 248, 0.25)',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      fontWeight: 500,
                    }}>
                      Default: 1 FPS
                    </span>
                  </div>

                  {/* Input fields */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '14px' }}>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                        <label style={{ fontSize: '12px', fontWeight: 600, color: '#cbd5e1' }}>
                          FPS (Frames Per Second)
                        </label>
                        <span style={{ fontSize: '11px', color: '#38bdf8', fontWeight: 500 }}>
                          Rate: {currentFps} FPS
                        </span>
                      </div>
                      <input
                        min="1"
                        className="opensfm-field-input"
                        type="number"
                        value={params.fps}
                        onChange={(e) => updateBatchParam(batch.batch_id, 'fps', e.target.value)}
                        disabled={isStarting}
                        placeholder="1"
                      />
                      <div style={{
                        marginTop: '8px',
                        padding: '6px 10px',
                        backgroundColor: 'rgba(56, 189, 248, 0.08)',
                        border: '1px solid rgba(56, 189, 248, 0.2)',
                        borderRadius: '6px',
                        fontSize: '12px',
                        color: '#7dd3fc',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px'
                      }}>
                        <span>📊</span>
                        <span>
                          <strong>Calculated:</strong> {calculatedFrames.toLocaleString()} frames total
                          {duration > 0
                            ? ` (${formatDuration(duration)} combined length × ${currentFps} FPS)`
                            : ` (estimated standard duration × ${currentFps} FPS)`}
                        </span>
                      </div>
                    </div>

                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                        <label style={{ fontSize: '12px', fontWeight: 600, color: '#cbd5e1' }}>
                          Blur Threshold
                        </label>
                        <span style={{ fontSize: '11px', color: '#a78bfa', fontWeight: 500 }}>
                          Threshold: {currentBlur}
                        </span>
                      </div>
                      <input
                        min="0"
                        className="opensfm-field-input"
                        type="number"
                        value={params.blurThreshold}
                        onChange={(e) => updateBatchParam(batch.batch_id, 'blurThreshold', e.target.value)}
                        disabled={isStarting}
                        placeholder="50"
                      />
                      <div style={{
                        marginTop: '8px',
                        padding: '6px 10px',
                        backgroundColor: 'rgba(167, 139, 250, 0.08)',
                        border: '1px solid rgba(167, 139, 250, 0.2)',
                        borderRadius: '6px',
                        fontSize: '12px',
                        color: '#c4b5fd',
                      }}>
                        Laplacian variance threshold (filters out blurry ROV footage)
                      </div>
                    </div>
                  </div>

                  {/* Actions & Launch Button */}
                  <div style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '12px',
                    paddingTop: '12px',
                    borderTop: '1px solid rgba(255, 255, 255, 0.06)',
                  }}>
                    <div style={{ fontSize: '12px', color: '#94a3b8' }}>
                      Will extract <strong>{calculatedFrames.toLocaleString()}</strong> frames at <strong>{currentFps} FPS</strong>
                      {isReconstructed && (
                        <span style={{ color: '#38bdf8', marginLeft: '8px' }}>
                          (Previously reconstructed — you can re-run with any parameters at any time)
                        </span>
                      )}
                    </div>

                    <button
                      onClick={() => handleStartPipeline(batch)}
                      disabled={isStarting}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '8px',
                        padding: '10px 20px',
                        backgroundColor: isReconstructed ? '#2563eb' : '#0284c7',
                        backgroundImage: isReconstructed
                          ? 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)'
                          : 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
                        border: 'none',
                        borderRadius: '8px',
                        color: '#ffffff',
                        fontSize: '13px',
                        fontWeight: 600,
                        cursor: isStarting ? 'not-allowed' : 'pointer',
                        boxShadow: '0 4px 12px rgba(2, 132, 199, 0.3)',
                        transition: 'all 0.2s ease',
                      }}
                      onMouseEnter={(e) => {
                        if (!isStarting) e.currentTarget.style.filter = 'brightness(1.1)';
                      }}
                      onMouseLeave={(e) => {
                        if (!isStarting) e.currentTarget.style.filter = 'none';
                      }}
                    >
                      {isStarting ? (
                        <>
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            style={{ animation: 'spin 1s linear infinite' }}
                          >
                            <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
                          </svg>
                          Launching Pipeline...
                        </>
                      ) : (
                        <>
                          <span>🚀</span>
                          {isReconstructed ? 'Re-run OpenSfM Pipeline' : 'Start OpenSfM Pipeline'}
                        </>
                      )}
                    </button>
                  </div>

                  {/* Feedback Message */}
                  {message && (
                    <div style={{
                      marginTop: '12px',
                      padding: '10px 14px',
                      backgroundColor: message.type === 'success' ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                      border: message.type === 'success' ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid rgba(239, 68, 68, 0.3)',
                      borderRadius: '8px',
                      color: message.type === 'success' ? '#6ee7b7' : '#fca5a5',
                      fontSize: '13px',
                    }}>
                      {message.type === 'success' ? '✓ ' : '⚠️ '}
                      {message.text}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default UploadedBatchesManager;
