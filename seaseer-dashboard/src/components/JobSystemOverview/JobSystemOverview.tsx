import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useJobSystemStatus } from '../../hooks/useJobSystemStatus';
import {
  cancelJob,
  retryJob,
  retryPipeline,
  deletePipeline,
  type JobResponse,
  type JobStatus,
  type PipelineResponse,
  type PipelineStatus,
} from '../../client';
import { PipelineGraph } from './PipelineGraph';
import { JobDetailsDrawer } from './JobDetailsDrawer';
import './JobSystemOverview.css';

export interface JobSystemOverviewProps {
  /**
   * Maximum number of recent jobs to fetch.
   * @default 10
   */
  limit?: number;

  /**
   * Fast polling interval in milliseconds when active jobs exist.
   * @default 2500
   */
  activePollInterval?: number;

  /**
   * Slow polling interval in milliseconds when all recent jobs are idle.
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
   * Callback fired when a job item is selected.
   */
  onJobSelect?: (job: JobResponse) => void;
}

type ViewMode = 'pipeline' | 'matrix';

const getPipelineStatusClass = (status: PipelineStatus): string => {
  switch (status) {
    case 'COMPLETED':
      return 'jso-pipe-status-completed';
    case 'RUNNING':
      return 'jso-pipe-status-running';
    case 'PENDING':
      return 'jso-pipe-status-pending';
    case 'FAILED':
      return 'jso-pipe-status-failed';
    case 'CANCELLED':
      return 'jso-pipe-status-cancelled';
    default:
      return 'jso-pipe-status-pending';
  }
};

