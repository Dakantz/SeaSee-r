import React, { useState, useEffect } from 'react';
import type { JobResponse, JobStatus } from '../../client';
import { calculateDuration } from '../../utils/durationUtils';

export interface JobNodeProps {
  job: JobResponse;
  isSelected?: boolean;
  isSearchMatch?: boolean;
  isOptimistic?: boolean;
  onSelect: (job: JobResponse) => void;
  onRetry?: (jobId: string, e: React.MouseEvent) => void;
  onCancel?: (jobId: string, e: React.MouseEvent) => void;
  retryingJobId?: string | null;
  cancellingJobId?: string | null;
}

const getJobStatusClass = (status: JobStatus): string => {
  switch (status) {
    case 'COMPLETED':
      return 'jso-node-completed';
    case 'RUNNING':
      return 'jso-node-running';
    case 'BLOCKED':
      return 'jso-node-blocked';
    case 'PENDING':
      return 'jso-node-pending';
    case 'FAILED':
      return 'jso-node-failed';
    case 'CANCELLED':
      return 'jso-node-cancelled';
    default:
      return 'jso-node-pending';
  }
};

const getStatusIcon = (status: JobStatus): string => {
  switch (status) {
    case 'COMPLETED':
      return '✓';
    case 'RUNNING':
      return '↻';
    case 'BLOCKED':
      return '🔒';
    case 'PENDING':
      return '⏳';
    case 'FAILED':
      return '✕';
    case 'CANCELLED':
      return '⛔';
    default:
      return '•';
  }
};

export const JobNode: React.FC<JobNodeProps> = ({
  job,
  isSelected = false,
  isSearchMatch = false,
  isOptimistic = false,
  onSelect,
  onRetry,
  onCancel,
  retryingJobId,
  cancellingJobId,
}) => {
  const isRunning = job.status === 'RUNNING';
  const isPending = job.status === 'PENDING';
  const isBlocked = job.status === 'BLOCKED';
  const isFailed = job.status === 'FAILED';
  const isCancelled = job.status === 'CANCELLED';
  const isCompleted = job.status === 'COMPLETED';

  const [now, setNow] = useState<number>(Date.now());

  useEffect(() => {
    if (!isRunning) return;
    setNow(Date.now());
    const interval = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, [isRunning]);

  const progressValue = isCompleted
    ? 100
    : Math.min(100, Math.max(0, job.progress || 0));
  const durationStr = calculateDuration(job.started_at, job.completed_at, now);

  return (
    <div
      id={`job-node-${job.id}`}
      data-job-id={job.id}
      className={`jso-job-node ${getJobStatusClass(job.status)} ${isSelected ? 'selected' : ''} ${isSearchMatch ? 'search-match' : ''} ${isOptimistic ? 'optimistic' : ''}`}
      onClick={() => onSelect(job)}
      title={`Job: ${job.name}\nID: ${job.id}\nStatus: ${job.status}\nProgress: ${progressValue.toFixed(0)}%\nClick to view drawer details`}
    >
      <div className="jso-node-header">
        <span className={`jso-node-icon status-${job.status.toLowerCase()}`}>
          {getStatusIcon(job.status)}
        </span>
        <span className="jso-node-name" title={job.name}>
          {job.name}
        </span>
        {isSelected ? (
          <span className="jso-target-anchor-badge" title="Currently selected target job in drawer">
            TARGET
          </span>
        ) : isSearchMatch ? (
          <span className="jso-search-match-badge" title="Matches search filter">
            MATCH
          </span>
        ) : null}
      </div>

      <div className="jso-node-meta">
        {job.task_type && (
          <span className="jso-node-tag">
            {job.task_type.replace('opensfm_', '').replace('_tasks', '')}
          </span>
        )}
        <span className="jso-node-duration">
          {durationStr !== '-' ? durationStr : ''}
        </span>
      </div>

      {/* Progress track on every individual job - always displayed */}
      <div className="jso-node-progress-track" title={`Progress: ${progressValue.toFixed(0)}%`}>
        <div
          className={`jso-node-progress-fill status-${job.status.toLowerCase()}`}
          style={{ width: `${progressValue}%` }}
        />
      </div>

      {/* Quick Actions Hover Trigger */}
      <div className="jso-node-quick-actions">
        {(isRunning || isPending || isBlocked) && onCancel && (
          <button
            type="button"
            className="jso-node-action-btn cancel"
            onClick={(e) => onCancel(job.id, e)}
            disabled={cancellingJobId === job.id}
            title="Cancel Job"
          >
            <span className={cancellingJobId === job.id ? 'jso-spin-icon' : ''}>⛔</span>
            <span>Cancel</span>
          </button>
        )}
        {(isFailed || isCancelled) && onRetry && (
          <button
            type="button"
            className="jso-node-action-btn retry"
            onClick={(e) => onRetry(job.id, e)}
            disabled={retryingJobId === job.id}
            title="Retry Job"
          >
            <span className={retryingJobId === job.id ? 'jso-spin-icon' : ''}>↻</span>
            <span>Retry</span>
          </button>
        )}
      </div>
    </div>
  );
};
