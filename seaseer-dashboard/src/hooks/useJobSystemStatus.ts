import { useState, useEffect, useCallback, useRef } from 'react';
import { listJobs } from '../client';
import type { JobResponse } from '../client';

export interface UseJobSystemStatusOptions {
  /**
   * Maximum number of recent jobs to fetch.
   * Appended to GET /jobs?limit=X to optimize payload size.
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
  onUpdate?: (jobs: JobResponse[]) => void;
}

export interface UseJobSystemStatusReturn {
  /** List of recent jobs */
  jobs: JobResponse[];

  /** True during initial load */
  loading: boolean;

  /** True when background refetching is in progress */
  isRefreshing: boolean;

  /** Error message string if data fetching fails */
  error: string | null;

  /** True if there is at least one active job (PENDING or RUNNING) */
  hasActiveJobs: boolean;

  /** Count of currently active jobs (PENDING or RUNNING) */
  activeCount: number;

  /** True if currently polling at active fast rate */
  isPollingFast: boolean;

  /** Timestamp of the last successful data fetch */
  lastUpdated: Date | null;

  /** Manual trigger to immediately refresh the job list */
  refetch: () => Promise<void>;
}

/**
 * Custom React hook for smart, data-efficient polling of the SeaSee-r job system.
 * 
 * Features:
 * - Smart Polling: Polls rapidly (e.g. 2.5s) when jobs are PENDING or RUNNING.
 *   Slows down polling automatically (e.g. 30s) when all recent jobs are COMPLETED/FAILED.
 * - Optimized payload: Appends `?limit=N` parameter to GET /jobs requests.
 * - Handles loading, error states, and unmount cleanup gracefully.
 */
export function useJobSystemStatus({
  limit = 10,
  activePollInterval = 2500,
  idlePollInterval = 30000,
  autoPoll = true,
  onUpdate,
}: UseJobSystemStatusOptions = {}): UseJobSystemStatusReturn {
  const [jobs, setJobs] = useState<JobResponse[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const timerRef = useRef<ReturnType<typeof setTimeout> | number | null>(null);
  const isMountedRef = useRef<boolean>(true);
  const isInitialFetchRef = useRef<boolean>(true);

  // Determine if any recent job is in an active state (PENDING or RUNNING)
  const activeCount = jobs.filter(
    (job) => job.status === 'PENDING' || job.status === 'RUNNING'
  ).length;
  const hasActiveJobs = activeCount > 0;
  const isPollingFast = autoPoll && hasActiveJobs;

  const fetchJobs = useCallback(async () => {
    if (!isMountedRef.current) return;

    if (isInitialFetchRef.current) {
      setLoading(true);
    } else {
      setIsRefreshing(true);
    }

    try {
      // Pass limit via query parameter to ensure data efficiency
      const response = await listJobs({
        query: { limit } as any,
      });

      if (!isMountedRef.current) return;

      if (response.data) {
        // Ensure data is sorted by created_at DESC if backend hasn't already
        const sortedJobs = Array.isArray(response.data)
          ? [...response.data].sort(
              (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
            )
          : [];

        setJobs(sortedJobs);
        setError(null);
        setLastUpdated(new Date());
        onUpdate?.(sortedJobs);
      } else if (response.error) {
        const errMsg =
          typeof response.error === 'object' && response.error !== null
            ? (response.error as any).detail || 'Failed to fetch job list'
            : 'Failed to fetch job list';
        setError(errMsg);
      }
    } catch (err: any) {
      if (isMountedRef.current) {
        // Fallback fetch if SDK listJobs options format varies
        try {
          const fallbackRes = await fetch(`/jobs?limit=${limit}`);
          if (fallbackRes.ok) {
            const data: JobResponse[] = await fallbackRes.json();
            if (isMountedRef.current) {
              setJobs(data);
              setError(null);
              setLastUpdated(new Date());
              onUpdate?.(data);
              return;
            }
          }
        } catch (_) {
          // Ignore secondary failure
        }
        setError(err.message || 'Error communicating with job service');
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

      // Select poll rate based on presence of active (PENDING/RUNNING) jobs
      const currentInterval = hasActiveJobs ? activePollInterval : idlePollInterval;

      timerRef.current = setTimeout(async () => {
        await fetchJobs();
        scheduleNextPoll();
      }, currentInterval);
    };

    // Initial fetch on mount or when key parameters change
    fetchJobs().then(() => {
      scheduleNextPoll();
    });

    return () => {
      isMountedRef.current = false;
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current as number);
      }
    };
  }, [fetchJobs, autoPoll, hasActiveJobs, activePollInterval, idlePollInterval]);

  return {
    jobs,
    loading,
    isRefreshing,
    error,
    hasActiveJobs,
    activeCount,
    isPollingFast,
    lastUpdated,
    refetch: fetchJobs,
  };
}
