import React, { useState, useRef, useCallback } from 'react';
import * as tus from 'tus-js-client';
import './VideoUploader.css';

export interface VideoUploaderProps {
  onUploadSuccess?: (fileIds: string[]) => void;
  onUploadError?: (error: Error) => void;
  onProgress?: (percentage: number) => void;
  chunkSize?: number; // In bytes, default 5MB
  apiUrl?: string;
  tusEndpoint?: string;
  simulateDisconnectAt?: number; // percentage (0-100) to simulate disconnect
}

const DEFAULT_CHUNK_SIZE = 5 * 1024 * 1024; // 5MB

export const VideoUploader: React.FC<VideoUploaderProps> = ({
  onUploadSuccess,
  onUploadError,
  onProgress,
  chunkSize = DEFAULT_CHUNK_SIZE,
  apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8000',
  tusEndpoint = import.meta.env.VITE_TUS_URL || 'http://localhost:8080/files/',
  simulateDisconnectAt
}) => {
  const [videoFiles, setVideoFiles] = useState<File[]>([]);
  const [metadataFiles, setMetadataFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [fileProgress, setFileProgress] = useState<Record<string, number>>({});
  const [dragActive, setDragActive] = useState(false);

  const [videoSafeFilenames, setVideoSafeFilenames] = useState<Record<string, string>>({});
  const [videoFileIds, setVideoFileIds] = useState<Record<string, string>>({});
  const [metadataSafeFilenames, setMetadataSafeFilenames] = useState<Record<string, string[]>>({});

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
    const newVideoFiles: File[] = [];
    const newMetadataFiles: File[] = [];

    Array.from(selectedFiles).forEach(f => {
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
      setProgress(0);
    }

    if (newMetadataFiles.length > 0) {
      setMetadataFiles(prev => {
        const existingNames = new Set(prev.map(f => f.name));
        const filtered = newMetadataFiles.filter(f => !existingNames.has(f.name));
        return [...prev, ...filtered];
      });
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
    // Reset input so the same files/folder can be selected again
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

  const removeVideoFile = async (indexToRemove: number) => {
    const fileToRemove = videoFiles[indexToRemove];
    if (fileToRemove) {
      const upload = uploadsRef.current[fileToRemove.name];
      if (upload) {
        upload.abort(true).catch(err => console.error("Failed to abort upload:", err));
        delete uploadsRef.current[fileToRemove.name];
      }
      
      if (videoSafeFilenames[fileToRemove.name]) {
        setVideoSafeFilenames(prev => {
          const newMap = { ...prev };
          delete newMap[fileToRemove.name];
          return newMap;
        });
        setVideoFileIds(prev => {
          const newMap = { ...prev };
          delete newMap[fileToRemove.name];
          return newMap;
        });
      }
    }
    setVideoFiles(prev => prev.filter((_, index) => index !== indexToRemove));
  };

  const removeMetadataFile = async (indexToRemove: number) => {
    const fileToRemove = metadataFiles[indexToRemove];
    if (fileToRemove) {
      const upload = uploadsRef.current[fileToRemove.name];
      if (upload) {
        upload.abort(true).catch(err => console.error("Failed to abort upload:", err));
        delete uploadsRef.current[fileToRemove.name];
      }

      if (metadataSafeFilenames[fileToRemove.name]) {
        setMetadataSafeFilenames(prev => {
          const newMap = { ...prev };
          delete newMap[fileToRemove.name];
          return newMap;
        });
      }
    }
    setMetadataFiles(prev => prev.filter((_, index) => index !== indexToRemove));
  };

  const resetState = async (cancelUpload: boolean = true) => {
    if (cancelUpload) {
      for (const upload of Object.values(uploadsRef.current)) {
        upload.abort(true).catch(err => console.error("Failed to abort upload:", err));
      }
    }

    uploadsRef.current = {};
    bytesUploadedRef.current = {};
    setVideoFiles([]);
    setMetadataFiles([]);
    setVideoSafeFilenames({});
    setVideoFileIds({});
    setMetadataSafeFilenames({});
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
    if (videoFiles.length === 0) return;
    setIsUploading(true);
    setUploadFailed(false);

    if (!isResume) {
      setProgress(0);
      bytesUploadedRef.current = {};
    }

    try {
      const currentVideoSafeFilenames = { ...videoSafeFilenames };
      const currentVideoFileIds = { ...videoFileIds };
      const currentMetadataSafeFilenames = { ...metadataSafeFilenames };

      // Initialize all videos locally by generating UUIDs
      for (const video of videoFiles) {
        if (!isResume || !currentVideoSafeFilenames[video.name]) {
          const file_id = crypto.randomUUID();
          const ext = video.name.split('.').pop() || '';
          const safeFilename = ext ? `${file_id}.${ext}` : file_id;
          
          currentVideoSafeFilenames[video.name] = safeFilename;
          currentVideoFileIds[video.name] = file_id;
        }
      }
      setVideoSafeFilenames(currentVideoSafeFilenames);
      setVideoFileIds(currentVideoFileIds);

      // Initialize all metadata files
      const activeVideoSafeFilenames = videoFiles
        .map(v => currentVideoSafeFilenames[v.name])
        .filter(Boolean)
        .join(',');

      if (activeVideoSafeFilenames) {
        for (const metaFile of metadataFiles) {
          if (!currentMetadataSafeFilenames[metaFile.name] || currentMetadataSafeFilenames[metaFile.name].length === 0) {
            currentMetadataSafeFilenames[metaFile.name] = activeVideoSafeFilenames.split(',');
          }
        }
        setMetadataSafeFilenames(currentMetadataSafeFilenames);
      }

      // TUS upload logic
      const totalSize = videoFiles.reduce((acc, f) => acc + f.size, 0) + metadataFiles.reduce((acc, f) => acc + f.size, 0);

      const updateOverallProgress = () => {
        let totalUploadedBytes = 0;
        for (const f of [...videoFiles, ...metadataFiles]) {
          totalUploadedBytes += bytesUploadedRef.current[f.name] || 0;
        }
        if (totalSize > 0) {
          const overall = Math.min(100, Math.round((totalUploadedBytes / totalSize) * 100));
          setProgress(overall);
          if (onProgress) onProgress(overall);
        }
      };

      const createTusUpload = (file: File, fileType: 'video' | 'video_metadata', additionalMetadata: Record<string, string>) => {
        return new Promise<void>((resolve, reject) => {
          const fingerprint = `${file.name}-${file.size}-${file.lastModified}`;
          
          const upload = new tus.Upload(file, {
            endpoint: tusEndpoint,
            retryDelays: [0, 1000, 3000, 5000, 10000, 20000, 60000],
            metadata: {
              filename: file.name,
              filetype: file.type || 'application/octet-stream',
              upload_type: fileType,
              ...additionalMetadata
            },
            chunkSize,
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
              upload.start();
          });
        });
      };

      const uploadPromises: Promise<void>[] = [];

      for (const video of videoFiles) {
        const safeFilename = currentVideoSafeFilenames[video.name];
        const fileId = currentVideoFileIds[video.name];
        if (safeFilename && fileId) {
          uploadPromises.push(createTusUpload(video, 'video', { safe_filename: safeFilename, file_id: fileId }));
        }
      }

      for (const metaFile of metadataFiles) {
        const safeFilenamesList = currentMetadataSafeFilenames[metaFile.name];
        if (safeFilenamesList && safeFilenamesList.length > 0) {
          uploadPromises.push(createTusUpload(metaFile, 'video_metadata', { video_safe_filenames: safeFilenamesList.join(',') }));
        }
      }

      await Promise.all(uploadPromises);

      setIsUploading(false);
      setProgress(100);
      setUploadFailed(false);
      triggeredDisconnects.current.clear();

      if (onUploadSuccess && Object.values(currentVideoFileIds).length > 0) {
        onUploadSuccess(Object.values(currentVideoFileIds));
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
      {videoFiles.length === 0 && metadataFiles.length === 0 ? (
        <div
          className={`vu-dropzone ${dragActive ? 'active' : ''}`}
          onClick={onButtonClick}
        >
          <input
            ref={inputRef}
            type="file"
            multiple
            onChange={handleChange}
            style={{ display: 'none' }}
          />
          <input
            ref={dirInputRef}
            type="file"
            multiple
            // @ts-ignore - directory attributes for folder selection
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
          <div className="vu-text">Drag and drop your videos & metadata here</div>
          <div className="vu-subtext">or click to browse files, or add a full folder</div>
        </div>
      ) : (
        <div className="vu-file-info">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
            <div style={{ fontSize: '14px', fontWeight: 600, color: '#9ca3af' }}>Videos:</div>
            {videoFiles.map((vf, index) => (
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
                    <span>{vf.name}</span>
                  </div>
                  {!isUploading && progress < 100 && (
                    <button
                      onClick={() => removeVideoFile(index)}
                      style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}
                    >
                      X
                    </button>
                  )}
                </div>
                {fileProgress[vf.name] !== undefined && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ width: '100%', backgroundColor: '#374151', height: '4px', borderRadius: '2px', overflow: 'hidden' }}>
                      <div style={{ width: `${fileProgress[vf.name]}%`, backgroundColor: '#3b82f6', height: '100%', transition: 'width 0.3s ease' }}></div>
                    </div>
                    <span style={{ fontSize: '10px', color: '#9ca3af', minWidth: '24px', textAlign: 'right' }}>{fileProgress[vf.name]}%</span>
                  </div>
                )}
              </div>
            ))}
          </div>

          {metadataFiles.length > 0 && (
            <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '5px' }}>
              <div style={{ fontSize: '14px', fontWeight: 600, color: '#9ca3af' }}>Metadata Files:</div>
              {metadataFiles.map((mf, index) => (
                <div key={index} className="vu-filename" style={{ display: 'flex', flexDirection: 'column', gap: '4px', padding: '6px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>{mf.name}</span>
                    {!isUploading && progress < 100 && (
                      <button
                        onClick={() => removeMetadataFile(index)}
                        style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}
                      >
                        X
                      </button>
                    )}
                  </div>
                  {fileProgress[mf.name] !== undefined && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{ width: '100%', backgroundColor: '#374151', height: '4px', borderRadius: '2px', overflow: 'hidden' }}>
                        <div style={{ width: `${fileProgress[mf.name]}%`, backgroundColor: '#3b82f6', height: '100%', transition: 'width 0.3s ease' }}></div>
                      </div>
                      <span style={{ fontSize: '10px', color: '#9ca3af', minWidth: '24px', textAlign: 'right' }}>{fileProgress[mf.name]}%</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

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

export default VideoUploader;
