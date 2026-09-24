import { useState, useRef, useCallback } from 'react';
import * as tus from 'tus-js-client';

export interface TusUploadConfig {
  file: File;
  metadata: Record<string, string>;
  fingerprintPrefix?: string;
}

export function formatUuid(id: string): string {
  if (!id) return id;
  const clean = id.replace(/-/g, '');
  if (clean.length === 32) {
    return `${clean.slice(0, 8)}-${clean.slice(8, 12)}-${clean.slice(12, 16)}-${clean.slice(16, 20)}-${clean.slice(20)}`;
  }
  return id;
}

export interface UseTusUploadOptions {
  tusEndpoint: string;
  chunkSize: number;
  onUploadSuccess?: (fileIds: Record<string, string>) => void;
  onUploadError?: (error: Error) => void;
  onProgress?: (percentage: number) => void;
}

export const useTusUpload = ({
  tusEndpoint,
  chunkSize,
  onUploadSuccess,
  onUploadError,
  onProgress
}: UseTusUploadOptions) => {
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [fileProgress, setFileProgress] = useState<Record<string, number>>({});
  const [uploadFailed, setUploadFailed] = useState(false);

  const uploadsRef = useRef<Record<string, tus.Upload>>({});
  const bytesUploadedRef = useRef<Record<string, number>>({});
  
  // We need to keep track of file IDs mapping by filename
  const fileIdsRef = useRef<Record<string, string>>({});

  const updateOverallProgress = useCallback((totalSize: number) => {
    let totalUploadedBytes = 0;
    for (const bytes of Object.values(bytesUploadedRef.current)) {
      totalUploadedBytes += bytes;
    }
    if (totalSize > 0) {
      const overall = Math.min(100, Math.round((totalUploadedBytes / totalSize) * 100));
      setProgress(overall);
      if (onProgress) onProgress(overall);
    }
  }, [onProgress]);

  const resetState = useCallback((cancelUpload: boolean = true) => {
    if (cancelUpload) {
      for (const upload of Object.values(uploadsRef.current)) {
        upload.abort(true).catch(err => console.error("Failed to abort upload:", err));
      }
    }
    uploadsRef.current = {};
    bytesUploadedRef.current = {};
    fileIdsRef.current = {};
    setProgress(0);
    setFileProgress({});
    setIsUploading(false);
    setUploadFailed(false);
  }, []);

  const removeFile = useCallback((filename: string) => {
    const upload = uploadsRef.current[filename];
    if (upload) {
      upload.abort(true).catch(err => console.error("Failed to abort upload:", err));
      delete uploadsRef.current[filename];
    }
    delete bytesUploadedRef.current[filename];
    delete fileIdsRef.current[filename];
    setFileProgress(prev => {
      const newMap = { ...prev };
      delete newMap[filename];
      return newMap;
    });
  }, []);

  const startUpload = useCallback(async (
    filesConfig: TusUploadConfig[],
    isResume: boolean = false
  ) => {
    if (filesConfig.length === 0) return;
    setIsUploading(true);
    setUploadFailed(false);

    if (!isResume) {
      setProgress(0);
      bytesUploadedRef.current = {};
    }

    const totalSize = filesConfig.reduce((acc, conf) => acc + conf.file.size, 0);

    const createTusUpload = (config: TusUploadConfig, isFallbackFreshUpload = false) => {
      const { file, metadata, fingerprintPrefix } = config;
      return new Promise<void>((resolve, reject) => {
        const prefix = fingerprintPrefix || 'file';
        const fingerprint = `${prefix}-${file.name}-${file.size}-${file.lastModified}`;

        let currentUpload: tus.Upload;

        currentUpload = new tus.Upload(file, {
          endpoint: tusEndpoint,
          retryDelays: [0, 1000, 3000, 5000, 10000, 20000, 60000],
          metadata: {
            filename: file.name,
            filetype: file.type || 'application/octet-stream',
            ...metadata
          },
          chunkSize,
          addRequestId: true, // Only pointcloud had this before, but it's safe generally
          fingerprint: () => Promise.resolve(fingerprint),
          onError: async (error: any) => {
            console.error("Upload failed:", error);
            // If resume failed (e.g. invalid cached URL, 404, or connection error to old URL),
            // clean up the stale localStorage entry and attempt a fresh upload once.
            if (!isFallbackFreshUpload) {
              try {
                const prevList = await currentUpload.findPreviousUploads();
                for (const p of prevList) {
                  if (p.urlStorageKey && typeof localStorage !== 'undefined') {
                    localStorage.removeItem(p.urlStorageKey);
                  }
                }
              } catch (_) {}
              return createTusUpload(config, true).then(resolve).catch(reject);
            }
            reject(error);
          },
          onProgress: (bytesUploaded, bytesTotal) => {
            bytesUploadedRef.current[file.name] = bytesUploaded;
            setFileProgress(prev => ({
              ...prev,
              [file.name]: bytesTotal > 0 ? Math.min(100, Math.round((bytesUploaded / bytesTotal) * 100)) : 100
            }));
            updateOverallProgress(totalSize);
          },
          onSuccess: () => {
            bytesUploadedRef.current[file.name] = file.size;
            updateOverallProgress(totalSize);
            
            if (currentUpload.url) {
              const parts = currentUpload.url.split('/');
              const id = parts[parts.length - 1];
              fileIdsRef.current[file.name] = formatUuid(id);
            }
            resolve();
          }
        });

        uploadsRef.current[file.name] = currentUpload;

        if (!isFallbackFreshUpload) {
          currentUpload.findPreviousUploads().then((previousUploads) => {
            if (previousUploads.length > 0) {
              const prev = previousUploads[0];
              // Normalize previous upload URL to match current tusEndpoint (heals port or host mismatches)
              if (prev.uploadUrl) {
                const parts = prev.uploadUrl.split('/');
                const id = parts[parts.length - 1];
                if (id) {
                  const base = tusEndpoint.endsWith('/') ? tusEndpoint : `${tusEndpoint}/`;
                  prev.uploadUrl = `${base}${id}`;
                }
              }
              currentUpload.resumeFromPreviousUpload(prev);
            }
            currentUpload.start();
          }).catch(() => {
            currentUpload.start();
          });
        } else {
          currentUpload.start();
        }
      });
    };

    try {
      const uploadPromises = filesConfig.map(conf => createTusUpload(conf));
      await Promise.all(uploadPromises);

      setIsUploading(false);
      setProgress(100);
      setUploadFailed(false);

      if (onUploadSuccess && Object.keys(fileIdsRef.current).length > 0) {
        onUploadSuccess({ ...fileIdsRef.current });
      }

    } catch (err: any) {
      setIsUploading(false);
      setUploadFailed(true);
      if (onUploadError) {
        onUploadError(err instanceof Error ? err : new Error('Upload failed'));
      }
    }
  }, [tusEndpoint, chunkSize, onUploadSuccess, onUploadError, updateOverallProgress]);

  return {
    isUploading,
    progress,
    fileProgress,
    uploadFailed,
    startUpload,
    resetState,
    removeFile,
    fileIds: fileIdsRef.current
  };
};
