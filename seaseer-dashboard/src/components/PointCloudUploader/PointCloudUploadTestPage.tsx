import React, { useState } from 'react';
import { PointCloudUploader } from './PointCloudUploader';

interface UploaderInstanceProps {
  title: string;
  chunkSize?: number;
}

const UploaderInstance: React.FC<UploaderInstanceProps> = ({ title, chunkSize }) => {
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [fileIds, setFileIds] = useState<string[]>([]);

  const handleUploadSuccess = (ids: string[]) => {
    setFileIds(ids);
    setStatusMessage(`Upload completed successfully!`);
  };

  const handleUploadError = (error: Error) => {
    setStatusMessage(`Upload failed: ${error.message}`);
    setFileIds([]);
  };

  const handleProgress = (percentage: number) => {
    if (percentage < 100) {
      setStatusMessage(`Uploading... ${percentage}%`);
      setFileIds([]);
    } else {
      setStatusMessage('Finalizing...');
    }
  };

  return (
    <div style={{ marginBottom: 'var(--spacing-5xl)', padding: 'var(--spacing-3xl)', background: 'var(--color-bg-subtle)', borderRadius: 'var(--radius-2xl)', border: '1px solid var(--color-border-light)' }}>
      <h2 style={{ fontSize: 'var(--font-size-2xl)', color: 'var(--color-text-primary)', marginBottom: 'var(--spacing-xl)', fontWeight: 'var(--font-weight-medium)' }}>
        {title}
      </h2>
      <PointCloudUploader
        onUploadSuccess={handleUploadSuccess}
        onUploadError={handleUploadError}
        onProgress={handleProgress}
        chunkSize={chunkSize}
      />

      {statusMessage && (
        <div style={{
          marginTop: 'var(--spacing-3xl)',
          padding: 'var(--spacing-xl)',
          backgroundColor: fileIds.length > 0 ? 'var(--color-success-subtle)' : 'var(--color-bg-subtle)',
          borderRadius: 'var(--radius-lg)',
          borderStyle: 'solid',
          borderWidth: '1px',
          borderColor: 'var(--color-border-light)',
          borderLeftWidth: '4px',
          borderLeftColor: fileIds.length > 0 ? 'var(--color-success)' : 'var(--color-primary)',
          boxShadow: 'inset 0 2px 4px 0 rgba(0, 0, 0, 0.05)'
        }}>
          <p style={{ margin: 0, color: 'var(--color-text-primary)', fontWeight: 'var(--font-weight-medium)', fontSize: 'var(--font-size-lg)' }}>
            {statusMessage}
          </p>
          {fileIds.length > 0 && (
            <div style={{ margin: 'var(--spacing-lg) 0 0 0', color: 'var(--color-text-muted)', fontSize: 'var(--font-size-md)', display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)', flexWrap: 'wrap' }}>
              File IDs:
              {fileIds.map(id => (
                <span key={id} style={{
                  fontFamily: 'var(--font-mono)',
                  backgroundColor: 'var(--color-border-light)',
                  padding: 'var(--spacing-2xs) var(--spacing-sm)',
                  borderRadius: 'var(--radius-md)',
                  color: 'var(--color-text-body)',
                  border: '1px solid var(--color-border-default)'
                }}>
                  {id}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export const PointCloudUploadTestPage: React.FC = () => {

  return (
    <div style={{
      padding: 'var(--spacing-5xl)',
      maxWidth: '800px',
      margin: '0 auto',
      fontFamily: 'var(--font-sans)',
      color: 'var(--color-text-secondary)',
      flex: 1,
      overflowY: 'auto',
      height: '100%'
    }}>
      <div style={{
        background: 'var(--color-bg-card)',
        border: '1px solid var(--color-border-light)',
        borderRadius: 'var(--radius-4xl)',
        padding: 'var(--spacing-4xl)',
        boxShadow: 'var(--shadow-md)'
      }}>
        <h1 style={{ fontSize: 'var(--font-size-3xl)', marginBottom: 'var(--spacing-sm)', color: 'var(--color-text-primary)', fontWeight: 'var(--font-weight-semibold)' }}>
          PointCloud Upload Test
        </h1>
        <p style={{ color: 'var(--color-text-primary)', marginBottom: 'var(--spacing-4xl)', fontSize: 'var(--font-size-lg)' }}>
          This is an example component to show how the upload backend for pointclouds can be used. It automatically resumes the upload after a connection issue. Only accepts .las, .laz, and .ply files.
        </p>

        <UploaderInstance
          title="Uploader 1 (5MB Chunks - Default)"
        />
      </div>
    </div>
  );
};

export default PointCloudUploadTestPage;
