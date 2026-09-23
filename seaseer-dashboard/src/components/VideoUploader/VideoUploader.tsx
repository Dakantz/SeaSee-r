import React, { useState, useRef, useEffect } from 'react';
import { BaseUploader } from '../common/BaseUploader';
import { useTusUpload, formatUuid } from '../common/useTusUpload';
import type { TusUploadConfig } from '../common/useTusUpload';
import { createPipeline } from '../../client';

export interface VideoUploaderProps {
  onUploadSuccess?: (fileIds: string[]) => void;
  onUploadError?: (error: Error) => void;
  onProgress?: (percentage: number) => void;
  onJobCreated?: (jobId: string) => void;
  jobId?: string;
  chunkSize?: number; // In bytes, default 5MB
  apiUrl?: string;
  tusEndpoint?: string;
  defaultFrameCounts?: number[];
  defaultBlurThresholds?: number[];
}

const DEFAULT_CHUNK_SIZE = 5 * 1024 * 1024; // 5MB

const parseInputNumbers = (input: string, fallback: number[]): number[] => {
  if (!input || !input.trim()) return fallback;
  const parts = input.split(',').map(s => s.trim()).filter(Boolean);
  const parsed = parts.map(p => Number(p)).filter(n => !isNaN(n) && n >= 0);
  return parsed.length > 0 ? parsed : fallback;
};

