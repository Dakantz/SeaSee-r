import React, { useState, useRef, useCallback } from 'react';
import './VideoUploader.css';

export interface VideoUploaderProps {
  onUploadSuccess?: (fileId: string) => void;
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
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [dragActive, setDragActive] = useState(false);
  const [safeFilename, setSafeFilename] = useState<string | null>(null);
  const [fileId, setFileId] = useState<string | null>(null);
  const [uploadFailed, setUploadFailed] = useState<boolean>(false);
  const triggeredDisconnects = useRef<Set<number>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile.type.startsWith('video/')) {
        setFile(droppedFile);
        setProgress(0);
      } else {
        alert("Please drop a valid video file.");
      }
    }
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      if (selectedFile.type.startsWith('video/')) {
        setFile(selectedFile);
        setProgress(0);
      } else {
        alert("Please select a valid video file.");
      }
    }
  };

  const onButtonClick = () => {
    if (!isUploading && progress < 100) {
      inputRef.current?.click();
    }
  };

  const resetState = async () => {
    if (safeFilename) {
      try {
        await fetch(`${apiUrl}/videos/upload/resumable/${safeFilename}`, {
          method: 'DELETE',
        });
      } catch (err) {
        console.error("Failed to delete incomplete upload", err);
      }
    }

    setFile(null);
    setProgress(0);
    setIsUploading(false);
    setSafeFilename(null);
    setFileId(null);
    setUploadFailed(false);
    triggeredDisconnects.current.clear();
    if (inputRef.current) {
      inputRef.current.value = '';
    }
  };

  const startUpload = async (isResume = false) => {
    if (!file) return;
    setIsUploading(true);
    setUploadFailed(false);

    if (!isResume) {
      setProgress(0);
    }

    try {
      let currentSafeFilename = safeFilename;
      let currentFileId = fileId;

      if (!isResume || !currentSafeFilename) {
        // 1. Initialize Upload
        const initFormData = new FormData();
        initFormData.append('filename', file.name);
        initFormData.append('total_bytes', file.size.toString());

        const initRes = await fetch(`${apiUrl}/videos/upload/resumable/init`, {
          method: 'POST',
          body: initFormData,
        });

        if (!initRes.ok) {
          throw new Error(`Failed to initialize upload: ${initRes.statusText}`);
        }

        const initData = await initRes.json();
        currentSafeFilename = initData.safe_filename;
        currentFileId = initData.file_id;
        
        setSafeFilename(currentSafeFilename || null);
        setFileId(currentFileId || null);
      }

      // 2. Upload Chunks
      let offset = 0;
      
      // Optionally check initial status to resume (though usually 0 here)
      try {
        const statusRes = await fetch(`${apiUrl}/videos/upload/resumable/${currentSafeFilename}/status`);
        if (statusRes.ok) {
          const statusData = await statusRes.json();
          offset = statusData.uploaded_bytes || 0;
        }
      } catch (err) {
        console.warn("Could not fetch initial status, proceeding with offset 0");
      }

      while (offset < file.size) {
        const currentProgress = Math.round((offset / file.size) * 100);
        
        if (simulateDisconnectAt !== undefined && simulateDisconnectAt > 0 && currentProgress >= simulateDisconnectAt) {
          if (!triggeredDisconnects.current.has(simulateDisconnectAt)) {
            triggeredDisconnects.current.add(simulateDisconnectAt);
            throw new Error(`Simulated network disconnect at ${currentProgress}%`);
          }
        }

        const chunkEnd = Math.min(offset + chunkSize, file.size);
        const chunk = file.slice(offset, chunkEnd);

        const chunkFormData = new FormData();
        chunkFormData.append('offset', offset.toString());
        chunkFormData.append('file', chunk, file.name);

        const chunkRes = await fetch(`${apiUrl}/videos/upload/resumable/${currentSafeFilename}`, {
          method: 'POST',
          body: chunkFormData,
        });

        if (!chunkRes.ok) {
           throw new Error(`Failed to upload chunk at offset ${offset}`);
        }

        const chunkData = await chunkRes.json();
        offset = chunkData.uploaded_bytes;

        const updatedProgress = Math.round((offset / file.size) * 100);
        setProgress(updatedProgress);
        if (onProgress) {
          onProgress(updatedProgress);
        }
      }

      setIsUploading(false);
      setProgress(100);
      setSafeFilename(null);
      setFileId(null);
      setUploadFailed(false);
      triggeredDisconnects.current.clear();
      
      if (onUploadSuccess && currentFileId) {
        onUploadSuccess(currentFileId);
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
    <div className="vu-container">
      {!file ? (
        <div 
          className={`vu-dropzone ${dragActive ? 'active' : ''}`}
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
          onClick={onButtonClick}
        >
          <input 
            ref={inputRef}
            type="file" 
            accept="video/*" 
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
          <div className="vu-text">Drag and drop your video here</div>
          <div className="vu-subtext">or click to browse from your device</div>
        </div>
      ) : (
        <div className="vu-file-info">
          <div className="vu-filename">
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
            {file.name}
          </div>
          
          <div className="vu-progress-bar-container">
            <div 
              className="vu-progress-bar" 
              style={{ width: `${progress}%` }} 
            ></div>
          </div>
          <div className="vu-progress-text">{progress}% Uploaded</div>
          
          <div className="vu-actions">
            {!isUploading && progress < 100 && !uploadFailed && (
              <>
                <button className="vu-button" onClick={() => startUpload(false)}>
                  Start Upload
                </button>
                <button className="vu-button vu-button-danger" onClick={resetState}>
                  Cancel
                </button>
              </>
            )}

            {!isUploading && uploadFailed && (
              <>
                <button className="vu-button" style={{ backgroundColor: '#f59e0b', boxShadow: '0 4px 6px -1px rgba(245, 158, 11, 0.3)' }} onClick={() => startUpload(true)}>
                  Resume Upload
                </button>
                <button className="vu-button vu-button-danger" onClick={resetState}>
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
              <button className="vu-button vu-button-success" onClick={resetState}>
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
