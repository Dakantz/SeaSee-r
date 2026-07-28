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

@router.post("/ingest-opensfm/init")
async def ingest_opensfm_init(
    folder_name: Optional[str] = None,
    db: AsyncSession = Depends(get_db_session)
):
    """
    Initialize new point cloud ingestion from OpenSfM output directories.
    """
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
                        "task_type": "opensfm_ingest",
                        "filename": f_name, # orig_filename will be the folder name
                        "safe_filename": f"{file_uuid_str}.ply",
                        "total_bytes": os.path.getsize(fused_ply_path),
                        "file_id": file_uuid_str,
                        "folder_path": folder_path,
                        "storage_type": settings.pointcloud_storage_type.value
                    },
                    status="PENDING",
                    progress=0.0
                )
                db.add(job_record)
                await db.commit()
                await db.refresh(job_record)
                
                q.enqueue(
                    "app.services.worker.tasks.run_background_job",
                    str(job_record.id),
                    job_id=str(job_record.id)
                )
                
                jobs_created.append({
                    "folder": f_name,
                    "job_id": str(job_record.id),
                    "file_id": file_uuid_str
                })

    return {"message": f"Started {len(jobs_created)} ingestion jobs", "jobs": jobs_created}


@router.post("/ingest-opensfm/append")
async def ingest_opensfm_append(
    existing_id: str,
    folder_name: Optional[str] = None,
    db: AsyncSession = Depends(get_db_session)
):
    """
    Append point clouds inside opensfm_ingestion_dir into an existing point cloud
    if conditions (within bounding box, same coordinate system) are met.
    """
    try:
        pc_uuid = uuid.UUID(str(existing_id))
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid UUID format for existing point cloud.")

    query = select(PointCloud).where(PointCloud.id == pc_uuid)
    result = await db.execute(query)
    existing_pc = result.scalar_one_or_none()

    if not existing_pc:
        raise HTTPException(status_code=404, detail=f"Existing point cloud with ID {existing_id} not found.")

    ingestion_dir = settings.opensfm_ingestion_dir
    if not os.path.exists(ingestion_dir) or not os.path.isdir(ingestion_dir):
        raise HTTPException(status_code=404, detail="OpenSfM ingestion directory not found.")

    from app.services.pointcloud.pdal import (
        get_pointcloud_srs_and_stats,
        check_bbox_within_or_overlapping,
        check_coordinate_systems_match
    )

    existing_bbox = {
        "min_x": existing_pc.min_x,
        "max_x": existing_pc.max_x,
        "min_y": existing_pc.min_y,
        "max_y": existing_pc.max_y,
        "min_z": existing_pc.min_z,
        "max_z": existing_pc.max_z,
    }
    existing_srs = str(existing_pc.pcid)

    redis_conn = Redis.from_url(settings.redis_url)
    q = Queue("pointcloud_tasks", connection=redis_conn)

    jobs_created = []
    skipped_folders = []

    for f_name in os.listdir(ingestion_dir):
        if folder_name and f_name != folder_name:
            continue
            
        folder_path = os.path.join(ingestion_dir, f_name)
        if os.path.isdir(folder_path):
            fused_ply_path = os.path.join(folder_path, "undistorted", "depthmaps", "fused.ply")
            if os.path.isfile(fused_ply_path):
                try:
                    cand_bbox, cand_points, cand_srs = await get_pointcloud_srs_and_stats(fused_ply_path)
                except Exception as e:
                    skipped_folders.append({"folder": f_name, "reason": f"Failed to parse PDAL stats: {str(e)}"})
                    continue

                bbox_valid = check_bbox_within_or_overlapping(existing_bbox, cand_bbox)
                srs_valid = check_coordinate_systems_match(existing_srs, cand_srs)

                if not bbox_valid:
                    skipped_folders.append({"folder": f_name, "reason": "Candidate point cloud outside existing bounding box."})
                    continue

                if not srs_valid:
                    skipped_folders.append({"folder": f_name, "reason": f"Coordinate system mismatch: existing={existing_srs}, candidate={cand_srs}."})
                    continue

                job_record = Job(
                    name=f"Append OpenSfM {f_name} to {existing_id}",
                    payload={
                        "task_type": "opensfm_append",
                        "filename": f_name,
                        "folder_path": folder_path,
                        "existing_id": str(existing_pc.id),
                        "file_id": str(existing_pc.id),
                        "is_append": True,
                        "total_bytes": os.path.getsize(fused_ply_path),
                        "storage_type": settings.pointcloud_storage_type.value
                    },
                    status="PENDING",
                    progress=0.0
                )
                db.add(job_record)
                await db.commit()
                await db.refresh(job_record)

                q.enqueue(
                    "app.services.worker.tasks.run_background_job",
                    str(job_record.id),
                    job_id=str(job_record.id)
                )

                jobs_created.append({
                    "folder": f_name,
                    "job_id": str(job_record.id),
                    "existing_id": str(existing_pc.id)
                })

    return {
        "message": f"Started {len(jobs_created)} append jobs",
        "jobs": jobs_created,
        "skipped": skipped_folders
    }


