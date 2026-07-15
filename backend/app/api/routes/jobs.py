from typing import List
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

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
    
    # In the future, enqueueing to Celery/ARQ would happen here:
    # await redis.enqueue_job("run_pyslam", job.id)
    
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
