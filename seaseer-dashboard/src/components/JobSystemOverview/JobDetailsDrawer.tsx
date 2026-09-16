import React, { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { JobResponse, JobStatus } from '../../client';
import { TerminalConsole } from './TerminalConsole';

export interface JobDetailsDrawerProps {
  job: JobResponse | null;
  isOpen: boolean;
  onClose: () => void;
  onRetryJob?: (jobId: string, e?: React.MouseEvent) => void;
  onCancelJob?: (jobId: string, e?: React.MouseEvent) => void;
  retryingJobId?: string | null;
  cancellingJobId?: string | null;
}

const getJobStatusClass = (status: JobStatus): string => {
  switch (status) {
    case 'COMPLETED':
      return 'jso-status-completed';
    case 'RUNNING':
      return 'jso-status-running';
    case 'BLOCKED':
      return 'jso-status-blocked';
    case 'PENDING':
      return 'jso-status-pending';
    case 'FAILED':
      return 'jso-status-failed';
    case 'CANCELLED':
      return 'jso-status-cancelled';
    default:
      return 'jso-status-pending';
  }
};

const formatTime = (dateStr?: string | null): string => {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '-';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

const calculateDuration = (startStr?: string | null, endStr?: string | null): string => {
  if (!startStr) return '-';
  const start = new Date(startStr).getTime();
  if (isNaN(start)) return '-';

  const end = endStr ? new Date(endStr).getTime() : Date.now();
  if (isNaN(end)) return '-';

  const diffMs = Math.max(0, end - start);
  const totalSeconds = Math.floor(diffMs / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
};

export const JobDetailsDrawer: React.FC<JobDetailsDrawerProps> = ({
  job,
  isOpen,
  onClose,
  onRetryJob,
  onCancelJob,
  retryingJobId,
  cancellingJobId,
}) => {
  const [searchParams, setSearchParams] = useSearchParams();

  // Sync state to URL search params when drawer opens or closes
  useEffect(() => {
    if (isOpen && job) {
      const current = new URLSearchParams(searchParams);
      current.set('jobId', job.id);
      if (job.pipeline_id) {
        current.set('pipelineId', job.pipeline_id);
      }
      setSearchParams(current, { replace: true });
    } else if (!isOpen) {
      const current = new URLSearchParams(searchParams);
      if (current.has('jobId') || current.has('pipelineId')) {
        current.delete('jobId');
        current.delete('pipelineId');
        setSearchParams(current, { replace: true });
      }
    }
  }, [isOpen, job, setSearchParams]);

  if (!isOpen || !job) return null;

  const isRunning = job.status === 'RUNNING';
  const isPending = job.status === 'PENDING';
  const isBlocked = job.status === 'BLOCKED';
  const isFailed = job.status === 'FAILED';
  const isCancelled = job.status === 'CANCELLED';

  return (
    <div className="jso-drawer-backdrop" onClick={onClose}>
      <div
        className="jso-drawer-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Job Inspector - ${job.name}`}
      >
        {/* Drawer Header */}
        <div className="jso-drawer-header">
          <div className="jso-drawer-title-group">
            <span className="jso-drawer-icon">📟</span>
            <div className="jso-drawer-titles">
              <h3 className="jso-drawer-name" title={job.name}>
                {job.name}
              </h3>
              <span className="jso-drawer-sub">
                ID: {job.id} • {job.task_type || 'default'}
              </span>
            </div>
          </div>

          <div className="jso-drawer-header-actions">
            <span className={`jso-status-badge ${getJobStatusClass(job.status)}`}>
              {job.status}
            </span>

            <button
              type="button"
              className="jso-drawer-close-btn"
              onClick={onClose}
              title="Close Drawer"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Drawer Metadata Grid & Progress */}
        <div className="jso-drawer-meta-section">
          <div className="jso-drawer-meta-grid">
            <div className="jso-meta-card">
              <span className="jso-meta-lbl">Created</span>
              <span className="jso-meta-val">{formatTime(job.created_at)}</span>
            </div>
            <div className="jso-meta-card">
              <span className="jso-meta-lbl">Started</span>
              <span className="jso-meta-val">{formatTime(job.started_at)}</span>
            </div>
            <div className="jso-meta-card">
              <span className="jso-meta-lbl">Completed</span>
              <span className="jso-meta-val">{formatTime(job.completed_at)}</span>
            </div>
            <div className="jso-meta-card">
              <span className="jso-meta-lbl">Runtime</span>
              <span className="jso-meta-val">
                {calculateDuration(job.started_at || job.created_at, job.completed_at)}
              </span>
            </div>
          </div>

          {/* Quick Actions Bar */}
          {(((isRunning || isPending || isBlocked) && onCancelJob) || ((isFailed || isCancelled) && onRetryJob)) && (
            <div className="jso-drawer-actions-bar">
              {(isRunning || isPending || isBlocked) && onCancelJob && (
                <button
                  type="button"
                  className="jso-drawer-btn cancel"
                  onClick={(e) => onCancelJob(job.id, e)}
                  disabled={cancellingJobId === job.id}
                >
                  ⛔ Cancel Task
                </button>
              )}

              {(isFailed || isCancelled) && onRetryJob && (
                <button
                  type="button"
                  className="jso-drawer-btn retry"
                  onClick={(e) => onRetryJob(job.id, e)}
                  disabled={retryingJobId === job.id}
                >
                  ↻ Retry Task
                </button>
              )}
            </div>
          )}
        </div>

        {/* Drawer Body: Terminal Console Output */}
        <div className="jso-drawer-body">
          <TerminalConsole job={job} />
        </div>
      </div>
    </div>
  );
};
