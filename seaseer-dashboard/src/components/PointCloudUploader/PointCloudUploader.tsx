import React, { useState, useRef, useCallback } from 'react';
import * as tus from 'tus-js-client';
import './PointCloudUploader.css';

export interface PointCloudUploaderProps {
  onUploadSuccess?: (fileIds: string[]) => void;
  onUploadError?: (error: Error) => void;
  onProgress?: (percentage: number) => void;
  chunkSize?: number; // In bytes, default 5MB. Note: tus handles chunking natively, but can be configured.
  apiUrl?: string;
  tusEndpoint?: string;
  simulateDisconnectAt?: number; // percentage (0-100) to simulate disconnect
}

const DEFAULT_CHUNK_SIZE = 5 * 1024 * 1024; // 5MB

export const PointCloudUploader: React.FC<PointCloudUploaderProps> = ({
  onUploadSuccess,
  onUploadError,
  onProgress,
  chunkSize = DEFAULT_CHUNK_SIZE,
  tusEndpoint = import.meta.env.VITE_TUS_URL || 'http://localhost:8080/files/',
  simulateDisconnectAt
}) => {
  const [pointCloudFiles, setPointCloudFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [fileProgress, setFileProgress] = useState<Record<string, number>>({});
  const [dragActive, setDragActive] = useState(false);

  const [fileIds, setFileIds] = useState<Record<string, string>>({});

  const [uploadFailed, setUploadFailed] = useState<boolean>(false);
  const triggeredDisconnects = useRef<Set<number>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);
  const dirInputRef = useRef<HTMLInputElement>(null);
  
  const uploadsRef = useRef<Record<string, tus.Upload>>({});
  const bytesUploadedRef = useRef<Record<string, number>>({});
  const dragCounter = useRef(0);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isUploading || progress === 100) return;

    if (e.type === "dragenter") {
      dragCounter.current += 1;
      setDragActive(true);
    } else if (e.type === "dragleave") {
      dragCounter.current -= 1;
      if (dragCounter.current === 0) {
        setDragActive(false);
      }
    } else if (e.type === "dragover") {
      setDragActive(true);
    }
  }, [isUploading, progress]);

  const processSelectedFiles = (selectedFiles: FileList | File[]) => {
    const validExtensions = ['.las', '.laz', '.ply'];
    const newFiles: File[] = [];

    Array.from(selectedFiles).forEach(f => {
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
      setProgress(0);
    } else {
      alert("Please upload .las, .laz, or .ply files");
    }
  };

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setDragActive(false);

    if (e.dataTransfer.items) {
      const newFiles: File[] = [];
      const traverseFileTree = async (item: any, path: string = '') => {
        return new Promise<void>((resolve) => {
          if (item.isFile) {
            item.file((file: File) => {
              newFiles.push(file);
              resolve();
            });
          } else if (item.isDirectory) {
            const dirReader = item.createReader();
            dirReader.readEntries(async (entries: any[]) => {
              const promises = entries.map(entry => traverseFileTree(entry, path + item.name + "/"));
              await Promise.all(promises);
              resolve();
            });
          } else {
            resolve();
          }
        });
      };

      const promises = [];
      for (let i = 0; i < e.dataTransfer.items.length; i++) {
        const item = e.dataTransfer.items[i].webkitGetAsEntry();
        if (item) promises.push(traverseFileTree(item));
      }
      await Promise.all(promises);
      if (newFiles.length > 0) {
        processSelectedFiles(newFiles);
      }
    } else if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processSelectedFiles(e.dataTransfer.files);
    }
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (e.target.files && e.target.files.length > 0) {
      processSelectedFiles(e.target.files);
    }
    // Reset input so the same files can be selected again
    e.target.value = '';
  };

  const onButtonClick = () => {
    if (!isUploading && progress < 100) {
      inputRef.current?.click();
    }
  };

  const onDirButtonClick = () => {
    if (!isUploading && progress < 100) {
      dirInputRef.current?.click();
    }
  };

  const removeFile = async (indexToRemove: number) => {
    const fileToRemove = pointCloudFiles[indexToRemove];
    if (fileToRemove) {
      const upload = uploadsRef.current[fileToRemove.name];
      if (upload) {
        upload.abort(true).catch(err => console.error("Failed to abort upload:", err));
        delete uploadsRef.current[fileToRemove.name];
      }
      setFileIds(prev => {
        const newMap = { ...prev };
        delete newMap[fileToRemove.name];
        return newMap;
      });
    }
    setPointCloudFiles(prev => prev.filter((_, index) => index !== indexToRemove));
  };

  const resetState = async (cancelUpload: boolean = true) => {
    if (cancelUpload) {
      for (const upload of Object.values(uploadsRef.current)) {
        upload.abort(true).catch(err => console.error("Failed to abort upload:", err));
      }
    }
    
    uploadsRef.current = {};
    bytesUploadedRef.current = {};
    setPointCloudFiles([]);
    setFileIds({});
    setProgress(0);
    setFileProgress({});
    setIsUploading(false);
    setUploadFailed(false);
    triggeredDisconnects.current.clear();
    if (inputRef.current) {
      inputRef.current.value = '';
    }
  };

  const startUpload = async (isResume = false) => {
    if (pointCloudFiles.length === 0) return;
    setIsUploading(true);
    setUploadFailed(false);

    if (!isResume) {
      setProgress(0);
    }

    const totalSize = pointCloudFiles.reduce((acc, f) => acc + f.size, 0);
    if (!isResume) {
      bytesUploadedRef.current = {};
    }
    const newFileIds = { ...fileIds };

    const updateOverallProgress = () => {
      let totalUploadedBytes = 0;
      for (const f of pointCloudFiles) {
        totalUploadedBytes += bytesUploadedRef.current[f.name] || 0;
      }
      if (totalSize > 0) {
        const overall = Math.min(100, Math.round((totalUploadedBytes / totalSize) * 100));
        setProgress(overall);
        if (onProgress) onProgress(overall);
      }
    };

    try {
      const promises = pointCloudFiles.map(file => {
        return new Promise<void>((resolve, reject) => {
          // Robust fingerprinting with prefix to prevent collisions between different upload types
          const fingerprint = `pc-${file.name}-${file.size}-${file.lastModified}`;
          
          const upload = new tus.Upload(file, {
            endpoint: tusEndpoint,
            retryDelays: [0, 1000, 3000, 5000, 10000, 20000, 60000],
            metadata: {
              filename: file.name,
              filetype: file.type || 'application/octet-stream',
              upload_type: 'pointcloud'
            },
            chunkSize,
            addRequestId: true,
            fingerprint: () => Promise.resolve(fingerprint),
            onError: (error) => {
              console.error("Upload failed:", error);
              reject(error);
            },
            onProgress: (bytesUploaded, bytesTotal) => {
              bytesUploadedRef.current[file.name] = bytesUploaded;
              setFileProgress(prev => ({
                ...prev,
                [file.name]: bytesTotal > 0 ? Math.min(100, Math.round((bytesUploaded / bytesTotal) * 100)) : 100
              }));
              updateOverallProgress();

              if (simulateDisconnectAt !== undefined && simulateDisconnectAt > 0) {
                const currentOverall = Math.round(
                  (Object.values(bytesUploadedRef.current).reduce((a, b) => a + b, 0) / totalSize) * 100
                );
                if (currentOverall >= simulateDisconnectAt && !triggeredDisconnects.current.has(simulateDisconnectAt)) {
                  triggeredDisconnects.current.add(simulateDisconnectAt);
                  upload.abort();
                  reject(new Error(`Simulated network disconnect at ${currentOverall}%`));
                }
              }
            },
            onSuccess: () => {
              bytesUploadedRef.current[file.name] = file.size;
              updateOverallProgress();
              
              if (upload.url) {
                const parts = upload.url.split('/');
                const id = parts[parts.length - 1];
                newFileIds[file.name] = id;
              }
              resolve();
            }
          });

          uploadsRef.current[file.name] = upload;

          upload.findPreviousUploads().then((previousUploads) => {
            if (previousUploads.length > 0) {
              upload.resumeFromPreviousUpload(previousUploads[0]);
            }
            upload.start();
          }).catch(() => {
              // If finding previous uploads fails, fallback to starting fresh
              upload.start();
          });
        });
      });

      await Promise.all(promises);

      setFileIds(newFileIds);
      setIsUploading(false);
      setProgress(100);
      setUploadFailed(false);
      triggeredDisconnects.current.clear();

      if (onUploadSuccess && Object.keys(newFileIds).length > 0) {
        onUploadSuccess(Object.values(newFileIds));
      }

    } catch (err: any) {
      setIsUploading(false);
      setUploadFailed(true);
      if (onUploadError) {
        onUploadError(err instanceof Error ? err : new Error('Upload failed'));
      }
    }
  };

  return (
    <div
      className="vu-container"
      onDragEnter={handleDrag}
      onDragLeave={handleDrag}
      onDragOver={handleDrag}
      onDrop={handleDrop}
      style={{ position: 'relative' }}
    >
      {dragActive && !isUploading && progress < 100 && (
        <div
          style={{
            position: 'absolute',
            top: 0, bottom: 0, left: 0, right: 0,
            zIndex: 9999,
            backgroundColor: 'rgba(96, 165, 250, 0.1)',
            border: '2px dashed #60a5fa',
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backdropFilter: 'blur(2px)',
            pointerEvents: 'none'
          }}
        >
          <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#60a5fa', pointerEvents: 'none', backgroundColor: '#1f2937', padding: '12px 24px', borderRadius: '8px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}>
            Drop files to add them
          </div>
        </div>
      )}
      {pointCloudFiles.length === 0 ? (
        <div
          className={`vu-dropzone ${dragActive ? 'active' : ''}`}
          onClick={onButtonClick}
        >
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".las,.laz,.ply"
            onChange={handleChange}
            style={{ display: 'none' }}
          />
          <input
            ref={dirInputRef}
            type="file"
            multiple
            // @ts-ignore
            webkitdirectory="true"
            directory="true"
            onChange={handleChange}
            style={{ display: 'none' }}
          />
          <div className="vu-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="17 8 12 3 7 8"></polyline>
              <line x1="12" y1="3" x2="12" y2="15"></line>
            </svg>
          </div>
          <div className="vu-text">Drag and drop your PointClouds here</div>
          <div className="vu-subtext">or click to browse (.las, .laz, .ply), or add a full folder</div>
        </div>
      ) : (
        <div className="vu-file-info">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
            <div style={{ fontSize: '14px', fontWeight: 600, color: '#9ca3af' }}>PointClouds:</div>
            {pointCloudFiles.map((f, index) => (
              <div key={index} className="vu-filename" style={{ display: 'flex', flexDirection: 'column', gap: '4px', padding: '6px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect>
                      <line x1="7" y1="2" x2="7" y2="22"></line>
                      <line x1="17" y1="2" x2="17" y2="22"></line>
                      <line x1="2" y1="12" x2="22" y2="12"></line>
                      <line x1="2" y1="7" x2="7" y2="7"></line>
                      <line x1="2" y1="17" x2="7" y2="17"></line>
                      <line x1="17" y1="17" x2="22" y2="17"></line>
                      <line x1="17" y1="7" x2="22" y2="7"></line>
                    </svg>
                    <span>{f.name}</span>
                  </div>
                  {!isUploading && progress < 100 && (
                    <button
                      onClick={() => removeFile(index)}
                      style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}
                    >
                      X
                    </button>
                  )}
                </div>
                {fileProgress[f.name] !== undefined && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ width: '100%', backgroundColor: '#374151', height: '4px', borderRadius: '2px', overflow: 'hidden' }}>
                      <div style={{ width: `${fileProgress[f.name]}%`, backgroundColor: '#3b82f6', height: '100%', transition: 'width 0.3s ease' }}></div>
                    </div>
                    <span style={{ fontSize: '10px', color: '#9ca3af', minWidth: '24px', textAlign: 'right' }}>{fileProgress[f.name]}%</span>
                  </div>
                )}
              </div>
            ))}
          </div>

          {!isUploading && progress < 100 && (
            <div style={{ marginTop: '10px', display: 'flex', justifyContent: 'center', gap: '10px' }}>
              <button
                onClick={onButtonClick}
                style={{ background: 'none', border: '1px dashed #4b5563', color: '#9ca3af', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}
              >
                + Add files
              </button>
              <button
                onClick={onDirButtonClick}
                style={{ background: 'none', border: '1px dashed #4b5563', color: '#9ca3af', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}
              >
                + Add folder
              </button>
              <input
                ref={inputRef}
                type="file"
                multiple
                accept=".las,.laz,.ply"
                onChange={handleChange}
                style={{ display: 'none' }}
              />
              <input
                ref={dirInputRef}
                type="file"
                multiple
                // @ts-ignore
                webkitdirectory="true"
                directory="true"
                onChange={handleChange}
                style={{ display: 'none' }}
              />
            </div>
          )}

          <div className="vu-progress-bar-container" style={{ marginTop: '16px' }}>
            <div
              className="vu-progress-bar"
              style={{ width: `${progress}%` }}
            ></div>
          </div>
          <div className="vu-progress-text">{progress}% Uploaded (Total)</div>

          <div className="vu-actions">
            {!isUploading && progress < 100 && !uploadFailed && (
              <>
                <button className="vu-button" onClick={() => startUpload(false)}>
                  Start Upload
                </button>
                <button className="vu-button vu-button-danger" onClick={() => resetState(true)}>
                  Cancel
                </button>
              </>
            )}

            {!isUploading && uploadFailed && (
              <>
                <button className="vu-button" style={{ backgroundColor: '#f59e0b', boxShadow: '0 4px 6px -1px rgba(245, 158, 11, 0.3)' }} onClick={() => startUpload(true)}>
                  Resume Upload
                </button>
                <button className="vu-button vu-button-danger" onClick={() => resetState(true)}>
                  Cancel
                </button>
              </>
            )}

            {isUploading && (
              <button className="vu-button" disabled>
                <svg className="animate-spin" style={{ animation: 'spin 1s linear infinite', marginRight: '8px' }} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="2" x2="12" y2="6"></line>
                  <line x1="12" y1="18" x2="12" y2="22"></line>
                  <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line>
                  <line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line>
                  <line x1="2" y1="12" x2="6" y2="12"></line>
                  <line x1="18" y1="12" x2="22" y2="12"></line>
                  <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line>
                  <line x1="16.24" y1="4.93" x2="19.07" y2="7.76"></line>
                </svg>
                <style>{`@keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
                Uploading...
              </button>
            )}

            {progress === 100 && (
              <button className="vu-button vu-button-success" onClick={() => resetState(false)}>
                Upload Another
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default PointCloudUploader;
