import React, { useEffect, useState, useRef, useCallback } from 'react';
import { getJob } from '../../client';
import type { JobResponse, JobStatus } from '../../client';
import './JobProgress.css';

export interface JobProgressProps {
  /** The UUID of the job to track and poll */
  jobId?: string;
  /** Optional initial job data object */
  job?: JobResponse;
  /** Whether to automatically poll backend for status updates (default: true) */
  autoPoll?: boolean;
  /** Polling interval in milliseconds (default: 2000ms) */
  pollInterval?: number;
  /** Callback fired when job completes successfully */
  onJobComplete?: (job: JobResponse) => void;
  /** Callback fired when job fails */
  onJobFailed?: (errorMsg: string, job?: JobResponse) => void;
  /** Optional callback to close/dismiss the card */
  onClose?: () => void;
  /** Custom title header (defaults to job name or "Job Progress") */
  title?: string;
  /** Whether to show expandable technical details (timestamps, payload, etc.) */
  showDetails?: boolean;
  /** Custom CSS class name */
  className?: string;
  /** Custom inline styles */
  style?: React.CSSProperties;
}

export const JobProgress: React.FC<JobProgressProps> = ({
  jobId,
  job: initialJob,
  autoPoll = true,
  pollInterval = 1000,
  onJobComplete,
  onJobFailed,
  onClose,
  title,
  showDetails = true,
  className = '',
  style
}) => {
  const [jobData, setJobData] = useState<JobResponse | null>(initialJob || null);
  const [loading, setLoading] = useState<boolean>(!initialJob && Boolean(jobId));
  const [error, setError] = useState<string | null>(null);
  const [isDetailsExpanded, setIsDetailsExpanded] = useState<boolean>(false);

  const prevStatusRef = useRef<JobStatus | null>(initialJob?.status || null);
  const activeJobId = jobId || initialJob?.id;

  const fetchJob = useCallback(async () => {
    if (!activeJobId) return;

    try {
      const response = await getJob({
        path: { job_id: activeJobId }
      });

      if (response.data) {
        const currentJob = response.data;
        setJobData(currentJob);
        setError(null);

        // Check if state transitioned to terminal status
        if (prevStatusRef.current !== currentJob.status) {
          prevStatusRef.current = currentJob.status;
          if (currentJob.status === 'COMPLETED' && onJobComplete) {
            onJobComplete(currentJob);
          } else if (currentJob.status === 'FAILED' && onJobFailed) {
            onJobFailed(currentJob.error_message || 'Job execution failed', currentJob);
          }
        }
      } else if (response.error) {
        const errMsg = typeof response.error === 'object' && response.error !== null
          ? (response.error as any).detail || 'Failed to fetch job status'
          : 'Failed to fetch job status';
        setError(errMsg);
      }
    } catch (err: any) {
      setError(err.message || 'Error communicating with server');
    } finally {
      setLoading(false);
    }
  }, [activeJobId, onJobComplete, onJobFailed]);

  // Sync initialJob prop changes
  useEffect(() => {
    if (initialJob) {
      setJobData(initialJob);
    }
  }, [initialJob]);

  // Poll job status until terminal state (COMPLETED or FAILED)
  useEffect(() => {
    if (!autoPoll || !activeJobId) return;

    // Fetch immediately on mount or ID change
    fetchJob();

    const isTerminal = jobData?.status === 'COMPLETED' || jobData?.status === 'FAILED' || jobData?.status === 'CANCELLED';
    if (isTerminal) return;

    const intervalId = setInterval(() => {
      fetchJob();
    }, pollInterval);

    return () => clearInterval(intervalId);
  }, [activeJobId, autoPoll, pollInterval, jobData?.status, fetchJob]);

  if (!activeJobId && !jobData) {
    return null;
  }

  const rawProgress = jobData?.progress ?? 0;
  // Normalize progress percentage: handles 0.0 - 1.0 vs 0 - 100
  const normalizedProgress = rawProgress <= 1.0 && rawProgress > 0
    ? Math.min(100, Math.round(rawProgress * 100))
    : Math.min(100, Math.round(rawProgress));

  const status = jobData?.status || 'PENDING';
  const displayTitle = title || jobData?.name || 'Background Job';

  const getStatusBadge = () => {
    switch (status) {
      case 'PENDING':
        return (
          <span className="job-progress-status-badge job-status-pending">
            <svg className="job-spin-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <circle cx="12" cy="12" r="10"></circle>
              <polyline points="12 6 12 12 16 14"></polyline>
            </svg>
            Pending
          </span>
        );
      case 'BLOCKED':
        return (
          <span className="job-progress-status-badge job-status-blocked">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
            </svg>
            Blocked
          </span>
        );
      case 'RUNNING':
        return (
          <span className="job-progress-status-badge job-status-running">
            <svg className="job-spin-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="2" x2="12" y2="6"></line>
              <line x1="12" y1="18" x2="12" y2="22"></line>
              <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line>
              <line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line>
              <line x1="2" y1="12" x2="6" y2="12"></line>
              <line x1="18" y1="12" x2="22" y2="12"></line>
              <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line>
              <line x1="16.24" y1="4.93" x2="19.07" y2="7.76"></line>
            </svg>
            Running
          </span>
        );
      case 'COMPLETED':
        return (
          <span className="job-progress-status-badge job-status-completed">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            Completed
          </span>
        );
      case 'FAILED':
        return (
          <span className="job-progress-status-badge job-status-failed">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
            Failed
          </span>
        );
      case 'CANCELLED':
        return (
          <span className="job-progress-status-badge job-status-cancelled">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line>
            </svg>
            Cancelled
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className={`job-progress-card ${className}`} style={style}>
      <div className="job-progress-header">
        <div className="job-progress-title-section">
          <span className="job-progress-title">{displayTitle}</span>
          {activeJobId && (
            <span className="job-progress-id" title={activeJobId}>
              ID: {activeJobId}
            </span>
          )}
        </div>

        <div className="job-progress-header-actions">
          {getStatusBadge()}
          {onClose && (
            <button className="job-progress-close-btn" onClick={onClose} title="Dismiss">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          )}
        </div>
      </div>

      <div className="job-progress-bar-wrapper">
        <div
          className={`job-progress-bar-fill ${status.toLowerCase()}`}
          style={{ width: `${status === 'COMPLETED' ? 100 : normalizedProgress}%` }}
        />
      </div>

      <div className="job-progress-stats">
        <span>
          {status === 'RUNNING' && 'Processing job...'}
          {status === 'PENDING' && 'Waiting in queue...'}
          {status === 'BLOCKED' && 'Blocked (waiting on parent job)...'}
          {status === 'COMPLETED' && 'Job finished successfully'}
          {status === 'FAILED' && 'Job failed'}
          {status === 'CANCELLED' && 'Job cancelled'}
        </span>
        <span className="job-progress-percent">
          {status === 'COMPLETED' ? 100 : normalizedProgress}%
        </span>
      </div>

      {error && <div className="job-progress-error">Server Error: {error}</div>}

      {jobData?.error_message && status === 'FAILED' && (
        <div className="job-progress-error">
          <strong>Error Details:</strong> {jobData.error_message}
        </div>
      )}

      {showDetails && jobData && (
        <>
          <div style={{ marginTop: 'var(--spacing-sm)', textAlign: 'right' }}>
            <button
              onClick={() => setIsDetailsExpanded(prev => !prev)}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--color-primary-text)',
                fontSize: 'var(--font-size-xs)',
                cursor: 'pointer',
                padding: 'var(--spacing-3xs) var(--spacing-2xs)',
                textDecoration: 'underline'
              }}
            >
              {isDetailsExpanded ? 'Hide Details' : 'Show Details'}
            </button>
          </div>

          {isDetailsExpanded && (
            <div className="job-progress-details">
              <div className="job-progress-details-item">
                <span>Created:</span>
                <span className="value">{new Date(jobData.created_at).toLocaleTimeString()}</span>
              </div>
              {jobData.started_at && (
                <div className="job-progress-details-item">
                  <span>Started:</span>
                  <span className="value">{new Date(jobData.started_at).toLocaleTimeString()}</span>
                </div>
              )}
              {jobData.completed_at && (
                <div className="job-progress-details-item">
                  <span>Completed:</span>
                  <span className="value">{new Date(jobData.completed_at).toLocaleTimeString()}</span>
                </div>
              )}
              {jobData.result && (
                <div className="job-progress-details-item" style={{ flexDirection: 'column', gap: 'var(--spacing-3xs)', marginTop: 'var(--spacing-2xs)' }}>
                  <span>Result Output:</span>
                  <pre style={{
                    backgroundColor: 'var(--color-bg-subtle)',
                    padding: 'var(--spacing-xs)',
                    borderRadius: 'var(--radius-sm)',
                    margin: 0,
                    maxHeight: '100px',
                    overflow: 'auto',
                    fontSize: 'var(--font-size-2xs)',
                    color: 'var(--color-success-text)'
                  }}>
                    {JSON.stringify(jobData.result, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {loading && !jobData && (
        <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', marginTop: 'var(--spacing-xs)' }}>
          Loading job information...
        </div>
      )}
    </div>
  );
};

export default JobProgress;
