import React, { useState } from 'react';
import { BaseUploader } from '../common/BaseUploader';
import { useTusUpload, formatUuid } from '../common/useTusUpload';
import type { TusUploadConfig } from '../common/useTusUpload';
import { JobProgress } from '../JobProgress';
import { createJob } from '../../client';

export interface PointCloudUploaderProps {
  onUploadSuccess?: (fileIds: string[]) => void;
  onUploadError?: (error: Error) => void;
  onProgress?: (percentage: number) => void;
  onJobCreated?: (jobId: string) => void;
  jobId?: string;
  chunkSize?: number; // In bytes, default 5MB. Note: tus handles chunking natively, but can be configured.
  apiUrl?: string;
  tusEndpoint?: string;
}

const DEFAULT_CHUNK_SIZE = 5 * 1024 * 1024; // 5MB

export const PointCloudUploader: React.FC<PointCloudUploaderProps> = ({
  onUploadSuccess,
  onUploadError,
  onProgress,
  onJobCreated,
  jobId: initialJobId,
  chunkSize = DEFAULT_CHUNK_SIZE,
  tusEndpoint = import.meta.env.VITE_TUS_URL || 'http://localhost:8080/files/'
}) => {
  const [pointCloudFiles, setPointCloudFiles] = useState<File[]>([]);
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
      const fileIds = Object.values(fileIdsMap);
      if (onUploadSuccess && fileIds.length > 0) {
        onUploadSuccess(fileIds);
      }

      // Automatically create a job for each uploaded pointcloud file
      try {
        const createdJobIds: string[] = [];
        const newJobFileMap: Record<string, string> = {};
        for (const file of pointCloudFiles) {
          const rawFileId = fileIdsMap[file.name];
          const fileId = formatUuid(rawFileId);
          const ext = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : '';
          const safeFilename = fileId ? `${fileId}${ext}` : file.name;

          const jobRes = await createJob({
            body: {
              name: `PointCloud Ingestion: ${file.name}`,
              payload: {
                task_type: 'pointcloud_upload',
                filename: file.name,
                safe_filename: safeFilename,
                total_bytes: file.size,
                file_id: fileId
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
    setActiveJobIds([]);
    setJobFileMap({});
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

  const allJobIds = Array.from(
    new Set([...(initialJobId ? [initialJobId] : []), ...activeJobIds])
  );

  return (
    <div style={{ width: '100%' }}>
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

      {allJobIds.length > 0 && (
        <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {allJobIds.map(id => {
            const fileName = jobFileMap[id];
            const title = fileName ? `Point Cloud Processing Job (${fileName})` : undefined;
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

export default PointCloudUploader;