def _find_geotiff_in_item(item_path: str) -> Optional[str]:
    """Helper to locate a .geotif, .tif, or .tiff file within a directory or check if item_path itself is a GeoTIFF."""
    if os.path.isfile(item_path) and item_path.lower().endswith(('.geotif', '.tif', '.tiff')):
        return item_path
    elif os.path.isdir(item_path):
        for root, _, files in os.walk(item_path):
            for file in files:
                if file.lower().endswith(('.geotif', '.tif', '.tiff')):
                    return os.path.join(root, file)
    return None


@router.post("/ingest-emodnet")
@router.post("/ingest-emodnet/init")
async def ingest_emodnet_init(
    folder_name: Optional[str] = None,
    db: AsyncSession = Depends(get_db_session)
):
    """
    Initialize new point cloud ingestion from EMODnet GeoTIFF bathymetry data files
    using PDAL pipeline running inside Docker.
    """
    ingestion_dir = settings.emodnet_ingestion_dir
    if not os.path.exists(ingestion_dir) or not os.path.isdir(ingestion_dir):
        raise HTTPException(status_code=404, detail="EMODnet ingestion directory not found.")

    redis_conn = Redis.from_url(settings.redis_url)
    q = Queue("pointcloud_tasks", connection=redis_conn)

    jobs_created = []

    for f_name in os.listdir(ingestion_dir):
        if folder_name and f_name != folder_name:
            continue

        item_path = os.path.join(ingestion_dir, f_name)
        geotiff_path = _find_geotiff_in_item(item_path)

        if geotiff_path:
            file_uuid_str = str(uuid.uuid4())

            job_record = Job(
                name=f"Ingest EMODnet {f_name}",
                payload={
                    "task_type": "emodnet_ingest",
                    "filename": f_name,
                    "file_id": file_uuid_str,
                    "geotiff_path": geotiff_path,
                    "folder_path": item_path if os.path.isdir(item_path) else os.path.dirname(item_path),
                    "total_bytes": os.path.getsize(geotiff_path),
                    "storage_type": settings.pointcloud_storage_type.value
                },
                status="PENDING",
                progress=0.0
            )
            db.add(job_record)
            await db.commit()
            await db.refresh(job_record)

            q.enqueue(
                "app.services.worker.tasks.run_background_job",
                str(job_record.id),
                job_id=str(job_record.id)
            )

            jobs_created.append({
                "folder": f_name,
                "job_id": str(job_record.id),
                "file_id": file_uuid_str,
                "geotiff": os.path.basename(geotiff_path)
            })

    return {"message": f"Started {len(jobs_created)} EMODnet ingestion jobs", "jobs": jobs_created}