export const VideoUploader: React.FC<VideoUploaderProps> = ({
  onUploadSuccess,
  onUploadError,
  onProgress,
  onJobCreated,
  chunkSize = DEFAULT_CHUNK_SIZE,
  tusEndpoint = import.meta.env.VITE_TUS_URL || 'http://localhost:8080/files/',
  defaultFrameCounts = [200],
  defaultBlurThresholds = [50]
}) => {
  const [videoFiles, setVideoFiles] = useState<File[]>([]);
  const [metadataFiles, setMetadataFiles] = useState<File[]>([]);
  const [batchId, setBatchId] = useState<string>('');
  const batchIdRef = useRef<string>(batchId);
  
  const [frameCountsInput, setFrameCountsInput] = useState<string>(
    defaultFrameCounts.join(', ')
  );
  const [blurThresholdsInput, setBlurThresholdsInput] = useState<string>(
    defaultBlurThresholds.join(', ')
  );

  const frameCountsRef = useRef(frameCountsInput);
  const blurThresholdsRef = useRef(blurThresholdsInput);

  useEffect(() => {
    batchIdRef.current = batchId;
  }, [batchId]);

  useEffect(() => {
    frameCountsRef.current = frameCountsInput;
  }, [frameCountsInput]);

  useEffect(() => {
    blurThresholdsRef.current = blurThresholdsInput;
  }, [blurThresholdsInput]);

  const parsedFrameCounts = parseInputNumbers(frameCountsInput, defaultFrameCounts);
  const parsedBlurThresholds = parseInputNumbers(blurThresholdsInput, defaultBlurThresholds);
  const totalPipelines = parsedFrameCounts.length * parsedBlurThresholds.length;

  const {
    isUploading,
    progress,
    fileProgress,
    uploadFailed,
    startUpload: tusStartUpload,
    resetState: tusResetState,
    removeFile: tusRemoveFile,
  } = useTusUpload({
    tusEndpoint,
    chunkSize,
    onUploadSuccess: async (fileIdsMap) => {
      const videoIds = videoFiles.map(v => formatUuid(fileIdsMap[v.name])).filter(Boolean);

      // Automatically create job pipeline across user-configured parameter grid (num_frames x blur_threshold)
      try {
        const frameCounts = parseInputNumbers(frameCountsRef.current, defaultFrameCounts);
        const blurThresholds = parseInputNumbers(blurThresholdsRef.current, defaultBlurThresholds);

        const videoSafeFilenames: string[] = [];
        for (const vf of videoFiles) {
          const rawId = fileIdsMap[vf.name];
          const fId = formatUuid(rawId);
          const ext = vf.name.includes('.') ? vf.name.slice(vf.name.lastIndexOf('.')) : '';
          const safeFname = fId ? `${fId}${ext}` : vf.name;
          if (!videoSafeFilenames.includes(safeFname)) {
            videoSafeFilenames.push(safeFname);
          }
        }

        const primaryFile = videoFiles[0] || metadataFiles[0];
        if (!primaryFile) return;

        const primaryRawId = fileIdsMap[primaryFile.name];
        const primaryFileId = formatUuid(primaryRawId);
        const primaryExt = primaryFile.name.includes('.') ? primaryFile.name.slice(primaryFile.name.lastIndexOf('.')) : '';
        const primarySafeFilename = primaryFileId ? `${primaryFileId}${primaryExt}` : primaryFile.name;

        const formatSummary = (files: File[]): string => {
          if (files.length === 0) return primaryFile.name;
          if (files.length === 1) return files[0].name;
          const firstTwo = files.slice(0, 2).map(v => v.name).join(', ');
          const extra = files.length > 2 ? `, +${files.length - 2} more` : '';
          return `${files.length} videos (${firstTwo}${extra})`;
        };

        const fileNamesSummary = formatSummary(videoFiles);
        const truncateStr = (str: string, maxLen = 220) =>
          str.length > maxLen ? `${str.slice(0, maxLen - 3)}...` : str;

        const activeBatchId = batchIdRef.current || batchId;

        for (const numFrames of frameCounts) {
          for (const blurThreshold of blurThresholds) {
            const batchSlug = activeBatchId ? activeBatchId.replace(/-/g, '_') : primaryFileId.replace(/-/g, '_');
            const datasetName = `dataset_${batchSlug}_f${numFrames}_b${blurThreshold}`;

            const pipelineRes = await createPipeline({
              body: {
                name: truncateStr(`Video OpenSfM Pipeline: ${fileNamesSummary} (frames=${numFrames}, blur=${blurThreshold})`),
                jobs: [
                  {
                    id_key: 'video_upload',
                    name: truncateStr(`Log Ingestion: ${fileNamesSummary}`),
                    task_type: 'video_upload',
                    payload: {
                      file_id: primaryFileId,
                      batch_id: activeBatchId,
                      filename: primaryFile.name,
                      safe_filename: primarySafeFilename,
                      video_files: videoSafeFilenames
                    },
                    depends_on: []
                  },
                  {
                    id_key: 'frame_extraction',
                    name: truncateStr(`Frame Extraction: ${fileNamesSummary} (frames=${numFrames}, blur=${blurThreshold})`),
                    task_type: 'frame_extraction',
                    payload: {
                      filename: primaryFile.name,
                      safe_filename: primarySafeFilename,
                      video_files: videoSafeFilenames,
                      num_frames: numFrames,
                      blur_threshold: blurThreshold,
                      dataset_name: datasetName,
                      batch_id: activeBatchId
                    },
                    depends_on: []
                  },
                  {
                    id_key: 'opensfm_sparse',
                    name: truncateStr(`OpenSfM Sparse: ${fileNamesSummary} (frames=${numFrames}, blur=${blurThreshold})`),
                    task_type: 'opensfm_sparse',
                    payload: {
                      dataset_name: datasetName,
                      file_id: primaryFileId,
                      batch_id: activeBatchId
                    },
                    depends_on: ['frame_extraction', 'video_upload']
                  },
                  {
                    id_key: 'opensfm_dense',
                    name: truncateStr(datasetName ? `OpenSfM Dense Component 0: ${datasetName}` : `OpenSfM Dense Reconstruction Component 0`),
                    task_type: 'opensfm_dense',
                    payload: {
                      dataset_name: datasetName,
                      file_id: primaryFileId,
                      batch_id: activeBatchId,
                      reconstruction_index: 0,
                      subfolder: 'undistorted'
                    },
                    depends_on: ['opensfm_sparse']
                  },
                  {
                    id_key: 'opensfm_ingest',
                    name: truncateStr(datasetName ? `OpenSfM Ingest Component 0: ${datasetName}` : `OpenSfM Pointcloud Ingestion Component 0`),
                    task_type: 'opensfm_ingest',
                    payload: {
                      dataset_name: datasetName,
                      file_id: primaryFileId,
                      batch_id: activeBatchId,
                      reconstruction_index: 0,
                      subfolder: 'undistorted'
                    },
                    depends_on: ['opensfm_dense']
                  }
                ]
              }
            });

            if (pipelineRes.data?.jobs) {
              for (const job of pipelineRes.data.jobs) {
                if (job.id && onJobCreated) {
                  onJobCreated(job.id);
                }
              }
            }
          }
        }
      } catch (err) {
        console.warn('Could not auto-create background job pipeline:', err);
      } finally {
        window.dispatchEvent(new CustomEvent('job-system-updated'));
        if (onUploadSuccess && videoIds.length > 0) {
          onUploadSuccess(videoIds);
        }
      }
    },
    onUploadError,
    onProgress
  });

  const handleFilesAdded = (files: File[]) => {
    const newVideoFiles: File[] = [];
    const newMetadataFiles: File[] = [];

    files.forEach(f => {
      if (f.type.startsWith('video/')) {
        newVideoFiles.push(f);
      } else {
        newMetadataFiles.push(f);
      }
    });

    if (newVideoFiles.length > 0) {
      setVideoFiles(prev => {
        const existingNames = new Set(prev.map(f => f.name));
        const filtered = newVideoFiles.filter(f => !existingNames.has(f.name));
        return [...prev, ...filtered];
      });
    }

    if (newMetadataFiles.length > 0) {
      setMetadataFiles(prev => {
        const existingNames = new Set(prev.map(f => f.name));
        const filtered = newMetadataFiles.filter(f => !existingNames.has(f.name));
        return [...prev, ...filtered];
      });
    }
  };

  const handleRemoveVideo = (index: number) => {
    const file = videoFiles[index];
    if (file) {
      tusRemoveFile(file.name);
    }
    setVideoFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleRemoveMetadata = (index: number) => {
    const file = metadataFiles[index];
    if (file) {
      tusRemoveFile(file.name);
    }
    setMetadataFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleReset = (cancel: boolean) => {
    tusResetState(cancel);
    setVideoFiles([]);
    setMetadataFiles([]);
    batchIdRef.current = '';
    setBatchId('');
  };

  const handleStartUpload = (isResume: boolean) => {
    if (videoFiles.length === 0 && metadataFiles.length === 0) return;

    let currentBatchId = batchIdRef.current || batchId;
    if (!isResume || !currentBatchId) {
      currentBatchId = crypto.randomUUID();
      batchIdRef.current = currentBatchId;
      setBatchId(currentBatchId);
    }

    const configs: TusUploadConfig[] = [];
    
    for (const video of videoFiles) {
      configs.push({
        file: video,
        metadata: { 
          upload_type: 'video',
          batch_id: currentBatchId
        },
        fingerprintPrefix: 'video'
      });
    }

    for (const meta of metadataFiles) {
      configs.push({
        file: meta,
        metadata: { 
          upload_type: 'video_metadata',
          batch_id: currentBatchId
        },
        fingerprintPrefix: 'video_metadata'
      });
    }

    tusStartUpload(configs, isResume);
  };

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{
        backgroundColor: 'var(--color-bg-card, #1e293b)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        border: '1px solid var(--color-border-default, rgba(255, 255, 255, 0.1))',
        borderRadius: 'var(--radius-4xl, 16px)',
        padding: '16px 20px',
        boxShadow: 'var(--shadow-xl, 0 20px 25px -5px rgba(0, 0, 0, 0.1))'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"></circle>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
            </svg>
            <span style={{ fontWeight: 600, fontSize: '14px', color: '#f8fafc' }}>
              Pipeline Parameters
            </span>
          </div>
          <span style={{ fontSize: '11px', color: '#94a3b8', backgroundColor: 'rgba(255, 255, 255, 0.05)', padding: '2px 8px', borderRadius: '4px' }}>
            Parameter Grid Sweep
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#cbd5e1' }}>
                Frame Counts
              </label>
              <span style={{ fontSize: '10px', color: '#38bdf8', fontWeight: 500 }}>
                {parsedFrameCounts.length} value{parsedFrameCounts.length > 1 ? 's' : ''}
              </span>
            </div>
            <input
              type="text"
              value={frameCountsInput}
              onChange={(e) => setFrameCountsInput(e.target.value)}
              placeholder="e.g. 100, 200, 300"
              disabled={isUploading}
              style={{
                width: '100%',
                backgroundColor: 'rgba(15, 23, 42, 0.6)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                borderRadius: '8px',
                padding: '8px 10px',
                fontSize: '13px',
                color: '#f8fafc',
                outline: 'none',
                boxSizing: 'border-box'
              }}
            />
            {/* Tag Pills Preview */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '6px', minHeight: '20px' }}>
              {parsedFrameCounts.map((val, idx) => (
                <span key={idx} style={{
                  fontSize: '10px',
                  fontWeight: 600,
                  color: '#38bdf8',
                  backgroundColor: 'rgba(56, 189, 248, 0.1)',
                  border: '1px solid rgba(56, 189, 248, 0.3)',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  fontFamily: 'monospace'
                }}>
                  {val} frames
                </span>
              ))}
            </div>
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#cbd5e1' }}>
                Blur Thresholds
              </label>
              <span style={{ fontSize: '10px', color: '#a78bfa', fontWeight: 500 }}>
                {parsedBlurThresholds.length} value{parsedBlurThresholds.length > 1 ? 's' : ''}
              </span>
            </div>
            <input
              type="text"
              value={blurThresholdsInput}
              onChange={(e) => setBlurThresholdsInput(e.target.value)}
              placeholder="e.g. 30, 50, 80"
              disabled={isUploading}
              style={{
                width: '100%',
                backgroundColor: 'rgba(15, 23, 42, 0.6)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                borderRadius: '8px',
                padding: '8px 10px',
                fontSize: '13px',
                color: '#f8fafc',
                outline: 'none',
                boxSizing: 'border-box'
              }}
            />
            {/* Tag Pills Preview */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '6px', minHeight: '20px' }}>
              {parsedBlurThresholds.map((val, idx) => (
                <span key={idx} style={{
                  fontSize: '10px',
                  fontWeight: 600,
                  color: '#a78bfa',
                  backgroundColor: 'rgba(167, 139, 250, 0.1)',
                  border: '1px solid rgba(167, 139, 250, 0.3)',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  fontFamily: 'monospace'
                }}>
                  blur={val}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div style={{
          marginTop: '12px',
          padding: '10px 12px',
          backgroundColor: 'rgba(15, 23, 42, 0.5)',
          borderRadius: '8px',
          border: '1px solid rgba(255, 255, 255, 0.06)',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px'
        }}>
          <div style={{ fontSize: '11px', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '12px' }}>💡</span>
            <span>
              <strong>Multiple Values Tip:</strong> Enter comma-separated values (e.g. <code style={{ color: '#38bdf8', backgroundColor: 'rgba(0,0,0,0.3)', padding: '1px 4px', borderRadius: '3px' }}>100, 200</code>) to run a parameter sweep matrix.
            </span>
          </div>
          
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '4px', borderTop: '1px solid rgba(255, 255, 255, 0.05)' }}>
            <span style={{ fontSize: '11px', color: '#cbd5e1' }}>
              Execution Grid: <strong>{parsedFrameCounts.length}</strong> frame count{parsedFrameCounts.length > 1 ? 's' : ''} × <strong>{parsedBlurThresholds.length}</strong> blur threshold{parsedBlurThresholds.length > 1 ? 's' : ''}
            </span>
            <span style={{
              fontSize: '11px',
              fontWeight: 600,
              color: totalPipelines > 1 ? '#38bdf8' : '#94a3b8',
              backgroundColor: totalPipelines > 1 ? 'rgba(56, 189, 248, 0.15)' : 'rgba(255, 255, 255, 0.05)',
              padding: '2px 8px',
              borderRadius: '12px',
              border: totalPipelines > 1 ? '1px solid rgba(56, 189, 248, 0.3)' : '1px solid rgba(255, 255, 255, 0.1)'
            }}>
              {totalPipelines} {totalPipelines === 1 ? 'Pipeline' : 'Pipelines'} Total
            </span>
          </div>
        </div>
      </div>

      <BaseUploader
        onFilesAdded={handleFilesAdded}
        fileGroups={[
          {
            label: 'Videos:',
            files: videoFiles,
            onRemove: handleRemoveVideo
          },
          {
            label: 'Metadata Files:',
            files: metadataFiles,
            onRemove: handleRemoveMetadata,
            showIcon: false
          }
        ]}
        isUploading={isUploading}
        progress={progress}
        fileProgress={fileProgress}
        uploadFailed={uploadFailed}
        onStartUpload={handleStartUpload}
        onReset={handleReset}
        dropzoneText="Drag and drop your videos & metadata here"
        dropzoneSubtext="or click to browse files, or add a full folder"
      />
    </div>
  );
};

export default VideoUploader;


