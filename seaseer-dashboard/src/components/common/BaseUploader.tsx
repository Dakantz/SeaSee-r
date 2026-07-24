import React, { useRef } from 'react';
import './BaseUploader.css';
import { useDragAndDrop } from './useDragAndDrop';

export interface FileGroup {
  label: string;
  files: File[];
  onRemove: (index: number) => void;
  showIcon?: boolean;
}

export interface BaseUploaderProps {
  onFilesAdded: (files: File[]) => void;
  fileGroups: FileGroup[];
  isUploading: boolean;
  progress: number;
  fileProgress: Record<string, number>;
  uploadFailed: boolean;
  onStartUpload: (isResume: boolean) => void;
  onReset: (cancelUpload: boolean) => void;
  accept?: string;
  dropzoneText: React.ReactNode;
  dropzoneSubtext: React.ReactNode;
}

export const BaseUploader: React.FC<BaseUploaderProps> = ({
  onFilesAdded,
  fileGroups,
  isUploading,
  progress,
  fileProgress,
  uploadFailed,
  onStartUpload,
  onReset,
  accept,
  dropzoneText,
  dropzoneSubtext
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const dirInputRef = useRef<HTMLInputElement>(null);

  const { dragActive, handleDrag, handleDrop } = useDragAndDrop(onFilesAdded, isUploading || progress === 100);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (e.target.files && e.target.files.length > 0) {
      onFilesAdded(Array.from(e.target.files));
    }
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

  const hasFiles = fileGroups.some(group => group.files.length > 0);

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
      
      {!hasFiles ? (
        <div
          className={`vu-dropzone ${dragActive ? 'active' : ''}`}
          onClick={onButtonClick}
        >
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={accept}
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
          <div className="vu-text">{dropzoneText}</div>
          <div className="vu-subtext">{dropzoneSubtext}</div>
        </div>
      ) : (
        <div className="vu-file-info">
          {fileGroups.map((group, groupIndex) => (
            group.files.length > 0 && (
              <div key={groupIndex} style={{ marginTop: groupIndex > 0 ? '10px' : '0', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                <div style={{ fontSize: '14px', fontWeight: 600, color: '#9ca3af' }}>{group.label}</div>
                {group.files.map((file, fileIndex) => (
                  <div key={fileIndex} className="vu-filename" style={{ display: 'flex', flexDirection: 'column', gap: '4px', padding: '6px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {group.showIcon !== false && (
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
                        )}
                        <span>{file.name}</span>
                      </div>
                      {!isUploading && progress < 100 && (
                        <button
                          onClick={() => group.onRemove(fileIndex)}
                          style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}
                        >
                          X
                        </button>
                      )}
                    </div>
                    {fileProgress[file.name] !== undefined && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{ width: '100%', backgroundColor: '#374151', height: '4px', borderRadius: '2px', overflow: 'hidden' }}>
                          <div style={{ width: `${fileProgress[file.name]}%`, backgroundColor: '#3b82f6', height: '100%', transition: 'width 0.3s ease' }}></div>
                        </div>
                        <span style={{ fontSize: '10px', color: '#9ca3af', minWidth: '24px', textAlign: 'right' }}>{fileProgress[file.name]}%</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )
          ))}

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
                accept={accept}
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
                <button className="vu-button" onClick={() => onStartUpload(false)}>
                  Start Upload
                </button>
                <button className="vu-button vu-button-danger" onClick={() => onReset(true)}>
                  Cancel
                </button>
              </>
            )}

            {!isUploading && uploadFailed && (
              <>
                <button className="vu-button" style={{ backgroundColor: '#f59e0b', boxShadow: '0 4px 6px -1px rgba(245, 158, 11, 0.3)' }} onClick={() => onStartUpload(true)}>
                  Resume Upload
                </button>
                <button className="vu-button vu-button-danger" onClick={() => onReset(true)}>
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
              <button className="vu-button vu-button-success" onClick={() => onReset(false)}>
                Upload Another
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
