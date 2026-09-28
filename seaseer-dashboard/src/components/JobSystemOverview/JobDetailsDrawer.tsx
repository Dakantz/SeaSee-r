import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { JobResponse, JobStatus } from '../../client';
import { TerminalConsole } from './TerminalConsole';
import { calculateDuration } from '../../utils/durationUtils';
import { formatDateTime } from '../../utils/dateUtils';

export interface JobDetailsDrawerProps {
  job: JobResponse | null;
  isOpen: boolean;
  onClose: () => void;
  onRetryJob?: (jobId: string, e?: React.MouseEvent) => void;
  onCancelJob?: (jobId: string, e?: React.MouseEvent) => void;
  retryingJobId?: string | null;
  cancellingJobId?: string | null;
  now?: number;
  style?: React.CSSProperties;
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

export const JobDetailsDrawer: React.FC<JobDetailsDrawerProps> = ({
  job,
  isOpen,
  onClose,
  onRetryJob,
  onCancelJob,
  retryingJobId,
  cancellingJobId,
  now: propNow,
  style,
}) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [internalNow, setInternalNow] = useState<number>(() => Date.now());
  const now = propNow ?? internalNow;
  const [copiedUuid, setCopiedUuid] = useState<boolean>(false);

  const isRunning = job?.status === 'RUNNING';

  useEffect(() => {
    if (propNow !== undefined || !isOpen || !isRunning) return;
    const interval = setInterval(() => {
      setInternalNow(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, [isOpen, isRunning, job?.id, propNow]);

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
  }, [isOpen, job, searchParams, setSearchParams]);

  const panelRef = useRef<HTMLDivElement>(null);

  // Close drawer when clicking outside of the drawer panel or pressing Escape
  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!target) return;

      // If clicked inside the drawer panel, do nothing
      if (panelRef.current && panelRef.current.contains(target)) {
        return;
      }

      // If clicked on an interactive job selection element (a job card in DAG or matrix row),
      // allow its own click handler to select/switch jobs smoothly without closing first
      if (target instanceof Element && (target.closest('.jso-job-node') || target.closest('.jso-matrix-row'))) {
        return;
      }

      onClose();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen || !job) return null;

  const isPending = job.status === 'PENDING';
  const isBlocked = job.status === 'BLOCKED';
  const isFailed = job.status === 'FAILED';
  const isCancelled = job.status === 'CANCELLED';

  const handleCopyUuid = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!job?.id) return;
    navigator.clipboard.writeText(job.id);
    setCopiedUuid(true);
    setTimeout(() => setCopiedUuid(false), 2000);
  };

  const truncatedUuid = job.id ? `${job.id.slice(0, 8)}...` : '-';

  return (
    <div className="jso-drawer-backdrop" style={style} onClick={onClose}>
      <div
        ref={panelRef}
        className="jso-drawer-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="job-drawer-title"
      >
        {/* Drawer Header */}
        <header className="jso-drawer-header">
          <div className="jso-drawer-title-group">
            <span className="jso-drawer-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="4 17 10 11 4 5" />
                <line x1="12" y1="19" x2="20" y2="19" />
              </svg>
            </span>
            <div className="jso-drawer-titles">
              <h3 id="job-drawer-title" className="jso-drawer-name" title={job.name}>
                {job.name}
              </h3>
              <span className="jso-drawer-sub">
                ID: {truncatedUuid}
                <button
                  type="button"
                  className="jso-copy-uuid-btn"
                  onClick={handleCopyUuid}
                  aria-label="Copy full UUID"
                  title={copiedUuid ? 'Copied UUID!' : 'Copy full UUID'}
                >
                  {copiedUuid ? (
                    <svg className="jso-icon-sm" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  ) : (
                    <svg className="jso-icon-sm" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                      <path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" />
                      <path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z" />
                    </svg>
                  )}
                </button>
                • {job.task_type || 'default'}
              </span>
            </div>
          </div>

          <div className="jso-drawer-header-actions">

            {(isRunning || isPending || isBlocked) && onCancelJob && (
              <button
                type="button"
                className="jso-drawer-btn cancel"
                onClick={(e) => onCancelJob(job.id, e)}
                disabled={cancellingJobId === job.id}
                aria-label="Cancel Task"
              >
                <svg className="jso-btn-icon" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V8a1 1 0 00-1-1H8z" clipRule="evenodd" />
                </svg>
                <span>Cancel Task</span>
              </button>
            )}

            {(isFailed || isCancelled) && onRetryJob && (
              <button
                type="button"
                className="jso-drawer-btn retry"
                onClick={(e) => onRetryJob(job.id, e)}
                disabled={retryingJobId === job.id}
                aria-label="Retry Task"
              >
                <svg className="jso-btn-icon" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
                </svg>
                <span>Retry Task</span>
              </button>
            )}

            <span className={`jso-status-badge ${getJobStatusClass(job.status)}`}>
              {job.status}
            </span>

            <button
              type="button"
              className="jso-drawer-close-btn"
              onClick={onClose}
              aria-label="Close drawer"
              title="Close Drawer"
            >
              <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16" aria-hidden="true">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        </header>

        {/* Drawer Metadata Strip */}
        <div className="jso-drawer-meta-section">
          <dl className="jso-meta-strip">
            <div className="jso-meta-item">
              <dt className="jso-meta-lbl">Created</dt>
              <dd className="jso-meta-val">
                <time dateTime={job.created_at || undefined} title={formatDateTime(job.created_at)}>
                  {formatDateTime(job.created_at)}
                </time>
              </dd>
            </div>
            <div className="jso-meta-item">
              <dt className="jso-meta-lbl">Started</dt>
              <dd className="jso-meta-val">
                <time dateTime={job.started_at || undefined} title={formatDateTime(job.started_at)}>
                  {formatDateTime(job.started_at)}
                </time>
              </dd>
            </div>
            <div className="jso-meta-item">
              <dt className="jso-meta-lbl">Completed</dt>
              <dd className="jso-meta-val">
                <time dateTime={job.completed_at || undefined} title={formatDateTime(job.completed_at)}>
                  {formatDateTime(job.completed_at)}
                </time>
              </dd>
            </div>
            <div className="jso-meta-item">
              <dt className="jso-meta-lbl">Runtime</dt>
              <dd className="jso-meta-val">
                {calculateDuration(job.started_at, job.completed_at, now)}
              </dd>
            </div>
          </dl>
        </div>

        {/* Drawer Body: Terminal Console Output */}
        <div className="jso-drawer-body">
          <TerminalConsole job={job} />
        </div>
      </div>
    </div>
  );
};
