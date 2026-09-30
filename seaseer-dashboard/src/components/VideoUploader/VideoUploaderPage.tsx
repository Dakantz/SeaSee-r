import React, { useState } from 'react';
import { VideoUploader } from './VideoUploader';
import { UploadedBatchesManager } from './UploadedBatchesManager';
import { JobSystemOverview } from '../JobSystemOverview';
import OpenSfMConfigModal from '../OpenSfMConfigModal/OpenSfMConfigModal';
import '../PointCloudOverview/PointCloudOverview.css';

interface UploaderInstanceProps {
  title: string;
  chunkSize?: number;
  onBatchUploaded?: (batchId?: string) => void;
}

const UploaderInstance: React.FC<UploaderInstanceProps> = ({ title, chunkSize, onBatchUploaded }) => {
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [isSuccess, setIsSuccess] = useState<boolean>(false);

  const handleUploadSuccess = (_fileIds?: string[], batchId?: string) => {
    setIsSuccess(true);
    setStatusMessage(`Upload completed successfully!`);
    onBatchUploaded?.(batchId);
  };

  const handleUploadError = (error: Error) => {
    setStatusMessage(`Upload failed: ${error.message}`);
    setIsSuccess(false);
  };

  const handleProgress = (percentage: number) => {
    if (percentage < 100) {
      setStatusMessage(`Uploading... ${percentage}%`);
      setIsSuccess(false);
    } else {
      setStatusMessage('Finalizing batch upload on server...');
    }
  };

  return (
    <div style={{
      marginBottom: '32px',
      padding: '24px',
      background: 'rgba(15, 23, 42, 0.35)',
      borderRadius: '16px',
      border: '1px solid rgba(255, 255, 255, 0.08)'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <h2 style={{ fontSize: '18px', color: '#f8fafc', margin: 0, fontWeight: 600 }}>
          {title}
        </h2>
        <span style={{ fontSize: '12px', color: '#94a3b8' }}>
          Tus Resumable Transfer (5MB chunks)
        </span>
      </div>

      <VideoUploader
        onUploadSuccess={handleUploadSuccess}
        onUploadError={handleUploadError}
        onProgress={handleProgress}
        chunkSize={chunkSize}
      />

      {statusMessage && (
        <div style={{
          marginTop: '20px',
          padding: '14px 18px',
          backgroundColor: isSuccess ? 'rgba(16, 185, 129, 0.12)' : 'rgba(15, 23, 42, 0.7)',
          borderRadius: '10px',
          borderStyle: 'solid',
          borderWidth: '1px',
          borderColor: 'rgba(255, 255, 255, 0.08)',
          borderLeftWidth: '4px',
          borderLeftColor: isSuccess ? '#10b981' : '#3b82f6',
          boxShadow: 'inset 0 2px 4px 0 rgba(0, 0, 0, 0.05)'
        }}>
          <p style={{ margin: 0, color: '#f1f5f9', fontWeight: 500, fontSize: '14px' }}>
            {statusMessage}
          </p>
        </div>
      )}
    </div>
  );
};

export const VideoUploaderPage: React.FC = () => {
  const [highlightedBatchId, setHighlightedBatchId] = useState<string | undefined>();
  const [isOpenSfMOpen, setIsOpenSfMOpen] = useState<boolean>(false);

  return (
    <div style={{
      padding: '40px',
      width: '100%',
      maxWidth: '100%',
      boxSizing: 'border-box',
      fontFamily: "'Inter', 'Roboto', sans-serif",
      color: '#e2e8f0',
      flex: 1,
      overflowY: 'auto',
      height: '100%'
    }}>
      <div style={{
        maxWidth: '1400px',
        margin: '0 auto',
        display: 'flex',
        flexDirection: 'column',
        gap: '32px',
      }}>
        {/* Page Header */}
        <div style={{
          background: 'rgba(30, 41, 59, 0.4)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '16px',
          padding: '32px',
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '24px',
          flexWrap: 'wrap',
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
              <span style={{ fontSize: '28px' }}>🎥</span>
              <h1 style={{ fontSize: '28px', margin: 0, color: '#f8fafc', fontWeight: 700 }}>
                Video Uploader
              </h1>
            </div>
            <p style={{ color: '#94a3b8', margin: 0, fontSize: '15px', maxWidth: '800px', lineHeight: 1.5 }}>
              Upload ROV video feeds and navigation telemetry logs. Uploaded files are grouped into batches so you can configure custom reconstruction parameters and trigger OpenSfM pipelines on demand.
            </p>
          </div>
          <div>
            <button
              type="button"
              className="pco-toggle-btn"
              onClick={() => setIsOpenSfMOpen(true)}
              title="Toggle OpenSfM Settings"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
              </svg>
              <span>OpenSfM Settings</span>
            </button>
          </div>
        </div>

        <OpenSfMConfigModal
          isOpen={isOpenSfMOpen}
          onClose={() => setIsOpenSfMOpen(false)}
        />

        {/* Section 1: Upload Section */}
        <div style={{
          background: 'rgba(30, 41, 59, 0.4)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '16px',
          padding: '28px',
        }}>
          <UploaderInstance 
            title="Upload New Video & Log Batch" 
            onBatchUploaded={(id) => setHighlightedBatchId(id)}
          />
        </div>

        {/* Section 2: Uploaded Batches & Pipeline Launcher (The New Component) */}
        <div style={{
          background: 'rgba(30, 41, 59, 0.4)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '16px',
          padding: '28px',
        }}>
          <UploadedBatchesManager 
            highlightedBatchId={highlightedBatchId}
          />
        </div>

        {/* Section 3: Job Pipelines Overview */}
        <div style={{
          background: 'rgba(30, 41, 59, 0.4)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '16px',
          padding: '28px',
        }}>
          <div style={{ marginBottom: '20px' }}>
            <h2 style={{ fontSize: '20px', color: '#f8fafc', margin: '0 0 6px 0', fontWeight: 600 }}>
              Job Pipelines Overview
            </h2>
            <p style={{ color: '#94a3b8', margin: 0, fontSize: '13px' }}>
              Real-time execution status and progress of log ingestion, frame extraction, and OpenSfM reconstruction tasks.
            </p>
          </div>
          <JobSystemOverview limit={0} />
        </div>
      </div>
    </div>
  );
};

export default VideoUploaderPage;