const formatTime = (dateStr?: string | null): string => {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

const calculateDuration = (startStr?: string | null, endStr?: string | null, nowMs: number = Date.now()): string => {
  if (!startStr) return '-';
  const start = new Date(startStr).getTime();
  if (isNaN(start)) return '-';

  const end = endStr ? new Date(endStr).getTime() : nowMs;
  if (isNaN(end)) return '-';

  const diffMs = Math.max(0, end - start);
  const totalSeconds = Math.floor(diffMs / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
};

export const JobSystemOverview: React.FC<JobSystemOverviewProps> = ({
  limit = 10,
  activePollInterval = 2500,
  idlePollInterval = 30000,
  autoPoll = true,
  title = 'Job Pipelines',
  compact = false,
  className = '',
  style,
  onJobSelect,
}) => {
  const [searchParams] = useSearchParams();
  const {
    jobs,
    pipelines,
    loading,
    isRefreshing,
    error,
    isPollingFast,
    activeCount,
    refetch,
  } = useJobSystemStatus({
    limit,
    activePollInterval,
    idlePollInterval,
    autoPoll,
  });

  const [viewMode, setViewMode] = useState<ViewMode>('pipeline');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedJob, setSelectedJob] = useState<JobResponse | null>(null);

  // Live timer tick for active pipelines and jobs
  const [now, setNow] = useState<number>(Date.now());

  const hasActivePipelineOrJob = useMemo(() => {
    const activePipeline = pipelines.some((p) => p.status === 'RUNNING' || p.status === 'PENDING');
    const activeJob = jobs.some((j) => j.status === 'RUNNING' || j.status === 'PENDING');
    return activePipeline || activeJob;
  }, [pipelines, jobs]);

  useEffect(() => {
    if (!hasActivePipelineOrJob) return;
    setNow(Date.now());
    const interval = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, [hasActivePipelineOrJob]);

  // Optimistic job statuses map
  const [optimisticJobStatuses, setOptimisticJobStatuses] = useState<Record<string, JobStatus>>({});

  // Action loading states
  const [retryingJobId, setRetryingJobId] = useState<string | null>(null);
  const [cancellingJobId, setCancellingJobId] = useState<string | null>(null);
  const [retryingPipelineId, setRetryingPipelineId] = useState<string | null>(null);
  const [deletingPipelineId, setDeletingPipelineId] = useState<string | null>(null);

  // Auto-open drawer if URL contains ?jobId=<id>
  useEffect(() => {
    const urlJobId = searchParams.get('jobId');
    if (urlJobId && jobs.length > 0) {
      const target = jobs.find((j) => j.id === urlJobId);
      if (target) {
        setSelectedJob(target);
      }
    }
  }, [searchParams, jobs]);

  // Clear optimistic statuses when server refetch updates job list
  useEffect(() => {
    setOptimisticJobStatuses({});
  }, [jobs]);

  // Action Handlers with Optimistic Updates
  const handleRetryJob = async (jobId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setRetryingJobId(jobId);

    // Optimistic UI update
    setOptimisticJobStatuses((prev) => ({ ...prev, [jobId]: 'PENDING' }));

    try {
      const response = await retryJob({ path: { job_id: jobId } });
      if (response.error) {
        alert((response.error as any)?.detail || 'Failed to retry job');
        setOptimisticJobStatuses((prev) => {
          const copy = { ...prev };
          delete copy[jobId];
          return copy;
        });
      } else {
        await refetch();
        if (selectedJob?.id === jobId && response.data) {
          setSelectedJob(response.data);
        }
      }
    } catch (err: any) {
      alert(err.message || 'Network error retrying job');
      setOptimisticJobStatuses((prev) => {
        const copy = { ...prev };
        delete copy[jobId];
        return copy;
      });
    } finally {
      setRetryingJobId(null);
    }
  };

  const handleCancelJob = async (jobId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setCancellingJobId(jobId);

    // Optimistic UI update
    setOptimisticJobStatuses((prev) => ({ ...prev, [jobId]: 'CANCELLED' }));

    try {
      const response = await cancelJob({ path: { job_id: jobId } });
      if (response.error) {
        alert((response.error as any)?.detail || 'Failed to cancel job');
        setOptimisticJobStatuses((prev) => {
          const copy = { ...prev };
          delete copy[jobId];
          return copy;
        });
      } else {
        await refetch();
        if (selectedJob?.id === jobId && response.data) {
          setSelectedJob(response.data);
        }
      }
    } catch (err: any) {
      alert(err.message || 'Network error cancelling job');
      setOptimisticJobStatuses((prev) => {
        const copy = { ...prev };
        delete copy[jobId];
        return copy;
      });
    } finally {
      setCancellingJobId(null);
    }
  };

  const handleRetryPipeline = async (pipelineId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setRetryingPipelineId(pipelineId);

    try {
      const response = await retryPipeline({ path: { pipeline_id: pipelineId } });
      if (response.error) {
        alert((response.error as any)?.detail || 'Failed to retry pipeline');
      } else {
        await refetch();
      }
    } catch (err: any) {
      alert(err.message || 'Error retrying pipeline');
    } finally {
      setRetryingPipelineId(null);
    }
  };

  const handleDeletePipeline = async (pipelineId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this pipeline and its jobs?')) return;
    setDeletingPipelineId(pipelineId);
    try {
      const response = await deletePipeline({ path: { pipeline_id: pipelineId } });
      if (response.error) {
        alert((response.error as any)?.detail || 'Failed to delete pipeline');
      } else {
        await refetch();
        if (selectedJob?.pipeline_id === pipelineId) {
          setSelectedJob(null);
        }
      }
    } catch (err: any) {
      alert(err.message || 'Error deleting pipeline');
    } finally {
      setDeletingPipelineId(null);
    }
  };

  const handleDownloadFullLogs = (pipeJobs: JobResponse[]) => {
    const fullLogText = pipeJobs
      .map(
        (j) =>
          `==========================================\n` +
          `JOB: ${j.name} (ID: ${j.id})\n` +
          `STATUS: ${j.status} | TASK: ${j.task_type || 'default'}\n` +
          `CREATED: ${j.created_at} | COMPLETED: ${j.completed_at || 'N/A'}\n` +
          `PAYLOAD: ${JSON.stringify(j.payload || {})}\n` +
          (j.error_message ? `ERROR TRACE: ${j.error_message}\n` : '') +
          (j.result ? `RESULT: ${JSON.stringify(j.result)}\n` : '') +
          `==========================================\n`
      )
      .join('\n\n');

    const blob = new Blob([fullLogText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `pipeline_full_logs_${Date.now()}.log`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Group standalone jobs & pipelines
  const filteredJobs = useMemo(() => {
    if (!searchQuery.trim()) return jobs;
    const q = searchQuery.toLowerCase();
    return jobs.filter(
      (j) =>
        j.name.toLowerCase().includes(q) ||
        j.id.toLowerCase().includes(q) ||
        (j.task_type && j.task_type.toLowerCase().includes(q))
    );
  }, [jobs, searchQuery]);

  const groupedPipelines = useMemo(() => {
    const pipelineMap = new Map<string, { pipeline: PipelineResponse; jobs: JobResponse[] }>();

    pipelines.forEach((p) => {
      pipelineMap.set(p.id, { pipeline: p, jobs: p.jobs || [] });
    });

    const standaloneJobs: JobResponse[] = [];

    filteredJobs.forEach((job) => {
      const jobPipeId = job.pipeline_id;
      if (jobPipeId && pipelineMap.has(jobPipeId)) {
        const existing = pipelineMap.get(jobPipeId)!;
        if (!existing.jobs.some((j) => j.id === job.id)) {
          existing.jobs.push(job);
        }
      } else if (!jobPipeId) {
        standaloneJobs.push(job);
      }
    });

    const resultPipelines = Array.from(pipelineMap.values());

    let filteredPipeList = resultPipelines;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filteredPipeList = resultPipelines.filter(
        (item) =>
          item.pipeline.name.toLowerCase().includes(q) ||
          item.pipeline.id.toLowerCase().includes(q) ||
          item.jobs.some(
            (j) =>
              j.name.toLowerCase().includes(q) ||
              (j.task_type && j.task_type.toLowerCase().includes(q))
          )
      );
    }

    return {
      pipelines: filteredPipeList,
      standaloneJobs,
    };
  }, [pipelines, filteredJobs, searchQuery]);

  // Global summary counters
  const completedCount = jobs.filter((j) => j.status === 'COMPLETED').length;
  const failedCount = jobs.filter((j) => j.status === 'FAILED' || j.status === 'CANCELLED').length;

  return (
    <div
      className={`job-system-overview ${compact ? 'compact' : ''} ${className}`}
      style={style}
      role="region"
      aria-label="CI/CD Job Pipeline Overview"
    >
      {/* Header Bar */}
      <div className="jso-header">
        <div className="jso-title-group">
          <div className="jso-brand-icon" title="Git CI/CD Pipeline Interface">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="6" y1="3" x2="6" y2="15"></line>
              <circle cx="18" cy="6" r="3"></circle>
              <circle cx="6" cy="18" r="3"></circle>
              <path d="M18 9a9 9 0 0 1-9 9"></path>
            </svg>
          </div>
          <h3 className="jso-title">{title}</h3>

          {/* Smart Polling Indicator */}
          {autoPoll && (
            <span
              className={`jso-polling-badge ${isPollingFast ? 'active' : 'idle'}`}
              title={
                isPollingFast
                  ? `Active jobs running. Smart polling fast every ${activePollInterval / 1000}s`
                  : `All jobs idle. Smart polling slow every ${idlePollInterval / 1000}s`
              }
            >
              <span className="jso-pulse-dot" />
              {isPollingFast ? `LIVE` : `IDLE`}
            </span>
          )}
        </div>

        {/* Action Controls & View Mode Toggle */}
        <div className="jso-actions">
          <div className="jso-view-mode-toggle" title="Switch View Mode">
            <button
              type="button"
              className={`jso-mode-btn ${viewMode === 'pipeline' ? 'active' : ''}`}
              onClick={() => setViewMode('pipeline')}
              title="Pipeline Stage Flow Graph View"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="2" y="3" width="6" height="6" rx="1"></rect>
                <rect x="16" y="3" width="6" height="6" rx="1"></rect>
                <rect x="9" y="15" width="6" height="6" rx="1"></rect>
                <path d="M5 9v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9"></path>
                <path d="M12 14v1"></path>
              </svg>
              {!compact && <span>Pipeline Graph</span>}
            </button>
            <button
              type="button"
              className={`jso-mode-btn ${viewMode === 'matrix' ? 'active' : ''}`}
              onClick={() => setViewMode('matrix')}
              title="Job Matrix Table View"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="3" y1="6" x2="21" y2="6"></line>
                <line x1="3" y1="12" x2="21" y2="12"></line>
                <line x1="3" y1="18" x2="21" y2="18"></line>
              </svg>
              {!compact && <span>Job Matrix</span>}
            </button>
          </div>

          <button
            type="button"
            className="jso-refresh-btn"
            onClick={() => refetch()}
            disabled={loading || isRefreshing}
            title="Refresh pipeline status"
          >
            <span className={isRefreshing ? 'jso-spin-icon' : ''}>↻</span>
            {!compact && <span>{isRefreshing ? 'Refreshing...' : 'Refresh'}</span>}
          </button>
        </div>
      </div>

      {/* Filter & Summary Sub-Bar */}
      {!loading && !error && (
        <div className="jso-sub-bar">
          <div className="jso-search-box">
            <span className="jso-search-icon">🔍</span>
            <input
              type="text"
              className="jso-search-input"
              placeholder="Filter pipelines or tasks..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                type="button"
                className="jso-clear-search"
                onClick={() => setSearchQuery('')}
              >
                ✕
              </button>
            )}
          </div>

          <div className="jso-metrics-group">
            <span className="jso-metric active-m" title="Active Jobs">
              <span className="jso-metric-dot active-dot" /> {activeCount} Active
            </span>
            <span className="jso-metric pass-m" title="Passed Jobs">
              <span className="jso-metric-dot pass-dot" /> {completedCount} Done
            </span>
            <span className="jso-metric fail-m" title="Failed Jobs">
              <span className="jso-metric-dot fail-dot" /> {failedCount} Failed
            </span>
          </div>
        </div>
      )}

      {/* Loading Skeleton */}
      {loading && (
        <div className="jso-loading-container">
          <div className="jso-skeleton-pipeline">
            <div className="jso-skeleton-header" />
            <div className="jso-skeleton-stages">
              <div className="jso-skeleton-node" />
              <div className="jso-skeleton-line" />
              <div className="jso-skeleton-node" />
              <div className="jso-skeleton-line" />
              <div className="jso-skeleton-node" />
            </div>
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
      {!loading && !error && jobs.length === 0 && pipelines.length === 0 && (
        <div className="jso-empty-state">
          <div className="jso-empty-icon">🚀</div>
          <span>No job pipelines found in system</span>
        </div>
      )}

      {/* VIEW MODE 1: STAGE-BASED VISUAL DAG GRAPH */}
      {!loading && !error && viewMode === 'pipeline' && (
        <div className="jso-pipeline-container">
          {groupedPipelines.pipelines.map(({ pipeline, jobs: pipeJobs }) => {
            const hasFailedJob = pipeJobs.some((j) => {
              const st = optimisticJobStatuses[j.id] || j.status;
              return st === 'FAILED' || st === 'CANCELLED';
            });

            return (
              <div key={pipeline.id} className="jso-pipeline-card">
                {/* Pipeline Run Header */}
                <div className="jso-pipe-header">
                  <div className="jso-pipe-info">
                    <span className="jso-pipe-branch" title="Pipeline Workflow Branch">
                      ⎇ {pipeline.name || 'CI/CD Pipeline'}
                    </span>
                    <span className="jso-pipe-id" title={pipeline.id}>
                      #{pipeline.id.substring(0, 8)}
                    </span>
                    <span className={`jso-pipe-status-badge ${getPipelineStatusClass(pipeline.status)}`}>
                      {pipeline.status}
                    </span>
                  </div>

                  <div className="jso-pipe-meta-actions">
                    <span className="jso-pipe-time" title={`Created ${formatTime(pipeline.created_at)}`}>
                      ⏱ {calculateDuration(
                        pipeline.created_at,
                        pipeline.status === 'RUNNING' || pipeline.status === 'PENDING' ? null : pipeline.updated_at,
                        now
                      )}
                    </span>

                    {hasFailedJob && (
                      <button
                        type="button"
                        className="jso-pipe-action-btn retry"
                        onClick={(e) => handleRetryPipeline(pipeline.id, e)}
                        disabled={retryingPipelineId === pipeline.id}
                        title="Re-run failed jobs in pipeline"
                      >
                        <span className={retryingPipelineId === pipeline.id ? 'jso-spin-icon' : ''}>↻</span>
                        {!compact && <span>Re-run Failed</span>}
                      </button>
                    )}

                    <button
                      type="button"
                      className="jso-pipe-action-btn log"
                      onClick={() => handleDownloadFullLogs(pipeJobs)}
                      title="Download full pipeline execution logs"
                    >
                      <span>📥 Logs</span>
                    </button>

                    <button
                      type="button"
                      className="jso-pipe-action-btn delete"
                      onClick={(e) => handleDeletePipeline(pipeline.id, e)}
                      disabled={deletingPipelineId === pipeline.id}
                      title="Delete pipeline and associated jobs"
                    >
                      <span>🗑</span>
                    </button>
                  </div>
                </div>

                {/* Visual DAG Graph with Bezier Connectors */}
                <PipelineGraph
                  jobs={pipeJobs}
                  pipelineName={pipeline.name}
                  pipelineId={pipeline.id}
                  selectedJobId={selectedJob?.id}
                  optimisticJobStatuses={optimisticJobStatuses}
                  onSelectJob={(job) => {
                    setSelectedJob(job);
                    onJobSelect?.(job);
                  }}
                  onRetryJob={handleRetryJob}
                  onCancelJob={handleCancelJob}
                  retryingJobId={retryingJobId}
                  cancellingJobId={cancellingJobId}
                />
              </div>
            );
          })}

          {/* Standalone Jobs DAG Canvas */}
          {groupedPipelines.standaloneJobs.length > 0 && (
            <div className="jso-pipeline-card standalone-card">
              <div className="jso-pipe-header">
                <div className="jso-pipe-info">
                  <span className="jso-pipe-branch">⚡ Standalone / Ad-hoc Tasks</span>
                  <span className="jso-pipe-id">({groupedPipelines.standaloneJobs.length} tasks)</span>
                </div>
              </div>

              <PipelineGraph
                jobs={groupedPipelines.standaloneJobs}
                pipelineName="Standalone Tasks"
                selectedJobId={selectedJob?.id}
                optimisticJobStatuses={optimisticJobStatuses}
                onSelectJob={(job) => {
                  setSelectedJob(job);
                  onJobSelect?.(job);
                }}
                onRetryJob={handleRetryJob}
                onCancelJob={handleCancelJob}
                retryingJobId={retryingJobId}
                cancellingJobId={cancellingJobId}
              />
            </div>
          )}
        </div>
      )}

      {/* VIEW MODE 2: JOB MATRIX TABLE */}
      {!loading && !error && viewMode === 'matrix' && (
        <div className="jso-matrix-table-wrapper">
          <table className="jso-matrix-table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Job / Stage Name</th>
                <th>Task Type</th>
                <th>Progress</th>
                <th>Runtime</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredJobs.map((job) => {
                const optStatus = optimisticJobStatuses[job.id];
                const effectiveStatus = optStatus || job.status;
                const isActive = effectiveStatus === 'RUNNING' || effectiveStatus === 'PENDING' || effectiveStatus === 'BLOCKED';
                const isFailed = effectiveStatus === 'FAILED' || effectiveStatus === 'CANCELLED';

                return (
                  <tr
                    key={job.id}
                    onClick={() => {
                      setSelectedJob(job);
                      onJobSelect?.(job);
                    }}
                    className={`jso-matrix-row ${selectedJob?.id === job.id ? 'selected' : ''}`}
                  >
                    <td>
                      <span className={`jso-status-badge ${getPipelineStatusClass(effectiveStatus as any)}`}>
                        {effectiveStatus}
                      </span>
                    </td>
                    <td>
                      <div className="jso-matrix-job-name">{job.name}</div>
                      <div className="jso-matrix-job-id">ID: {job.id}</div>
                    </td>
                    <td>
                      <span className="jso-matrix-tag">{job.task_type || 'default'}</span>
                    </td>
                    <td>
                      <div className="jso-matrix-progress-cell">
                        {(() => {
                          const progVal = effectiveStatus === 'COMPLETED' ? 100 : Math.min(100, Math.max(0, job.progress || 0));
                          return (
                            <>
                              <div className="jso-matrix-progress-bar">
                                <div
                                  className={`jso-matrix-progress-fill status-${effectiveStatus.toLowerCase()}`}
                                  style={{ width: `${progVal}%` }}
                                />
                              </div>
                              <span>{progVal.toFixed(0)}%</span>
                            </>
                          );
                        })()}
                      </div>
                    </td>
                    <td className="jso-matrix-time">
                      {calculateDuration(job.started_at || job.created_at, job.completed_at, now)}
                    </td>
                    <td>
                      <div className="jso-matrix-actions" onClick={(e) => e.stopPropagation()}>
                        {isActive && (
                          <button
                            type="button"
                            className="jso-cancel-job-btn"
                            onClick={(e) => handleCancelJob(job.id, e)}
                            disabled={cancellingJobId === job.id}
                            title="Cancel Job"
                          >
                            Cancel
                          </button>
                        )}
                        {isFailed && (
                          <button
                            type="button"
                            className="jso-retry-job-btn"
                            onClick={(e) => handleRetryJob(job.id, e)}
                            disabled={retryingJobId === job.id}
                            title="Retry Job"
                          >
                            Retry
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* RIGHT SLIDE-OUT DETAILS DRAWER */}
      <JobDetailsDrawer
        job={selectedJob}
        isOpen={!!selectedJob}
        onClose={() => setSelectedJob(null)}
        onRetryJob={handleRetryJob}
        onCancelJob={handleCancelJob}
        retryingJobId={retryingJobId}
        cancellingJobId={cancellingJobId}
      />
    </div>
  );
};
