import React, { useState, useEffect, useRef, useMemo } from 'react';
import type { JobResponse, JobStatus } from '../../client';
import { StageColumn } from './StageColumn';

export interface PipelineGraphProps {
  jobs: JobResponse[];
  pipelineName?: string;
  pipelineId?: string;
  selectedJobId?: string | null;
  optimisticJobStatuses?: Record<string, JobStatus>;
  onSelectJob: (job: JobResponse) => void;
  onRetryJob?: (jobId: string, e: React.MouseEvent) => void;
  onCancelJob?: (jobId: string, e: React.MouseEvent) => void;
  retryingJobId?: string | null;
  cancellingJobId?: string | null;
}

interface ConnectorPath {
  id: string;
  path: string;
  status: JobStatus;
}

/**
 * Maps task types or depends_on DAG depth to stage columns
 */
const getStageNameForJob = (job: JobResponse, depth: number): string => {
  const taskType = (job.task_type || '').toLowerCase();
  if (taskType.includes('frame_extraction') || taskType.includes('preprocess')) {
    return 'Pre-Processing';
  }
  if (taskType.includes('reconstruct') || taskType.includes('pyslam') || taskType.includes('sfm')) {
    return 'Reconstruction';
  }
  if (taskType.includes('ingest') || taskType.includes('postgis')) {
    return 'Ingestion';
  }
  return `Stage ${depth + 1}`;
};

export const PipelineGraph: React.FC<PipelineGraphProps> = ({
  jobs,
  selectedJobId,
  optimisticJobStatuses = {},
  onSelectJob,
  onRetryJob,
  onCancelJob,
  retryingJobId,
  cancellingJobId,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [connectors, setConnectors] = useState<ConnectorPath[]>([]);

  // Compute DAG topological stages
  const stages = useMemo(() => {
    if (!jobs || jobs.length === 0) return [];

    // Map jobs by ID for fast lookup
    const jobMap = new Map<string, JobResponse>();
    jobs.forEach((j) => jobMap.set(j.id, j));

    // Calculate depth for each job
    const depthMap = new Map<string, number>();

    const getDepth = (jobId: string, visited = new Set<string>()): number => {
      if (depthMap.has(jobId)) return depthMap.get(jobId)!;
      if (visited.has(jobId)) return 0; // Avoid cycles
      visited.add(jobId);

      const job = jobMap.get(jobId);
      if (!job || !job.depends_on || job.depends_on.length === 0) {
        depthMap.set(jobId, 0);
        return 0;
      }

      let maxParentDepth = -1;
      for (const parentId of job.depends_on) {
        if (jobMap.has(parentId)) {
          maxParentDepth = Math.max(maxParentDepth, getDepth(parentId, new Set(visited)));
        }
      }

      const currentDepth = maxParentDepth + 1;
      depthMap.set(jobId, currentDepth);
      return currentDepth;
    };

    jobs.forEach((j) => getDepth(j.id));

    // Group jobs by stage depth
    const stageMap = new Map<number, { name: string; jobs: JobResponse[] }>();

    jobs.forEach((j) => {
      const depth = depthMap.get(j.id) || 0;
      if (!stageMap.has(depth)) {
        stageMap.set(depth, {
          name: getStageNameForJob(j, depth),
          jobs: [],
        });
      }
      stageMap.get(depth)!.jobs.push(j);
    });

    const sortedStageKeys = Array.from(stageMap.keys()).sort((a, b) => a - b);
    return sortedStageKeys.map((k) => stageMap.get(k)!);
  }, [jobs]);

  // Recalculate SVG Bezier connector curve paths between parent and child nodes
  const updateConnectors = () => {
    if (!containerRef.current || jobs.length === 0) return;

    const containerRect = containerRef.current.getBoundingClientRect();
    const newConnectors: ConnectorPath[] = [];

    jobs.forEach((job) => {
      if (!job.depends_on || job.depends_on.length === 0) return;

      const childEl = containerRef.current?.querySelector(`[data-job-id="${job.id}"]`);
      if (!childEl) return;
      const childRect = childEl.getBoundingClientRect();
      const childX = childRect.left - containerRect.left;
      const childY = childRect.top + childRect.height / 2 - containerRect.top;

      job.depends_on.forEach((parentId) => {
        const parentEl = containerRef.current?.querySelector(`[data-job-id="${parentId}"]`);
        if (!parentEl) return;
        const parentRect = parentEl.getBoundingClientRect();
        const parentX = parentRect.right - containerRect.left;
        const parentY = parentRect.top + parentRect.height / 2 - containerRect.top;

        const parentStatus = optimisticJobStatuses[parentId] || (jobs.find((j) => j.id === parentId)?.status || 'PENDING');

        // Calculate smooth Bezier curve path
        const dx = Math.max(20, Math.abs(childX - parentX) * 0.5);
        const path = `M ${parentX} ${parentY} C ${parentX + dx} ${parentY}, ${childX - dx} ${childY}, ${childX} ${childY}`;

        newConnectors.push({
          id: `${parentId}->${job.id}`,
          path,
          status: parentStatus,
        });
      });
    });

    setConnectors(newConnectors);
  };

  useEffect(() => {
    updateConnectors();
    const handleResize = () => updateConnectors();
    window.addEventListener('resize', handleResize);
    const timer = setTimeout(updateConnectors, 100);

    return () => {
      window.removeEventListener('resize', handleResize);
      clearTimeout(timer);
    };
  }, [jobs, stages, optimisticJobStatuses]);

  return (
    <div className="jso-pipeline-graph-wrapper" ref={containerRef}>
      {/* SVG Canvas overlay for Bezier curves */}
      <svg className="jso-graph-svg-layer" aria-hidden="true">
        {connectors.map((conn) => {
          const statusClass = conn.status.toLowerCase();
          return (
            <path
              key={conn.id}
              d={conn.path}
              className={`jso-svg-connector status-${statusClass}`}
            />
          );
        })}
      </svg>

      {/* Stage Columns Flex Container */}
      <div className="jso-stage-columns-container">
        {stages.map((stage, idx) => (
          <StageColumn
            key={`${stage.name}-${idx}`}
            stageName={stage.name}
            stageIndex={idx}
            jobs={stage.jobs}
            selectedJobId={selectedJobId}
            optimisticJobStatuses={optimisticJobStatuses}
            onSelectJob={onSelectJob}
            onRetryJob={onRetryJob}
            onCancelJob={onCancelJob}
            retryingJobId={retryingJobId}
            cancellingJobId={cancellingJobId}
          />
        ))}
      </div>
    </div>
  );
};
