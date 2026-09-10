from typing import List, Optional
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from redis import Redis
from rq import Queue

from app.core.config import settings
from app.core.database import get_db_session
from app.models.job import Job, JobStatus, Pipeline, PipelineStatus
from app.schemas.job import JobCreate, JobResponse, PipelineCreate, PipelineResponse
from app.services.worker.pipeline_service import build_pipeline_and_jobs

router = APIRouter(
    prefix="/jobs",
    tags=["Job System"]
)

def _enqueue_job_to_redis(job_id: UUID) -> None:
    try:
        redis_conn = Redis.from_url(settings.redis_url)
        q = Queue("pointcloud_tasks", connection=redis_conn)
        q.enqueue(
            "app.services.worker.tasks.run_background_job",
            str(job_id),
            job_id=str(job_id),
            job_timeout=settings.job_timeout
        )
    except Exception as e:
        print(f"Warning: Could not enqueue job {job_id} to Redis Queue: {e}")


@router.post("", response_model=JobResponse, status_code=201)
async def create_job(
    payload: JobCreate,
    db: AsyncSession = Depends(get_db_session)
):
    """
    Enqueue/Create a new background job. Supports optional depends_on list of parent job UUIDs.
    """
    depends_on_uuids = [str(dep) for dep in (payload.depends_on or [])]
    initial_status = JobStatus.PENDING

    if depends_on_uuids:
        # Check if all parent jobs are COMPLETED
        parent_uuids = [UUID(dep) for dep in depends_on_uuids]
        res = await db.execute(select(Job.status).where(Job.id.in_(parent_uuids)))
        parent_statuses = res.scalars().all()
        
        if len(parent_statuses) < len(parent_uuids) or not all(s == JobStatus.COMPLETED for s in parent_statuses):
            initial_status = JobStatus.BLOCKED

    job = Job(
        name=payload.name,
        task_type=payload.task_type,
        payload=payload.payload,
        status=initial_status,
        progress=0.0,
        pipeline_id=payload.pipeline_id,
        depends_on=depends_on_uuids
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)

    if job.status == JobStatus.PENDING:
        _enqueue_job_to_redis(job.id)

    return job


@router.post("/pipeline", response_model=PipelineResponse, status_code=201)
@router.post("/pipelines", response_model=PipelineResponse, status_code=201)
async def create_pipeline(
    payload: PipelineCreate,
    db: AsyncSession = Depends(get_db_session)
):
    """
    Create a multi-job pipeline with DAG dependency resolution.
    Jobs without unsatisfied dependencies start in PENDING status and auto-enqueue immediately.
    """
    try:
        pipeline, jobs = build_pipeline_and_jobs(payload)
    except ValueError as val_err:
        raise HTTPException(status_code=400, detail=str(val_err))

    db.add(pipeline)
    for j in jobs:
        db.add(j)
    await db.commit()

    # Refresh pipeline with jobs loaded
    result = await db.execute(
        select(Pipeline).options(selectinload(Pipeline.jobs)).where(Pipeline.id == pipeline.id)
    )
    pipeline_db = result.scalar_one()

    # Enqueue jobs that are immediately ready (PENDING status)
    for j in pipeline_db.jobs:
        if j.status == JobStatus.PENDING:
            _enqueue_job_to_redis(j.id)

    return pipeline_db


@router.get("/pipelines", response_model=List[PipelineResponse])
async def list_pipelines(
    db: AsyncSession = Depends(get_db_session)
):
    """
    Retrieve a list of all pipelines with associated jobs.
    """
    result = await db.execute(
        select(Pipeline).options(selectinload(Pipeline.jobs)).order_by(Pipeline.created_at.desc())
    )
    return result.scalars().all()


@router.get("/pipelines/{pipeline_id}", response_model=PipelineResponse)
async def get_pipeline(
    pipeline_id: UUID,
    db: AsyncSession = Depends(get_db_session)
):
    """
    Get details of a specific pipeline and its constituent jobs.
    """
    result = await db.execute(
        select(Pipeline).options(selectinload(Pipeline.jobs)).where(Pipeline.id == pipeline_id)
    )
    pipeline = result.scalar_one_or_none()
    if not pipeline:
        raise HTTPException(status_code=404, detail="Pipeline not found.")
    return pipeline


