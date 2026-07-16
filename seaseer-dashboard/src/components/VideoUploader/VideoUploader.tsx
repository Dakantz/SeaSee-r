import React, { useState, useRef, useCallback } from 'react';
import './VideoUploader.css';

export interface VideoUploaderProps {
  onUploadSuccess?: (fileIds: string[]) => void;
  onUploadError?: (error: Error) => void;
  onProgress?: (percentage: number) => void;
  chunkSize?: number; // In bytes, default 5MB
  apiUrl?: string;
  simulateDisconnectAt?: number; // percentage (0-100) to simulate disconnect
}

const DEFAULT_CHUNK_SIZE = 5 * 1024 * 1024; // 5MB

export const VideoUploader: React.FC<VideoUploaderProps> = ({
  onUploadSuccess,
  onUploadError,
  onProgress,
  chunkSize = DEFAULT_CHUNK_SIZE,
  apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8000',
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
    if (fileToRemove && videoSafeFilenames[fileToRemove.name]) {
      const safeName = videoSafeFilenames[fileToRemove.name];
      try {
        await fetch(`${apiUrl}/videos/upload/${safeName}`, {
          method: 'DELETE',
        });
      } catch (err) {
        console.error("Failed to delete incomplete upload", err);
      }
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
    setVideoFiles(prev => prev.filter((_, index) => index !== indexToRemove));
  };

  const removeMetadataFile = async (indexToRemove: number) => {
    const fileToRemove = metadataFiles[indexToRemove];
    if (fileToRemove && metadataSafeFilenames[fileToRemove.name]) {
      const safeNames = metadataSafeFilenames[fileToRemove.name];
      for (const safeName of safeNames) {
        try {
          await fetch(`${apiUrl}/videos/upload/metadata/${safeName}`, {
            method: 'DELETE',
          });
        } catch (err) {
          console.error("Failed to delete incomplete metadata upload", err);
        }
      }
      setMetadataSafeFilenames(prev => {
        const newMap = { ...prev };
        delete newMap[fileToRemove.name];
        return newMap;
      });
    }
    setMetadataFiles(prev => prev.filter((_, index) => index !== indexToRemove));
  };

  const resetState = async (cancelUpload: boolean = true) => {
    if (cancelUpload) {
      for (const safeName of Object.values(videoSafeFilenames)) {
        if (safeName) {
          try {
            await fetch(`${apiUrl}/videos/upload/${safeName}`, {
              method: 'DELETE',
            });
          } catch (err) {
            console.error("Failed to delete incomplete upload", err);
          }
        }
      }

      for (const safeNames of Object.values(metadataSafeFilenames)) {
        for (const safeName of safeNames) {
          try {
            await fetch(`${apiUrl}/videos/upload/metadata/${safeName}`, {
              method: 'DELETE',
            });
          } catch (err) {
            console.error("Failed to delete incomplete metadata upload", err);
          }
        }
      }
    }

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
    }

    try {
      const currentVideoSafeFilenames = { ...videoSafeFilenames };
      const currentVideoFileIds = { ...videoFileIds };
      const currentMetadataSafeFilenames = { ...metadataSafeFilenames };

      // Initialize all videos
      for (const video of videoFiles) {
        if (!isResume || !currentVideoSafeFilenames[video.name]) {
          const initFormData = new FormData();
          initFormData.append('filename', video.name);
          initFormData.append('total_bytes', video.size.toString());

          const initRes = await fetch(`${apiUrl}/videos/upload/init`, {
            method: 'POST',
            body: initFormData,
          });

          if (!initRes.ok) {
            throw new Error(`Failed to initialize upload for ${video.name}: ${initRes.statusText}`);
          }

          const initData = await initRes.json();
          currentVideoSafeFilenames[video.name] = initData.safe_filename;
          currentVideoFileIds[video.name] = initData.file_id;
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
        const initPromises = metadataFiles.map(async (metaFile) => {
          if (!currentMetadataSafeFilenames[metaFile.name] || currentMetadataSafeFilenames[metaFile.name].length === 0) {
            const initMetaFormData = new FormData();
            initMetaFormData.append('video_safe_filenames', activeVideoSafeFilenames);
            initMetaFormData.append('filename', metaFile.name);
            initMetaFormData.append('content_type', metaFile.type || 'application/octet-stream');
            initMetaFormData.append('total_bytes', metaFile.size.toString());

            const initMetaRes = await fetch(`${apiUrl}/videos/upload/metadata/init_multiple`, {
              method: 'POST',
              body: initMetaFormData,
            });

            if (!initMetaRes.ok) {
              throw new Error(`Failed to initialize metadata upload for ${metaFile.name}: ${initMetaRes.statusText}`);
            }

            const initMetaData = await initMetaRes.json();
            return { name: metaFile.name, safeFilenames: initMetaData.safe_filenames };
          }
          return null;
        });

        const results = await Promise.all(initPromises);
        results.forEach(res => {
          if (res) {
            currentMetadataSafeFilenames[res.name] = res.safeFilenames;
          }
        });

        setMetadataSafeFilenames(currentMetadataSafeFilenames);
      }

      // Calculate total size for progress bar
      const totalSize = videoFiles.reduce((acc, f) => acc + f.size, 0) + metadataFiles.reduce((acc, f) => acc + f.size, 0);
      let totalUploadedBytes = 0;

      // Fetch offsets first to establish base progress BEFORE starting uploads
      const videoOffsets: Record<string, number> = {};
      const initialFileProgress: Record<string, number> = {};
      for (const video of videoFiles) {
        const currentSafeFilename = currentVideoSafeFilenames[video.name];
        if (currentSafeFilename) {
          try {
            const statusRes = await fetch(`${apiUrl}/videos/upload/${currentSafeFilename}/status`);
            if (statusRes.ok) {
              const statusData = await statusRes.json();
              videoOffsets[video.name] = statusData.uploaded_bytes || 0;
            }
          } catch (err) { }
        }
        const currentOffset = Math.min(videoOffsets[video.name] || 0, video.size);
        totalUploadedBytes += currentOffset;
        initialFileProgress[video.name] = video.size > 0 ? Math.min(100, Math.round((currentOffset / video.size) * 100)) : 100;
      }

      const metaOffsets: Record<string, number> = {};
      for (const metaFile of metadataFiles) {
        const safeFilenamesList = currentMetadataSafeFilenames[metaFile.name];
        if (safeFilenamesList && safeFilenamesList.length > 0) {
          try {
            const safeFilenamesStr = safeFilenamesList.join(',');
            const statusRes = await fetch(`${apiUrl}/videos/upload/metadata_multiple/status?safe_filenames=${encodeURIComponent(safeFilenamesStr)}`);
            if (statusRes.ok) {
              const statusData = await statusRes.json();
              metaOffsets[metaFile.name] = statusData.uploaded_bytes || 0;
            }
          } catch (err) { }
        }
        const currentOffset = Math.min(metaOffsets[metaFile.name] || 0, metaFile.size);
        totalUploadedBytes += currentOffset;
        initialFileProgress[metaFile.name] = metaFile.size > 0 ? Math.min(100, Math.round((currentOffset / metaFile.size) * 100)) : 100;
      }
      setFileProgress(initialFileProgress);

      // Update initial progress visually
      if (totalSize > 0) {
        const initialProgress = Math.round((totalUploadedBytes / totalSize) * 100);
        setProgress(initialProgress);
        if (onProgress) onProgress(initialProgress);
      }

      const checkDisconnect = (currentProgress: number) => {
        if (simulateDisconnectAt !== undefined && simulateDisconnectAt > 0 && currentProgress >= simulateDisconnectAt) {
          if (!triggeredDisconnects.current.has(simulateDisconnectAt)) {
            triggeredDisconnects.current.add(simulateDisconnectAt);
            throw new Error(`Simulated network disconnect at ${currentProgress}%`);
          }
        }
      };

      // Upload Video Chunks
      for (const video of videoFiles) {
        const currentSafeFilename = currentVideoSafeFilenames[video.name];
        if (!currentSafeFilename) continue;

        let videoOffset = videoOffsets[video.name] || 0;

        while (videoOffset < video.size) {
          const currentProgress = Math.round((totalUploadedBytes / totalSize) * 100);
          checkDisconnect(currentProgress);

          const chunkEnd = Math.min(videoOffset + chunkSize, video.size);
          const chunk = video.slice(videoOffset, chunkEnd);

          const chunkFormData = new FormData();
          chunkFormData.append('offset', videoOffset.toString());
          chunkFormData.append('file', chunk, video.name);

          const chunkRes = await fetch(`${apiUrl}/videos/upload/${currentSafeFilename}`, {
            method: 'POST',
            body: chunkFormData,
          });

          if (!chunkRes.ok) {
            throw new Error(`Failed to upload video chunk for ${video.name} at offset ${videoOffset}`);
          }

          const chunkData = await chunkRes.json();
          const newOffset = Math.min(chunkData.uploaded_bytes, video.size);
          const bytesUploadedThisChunk = newOffset - videoOffset;
          videoOffset = newOffset;

          totalUploadedBytes += bytesUploadedThisChunk;

          setFileProgress(prev => ({
            ...prev,
            [video.name]: video.size > 0 ? Math.min(100, Math.round((videoOffset / video.size) * 100)) : 100
          }));

          const updatedProgress = Math.min(100, Math.round((totalUploadedBytes / totalSize) * 100));
          setProgress(updatedProgress);
          if (onProgress) {
            onProgress(updatedProgress);
          }
        }
      }

      // Upload Metadata Chunks
      for (const metaFile of metadataFiles) {
        const safeFilenamesList = currentMetadataSafeFilenames[metaFile.name];
        if (!safeFilenamesList || safeFilenamesList.length === 0) continue;

        const safeFilenamesStr = safeFilenamesList.join(',');

        let metaOffset = metaOffsets[metaFile.name] || 0;

        while (metaOffset < metaFile.size) {
          const currentProgress = Math.round((totalUploadedBytes / totalSize) * 100);
          checkDisconnect(currentProgress);

          const chunkEnd = Math.min(metaOffset + chunkSize, metaFile.size);
          const chunk = metaFile.slice(metaOffset, chunkEnd);

          const chunkFormData = new FormData();
          chunkFormData.append('safe_filenames', safeFilenamesStr);
          chunkFormData.append('offset', metaOffset.toString());
          chunkFormData.append('file', chunk, metaFile.name);

          const chunkRes = await fetch(`${apiUrl}/videos/upload/metadata_multiple`, {
            method: 'POST',
            body: chunkFormData,
          });

          if (!chunkRes.ok) {
            throw new Error(`Failed to upload metadata chunk for ${metaFile.name} at offset ${metaOffset}`);
          }

          const chunkData = await chunkRes.json();
          const newOffset = Math.min(chunkData.uploaded_bytes, metaFile.size);
          const bytesUploadedThisChunk = newOffset - metaOffset;
          metaOffset = newOffset;

          totalUploadedBytes += bytesUploadedThisChunk;

          setFileProgress(prev => ({
            ...prev,
            [metaFile.name]: metaFile.size > 0 ? Math.min(100, Math.round((metaOffset / metaFile.size) * 100)) : 100
          }));

          const updatedProgress = Math.min(100, Math.round((totalUploadedBytes / totalSize) * 100));
          setProgress(updatedProgress);
          if (onProgress) {
            onProgress(updatedProgress);
          }
        }
      }

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
