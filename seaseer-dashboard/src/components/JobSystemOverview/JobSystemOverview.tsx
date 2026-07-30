import React, { useState } from 'react';
import { useJobSystemStatus } from '../../hooks/useJobSystemStatus';
import type { JobResponse, JobStatus } from '../../client';
import './JobSystemOverview.css';

export interface JobSystemOverviewProps {
  /**
   * Maximum number of recent jobs to fetch.
   * Passed to backend `GET /jobs?limit=X`.
   * @default 10
   */
  limit?: number;

  /**
   * Fast polling interval in milliseconds when PENDING or RUNNING jobs exist.
   * @default 2500
   */
  activePollInterval?: number;

  /**
   * Slow polling interval in milliseconds when all recent jobs are COMPLETED or FAILED.
   * @default 30000
   */
  idlePollInterval?: number;

  /**
   * Enables or disables auto-polling.
   * @default true
   */
  autoPoll?: boolean;

  /**
   * Title text for the component header.
   * @default "Job System Overview"
   */
  title?: string;

  /**
   * Compact layout mode for narrow sidebars or popovers.
   * @default false
   */
  compact?: boolean;

  /**
   * Custom CSS class name.
   */
  className?: string;

  /**
   * Inline style object.
   */
  style?: React.CSSProperties;

  /**
   * Callback fired when a job item is clicked.
   */
  onJobSelect?: (job: JobResponse) => void;
}

/**
 * Returns CSS class for job status badge styling:
 * PENDING = gray/yellow
 * RUNNING = blue
 * COMPLETED = green
 * FAILED = red
 */
const getStatusBadgeClass = (status: JobStatus): string => {
  switch (status) {
    case 'PENDING':
      return 'jso-status-pending';
    case 'RUNNING':
      return 'jso-status-running';
    case 'COMPLETED':
      return 'jso-status-completed';
    case 'FAILED':
      return 'jso-status-failed';
    default:
      return 'jso-status-pending';
  }
};

/**
 * Formats ISO date string into relative time or readable short format.
 */
