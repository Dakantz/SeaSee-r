import React, { useState } from 'react';
import { BaseUploader } from '../common/BaseUploader';
import { useTusUpload } from '../common/useTusUpload';
import type { TusUploadConfig } from '../common/useTusUpload';

export interface PointCloudUploaderProps {
  onUploadSuccess?: (fileIds: string[]) => void;
  onUploadError?: (error: Error) => void;
  onProgress?: (percentage: number) => void;
  chunkSize?: number; // In bytes, default 5MB. Note: tus handles chunking natively, but can be configured.
  apiUrl?: string;
  tusEndpoint?: string;
}

const DEFAULT_CHUNK_SIZE = 5 * 1024 * 1024; // 5MB

export const PointCloudUploader: React.FC<PointCloudUploaderProps> = ({
  onUploadSuccess,
  onUploadError,
  onProgress,
  chunkSize = DEFAULT_CHUNK_SIZE,
  tusEndpoint = import.meta.env.VITE_TUS_URL || 'http://localhost:8080/files/'
}) => {
  const [pointCloudFiles, setPointCloudFiles] = useState<File[]>([]);

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
      if (onUploadSuccess && Object.keys(fileIds).length > 0) {
        onUploadSuccess(Object.values(fileIds));
      }
    },
    onUploadError,
    onProgress
  });

  const handleFilesAdded = (files: File[]) => {
    const validExtensions = ['.las', '.laz', '.ply'];
    const newFiles: File[] = [];

    files.forEach(f => {
      const ext = f.name.slice(f.name.lastIndexOf('.')).toLowerCase();
      if (validExtensions.includes(ext)) {
        newFiles.push(f);
      }
    });

    if (newFiles.length > 0) {
      setPointCloudFiles(prev => {
        const existingNames = new Set(prev.map(f => f.name));
        const filtered = newFiles.filter(f => !existingNames.has(f.name));
        return [...prev, ...filtered];
      });
    } else if (files.length > 0) {
      alert("Please upload .las, .laz, or .ply files");
    }
  };

  const handleRemoveFile = (index: number) => {
    const file = pointCloudFiles[index];
    if (file) {
      tusRemoveFile(file.name);
    }
    setPointCloudFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleReset = (cancel: boolean) => {
    tusResetState(cancel);
    setPointCloudFiles([]);
  };

  const handleStartUpload = (isResume: boolean) => {
    if (pointCloudFiles.length === 0) return;

    const configs: TusUploadConfig[] = pointCloudFiles.map(file => ({
      file,
      metadata: { upload_type: 'pointcloud' },
      fingerprintPrefix: 'pc'
    }));

    tusStartUpload(configs, isResume);
  };

  return (
    <BaseUploader
      onFilesAdded={handleFilesAdded}
      fileGroups={[
        {
          label: 'PointClouds:',
          files: pointCloudFiles,
          onRemove: handleRemoveFile
        }
      ]}
      isUploading={isUploading}
      progress={progress}
      fileProgress={fileProgress}
      uploadFailed={uploadFailed}
      onStartUpload={handleStartUpload}
      onReset={handleReset}
      accept=".las,.laz,.ply"
      dropzoneText="Drag and drop your PointClouds here"
      dropzoneSubtext="or click to browse (.las, .laz, .ply), or add a full folder"
    />
  );
};

export default PointCloudUploader;
