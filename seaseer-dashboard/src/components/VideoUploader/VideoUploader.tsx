import React, { useState } from 'react';
import { BaseUploader } from '../common/BaseUploader';
import { useTusUpload } from '../common/useTusUpload';
import type { TusUploadConfig } from '../common/useTusUpload';

export interface VideoUploaderProps {
  onUploadSuccess?: (fileIds: string[]) => void;
  onUploadError?: (error: Error) => void;
  onProgress?: (percentage: number) => void;
  chunkSize?: number; // In bytes, default 5MB
  apiUrl?: string;
  tusEndpoint?: string;
}

const DEFAULT_CHUNK_SIZE = 5 * 1024 * 1024; // 5MB

export const VideoUploader: React.FC<VideoUploaderProps> = ({
  onUploadSuccess,
  onUploadError,
  onProgress,
  chunkSize = DEFAULT_CHUNK_SIZE,
  tusEndpoint = import.meta.env.VITE_TUS_URL || 'http://localhost:8080/files/'
}) => {
  const [videoFiles, setVideoFiles] = useState<File[]>([]);
  const [metadataFiles, setMetadataFiles] = useState<File[]>([]);

  const [batchId, setBatchId] = useState<string>('');

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
    onUploadSuccess: (fileIds) => {
      const videoIds = videoFiles.map(v => fileIds[v.name]).filter(Boolean);
      if (onUploadSuccess && videoIds.length > 0) {
        onUploadSuccess(videoIds);
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

  return (
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
  );
};

export default VideoUploader;