const formatTime = (dateStr?: string | null): string => {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

export const JobSystemOverview: React.FC<JobSystemOverviewProps> = ({
  limit = 10,
  activePollInterval = 2500,
  idlePollInterval = 30000,
  autoPoll = true,
  title = 'Job System Overview',
  compact = false,
  className = '',
  style,
  onJobSelect,
}) => {
  const {
    jobs,
    loading,
    isRefreshing,
    error,
    isPollingFast,
    activeCount,
    lastUpdated,
    refetch,
  } = useJobSystemStatus({
    limit,
    activePollInterval,
    idlePollInterval,
    autoPoll,
  });

  // Track expanded error rows for FAILED jobs (job ID set)
  const [expandedErrorIds, setExpandedErrorIds] = useState<Set<string>>(new Set());

  const toggleErrorExpand = (jobId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedErrorIds((prev) => {
      const next = new Set(prev);
      if (next.has(jobId)) {
        next.delete(jobId);
      } else {
        next.add(jobId);
      }
      return next;
    });
  };

  // Summary counts
  const completedCount = jobs.filter((j) => j.status === 'COMPLETED').length;
  const failedCount = jobs.filter((j) => j.status === 'FAILED').length;

  return (
    <div
      className={`job-system-overview ${compact ? 'compact' : ''} ${className}`}
      style={style}
      role="region"
      aria-label="Job System Overview"
    >
      {/* Header */}
      <div className="jso-header">
        <div className="jso-title-group">
          <h3 className="jso-title">{title}</h3>

          {/* Smart Polling Indicator */}
          {autoPoll && (
            <span
              className={`jso-polling-badge ${isPollingFast ? 'active' : 'idle'}`}
              title={
                isPollingFast
                  ? `Active jobs detected. Smart polling fast every ${activePollInterval / 1000}s`
                  : `All jobs idle. Smart polling slow every ${idlePollInterval / 1000}s`
              }
            >
              <span className="jso-pulse-dot" />
              {isPollingFast
                ? `LIVE (${activePollInterval / 1000}s)`
                : `IDLE (${idlePollInterval / 1000}s)`}
            </span>
          )}
        </div>

        {/* Action Controls */}
        <div className="jso-actions">
          <button
            type="button"
            className="jso-refresh-btn"
            onClick={() => refetch()}
            disabled={loading || isRefreshing}
            title="Refresh job status"
          >
            <span className={isRefreshing ? 'jso-spin-icon' : ''}>↻</span>
            {!compact && <span>{isRefreshing ? 'Updating...' : 'Refresh'}</span>}
          </button>
        </div>
      </div>

      {/* Summary Counter Bar */}
      {!loading && !error && jobs.length > 0 && (
        <div className="jso-summary-bar">
          <div className="jso-summary-item">
            <span className="jso-summary-label">Active:</span>
            <span
              className="jso-summary-val"
              style={{ color: activeCount > 0 ? '#60a5fa' : '#94a3b8' }}
            >
              {activeCount}
            </span>
          </div>
          <div className="jso-summary-item">
            <span className="jso-summary-label">Done:</span>
            <span className="jso-summary-val" style={{ color: '#34d399' }}>
              {completedCount}
            </span>
          </div>
          <div className="jso-summary-item">
            <span className="jso-summary-label">Failed:</span>
            <span className="jso-summary-val" style={{ color: failedCount > 0 ? '#f87171' : '#94a3b8' }}>
              {failedCount}
            </span>
          </div>
          {lastUpdated && !compact && (
            <div className="jso-summary-item" style={{ marginLeft: 'auto', fontSize: '10.5px', color: '#64748b' }}>
              Updated {formatTime(lastUpdated.toISOString())}
            </div>
          )}
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="jso-loading-container">
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div className="jso-skeleton-item" />
            <div className="jso-skeleton-item" />
            <div className="jso-skeleton-item" />
          </div>
        </div>
      )}

      {/* Error State */}
      {!loading && error && (
        <div className="jso-error-state">
          <span>⚠️ {error}</span>
          <button type="button" className="jso-retry-btn" onClick={() => refetch()}>
            Retry Connection
          </button>
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && jobs.length === 0 && (
        <div className="jso-empty-state">
          <span style={{ fontSize: '24px' }}>📋</span>
          <span>No backend jobs found</span>
        </div>
      )}

      {/* Job List */}
      {!loading && !error && jobs.length > 0 && (
        <div className="jso-list">
          {jobs.map((job) => {
            const isFailed = job.status === 'FAILED';
            const isErrorExpanded = expandedErrorIds.has(job.id);
            const progressValue = Math.min(100, Math.max(0, job.progress || 0));

            return (
              <div
                key={job.id}
                className="jso-item"
                onClick={() => onJobSelect?.(job)}
                style={{ cursor: onJobSelect ? 'pointer' : 'default' }}
              >
                {/* Job Info & Status Badge */}
                <div className="jso-item-main">
                  <div className="jso-job-info">
                    <span className="jso-job-name" title={job.name}>
                      {job.name || 'Unnamed Job'}
                    </span>
                    <div className="jso-job-meta">
                      <span>ID: {job.id.substring(0, 8)}...</span>
                      <span>•</span>
                      <span>{formatTime(job.created_at)}</span>
                    </div>
                  </div>

                  {/* Status Badge */}
                  <span className={`jso-status-badge ${getStatusBadgeClass(job.status)}`}>
                    {job.status}
                  </span>
                </div>

                {/* Visual Progress Indicator (0.0 to 100.0) */}
                <div className="jso-progress-section">
                  <div className="jso-progress-bar-bg">
                    <div
                      className={`jso-progress-bar-fill status-${job.status.toLowerCase()}`}
                      style={{ width: `${progressValue}%` }}
                    />
                  </div>
                  <span className="jso-progress-percent">
                    {progressValue.toFixed(1)}%
                  </span>
                </div>

                {/* Error Expandable Row for FAILED Jobs */}
                {isFailed && job.error_message && (
                  <div>
                    <button
                      type="button"
                      className="jso-error-toggle-btn"
                      onClick={(e) => toggleErrorExpand(job.id, e)}
                    >
                      <span>{isErrorExpanded ? '▼ Hide Error Details' : '▶ Show Error Details'}</span>
                    </button>
                    {isErrorExpanded && (
                      <div className="jso-error-container">
                        <strong>Error Log:</strong> {job.error_message}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