@router.post("/ingest-emodnet/append")
async def ingest_emodnet_append(
    existing_id: str,
    folder_name: Optional[str] = None,
    db: AsyncSession = Depends(get_db_session)
):
    """
    Append EMODnet GeoTIFF bathymetry data files into an existing point cloud
    if conditions (within bounding box, matching coordinate system) are met.
    """
    try:
        pc_uuid = uuid.UUID(str(existing_id))
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid UUID format for existing point cloud.")

    query = select(PointCloud).where(PointCloud.id == pc_uuid)
    result = await db.execute(query)
    existing_pc = result.scalar_one_or_none()

    if not existing_pc:
        raise HTTPException(status_code=404, detail=f"Existing point cloud with ID {existing_id} not found.")

    ingestion_dir = settings.emodnet_ingestion_dir
    if not os.path.exists(ingestion_dir) or not os.path.isdir(ingestion_dir):
        raise HTTPException(status_code=404, detail="EMODnet ingestion directory not found.")

    from app.services.pointcloud.pdal import (
        get_pointcloud_srs_and_stats,
        check_bbox_within_or_overlapping,
        check_coordinate_systems_match
    )

    existing_bbox = {
        "min_x": existing_pc.min_x,
        "max_x": existing_pc.max_x,
        "min_y": existing_pc.min_y,
        "max_y": existing_pc.max_y,
        "min_z": existing_pc.min_z,
        "max_z": existing_pc.max_z,
    }
    existing_srs = str(existing_pc.pcid)

    redis_conn = Redis.from_url(settings.redis_url)
    q = Queue("pointcloud_tasks", connection=redis_conn)

    jobs_created = []
    skipped_folders = []

    for f_name in os.listdir(ingestion_dir):
        if folder_name and f_name != folder_name:
            continue

        item_path = os.path.join(ingestion_dir, f_name)
        geotiff_path = _find_geotiff_in_item(item_path)

        if geotiff_path:
            try:
                cand_bbox, cand_points, cand_srs = await get_pointcloud_srs_and_stats(geotiff_path)
            except Exception as e:
                skipped_folders.append({"folder": f_name, "reason": f"Failed to parse PDAL stats from GeoTIFF: {str(e)}"})
                continue

            bbox_valid = check_bbox_within_or_overlapping(existing_bbox, cand_bbox)
            srs_valid = check_coordinate_systems_match(existing_srs, cand_srs)

            if not bbox_valid:
                skipped_folders.append({"folder": f_name, "reason": "Candidate GeoTIFF outside existing bounding box."})
                continue

            if not srs_valid:
                skipped_folders.append({"folder": f_name, "reason": f"Coordinate system mismatch: existing={existing_srs}, candidate={cand_srs}."})
                continue

            job_record = Job(
                name=f"Append EMODnet {f_name} to {existing_id}",
                payload={
                    "task_type": "emodnet_append",
                    "filename": f_name,
                    "geotiff_path": geotiff_path,
                    "folder_path": item_path if os.path.isdir(item_path) else os.path.dirname(item_path),
                    "existing_id": str(existing_pc.id),
                    "file_id": str(existing_pc.id),
                    "is_append": True,
                    "total_bytes": os.path.getsize(geotiff_path),
                    "storage_type": settings.pointcloud_storage_type.value
                },
                status="PENDING",
                progress=0.0
            )
            db.add(job_record)
            await db.commit()
            await db.refresh(job_record)

            q.enqueue(
                "app.services.worker.tasks.run_background_job",
                str(job_record.id),
                job_id=str(job_record.id)
            )

            jobs_created.append({
                "folder": f_name,
                "job_id": str(job_record.id),
                "existing_id": str(existing_pc.id),
                "geotiff": os.path.basename(geotiff_path)
            })

    return {
        "message": f"Started {len(jobs_created)} EMODnet append jobs",
        "jobs": jobs_created,
        "skipped": skipped_folders
    }