@router.delete("/pipelines/{pipeline_id}", status_code=204)
async def delete_pipeline(
    pipeline_id: UUID,
    db: AsyncSession = Depends(get_db_session)
):
    """
    Delete a specific pipeline and all of its associated jobs.
    """
    result = await db.execute(select(Pipeline).where(Pipeline.id == pipeline_id))
    pipeline = result.scalar_one_or_none()
    if not pipeline:
        raise HTTPException(status_code=404, detail="Pipeline not found.")

    await db.delete(pipeline)
    await db.commit()
    return None


@router.post("/pipelines/{pipeline_id}/retry", response_model=PipelineResponse)
async def retry_pipeline(
    pipeline_id: UUID,
    db: AsyncSession = Depends(get_db_session)
):
    """
    Retry all failed jobs within a pipeline and re-evaluate dependent jobs.
    """
    result = await db.execute(
        select(Pipeline).options(selectinload(Pipeline.jobs)).where(Pipeline.id == pipeline_id)
    )
    pipeline = result.scalar_one_or_none()
    if not pipeline:
        raise HTTPException(status_code=404, detail="Pipeline not found.")

    failed_jobs = [j for j in pipeline.jobs if j.status in (JobStatus.FAILED, JobStatus.CANCELLED)]
    if not failed_jobs:
        raise HTTPException(status_code=400, detail="Pipeline has no failed or cancelled jobs to retry.")

    for job in failed_jobs:
        job.status = JobStatus.PENDING
        job.progress = 0.0
        job.error_message = None
        job.started_at = None
        job.completed_at = None
        job.result = None

    pipeline.status = PipelineStatus.RUNNING
    await db.commit()

    for job in failed_jobs:
        _enqueue_job_to_redis(job.id)

    # Reload pipeline
    result = await db.execute(
        select(Pipeline).options(selectinload(Pipeline.jobs)).where(Pipeline.id == pipeline_id)
    )
    return result.scalar_one()


@router.get("", response_model=List[JobResponse])
async def list_jobs(
    pipeline_id: Optional[UUID] = Query(None, description="Filter jobs by pipeline ID"),
    db: AsyncSession = Depends(get_db_session)
):
    """
    Retrieve a list of all jobs. Optionally filter by pipeline_id.
    """
    stmt = select(Job).order_by(Job.created_at.desc())
    if pipeline_id:
        stmt = stmt.where(Job.pipeline_id == pipeline_id)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.get("/{job_id}", response_model=JobResponse)
async def get_job(
    job_id: UUID,
    db: AsyncSession = Depends(get_db_session)
):
    """
    Get details and current status of a specific job.
    """
    result = await db.execute(select(Job).where(Job.id == job_id))
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")
    return job


@router.delete("/pending", status_code=200)
async def delete_pending_jobs(
    db: AsyncSession = Depends(get_db_session)
):
    """
    Delete all jobs currently in PENDING status.
    """
    result = await db.execute(select(Job).where(Job.status == JobStatus.PENDING))
    pending_jobs = result.scalars().all()
    deleted_count = len(pending_jobs)

    for job in pending_jobs:
        await db.delete(job)
    await db.commit()

    # Clear pending jobs from Redis Queues
    try:
        redis_conn = Redis.from_url(settings.redis_url)
        for queue_name in ["pointcloud_tasks", "job_tasks", "default"]:
            q = Queue(queue_name, connection=redis_conn)
            q.empty()
    except Exception as e:
        print(f"Warning: Could not clear Redis queues: {e}")

    return {"message": f"Deleted {deleted_count} pending job(s)", "deleted_count": deleted_count}


@router.delete("/{job_id}", status_code=204)
async def delete_job(
    job_id: UUID,
    db: AsyncSession = Depends(get_db_session)
):
    """
    Delete a specific job by ID.
    """
    result = await db.execute(select(Job).where(Job.id == job_id))
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")

    await db.delete(job)
    await db.commit()
    return None


@router.post("/{job_id}/retry", response_model=JobResponse)
async def retry_job(
    job_id: UUID,
    db: AsyncSession = Depends(get_db_session)
):
    """
    Retry a job that has failed. Resets status to PENDING and re-enqueues it in Redis RQ.
    """
    result = await db.execute(select(Job).where(Job.id == job_id))
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")

    if job.status not in (JobStatus.FAILED, JobStatus.CANCELLED):
        raise HTTPException(
            status_code=400,
            detail=f"Only failed or cancelled jobs can be retried. Current job status: '{job.status}'"
        )

    job.status = JobStatus.PENDING
    job.progress = 0.0
    job.error_message = None
    job.started_at = None
    job.completed_at = None
    job.result = None

    await db.commit()
    await db.refresh(job)

    _enqueue_job_to_redis(job.id)

    return job
