import logging
from datetime import datetime, timezone
from typing import Iterable, List, Optional, Set
from uuid import UUID

import anyio
from fastapi import APIRouter, Depends, HTTPException
from redis import Redis
from rq.exceptions import NoSuchJobError
from rq.job import Job as RQJob
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.database import get_db_session
from app.models.job import Job, JobStatus, Pipeline, PipelineStatus
from app.schemas.job import JobCreate, JobResponse, PipelineCreate, PipelineResponse
from app.services.worker.pipeline_service import build_pipeline_and_jobs

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/jobs",
    tags=["Job System"]
)

# -----------------------------------------------------------------------------
# Redis / RQ Background Task Helpers
# -----------------------------------------------------------------------------

def _sync_enqueue_job(job_id: UUID, task_type: Optional[str] = None) -> None:
    try:
        from app.utils.queue_utils import enqueue_job
        enqueue_job(job_id, task_type)
    except Exception as e:
        logger.warning("Could not enqueue job %s to Redis queue: %s", job_id, e)


async def _enqueue_job_to_redis(job_id: UUID, task_type: Optional[str] = None) -> None:
    """Non-blocking Redis enqueue wrapper offloaded to a worker thread."""
    await anyio.to_thread.run_sync(_sync_enqueue_job, job_id, task_type)


def _sync_delete_rq_jobs(job_ids: Iterable[str], cancel_first: bool = False) -> None:
    """Synchronously fetch and delete specific RQ jobs from Redis without queue purging."""
    try:
        with Redis.from_url(settings.redis_url) as redis_conn:
            for job_id_str in job_ids:
                try:
                    rq_job = RQJob.fetch(job_id_str, connection=redis_conn)
                    if cancel_first:
                        try:
                            rq_job.cancel()
                        except Exception:
                            pass
                    rq_job.delete()
                except NoSuchJobError:
                    pass
                except Exception as e:
                    logger.warning("Could not delete RQ job %s from Redis: %s", job_id_str, e)
    except Exception as e:
        logger.warning("Could not connect to Redis to manage jobs: %s", e)


async def _delete_redis_jobs(job_ids: Iterable[str], cancel_first: bool = False) -> None:
    """Non-blocking wrapper to remove/cancel RQ jobs from Redis."""
    target_ids = list(job_ids)
    if target_ids:
        await anyio.to_thread.run_sync(_sync_delete_rq_jobs, target_ids, cancel_first)


# -----------------------------------------------------------------------------
# Domain & DAG Traversal Helpers
# -----------------------------------------------------------------------------

def _parse_uuids(raw_ids: Optional[Iterable[object]]) -> List[UUID]:
    """Parse raw string/UUID objects into valid UUIDs, silently skipping malformed values."""
    if not raw_ids:
        return []
    valid_uuids: List[UUID] = []
    for raw in raw_ids:
        try:
            valid_uuids.append(raw if isinstance(raw, UUID) else UUID(str(raw)))
        except (ValueError, TypeError):
            continue
    return valid_uuids


def _reset_job_runtime_state(job: Job) -> None:
    """Reset execution tracking parameters prior to re-execution or retries."""
    job.progress = 0.0
    job.error_message = None
    job.started_at = None
    job.completed_at = None
    job.result = None


def _get_job_and_downstream_children(target_job_id: UUID, pipeline_jobs: List[Job]) -> List[Job]:
    """Return the specified job along with all downstream dependent jobs via breadth-first search."""
    affected_ids = {str(target_job_id)}
    changed = True

    while changed:
        changed = False
        for j in pipeline_jobs:
            if str(j.id) not in affected_ids:
                deps = [str(d) for d in (j.depends_on or [])]
                if any(dep in affected_ids for dep in deps):
                    affected_ids.add(str(j.id))
                    changed = True

    return [j for j in pipeline_jobs if str(j.id) in affected_ids]


async def _are_dependencies_satisfied(
    db: AsyncSession,
    depends_on: Optional[Iterable[object]],
    completed_cache: Optional[Set[str]] = None
) -> bool:
    """Determine whether all dependency parent jobs are marked COMPLETED."""
    parent_uuids = _parse_uuids(depends_on)
    if not parent_uuids:
        return True

    parent_ids_str = {str(u) for u in parent_uuids}
    satisfied_ids: Set[str] = set()

    if completed_cache:
        satisfied_ids.update(parent_ids_str & completed_cache)

    unresolved_uuids = [UUID(pid) for pid in (parent_ids_str - satisfied_ids)]
    if unresolved_uuids:
        stmt = select(Job.id).where(
            Job.id.in_(unresolved_uuids),
            Job.status == JobStatus.COMPLETED
        )
        res = await db.execute(stmt)
        completed_from_db = {str(uid) for uid in res.scalars().all()}
        satisfied_ids.update(completed_from_db)
        if completed_cache is not None:
            completed_cache.update(completed_from_db)

    return len(satisfied_ids) == len(parent_ids_str)


