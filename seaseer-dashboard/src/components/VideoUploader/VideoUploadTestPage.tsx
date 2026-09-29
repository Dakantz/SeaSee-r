import React, { useState } from 'react';
import { VideoUploader } from './VideoUploader';
import { JobSystemOverview } from '../JobSystemOverview';

interface UploaderInstanceProps {
  title: string;
  chunkSize?: number;
}

const UploaderInstance: React.FC<UploaderInstanceProps> = ({ title, chunkSize }) => {
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [isSuccess, setIsSuccess] = useState<boolean>(false);

  const handleUploadSuccess = () => {
    setIsSuccess(true);
    setStatusMessage(`Upload completed successfully!`);
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
      setStatusMessage('Finalizing...');
    }
  };

  return (
    <div style={{ marginBottom: '40px', padding: '24px', background: 'rgba(15, 23, 42, 0.2)', borderRadius: '12px', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
      <h2 style={{ fontSize: '18px', color: '#f8fafc', marginBottom: '16px', fontWeight: 500 }}>
        {title}
      </h2>
      <VideoUploader
        onUploadSuccess={handleUploadSuccess}
        onUploadError={handleUploadError}
        onProgress={handleProgress}
        chunkSize={chunkSize}
      />

      {statusMessage && (
        <div style={{
          marginTop: '24px',
          padding: '16px',
          backgroundColor: isSuccess ? 'rgba(16, 185, 129, 0.1)' : 'rgba(15, 23, 42, 0.6)',
          borderRadius: '8px',
          borderStyle: 'solid',
          borderWidth: '1px',
          borderColor: 'rgba(255, 255, 255, 0.05)',
          borderLeftWidth: '4px',
          borderLeftColor: isSuccess ? '#10b981' : '#3b82f6',
          boxShadow: 'inset 0 2px 4px 0 rgba(0, 0, 0, 0.05)'
        }}>
          <p style={{ margin: 0, color: '#f1f5f9', fontWeight: 500, fontSize: '15px' }}>
            {statusMessage}
          </p>
        </div>
      )}
    </div>
  );
};

export const VideoUploadTestPage: React.FC = () => {
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
        background: 'rgba(30, 41, 59, 0.4)',
        border: '1px solid rgba(255, 255, 255, 0.05)',
        borderRadius: '16px',
        padding: '32px',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)'
      }}>
        <h1 style={{ fontSize: '28px', marginBottom: '8px', color: '#f8fafc', fontWeight: 600 }}>
          Video Upload Test
        </h1>
        <p style={{ color: '#94a3b8', marginBottom: '32px', fontSize: '15px' }}>
          Test the chunked video uploader component below. You can now test multiple simultaneous uploads!
        </p>

        <UploaderInstance 
          title="Uploader 1 (5MB Chunks - Default)" 
        />

        <div style={{ marginTop: '40px', borderTop: '1px solid rgba(255, 255, 255, 0.08)' }}>
          <h2 style={{ fontSize: '20px', color: '#f8fafc', marginBottom: '16px', fontWeight: 600 }}>
            Job Pipelines Overview
          </h2>
          <JobSystemOverview limit={0} />
        </div>
      </div>
    </div>
  );
};

export default VideoUploadTestPage;
