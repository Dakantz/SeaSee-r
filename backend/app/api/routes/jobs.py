from typing import List
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from redis import Redis
from rq import Queue

from app.core.config import settings
from app.core.database import get_db_session
from app.models.job import Job
from app.schemas.job import JobCreate, JobResponse

router = APIRouter(
    prefix="/jobs",
    tags=["Job System"]
)

@router.post("", response_model=JobResponse, status_code=201)
async def create_job(
    payload: JobCreate,
    db: AsyncSession = Depends(get_db_session)
):
    """
    Enqueue/Create a new background job (e.g. PySLAM reconstruction or downsampling).
    """
    job = Job(
        name=payload.name,
        payload=payload.payload,
        status="PENDING",
        progress=0.0
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)
    
    # Auto-enqueue created job to Redis Queue (rq) for worker execution
    try:
        redis_conn = Redis.from_url(settings.redis_url)
        q = Queue("pointcloud_tasks", connection=redis_conn)
        q.enqueue(
            "app.services.worker.tasks.run_background_job",
            str(job.id),
            job_id=str(job.id)
        )
    except Exception as e:
        print(f"Warning: Could not enqueue job {job.id} to Redis Queue: {e}")

    
    return job


@router.get("", response_model=List[JobResponse])
async def list_jobs(
    db: AsyncSession = Depends(get_db_session)
):
    """
    Retrieve a list of all jobs.
    """
    result = await db.execute(select(Job).order_by(Job.created_at.desc()))
    return result.scalars().all()

@router.get("/{job_id}", response_model=JobResponse)
async def get_job(
    job_id: UUID,
    db: AsyncSession = Depends(get_db_session)
):
    """
    Get the details and current execution status/progress of a specific job.
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
    result = await db.execute(select(Job).where(Job.status == "PENDING"))
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

    if job.status != "FAILED":
        raise HTTPException(
            status_code=400,
            detail=f"Only failed jobs can be retried. Current job status: '{job.status}'"
        )

    job.status = "PENDING"
    job.progress = 0.0
    job.error_message = None
    job.started_at = None
    job.completed_at = None
    job.result = None

    await db.commit()
    await db.refresh(job)

    # Re-enqueue job to Redis Queue (rq) for worker execution
    try:
        redis_conn = Redis.from_url(settings.redis_url)
        q = Queue("pointcloud_tasks", connection=redis_conn)
        q.enqueue(
            "app.services.worker.tasks.run_background_job",
            str(job.id),
            job_id=str(job.id)
        )
    except Exception as e:
        print(f"Warning: Could not re-enqueue job {job.id} to Redis Queue: {e}")

    return job


