import React, { useState, useRef, useEffect } from 'react';
import { BaseUploader } from '../common/BaseUploader';
import { useTusUpload, formatUuid } from '../common/useTusUpload';
import type { TusUploadConfig } from '../common/useTusUpload';
import { calculateVideoTimestamps, DEBUG_VIDEO_TIMESTAMPS } from '../common/videoUtils';
import { generateTusdBatchId } from '../../client';
import { getTusEndpoint } from '../../utils/apiConfig';

export interface VideoUploaderProps {
  onUploadSuccess?: (fileIds: string[], batchId?: string) => void;
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

export const VideoUploader: React.FC<VideoUploaderProps> = ({
  onUploadSuccess,
  onUploadError,
  onProgress,
  chunkSize = DEFAULT_CHUNK_SIZE,
  tusEndpoint = getTusEndpoint()
}) => {
  const [videoFiles, setVideoFiles] = useState<File[]>([]);
  const [metadataFiles, setMetadataFiles] = useState<File[]>([]);
  const [batchId, setBatchId] = useState<string>('');
  const batchIdRef = useRef<string>(batchId);
  const videoFilesRef = useRef<File[]>(videoFiles);

  useEffect(() => {
    batchIdRef.current = batchId;
  }, [batchId]);

  useEffect(() => {
    videoFilesRef.current = videoFiles;
  }, [videoFiles]);

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
      const currentVideos = videoFilesRef.current.length > 0 ? videoFilesRef.current : videoFiles;
      const videoIds = currentVideos.map(v => formatUuid(fileIdsMap[v.name])).filter(Boolean);
      const activeBatchId = batchIdRef.current || batchId;

      // Do not automatically start the pipeline.
      // Instead, dispatch an event so the batch list updates and the user can launch when ready.
      window.dispatchEvent(new CustomEvent('batch-upload-completed', {
        detail: {
          batchId: activeBatchId,
          videoIds,
          fileIdsMap
        }
      }));

      if (onUploadSuccess && videoIds.length > 0) {
        onUploadSuccess(videoIds, activeBatchId);
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
      if (DEBUG_VIDEO_TIMESTAMPS) {
        console.log(
          '[VideoUploader] Video files selected/dropped:',
          newVideoFiles.map((f) => ({
            name: f.name,
            lastModifiedMs: f.lastModified,
            lastModifiedISO: new Date(f.lastModified).toISOString(),
            lastModifiedLocal: new Date(f.lastModified).toString(),
            sizeBytes: f.size,
          }))
        );
      }
      setVideoFiles(prev => {
        const existingNames = new Set(prev.map(f => f.name));
        const filtered = newVideoFiles.filter(f => !existingNames.has(f.name));
        const merged = [...prev, ...filtered];
        const sorted = merged.sort((a, b) => (a.lastModified || 0) - (b.lastModified || 0));
        videoFilesRef.current = sorted;
        return sorted;
      });
    }

    if (newMetadataFiles.length > 0) {
      setMetadataFiles(prev => {
        const existingNames = new Set(prev.map(f => f.name));
        const filtered = newMetadataFiles.filter(f => !existingNames.has(f.name));
        return [...prev, ...filtered];
      });
    }

    if ((newVideoFiles.length > 0 || newMetadataFiles.length > 0) && !batchIdRef.current) {
      generateTusdBatchId().then(res => {
        const id = res.data?.batch_id || res.data?.batchId;
        if (id) {
          const idStr = String(id);
          batchIdRef.current = idStr;
          setBatchId(idStr);
        }
      }).catch(err => {
        console.warn('Eager batchId generation failed, will retry on upload start:', err);
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

  const handleStartUpload = async (isResume: boolean) => {
    if (videoFiles.length === 0 && metadataFiles.length === 0) return;

    let currentBatchId = batchIdRef.current || batchId;
    if (!isResume || !currentBatchId) {
      try {
        const res = await generateTusdBatchId();
        if (res.data?.batch_id || res.data?.batchId) {
          currentBatchId = String(res.data.batch_id || res.data.batchId);
        }
      } catch (err) {
        console.error('Failed to fetch batch_id from backend:', err);
        onUploadError?.(err instanceof Error ? err : new Error('Failed to generate batch ID from backend'));
        return;
      }

      if (!currentBatchId) {
        const err = new Error('No batch ID returned from backend');
        console.error(err.message);
        onUploadError?.(err);
        return;
      }

      batchIdRef.current = currentBatchId;
      setBatchId(currentBatchId);
    }

    const configs: TusUploadConfig[] = [];

    // Sort all video files by modifieddatetime and calculate start/stop timestamps
    const videoMetadataList = await calculateVideoTimestamps(videoFiles);
    const sortedVideos = videoMetadataList.map(v => v.file);
    videoFilesRef.current = sortedVideos;
    setVideoFiles(sortedVideos);

    if (DEBUG_VIDEO_TIMESTAMPS) {
      console.log('[VideoUploader] Video timestamps ready for upload:');
      console.table(
        videoMetadataList.map((item) => ({
          fileName: item.file.name,
          lastModifiedMs: item.file.lastModified,
          lastModifiedISO: new Date(item.file.lastModified).toISOString(),
          durationSec: `${item.duration.toFixed(2)}s`,
          video_start_at: item.video_start_at,
          video_stop_at: item.video_stop_at,
        }))
      );
    }

    for (const item of videoMetadataList) {
      if (DEBUG_VIDEO_TIMESTAMPS) {
        console.log(`[VideoUploader] Upload metadata payload for "${item.file.name}":`, {
          upload_type: 'video',
          batch_id: currentBatchId,
          video_start_at: item.video_start_at,
          video_stop_at: item.video_stop_at,
        });
      }
      configs.push({
        file: item.file,
        metadata: {
          upload_type: 'video',
          batch_id: currentBatchId,
          video_start_at: item.video_start_at,
          video_stop_at: item.video_stop_at,
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
      {batchId && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 18px',
          backgroundColor: 'rgba(56, 189, 248, 0.08)',
          border: '1px solid rgba(56, 189, 248, 0.22)',
          borderRadius: '12px',
          color: '#cbd5e1'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '15px' }}>📦</span>
            <span style={{ fontWeight: 600, fontSize: '13px', color: '#f8fafc' }}>
              Target Upload Batch:
            </span>
            <span style={{
              fontFamily: 'monospace',
              fontSize: '12px',
              backgroundColor: 'rgba(15, 23, 42, 0.6)',
              padding: '2px 8px',
              borderRadius: '6px',
              color: '#38bdf8',
              border: '1px solid rgba(56, 189, 248, 0.3)'
            }}>
              {batchId}
            </span>
          </div>
          <span style={{ fontSize: '12px', color: '#94a3b8' }}>
            Files uploaded together will be saved to this batch
          </span>
        </div>
      )}


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


