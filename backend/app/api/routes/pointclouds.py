import os
import uuid
import aiofiles
from redis import Redis
from rq import Queue

from typing import List
from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

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
Webhook endpoint for TUSD when an upload finishes.
"""
from fastapi import Request

@router.post("/upload/complete")
async def pointcloud_upload_complete(
    request: Request,
    db: AsyncSession = Depends(get_db_session)
):
    try:
        data = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    event_name = data.get("EventName")
    upload = data.get("Upload", {})
    
    if not upload:
        return {"status": "ignored", "reason": "No upload data"}
        
    file_id = upload.get("ID")
    metadata = upload.get("MetaData", {})
    filename = metadata.get("name", metadata.get("filename", f"unknown-{file_id}.ply"))
    total_bytes = upload.get("Size")
    
    # tusd saves the file without an extension in the upload_dir
    original_file_path = os.path.join(settings.upload_dir, file_id)
    
    # Give it the proper extension so tools like pdal can guess the format
    original_ext = os.path.splitext(filename)[1]
    new_safe_filename = f"{file_id}{original_ext}"
    new_file_path = os.path.join(settings.upload_dir, new_safe_filename)
    
    if os.path.exists(original_file_path):
        os.rename(original_file_path, new_file_path)
    else:
        # File might have already been moved or not exist
        pass

    # Create job in database
    job_record = Job(
        name=f"Convert {filename} to EPT",
        payload={
            "filename": filename,
            "safe_filename": new_safe_filename,
            "total_bytes": total_bytes,
            "file_id": file_id
        },
        status="PENDING",
        progress=0.0
    )
    db.add(job_record)
    await db.commit()
    await db.refresh(job_record)
        
    # Queue the job
    redis_conn = Redis.from_url(settings.redis_url)
    q = Queue("pointcloud_tasks", connection=redis_conn)
    q.enqueue(
        "app.services.worker.tasks.convert_to_ept", 
        new_file_path, 
        file_id, 
        job_id=str(job_record.id),
        storage_type=settings.pointcloud_storage_type.value
    )
    
    return {"status": "ok"}

