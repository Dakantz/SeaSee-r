import React from 'react';
import type { JobResponse, JobStatus } from '../../client';
import { JobNode } from './JobNode';

export interface StageColumnProps {
  stageName: string;
  stageIndex: number;
  jobs: JobResponse[];
  selectedJobId?: string | null;
  searchQuery?: string;
  optimisticJobStatuses?: Record<string, JobStatus>;
  onSelectJob: (job: JobResponse) => void;
  onRetryJob?: (jobId: string, e: React.MouseEvent) => void;
  onCancelJob?: (jobId: string, e: React.MouseEvent) => void;
  retryingJobId?: string | null;
  cancellingJobId?: string | null;
  now?: number;
}

export const StageColumn: React.FC<StageColumnProps> = ({
  jobs,
  selectedJobId,
  searchQuery = '',
  optimisticJobStatuses = {},
  now,
  onSelectJob,
  onRetryJob,
  onCancelJob,
  retryingJobId,
  cancellingJobId,
}) => {
  const allCompleted = jobs.length > 0 && jobs.every((j) => (optimisticJobStatuses[j.id] || j.status) === 'COMPLETED');
  const hasFailed = jobs.some((j) => {
    const s = optimisticJobStatuses[j.id] || j.status;
    return s === 'FAILED' || s === 'CANCELLED';
  });
  const hasRunning = jobs.some((j) => (optimisticJobStatuses[j.id] || j.status) === 'RUNNING');

  const getStageHeaderBadgeClass = () => {
    if (hasFailed) return 'failed';
    if (hasRunning) return 'running';
    if (allCompleted) return 'completed';
    return 'pending';
  };

  const q = searchQuery.trim().toLowerCase();
  const qClean = q.replace(/^#/, '');

  return (
    <div className="jso-stage-column">
      {/* Stage Column Header */}
      <div className="jso-stage-col-header">
        <span className={`jso-stage-col-badge ${getStageHeaderBadgeClass()}`}>
          {jobs.length} {jobs.length === 1 ? 'task' : 'tasks'}
        </span>
      </div>

      {/* Vertical Stack of Job Nodes */}
      <div className="jso-stage-col-stack">
        {jobs.length === 0 ? (
          <div className="jso-stage-col-empty">No tasks in stage</div>
        ) : (
          jobs.map((job) => {
            const optStatus = optimisticJobStatuses[job.id];
            const effectiveJob = optStatus ? { ...job, status: optStatus } : job;

            const isSearchMatch = Boolean(
              q &&
                (job.id.toLowerCase().includes(q) ||
                  job.id.toLowerCase().includes(qClean) ||
                  (job.name && job.name.toLowerCase().includes(q)) ||
                  (job.task_type && job.task_type.toLowerCase().includes(q)))
            );

            return (
              <JobNode
                key={job.id}
                job={effectiveJob}
                isSelected={selectedJobId === job.id}
                isSearchMatch={isSearchMatch}
                isOptimistic={!!optStatus}
                now={now}
                onSelect={onSelectJob}
                onRetry={onRetryJob}
                onCancel={onCancelJob}
                retryingJobId={retryingJobId}
                cancellingJobId={cancellingJobId}
              />
            );
          })
        )}
      </div>
    </div>
  );
};
