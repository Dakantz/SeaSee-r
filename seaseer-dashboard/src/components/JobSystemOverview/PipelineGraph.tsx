import React, { useState, useEffect, useRef, useMemo } from 'react';
import type { JobResponse, JobStatus } from '../../client';
import { StageColumn } from './StageColumn';

export interface PipelineGraphProps {
  jobs: JobResponse[];
  pipelineName?: string;
  pipelineId?: string;
  selectedJobId?: string | null;
  searchQuery?: string;
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
 * Extracts component index from job payload or job name for vertical sorting within a stage column.
 * - Parses reconstruction_index or component_index from job payload if numeric.
 * - Parses "Component X", "Component: X", "Comp X" from job name.
 * - Base/main tasks without component suffix return 0 (primary/base task).
 */
export const getJobComponentIndex = (job: JobResponse): number => {
  if (job.payload && typeof job.payload === 'object') {
    const payloadObj = job.payload as Record<string, any>;
    if (typeof payloadObj.reconstruction_index === 'number' && !isNaN(payloadObj.reconstruction_index)) {
      return payloadObj.reconstruction_index;
    }
    if (typeof payloadObj.component_index === 'number' && !isNaN(payloadObj.component_index)) {
      return payloadObj.component_index;
    }
  }

  const name = job.name || '';
  const match = name.match(/(?:component|comp)\s*:?\s*(\d+)/i);
  if (match && match[1]) {
    return parseInt(match[1], 10);
  }

  return 0;
};

/**
 * Maps task types or depends_on DAG depth to stage columns
 */
const getStageNameForJob = (job: JobResponse, depth: number): string => {
  const taskType = (job.task_type || '').toLowerCase();
  if (taskType.includes('frame_extraction') || taskType.includes('preprocess')) {
    return 'Pre-Processing';
  }
  if (taskType.includes('dense')) {
    return 'Dense Reconstruction';
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
  searchQuery = '',
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
    return sortedStageKeys.map((k) => {
      const stage = stageMap.get(k)!;
      // Sort jobs inside the stage from top to bottom by component index / name
      stage.jobs.sort((a, b) => {
        const compA = getJobComponentIndex(a);
        const compB = getJobComponentIndex(b);
        if (compA !== compB) {
          return compA - compB;
        }
        const nameCompare = (a.name || '').localeCompare(b.name || '', undefined, {
          numeric: true,
          sensitivity: 'base',
        });
        if (nameCompare !== 0) return nameCompare;
        return (a.id || '').localeCompare(b.id || '');
      });
      return stage;
    });
  }, [jobs]);

  // Recalculate SVG Bezier connector curve paths between parent and child nodes
  const updateConnectors = () => {
    const container = containerRef.current;
    if (!container || jobs.length === 0) return;

    const containerRect = container.getBoundingClientRect();
    const scrollLeft = container.scrollLeft;
    const scrollTop = container.scrollTop;
    const newConnectors: ConnectorPath[] = [];

    // Map jobs by ID for fast lookup during transitive dependency filtering
    const jobMap = new Map<string, JobResponse>();
    jobs.forEach((j) => jobMap.set(j.id, j));

    // Helper: checks if ancestorId is a transitive ancestor of startId
    const isAncestor = (ancestorId: string, startId: string): boolean => {
      const visited = new Set<string>();
      const queue = [startId];
      while (queue.length > 0) {
        const currId = queue.shift()!;
        if (currId === ancestorId) return true;
        if (visited.has(currId)) continue;
        visited.add(currId);
        const currJob = jobMap.get(currId);
        if (currJob && currJob.depends_on) {
          queue.push(...currJob.depends_on);
        }
      }
      return false;
    };

    jobs.forEach((job) => {
      if (!job.depends_on || job.depends_on.length === 0) return;

      const childEl = container.querySelector(`[data-job-id="${job.id}"]`);
      if (!childEl) return;
      const childRect = childEl.getBoundingClientRect();
      const childX = childRect.left - containerRect.left + scrollLeft;
      const childY = childRect.top + childRect.height / 2 - containerRect.top + scrollTop;

      // Filter out redundant transitive parent dependencies
      const directParents = job.depends_on.filter((pId) => {
        return !job.depends_on!.some((otherPId) => otherPId !== pId && isAncestor(pId, otherPId));
      });

      directParents.forEach((parentId) => {
        const parentEl = container.querySelector(`[data-job-id="${parentId}"]`);
        if (!parentEl) return;
        const parentRect = parentEl.getBoundingClientRect();
        const parentX = parentRect.right - containerRect.left + scrollLeft;
        const parentY = parentRect.top + parentRect.height / 2 - containerRect.top + scrollTop;

        const parentStatus = optimisticJobStatuses[parentId] || (jobs.find((j) => j.id === parentId)?.status || 'PENDING');

        // Calculate smooth Bezier curve path
        const deltaX = Math.abs(childX - parentX);
        const dx = Math.max(30, deltaX * 0.45);
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
    const timer1 = setTimeout(updateConnectors, 50);
    const timer2 = setTimeout(updateConnectors, 200);

    const container = containerRef.current;
    let resizeObserver: ResizeObserver | null = null;
    if (container && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        updateConnectors();
      });
      resizeObserver.observe(container);
    }

    const handleResizeOrScroll = () => updateConnectors();
    window.addEventListener('resize', handleResizeOrScroll);
    if (container) {
      container.addEventListener('scroll', handleResizeOrScroll, { passive: true });
    }

    return () => {
      window.removeEventListener('resize', handleResizeOrScroll);
      if (container) {
        container.removeEventListener('scroll', handleResizeOrScroll);
      }
      clearTimeout(timer1);
      clearTimeout(timer2);
      if (resizeObserver) resizeObserver.disconnect();
    };
  }, [jobs, stages, optimisticJobStatuses]);

  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ startX: number; scrollLeft: number }>({ startX: 0, scrollLeft: 0 });
  const hasDraggedRef = useRef(false);

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('button, a, input, select, textarea, .jso-node-action-btn')) {
      return;
    }

    const container = containerRef.current;
    if (!container) return;

    setIsDragging(true);
    hasDraggedRef.current = false;
    dragStartRef.current = {
      startX: e.clientX,
      scrollLeft: container.scrollLeft,
    };
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    const container = containerRef.current;
    if (!container) return;

    const dx = e.clientX - dragStartRef.current.startX;
    if (Math.abs(dx) > 3) {
      hasDraggedRef.current = true;
    }

    container.scrollLeft = dragStartRef.current.scrollLeft - dx;
  };

  const handleMouseUpOrLeave = () => {
    if (isDragging) {
      setIsDragging(false);
    }
  };

  const handleClickCapture = (e: React.MouseEvent<HTMLDivElement>) => {
    if (hasDraggedRef.current) {
      e.stopPropagation();
      e.preventDefault();
      hasDraggedRef.current = false;
    }
  };

  return (
    <div
      className={`jso-pipeline-graph-wrapper ${isDragging ? 'is-dragging' : ''}`}
      ref={containerRef}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUpOrLeave}
      onMouseLeave={handleMouseUpOrLeave}
      onClickCapture={handleClickCapture}
    >
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
            searchQuery={searchQuery}
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

