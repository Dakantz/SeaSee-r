import React, { useState } from 'react';
import { BaseUploader } from '../common/BaseUploader';
import { useTusUpload, formatUuid } from '../common/useTusUpload';
import type { TusUploadConfig } from '../common/useTusUpload';
import { JobProgress } from '../JobProgress';
import { createJob } from '../../client';

export interface VideoUploaderProps {
  onUploadSuccess?: (fileIds: string[]) => void;
  onUploadError?: (error: Error) => void;
  onProgress?: (percentage: number) => void;
  onJobCreated?: (jobId: string) => void;
  jobId?: string;
  chunkSize?: number; // In bytes, default 5MB
  apiUrl?: string;
  tusEndpoint?: string;
}

const DEFAULT_CHUNK_SIZE = 5 * 1024 * 1024; // 5MB

export const VideoUploader: React.FC<VideoUploaderProps> = ({
  onUploadSuccess,
  onUploadError,
  onProgress,
  onJobCreated,
  jobId: initialJobId,
  chunkSize = DEFAULT_CHUNK_SIZE,
  tusEndpoint = import.meta.env.VITE_TUS_URL || 'http://localhost:8080/files/'
}) => {
  const [videoFiles, setVideoFiles] = useState<File[]>([]);
  const [metadataFiles, setMetadataFiles] = useState<File[]>([]);
  const [batchId, setBatchId] = useState<string>('');
  const [activeJobIds, setActiveJobIds] = useState<string[]>([]);
  const [jobFileMap, setJobFileMap] = useState<Record<string, string>>({});

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
      if (onUploadSuccess && videoIds.length > 0) {
        onUploadSuccess(videoIds);
      }

      // Automatically create a job for each uploaded video file
      try {
        const createdJobIds: string[] = [];
        const newJobFileMap: Record<string, string> = {};
        for (const file of videoFiles) {
          const rawFileId = fileIdsMap[file.name];
          const fileId = formatUuid(rawFileId);
          const ext = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : '';
          const safeFilename = fileId ? `${fileId}${ext}` : file.name;

          const jobRes = await createJob({
            body: {
              name: `Video Reconstruction (PySLAM): ${file.name}`,
              task_type: 'video_reconstruction',
              payload: {
                filename: file.name,
                safe_filename: safeFilename,
                total_bytes: file.size,
                file_id: fileId,
                batch_id: batchId,
                video_ids: videoIds,
                video_files: videoFiles.map(v => v.name),
                metadata_files: metadataFiles.map(m => m.name)
              }
            }
          });

          if (jobRes.data?.id) {
            createdJobIds.push(jobRes.data.id);
            newJobFileMap[jobRes.data.id] = file.name;
            if (onJobCreated) {
              onJobCreated(jobRes.data.id);
            }
          }
        }
        if (createdJobIds.length > 0) {
          setActiveJobIds(prev => Array.from(new Set([...prev, ...createdJobIds])));
          setJobFileMap(prev => ({ ...prev, ...newJobFileMap }));
        }
      } catch (err) {
        console.warn('Could not auto-create background job:', err);
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
    setBatchId('');
    setActiveJobIds([]);
    setJobFileMap({});
  };

  const handleStartUpload = (isResume: boolean) => {
    if (videoFiles.length === 0) return;

    let currentBatchId = batchId;
    if (!isResume || !currentBatchId) {
      currentBatchId = crypto.randomUUID();
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

  const allJobIds = Array.from(
    new Set([...(initialJobId ? [initialJobId] : []), ...activeJobIds])
  );

  return (
    <div style={{ width: '100%' }}>
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

      {allJobIds.length > 0 && (
        <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {allJobIds.map(id => {
            const fileName = jobFileMap[id];
            const title = fileName ? `Video Reconstruction Job (${fileName})` : undefined;
            return (
              <JobProgress
                key={id}
                jobId={id}
                onClose={() => setActiveJobIds(prev => prev.filter(jobId => jobId !== id))}
                title={title}
              />
            );
          })}
        </div>
      )}
    </div>
  );
};

export default VideoUploader;

