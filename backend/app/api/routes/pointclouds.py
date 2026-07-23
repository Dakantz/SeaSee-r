import os
import uuid
import aiofiles
from redis import Redis
from rq import Queue

from typing import List, Union, Optional
from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException
from fastapi.responses import FileResponse
from app.schemas.pointcloud import PointCloudMetadataResponse, PointCloudCameraRouteResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel, conlist

from app.services.pointcloud import PointCloudStorageService
from app.api.dependencies.pointcloud import get_pointcloud_service
from app.core.config import settings
from app.core.database import get_db_session
from app.models.job import Job
from app.models.pointcloud import PointCloud, PointCloudCameraRoute

class TransformUpdate(BaseModel):
    matrix: conlist(float, min_length=16, max_length=16)

router = APIRouter(
    prefix="/pointclouds",
    tags=["Point Clouds"]
)

"""
Retrieve a list of available point clouds.
"""
@router.get("/", response_model=List[Union[PointCloudMetadataResponse, str]])
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
Retrieve the EPT json URL for a given pointcloud.
"""
@router.get("/{identifier}/ept")
async def get_ept_metadata(identifier: str):
    ept_path = os.path.join(settings.ept_dir, identifier, "ept.json")
    if not os.path.isfile(ept_path):
        raise HTTPException(status_code=404, detail="EPT pointcloud not found.")
    
    return {"url": f"/ept/{identifier}/ept.json"}

"""
Delete a pointcloud and all related files (e.g. the saved pointcloud in the filesystem and EPT metadata).
"""
@router.delete("/{identifier}")
async def delete_pointcloud(
    identifier: str,
    db: AsyncSession = Depends(get_db_session)
):
    import shutil
    from app.services.pointcloud import LocalPointCloudStorageService, DatabasePointCloudStorageService
    
    local_service = LocalPointCloudStorageService(base_dir=settings.pointcloud_local_dir)
    db_service = DatabasePointCloudStorageService(db_session=db)

    deleted_local = await local_service.delete_pointcloud(identifier)
    deleted_db = await db_service.delete_pointcloud(identifier)
    
    ept_dir_path = os.path.join(settings.ept_dir, identifier)
    deleted_ept = False
    if os.path.isdir(ept_dir_path):
        shutil.rmtree(ept_dir_path)
        deleted_ept = True

    if not (deleted_local or deleted_db or deleted_ept):
        raise HTTPException(status_code=404, detail="Point cloud not found or could not be deleted.")
        
    return {"message": "Point cloud deleted successfully from available storages"}

@router.get("/{identifier}/camera-routes", response_model=List[PointCloudCameraRouteResponse])
async def get_camera_routes(
    identifier: str,
    db: AsyncSession = Depends(get_db_session)
):
    try:
        pc_uuid = uuid.UUID(identifier)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid UUID format")
        
    query = select(PointCloudCameraRoute).where(PointCloudCameraRoute.pointcloud_id == pc_uuid)
    result = await db.execute(query)
    routes = result.scalars().all()
    
    return list(routes)

@router.patch("/{id}/transform")
async def update_transform(
    id: str,
    transform: TransformUpdate,
    db: AsyncSession = Depends(get_db_session)
):
    try:
        pc_uuid = uuid.UUID(id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid UUID format")
        
    query = select(PointCloud).where(PointCloud.id == pc_uuid)
    result = await db.execute(query)
    pointcloud = result.scalar_one_or_none()
    
    if not pointcloud:
        raise HTTPException(status_code=404, detail="Point cloud not found")
        
    pointcloud.transform_matrix = transform.matrix
    await db.commit()
    await db.refresh(pointcloud)
    
    return {"transform_matrix": pointcloud.transform_matrix}

@router.post("/ingest-opensfm")
async def ingest_opensfm(
    folder_name: Optional[str] = None,
    db: AsyncSession = Depends(get_db_session)
):
    import os
    import uuid
    from redis import Redis
    from rq import Queue
    from app.core.config import settings
    from app.models.job import Job

    ingestion_dir = settings.opensfm_ingestion_dir
    if not os.path.exists(ingestion_dir) or not os.path.isdir(ingestion_dir):
        raise HTTPException(status_code=404, detail="OpenSfM ingestion directory not found.")

    redis_conn = Redis.from_url(settings.redis_url)
    q = Queue("pointcloud_tasks", connection=redis_conn)

    jobs_created = []

    for f_name in os.listdir(ingestion_dir):
        if folder_name and f_name != folder_name:
            continue
            
        folder_path = os.path.join(ingestion_dir, f_name)
        if os.path.isdir(folder_path):
            fused_ply_path = os.path.join(folder_path, "undistorted", "depthmaps", "fused.ply")
            if os.path.isfile(fused_ply_path):
                file_uuid_str = str(uuid.uuid4())
                
                job_record = Job(
                    name=f"Ingest OpenSfM {f_name}",
                    payload={
                        "filename": f_name, # orig_filename will be the folder name
                        "safe_filename": f"{file_uuid_str}.ply",
                        "total_bytes": os.path.getsize(fused_ply_path),
                        "file_id": file_uuid_str,
                        "folder_path": folder_path
                    },
                    status="PENDING",
                    progress=0.0
                )
                db.add(job_record)
                await db.commit()
                await db.refresh(job_record)
                
                q.enqueue(
                    "app.services.worker.tasks.process_opensfm",
                    fused_ply_path,
                    file_uuid_str,
                    job_id=str(job_record.id),
                    storage_type=settings.pointcloud_storage_type.value,
                    folder_path=folder_path
                )
                
                jobs_created.append({
                    "folder": f_name,
                    "job_id": str(job_record.id),
                    "file_id": file_uuid_str
                })

    return {"message": f"Started {len(jobs_created)} ingestion jobs", "jobs": jobs_created}
