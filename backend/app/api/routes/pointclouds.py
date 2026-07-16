import os
import uuid
import aiofiles
from redis import Redis
from rq import Queue

from typing import List
from fastapi import APIRouter, Depends, UploadFile, File
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.pointcloud import PointCloudStorageService
from app.api.dependencies.pointcloud import get_pointcloud_service
from app.core.config import settings
from app.core.database import get_db_session
from app.models.job import Job

router = APIRouter(
    prefix="/pointclouds",
    tags=["Point Clouds"]
)

"""
Retrieve a list of available point clouds.
"""
@router.get("/", response_model=List[str])
async def list_pointclouds(
    storage_service: PointCloudStorageService = Depends(get_pointcloud_service)
):
    return await storage_service.list_pointclouds()


"""
Retrieve a .ply point cloud file.

The underlying storage mechanism (local file system or database) is determined 
by the `POINTCLOUD_STORAGE_TYPE` configuration.
"""
@router.get("/{filename_or_id}", response_class=FileResponse)
async def get_pointcloud(
    filename_or_id: str,
    storage_service: PointCloudStorageService = Depends(get_pointcloud_service)
):
    return await storage_service.get_pointcloud(filename_or_id)

"""
Upload a .las, .laz, or .ply file and queue a conversion to EPT.
"""
@router.post("/upload")
async def upload_pointcloud(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db_session)
):
    # Create job in database first
    job_record = Job(
        name=f"Convert {file.filename} to EPT",
        payload={"filename": file.filename},
        status="PENDING",
        progress=0.0
    )
    db.add(job_record)
    await db.commit()
    await db.refresh(job_record)

    # Generate unique ID for the file
    file_id = str(uuid.uuid4())
    original_ext = os.path.splitext(file.filename)[1]
    safe_filename = f"{file_id}{original_ext}"
    
    file_path = os.path.join(settings.upload_dir, safe_filename)
    
    # Save file asynchronously
    async with aiofiles.open(file_path, 'wb') as out_file:
        while content := await file.read(1024 * 1024):  # read in 1MB chunks
            await out_file.write(content)
            
    # Enqueue job
    redis_conn = Redis.from_url(settings.redis_url)
    q = Queue("pointcloud_tasks", connection=redis_conn)
    rq_job = q.enqueue(
        "app.services.worker.tasks.convert_to_ept", 
        file_path, 
        file_id, 
        job_id=str(job_record.id),
        storage_type=settings.pointcloud_storage_type.value
    )
    
    return {"message": "File uploaded and conversion queued", "job_id": job_record.id, "file_id": file_id}