async def _get_pipeline_or_404(pipeline_id: UUID, db: AsyncSession) -> Pipeline:
    """Fetch pipeline with eagerly loaded jobs, raising a 404 if not found."""
    stmt = (
        select(Pipeline)
        .options(selectinload(Pipeline.jobs))
        .where(Pipeline.id == pipeline_id)
    )
    result = await db.execute(stmt)
    pipeline = result.scalar_one_or_none()
    if not pipeline:
        raise HTTPException(status_code=404, detail="Pipeline not found.")
    return pipeline


# -----------------------------------------------------------------------------
# Endpoints: Sleek Job System
# -----------------------------------------------------------------------------

@router.get("", response_model=List[JobResponse])
@router.get("/", response_model=List[JobResponse])
async def list_jobs(
    db: AsyncSession = Depends(get_db_session)
):
    """Retrieve all background jobs (standalone and constituent pipeline jobs)."""
    stmt = select(Job).order_by(Job.created_at.desc())
    result = await db.execute(stmt)
    return result.scalars().all()


@router.post("", response_model=JobResponse, status_code=201)
@router.post("/", response_model=JobResponse, status_code=201)
async def create_job(
    job_in: JobCreate,
    db: AsyncSession = Depends(get_db_session)
):
    """Create and enqueue an individual job."""
    job = Job(
        name=job_in.name,
        task_type=job_in.task_type,
        payload=job_in.payload or {},
        depends_on=[str(d) for d in (job_in.depends_on or [])],
        pipeline_id=job_in.pipeline_id,
        status=JobStatus.PENDING if not job_in.depends_on else JobStatus.BLOCKED,
        progress=0.0
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)

    if job.status == JobStatus.PENDING:
        await _enqueue_job_to_redis(job.id, job.task_type)

    return job



@router.get("/pipelines", response_model=List[PipelineResponse])
async def list_pipelines(
    db: AsyncSession = Depends(get_db_session)
):
    """Retrieve all job pipelines with nested constituent jobs."""
    stmt = (
        select(Pipeline)
        .options(selectinload(Pipeline.jobs))
        .order_by(Pipeline.created_at.desc())
    )
    result = await db.execute(stmt)
    return result.scalars().all()


@router.post("/pipelines", response_model=PipelineResponse, status_code=201)
async def create_pipeline(
    payload: PipelineCreate,
    db: AsyncSession = Depends(get_db_session)
):
    """Create a multi-job pipeline DAG, auto-enqueuing ready entry-point tasks."""
    try:
        pipeline, jobs = build_pipeline_and_jobs(payload)
    except ValueError as val_err:
        raise HTTPException(status_code=400, detail=str(val_err))

    db.add(pipeline)
    for j in jobs:
        db.add(j)
    await db.commit()

    pipeline_db = await _get_pipeline_or_404(pipeline.id, db)

    # Re-evaluate blocked jobs whose dependencies are satisfied
    completed_cache: Set[str] = set()
    for j in pipeline_db.jobs:
        if j.status == JobStatus.BLOCKED and j.depends_on:
            if await _are_dependencies_satisfied(db, j.depends_on, completed_cache):
                j.status = JobStatus.PENDING

    await db.commit()

    for j in pipeline_db.jobs:
        if j.status == JobStatus.PENDING:
            await _enqueue_job_to_redis(j.id, j.task_type)

    return pipeline_db


@router.get("/pipelines/{pipeline_id}", response_model=PipelineResponse)
async def get_pipeline(
    pipeline_id: UUID,
    db: AsyncSession = Depends(get_db_session)
):
    """Get details of a specific pipeline and its constituent jobs."""
    return await _get_pipeline_or_404(pipeline_id, db)


@router.get("/{job_id}", response_model=JobResponse)
async def get_job(
    job_id: UUID,
    db: AsyncSession = Depends(get_db_session)
):
    """Get details and current status of a specific job."""
    result = await db.execute(select(Job).where(Job.id == job_id))
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")
    return job


