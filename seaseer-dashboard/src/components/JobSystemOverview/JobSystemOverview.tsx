import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useJobSystemStatus } from '../../hooks/useJobSystemStatus';
import {
  cancelJob,
  retryJob,
  deleteJob,
  type JobResponse,
  type JobStatus,
  type PipelineResponse,
  type PipelineStatus,
} from '../../client';
import { PipelineGraph } from './PipelineGraph';
import { JobDetailsDrawer } from './JobDetailsDrawer';
import { calculateDuration, formatDurationSeconds } from '../../utils/durationUtils';
import { formatDateTime } from '../../utils/dateUtils';
import './JobSystemOverview.css';

export interface JobSystemOverviewProps {
  /**
   * Maximum number of recent jobs to fetch (0 for unlimited).
   * @default 0
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

export type OverviewItem =
  | { type: 'pipeline'; id: string; created_at: string; pipeline: PipelineResponse; jobs: JobResponse[] }
  | { type: 'standalone'; id: string; created_at: string; job: JobResponse };

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

const calculatePipelineDuration = (
  pipeJobs: JobResponse[],
  pipelineStatus: string,
  nowMs: number = Date.now()
): string => {
  if (!pipeJobs || pipeJobs.length === 0) return '-';

  const jobStartTimes = pipeJobs
    .map((j) => (j.started_at ? new Date(j.started_at).getTime() : null))
    .filter((t): t is number => t !== null && !isNaN(t));

  if (jobStartTimes.length === 0) return '-';

  const firstStartMs = Math.min(...jobStartTimes);

  const isTerminal =
    ['COMPLETED', 'FAILED', 'CANCELLED'].includes(pipelineStatus) ||
    (pipeJobs.length > 0 && pipeJobs.every((j) => ['COMPLETED', 'FAILED', 'CANCELLED'].includes(j.status)));

  let lastCompletionMs: number | undefined = undefined;
  if (isTerminal) {
    const jobEndTimes = pipeJobs
      .map((j) => (j.completed_at ? new Date(j.completed_at).getTime() : null))
      .filter((t): t is number => t !== null && !isNaN(t));
    if (jobEndTimes.length > 0) {
      lastCompletionMs = Math.max(...jobEndTimes);
    }
  }

  const endMs = lastCompletionMs !== undefined ? lastCompletionMs : nowMs;
  const diffMs = Math.max(0, endMs - firstStartMs);
  const totalSeconds = Math.floor(diffMs / 1000);
  return formatDurationSeconds(totalSeconds);
};

const matchesSearchQuery = (
  query: string,
  target?: { id?: string | null; name?: string | null; task_type?: string | null; pipeline_id?: string | null }
): boolean => {
  if (!query || !query.trim() || !target) return false;
  const q = query.toLowerCase().trim();
  const qClean = q.replace(/^#/, '');

  if (target.id && (target.id.toLowerCase().includes(q) || target.id.toLowerCase().includes(qClean))) {
    return true;
  }
  if (target.name && target.name.toLowerCase().includes(q)) {
    return true;
  }
  if (target.task_type && target.task_type.toLowerCase().includes(q)) {
    return true;
  }
  if (target.pipeline_id && (target.pipeline_id.toLowerCase().includes(q) || target.pipeline_id.toLowerCase().includes(qClean))) {
    return true;
  }
  return false;
};

export const JobSystemOverview: React.FC<JobSystemOverviewProps> = ({
  limit = 0,
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
  const [deletingPipelineId, setDeletingPipelineId] = useState<string | null>(null);
  const [cancellingPipelineId, setCancellingPipelineId] = useState<string | null>(null);
  const [retryingPipelineId, setRetryingPipelineId] = useState<string | null>(null);

  const contentAreaRef = React.useRef<HTMLDivElement | null>(null);
  const [drawerTopOffset, setDrawerTopOffset] = useState<number>(0);

  // Dynamic alignment of JobDetailsDrawer top edge to target pipeline card header or matrix row
  const updateDrawerAlignment = () => {
    if (!selectedJob || !contentAreaRef.current) {
      setDrawerTopOffset(0);
      return;
    }
    const jobEl = document.querySelector(`[data-job-id="${selectedJob.id}"]`);
    if (!jobEl) {
      setDrawerTopOffset(0);
      return;
    }

    const pipeCard = jobEl.closest('.jso-pipeline-card');
    const targetHeader = pipeCard?.querySelector('.jso-pipe-header') || jobEl;

    const containerRect = contentAreaRef.current.getBoundingClientRect();
    const headerRect = targetHeader.getBoundingClientRect();

    const topOffset = headerRect.top - containerRect.top;
    setDrawerTopOffset(Math.max(0, topOffset));
  };

  // Auto-scroll target job into view when selectedJob changes or URL deep-links
  const handleLocateSelectedJob = (targetJobId?: string) => {
    const id = targetJobId || selectedJob?.id;
    if (!id) return;
    setTimeout(() => {
      const el = document.querySelector(`[data-job-id="${id}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
        updateDrawerAlignment();
      }
    }, 120);
  };

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

  // Trigger auto-scroll & drawer alignment whenever selectedJob or viewMode changes
  useEffect(() => {
    if (selectedJob?.id) {
      handleLocateSelectedJob(selectedJob.id);
      updateDrawerAlignment();
    }
    const handleScrollOrResize = () => updateDrawerAlignment();

    const scrollContainer = contentAreaRef.current?.querySelector('.jso-pipeline-container, .jso-matrix-table-wrapper');
    scrollContainer?.addEventListener('scroll', handleScrollOrResize, { passive: true });
    window.addEventListener('resize', handleScrollOrResize, { passive: true });

    let rafId: number;
    rafId = requestAnimationFrame(() => {
      updateDrawerAlignment();
    });

    return () => {
      scrollContainer?.removeEventListener('scroll', handleScrollOrResize);
      window.removeEventListener('resize', handleScrollOrResize);
      cancelAnimationFrame(rafId);
    };
  }, [selectedJob?.id, viewMode]);

  // Clear optimistic statuses when server refetch updates job list
  useEffect(() => {
    setOptimisticJobStatuses({});
  }, [jobs]);

  // Action Handlers with Optimistic Updates
  const handleRetryJob = async (jobId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setRetryingJobId(jobId);

    const targetJob = jobs.find((j) => j.id === jobId);
    const pipeId = targetJob?.pipeline_id;

    if (pipeId) {
      const pipeJobs = jobs.filter((j) => j.pipeline_id === pipeId && j.status !== 'COMPLETED');
      setOptimisticJobStatuses((prev) => {
        const next = { ...prev };
        const completedIds = new Set(
          jobs.filter((pj) => pj.pipeline_id === pipeId && pj.status === 'COMPLETED').map((pj) => pj.id)
        );
        pipeJobs.forEach((j) => {
          const deps = j.depends_on || [];
          if (!deps.length || deps.every((d) => completedIds.has(String(d)))) {
            next[j.id] = 'PENDING';
          } else {
            next[j.id] = 'BLOCKED';
          }
        });
        return next;
      });
    } else {
      setOptimisticJobStatuses((prev) => ({ ...prev, [jobId]: 'PENDING' }));
    }

    try {
      const response = await retryJob({ path: { job_id: jobId } });
      if (response.error) {
        alert((response.error as any)?.detail || 'Failed to retry job');
        setOptimisticJobStatuses({});
      } else {
        await refetch();
        if (selectedJob?.id === jobId && response.data) {
          setSelectedJob(response.data);
        }
      }
    } catch (err: any) {
      alert(err.message || 'Network error retrying job');
      setOptimisticJobStatuses({});
    } finally {
      setRetryingJobId(null);
    }
  };

  const handleCancelJob = async (jobId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setCancellingJobId(jobId);

    const targetJob = jobs.find((j) => j.id === jobId);
    const pipeId = targetJob?.pipeline_id;

    if (pipeId) {
      const pipeJobs = jobs.filter((j) => j.pipeline_id === pipeId && j.status !== 'COMPLETED');
      setOptimisticJobStatuses((prev) => {
        const next = { ...prev };
        pipeJobs.forEach((j) => {
          next[j.id] = 'CANCELLED';
        });
        return next;
      });
    } else {
      setOptimisticJobStatuses((prev) => ({ ...prev, [jobId]: 'CANCELLED' }));
    }

    try {
      const response = await cancelJob({ path: { job_id: jobId } });
      if (response.error) {
        alert((response.error as any)?.detail || 'Failed to cancel job');
        setOptimisticJobStatuses({});
      } else {
        await refetch();
        if (selectedJob?.id === jobId && response.data) {
          setSelectedJob(response.data);
        }
      }
    } catch (err: any) {
      alert(err.message || 'Network error cancelling job');
      setOptimisticJobStatuses({});
    } finally {
      setCancellingJobId(null);
    }
  };

  const handleCancelAllPipelineJobs = async (
    pipelineId: string,
    pipeJobs: JobResponse[],
    e: React.MouseEvent
  ) => {
    e.stopPropagation();

    const cancellableStatuses = new Set<JobStatus>(['RUNNING', 'BLOCKED', 'PENDING']);
    const targetJobs = pipeJobs.filter((j) => {
      const effectiveStatus = optimisticJobStatuses[j.id] || j.status;
      return cancellableStatuses.has(effectiveStatus);
    });

    if (targetJobs.length === 0) return;

    setCancellingPipelineId(pipelineId);

    // Optimistically mark all running/blocked/pending jobs as CANCELLED
    setOptimisticJobStatuses((prev) => {
      const next = { ...prev };
      targetJobs.forEach((j) => {
        next[j.id] = 'CANCELLED';
      });
      return next;
    });

    try {
      for (const job of targetJobs) {
        try {
          const response = await cancelJob({ path: { job_id: job.id } });
          if (response.error) {
            console.warn(`Cancel job ${job.id} warning:`, response.error);
          }
        } catch (err: any) {
          console.warn(`Cancel job ${job.id} error:`, err);
        }
      }
      await refetch();
      if (selectedJob && targetJobs.some((j) => j.id === selectedJob.id)) {
        const updated = jobs.find((j) => j.id === selectedJob.id);
        if (updated) {
          setSelectedJob(updated);
        }
      }
    } catch (err: any) {
      alert(err.message || 'Error cancelling pipeline jobs');
      setOptimisticJobStatuses({});
    } finally {
      setCancellingPipelineId(null);
    }
  };

  const handleRetryAllPipelineJobs = async (
    pipelineId: string,
    pipeJobs: JobResponse[],
    e: React.MouseEvent
  ) => {
    e.stopPropagation();

    const retryableStatuses = new Set<JobStatus>(['CANCELLED', 'FAILED']);
    const targetJobs = pipeJobs.filter((j) => {
      const effectiveStatus = optimisticJobStatuses[j.id] || j.status;
      return retryableStatuses.has(effectiveStatus);
    });

    if (targetJobs.length === 0) return;

    setRetryingPipelineId(pipelineId);

    // Topological depth sorting so upstream/parent jobs are retried before downstream children
    const jobMap = new Map<string, JobResponse>();
    pipeJobs.forEach((j) => jobMap.set(j.id, j));

    const depthMap = new Map<string, number>();
    const getDepth = (jobId: string, visited = new Set<string>()): number => {
      if (depthMap.has(jobId)) return depthMap.get(jobId)!;
      if (visited.has(jobId)) return 0;
      visited.add(jobId);
      const j = jobMap.get(jobId);
      if (!j || !j.depends_on || j.depends_on.length === 0) {
        depthMap.set(jobId, 0);
        return 0;
      }
      let maxDepth = -1;
      for (const parentId of j.depends_on) {
        if (jobMap.has(String(parentId))) {
          maxDepth = Math.max(maxDepth, getDepth(String(parentId), new Set(visited)));
        }
      }
      const curDepth = maxDepth + 1;
      depthMap.set(jobId, curDepth);
      return curDepth;
    };

    const sortedJobsToRetry = [...targetJobs].sort((a, b) => getDepth(a.id) - getDepth(b.id));

    // Optimistically update statuses:
    // If all dependencies are already COMPLETED, job becomes PENDING; otherwise BLOCKED
    const completedIds = new Set(
      pipeJobs.filter((pj) => pj.status === 'COMPLETED').map((pj) => pj.id)
    );
    setOptimisticJobStatuses((prev) => {
      const next = { ...prev };
      sortedJobsToRetry.forEach((j) => {
        const deps = j.depends_on || [];
        if (!deps.length || deps.every((d) => completedIds.has(String(d)))) {
          next[j.id] = 'PENDING';
        } else {
          next[j.id] = 'BLOCKED';
        }
      });
      return next;
    });

    try {
      for (const job of sortedJobsToRetry) {
        try {
          const response = await retryJob({ path: { job_id: job.id } });
          if (response.error) {
            console.warn(`Retry job ${job.id} warning:`, response.error);
          }
        } catch (err: any) {
          console.warn(`Retry job ${job.id} error:`, err);
        }
      }
      await refetch();
      if (selectedJob && sortedJobsToRetry.some((j) => j.id === selectedJob.id)) {
        const updated = jobs.find((j) => j.id === selectedJob.id);
        if (updated) {
          setSelectedJob(updated);
        }
      }
    } catch (err: any) {
      alert(err.message || 'Error retrying pipeline jobs');
      setOptimisticJobStatuses({});
    } finally {
      setRetryingPipelineId(null);
    }
  };

  const handleDeletePipeline = async (pipelineId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this pipeline and its jobs?')) return;
    setDeletingPipelineId(pipelineId);
    try {
      const pipeJobs = jobs.filter((j) => j.pipeline_id === pipelineId);
      if (pipeJobs.length > 0) {
        await Promise.all(pipeJobs.map((j) => deleteJob({ path: { job_id: j.id } }).catch(() => null)));
      }
      await refetch();
      if (selectedJob?.pipeline_id === pipelineId) {
        setSelectedJob(null);
      }
    } catch (err: any) {
      alert(err.message || 'Error deleting pipeline');
    } finally {
      setDeletingPipelineId(null);
    }
  };

  const handleDeleteJob = async (jobId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this task?')) return;
    try {
      await deleteJob({ path: { job_id: jobId } });
      await refetch();
      if (selectedJob?.id === jobId) {
        setSelectedJob(null);
      }
    } catch (err: any) {
      alert(err.message || 'Error deleting task');
    }
  };

  const handleDownloadFullLogs = (pipeJobs: JobResponse[]) => {
    const fullLogText = pipeJobs
      .map(
        (j) =>
          `==========================================\n` +
          `JOB: ${j.name} (ID: ${j.id})\n` +
          `TYPE: ${j.task_type || 'N/A'}\n` +
          `STATUS: ${j.status}\n` +
          `PROGRESS: ${j.progress}%\n` +
          `STARTED: ${j.started_at || 'N/A'}\n` +
          `COMPLETED: ${j.completed_at || 'N/A'}\n` +
          `ERROR: ${j.error_message || 'None'}\n` +
          `RESULT: ${JSON.stringify(j.result || {}, null, 2)}\n` +
          `==========================================\n`
      )
      .join('\n');

    const blob = new Blob([fullLogText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `pipeline_logs_${Date.now()}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Find pipeline IDs matching the search query
  const matchingPipelineIds = useMemo(() => {
    if (!searchQuery.trim()) return new Set<string>();
    const q = searchQuery.trim();
    const set = new Set<string>();

    pipelines.forEach((p) => {
      if (matchesSearchQuery(q, { id: p.id, name: p.name })) {
        set.add(p.id);
      } else if (p.jobs && p.jobs.some((j) => matchesSearchQuery(q, j))) {
        set.add(p.id);
      }
    });

    jobs.forEach((j) => {
      if (j.pipeline_id && matchesSearchQuery(q, j)) {
        set.add(j.pipeline_id);
      }
    });

    return set;
  }, [pipelines, jobs, searchQuery]);

  // Filter jobs for Matrix View (includes all jobs from matching pipelines)
  const filteredJobs = useMemo(() => {
    if (!searchQuery.trim()) return jobs;
    const q = searchQuery.trim();

    return jobs.filter((j) => {
      if (matchesSearchQuery(q, j)) return true;
      if (j.pipeline_id && matchingPipelineIds.has(j.pipeline_id)) return true;
      return false;
    });
  }, [jobs, searchQuery, matchingPipelineIds]);

  // Intermix pipelines & standalone jobs into a single list ordered descending by created_at (latest first)
  const unifiedItems = useMemo<OverviewItem[]>(() => {
    const pipelineMap = new Map<string, { pipeline: PipelineResponse; jobs: JobResponse[] }>();

    pipelines.forEach((p) => {
      pipelineMap.set(p.id, { pipeline: p, jobs: p.jobs ? [...p.jobs] : [] });
    });

    const standaloneJobs: JobResponse[] = [];

    jobs.forEach((job) => {
      const jobPipeId = job.pipeline_id;
      if (jobPipeId) {
        if (!pipelineMap.has(jobPipeId)) {
          pipelineMap.set(jobPipeId, {
            pipeline: {
              id: jobPipeId,
              name: `Pipeline #${jobPipeId.substring(0, 8)}`,
              status: job.status as any,
              created_at: job.created_at,
              updated_at: job.created_at,
              jobs: [],
            },
            jobs: [],
          });
        }
        const existing = pipelineMap.get(jobPipeId)!;
        const idx = existing.jobs.findIndex((j) => j.id === job.id);
        if (idx >= 0) {
          existing.jobs[idx] = { ...existing.jobs[idx], ...job };
        } else {
          existing.jobs.push(job);
        }
      } else {
        standaloneJobs.push(job);
      }
    });

    const items: OverviewItem[] = [];

    pipelineMap.forEach(({ pipeline, jobs: pipeJobs }) => {
      items.push({
        type: 'pipeline',
        id: pipeline.id,
        created_at: pipeline.created_at,
        pipeline,
        jobs: pipeJobs,
      });
    });

    standaloneJobs.forEach((job) => {
      items.push({
        type: 'standalone',
        id: job.id,
        created_at: job.created_at,
        job,
      });
    });

    let filteredItems = items;
    if (searchQuery.trim()) {
      const q = searchQuery.trim();
      filteredItems = items.filter((item) => {
        if (item.type === 'pipeline') {
          const pipeMatch = matchesSearchQuery(q, {
            id: item.pipeline.id,
            name: item.pipeline.name,
          });
          const jobMatch = item.jobs.some((j) => matchesSearchQuery(q, j));
          return pipeMatch || jobMatch;
        } else {
          return matchesSearchQuery(q, item.job);
        }
      });
    }

    return filteredItems.sort((a, b) => {
      const timeA = new Date(a.created_at).getTime();
      const timeB = new Date(b.created_at).getTime();
      return (isNaN(timeB) ? 0 : timeB) - (isNaN(timeA) ? 0 : timeA);
    });
  }, [pipelines, jobs, searchQuery]);

  const sortedFilteredJobs = useMemo(() => {
    return [...filteredJobs].sort((a, b) => {
      const timeA = new Date(a.created_at).getTime();
      const timeB = new Date(b.created_at).getTime();
      return (isNaN(timeB) ? 0 : timeB) - (isNaN(timeA) ? 0 : timeA);
    });
  }, [filteredJobs]);

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
            disabled={loading}
            title="Refresh pipeline status"
          >
            <span>↻</span>
            {!compact && <span>Refresh</span>}
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

      {/* MAIN CONTENT AREA & DRAWER WRAPPER */}
      <div className="jso-content-area" ref={contentAreaRef}>
        {/* VIEW MODE 1: STAGE-BASED VISUAL DAG GRAPH */}
        {!loading && !error && viewMode === 'pipeline' && (
          <div className="jso-pipeline-container">
            {unifiedItems.map((item) => {
              if (item.type === 'pipeline') {
                const { pipeline, jobs: pipeJobs } = item;
                const isCancelling = cancellingPipelineId === pipeline.id;
                const isRetrying = retryingPipelineId === pipeline.id;
                const isDeleting = deletingPipelineId === pipeline.id;
                const isBusy = isCancelling || isRetrying || isDeleting;

                const hasCancellableJobs = pipeJobs.some((j) => {
                  const s = optimisticJobStatuses[j.id] || j.status;
                  return s === 'RUNNING' || s === 'BLOCKED' || s === 'PENDING';
                });

                const hasRetryableJobs = pipeJobs.some((j) => {
                  const s = optimisticJobStatuses[j.id] || j.status;
                  return s === 'CANCELLED' || s === 'FAILED';
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
                        <span className="jso-pipe-time" title={`Created: ${formatDateTime(pipeline.created_at)}`}>
                          ⏱ {calculatePipelineDuration(pipeJobs, pipeline.status, now)}
                        </span>

                        <button
                          type="button"
                          className="jso-pipe-action-btn cancel"
                          onClick={(e) => handleCancelAllPipelineJobs(pipeline.id, pipeJobs, e)}
                          disabled={isBusy || !hasCancellableJobs}
                          title={
                            hasCancellableJobs
                              ? 'Cancel all RUNNING, BLOCKED or PENDING jobs for this pipeline'
                              : 'No active jobs to cancel'
                          }
                        >
                          <span className={isCancelling ? 'jso-spin-icon' : ''}>
                            {isCancelling ? '↻' : '⛔'}
                          </span>
                          <span>Cancel All</span>
                        </button>

                        <button
                          type="button"
                          className="jso-pipe-action-btn retry"
                          onClick={(e) => handleRetryAllPipelineJobs(pipeline.id, pipeJobs, e)}
                          disabled={isBusy || !hasRetryableJobs}
                          title={
                            hasRetryableJobs
                              ? 'Retry all CANCELLED or FAILED jobs for this pipeline'
                              : 'No failed or cancelled jobs to retry'
                          }
                        >
                          <span className={isRetrying ? 'jso-spin-icon' : ''}>↻</span>
                          <span>Retry All</span>
                        </button>

                        <button
                          type="button"
                          className="jso-pipe-action-btn delete"
                          onClick={(e) => handleDeletePipeline(pipeline.id, e)}
                          disabled={isBusy}
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
                      searchQuery={searchQuery}
                      optimisticJobStatuses={optimisticJobStatuses}
                      now={now}
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
              } else {
                const { job } = item;
                const optStatus = optimisticJobStatuses[job.id];
                const effectiveStatus = optStatus || job.status;

                return (
                  <div key={job.id} className="jso-pipeline-card standalone-card">
                    <div className="jso-pipe-header">
                      <div className="jso-pipe-info">
                        <span className="jso-pipe-branch" title="Task Name">
                          ⚡ {job.name}
                        </span>
                        <span className="jso-pipe-id" title={job.id}>
                          #{job.id.substring(0, 8)}
                        </span>
                        <span className={`jso-pipe-status-badge ${getPipelineStatusClass(effectiveStatus as any)}`}>
                          {effectiveStatus}
                        </span>
                      </div>

                      <div className="jso-pipe-meta-actions">
                        <span className="jso-pipe-time" title={`Created: ${formatDateTime(job.created_at)}`}>
                          ⏱ {calculateDuration(job.started_at, job.completed_at, now)}
                        </span>

                        <button
                          type="button"
                          className="jso-pipe-action-btn log"
                          onClick={() => handleDownloadFullLogs([job])}
                          title="Download execution log"
                        >
                          <span>📥 Logs</span>
                        </button>

                        <button
                          type="button"
                          className="jso-pipe-action-btn delete"
                          onClick={(e) => handleDeleteJob(job.id, e)}
                          title="Delete task"
                        >
                          <span>🗑</span>
                        </button>
                      </div>
                    </div>

                    <PipelineGraph
                      jobs={[job]}
                      pipelineName={job.name}
                      selectedJobId={selectedJob?.id}
                      searchQuery={searchQuery}
                      optimisticJobStatuses={optimisticJobStatuses}
                      now={now}
                      onSelectJob={(j) => {
                        setSelectedJob(j);
                        onJobSelect?.(j);
                      }}
                      onRetryJob={handleRetryJob}
                      onCancelJob={handleCancelJob}
                      retryingJobId={retryingJobId}
                      cancellingJobId={cancellingJobId}
                    />
                  </div>
                );
              }
            })}
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
                {sortedFilteredJobs.map((job) => {
                  const optStatus = optimisticJobStatuses[job.id];
                  const effectiveStatus = optStatus || job.status;
                  const isActive = effectiveStatus === 'RUNNING' || effectiveStatus === 'PENDING' || effectiveStatus === 'BLOCKED';
                  const isFailed = effectiveStatus === 'FAILED' || effectiveStatus === 'CANCELLED';

                  return (
                    <tr
                      key={job.id}
                      id={`job-row-${job.id}`}
                      data-job-id={job.id}
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
                        {calculateDuration(job.started_at, job.completed_at, now)}
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

        {/* DETAILS DRAWER ALIGNED TO PIPELINE RUN HEADER TOP EDGE */}
        <JobDetailsDrawer
          job={selectedJob}
          isOpen={!!selectedJob}
          onClose={() => setSelectedJob(null)}
          onRetryJob={handleRetryJob}
          onCancelJob={handleCancelJob}
          retryingJobId={retryingJobId}
          cancellingJobId={cancellingJobId}
          now={now}
          style={{ top: `${drawerTopOffset}px` }}
        />
      </div>
    </div>
  );
};
