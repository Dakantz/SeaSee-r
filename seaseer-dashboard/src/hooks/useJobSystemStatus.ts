import { useState, useEffect, useCallback, useRef } from 'react';
import { listPipelines } from '../client';
import type { JobResponse, PipelineResponse } from '../client';

export interface UseJobSystemStatusOptions {
  /**
   * Maximum number of recent pipelines to fetch.
   * @default 10
   */
  limit?: number;

  /**
   * Polling interval in milliseconds when at least one job is PENDING or RUNNING.
   * @default 2500 (2.5 seconds)
   */
  activePollInterval?: number;

  /**
   * Polling interval in milliseconds when all recent jobs are COMPLETED or FAILED.
   * @default 30000 (30 seconds)
   */
  idlePollInterval?: number;

  /**
   * Whether auto-polling is enabled.
   * @default true
   */
  autoPoll?: boolean;

  /**
   * Optional callback triggered when job data updates.
   */
  onUpdate?: (jobs: JobResponse[], pipelines?: PipelineResponse[]) => void;
}

export interface UseJobSystemStatusReturn {
  /** List of all jobs from pipelines */
  jobs: JobResponse[];

  /** List of job pipelines */
  pipelines: PipelineResponse[];

  /** True during initial load */
  loading: boolean;

  /** True when background refetching is in progress */
  isRefreshing: boolean;

  /** Error message string if data fetching fails */
  error: string | null;

  /** True if there is at least one active job (PENDING, RUNNING, or BLOCKED) */
  hasActiveJobs: boolean;

  /** Count of currently active jobs (PENDING, RUNNING, or BLOCKED) */
  activeCount: number;

  /** True if currently polling at active fast rate */
  isPollingFast: boolean;

  /** Timestamp of the last successful data fetch */
  lastUpdated: Date | null;

  /** Manual trigger to immediately refresh the job list */
  refetch: () => Promise<void>;
}

/**
 * Custom React hook for smart, data-efficient polling of the SeaSee-r job system and CI/CD pipelines.
 */
export function useJobSystemStatus({
  limit = 10,
  activePollInterval = 2500,
  idlePollInterval = 30000,
  autoPoll = true,
  onUpdate,
}: UseJobSystemStatusOptions = {}): UseJobSystemStatusReturn {
  const [jobs, setJobs] = useState<JobResponse[]>([]);
  const [pipelines, setPipelines] = useState<PipelineResponse[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const timerRef = useRef<ReturnType<typeof setTimeout> | number | null>(null);
  const isMountedRef = useRef<boolean>(true);
  const isInitialFetchRef = useRef<boolean>(true);

  // Determine if any job or pipeline is in an active state (PENDING, RUNNING, or BLOCKED)
  const activeCount = jobs.filter(
    (job) => job.status === 'PENDING' || job.status === 'RUNNING' || job.status === 'BLOCKED'
  ).length;
  const hasActiveJobs = activeCount > 0;
  const isPollingFast = autoPoll && hasActiveJobs;

  const fetchData = useCallback(async () => {
    if (!isMountedRef.current) return;

    if (isInitialFetchRef.current) {
      setLoading(true);
    } else {
      setIsRefreshing(true);
    }

    try {
      let fetchedPipelines: PipelineResponse[] = [];

      const pipelinesRes = await listPipelines().catch(() => null);

      if (pipelinesRes?.data && Array.isArray(pipelinesRes.data)) {
        fetchedPipelines = [...pipelinesRes.data].sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
      } else {
        // Direct fetch fallback for pipelines
        try {
          const fbPipeRes = await fetch('/jobs/pipelines');
          if (fbPipeRes.ok) {
            fetchedPipelines = await fbPipeRes.json();
          }
        } catch (_) {}
      }

      if (limit > 0 && fetchedPipelines.length > limit) {
        fetchedPipelines = fetchedPipelines.slice(0, limit);
      }

      // Extract all constituent jobs from pipelines
      const fetchedJobs = fetchedPipelines.flatMap((p) => p.jobs || []);

      if (!isMountedRef.current) return;

      setJobs(fetchedJobs);
      setPipelines(fetchedPipelines);
      setError(null);
      setLastUpdated(new Date());
      onUpdate?.(fetchedJobs, fetchedPipelines);
    } catch (err: any) {
      if (isMountedRef.current) {
        setError(err.message || 'Error communicating with job pipeline service');
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
        setIsRefreshing(false);
        isInitialFetchRef.current = false;
      }
    }
  }, [limit, onUpdate]);

  // Smart Polling Effect
  useEffect(() => {
    isMountedRef.current = true;

    const scheduleNextPoll = () => {
      if (!autoPoll || !isMountedRef.current) return;

      const currentInterval = hasActiveJobs ? activePollInterval : idlePollInterval;

      timerRef.current = setTimeout(async () => {
        await fetchData();
        scheduleNextPoll();
      }, currentInterval);
    };

    fetchData().then(() => {
      scheduleNextPoll();
    });

    return () => {
      isMountedRef.current = false;
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current as number);
      }
    };
  }, [fetchData, autoPoll, hasActiveJobs, activePollInterval, idlePollInterval]);

  return {
    jobs,
    pipelines,
    loading,
    isRefreshing,
    error,
    hasActiveJobs,
    activeCount,
    isPollingFast,
    lastUpdated,
    refetch: fetchData,
  };
}