@router.delete("/{job_id}", status_code=204)
async def delete_job(
    job_id: UUID,
    db: AsyncSession = Depends(get_db_session)
):
    """Delete a specific job by ID, cancelling if running and cleaning up empty pipeline."""
    result = await db.execute(select(Job).where(Job.id == job_id))
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")

    pipeline_id = job.pipeline_id

    if job.status == JobStatus.RUNNING:
        job.status = JobStatus.CANCELLED
        job.completed_at = datetime.now(timezone.utc)
        job.error_message = job.error_message or "Job was cancelled before deletion."
        await db.commit()

        try:
            from app.services.worker.tasks import _process_job_dependency_updates
            await _process_job_dependency_updates(db, str(job.id), "CANCELLED")
        except Exception as e:
            logger.warning("Failed to process dependency updates for cancelled job %s: %s", job.id, e)

    await _delete_redis_jobs([str(job.id)], cancel_first=True)
    await db.delete(job)
    await db.commit()

    if pipeline_id:
        res = await db.execute(select(Job.id).where(Job.pipeline_id == pipeline_id))
        remaining_jobs = res.scalars().all()
        if not remaining_jobs:
            pipe_res = await db.execute(select(Pipeline).where(Pipeline.id == pipeline_id))
            pipeline = pipe_res.scalar_one_or_none()
            if pipeline:
                await db.delete(pipeline)
                await db.commit()

    return None


@router.post("/{job_id}/retry", response_model=JobResponse)
async def retry_job(
    job_id: UUID,
    db: AsyncSession = Depends(get_db_session)
):
    """Retry a failed/cancelled job or reset a pipeline sub-graph starting from this job."""
    result = await db.execute(select(Job).where(Job.id == job_id))
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")

    if job.pipeline_id is None:
        if job.status not in (JobStatus.FAILED, JobStatus.CANCELLED):
            raise HTTPException(
                status_code=400,
                detail=f"Only failed or cancelled jobs can be retried. Current status: '{job.status}'"
            )
        _reset_job_runtime_state(job)
        job.status = JobStatus.PENDING
        await db.commit()
        await db.refresh(job)

        await _enqueue_job_to_redis(job.id, job.task_type)
        return job

    pipeline = await _get_pipeline_or_404(job.pipeline_id, db)
    target_and_child_jobs = _get_job_and_downstream_children(job_id, pipeline.jobs)

    for j in target_and_child_jobs:
        _reset_job_runtime_state(j)
        j.status = JobStatus.BLOCKED

    completed_cache = {str(pj.id) for pj in pipeline.jobs if pj.status == JobStatus.COMPLETED}
    if await _are_dependencies_satisfied(db, job.depends_on, completed_cache):
        job.status = JobStatus.PENDING

    pipeline.status = PipelineStatus.RUNNING
    await db.commit()
    await db.refresh(job)

    if job.status == JobStatus.PENDING:
        await _enqueue_job_to_redis(job.id, job.task_type)

    return job


@router.post("/{job_id}/cancel", response_model=JobResponse)
async def cancel_job(
    job_id: UUID,
    db: AsyncSession = Depends(get_db_session)
):
    """Cancel a standalone active job or cascade cancellation through a pipeline branch."""
    from app.services.worker.tasks import _process_job_dependency_updates

    result = await db.execute(select(Job).where(Job.id == job_id))
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")

    now = datetime.now(timezone.utc)

    if job.pipeline_id is None:
        if job.status not in (JobStatus.PENDING, JobStatus.RUNNING, JobStatus.BLOCKED):
            raise HTTPException(
                status_code=400,
                detail=f"Only active jobs (PENDING, RUNNING, BLOCKED) can be cancelled. Current job status: '{job.status}'"
            )
        job.status = JobStatus.CANCELLED
        job.completed_at = now
        job.error_message = job.error_message or "Job was cancelled by user."

        await db.commit()
        await db.refresh(job)
        await _delete_redis_jobs([str(job.id)], cancel_first=True)

        try:
            await _process_job_dependency_updates(db, str(job.id), "CANCELLED")
        except Exception as e:
            logger.warning("Failed to process dependency updates for job %s: %s", job.id, e)

        return job

    pipeline = await _get_pipeline_or_404(job.pipeline_id, db)
    target_and_child_jobs = _get_job_and_downstream_children(job_id, pipeline.jobs)
    uncompleted_jobs = [j for j in target_and_child_jobs if j.status != JobStatus.COMPLETED]

    if not uncompleted_jobs:
        raise HTTPException(
            status_code=400,
            detail="No uncompleted target or child jobs to cancel."
        )

    for j in uncompleted_jobs:
        j.status = JobStatus.CANCELLED
        j.completed_at = j.completed_at or now
        j.error_message = j.error_message or "Job was cancelled by user."

    if any(j.status == JobStatus.FAILED for j in pipeline.jobs):
        pipeline.status = PipelineStatus.FAILED
    elif all(j.status in (JobStatus.COMPLETED, JobStatus.CANCELLED) for j in pipeline.jobs):
        pipeline.status = PipelineStatus.CANCELLED
    elif any(j.status in (JobStatus.RUNNING, JobStatus.PENDING, JobStatus.BLOCKED) for j in pipeline.jobs):
        pipeline.status = PipelineStatus.RUNNING

    await db.commit()
    await db.refresh(job)

    await _delete_redis_jobs([str(j.id) for j in uncompleted_jobs], cancel_first=True)
    return job