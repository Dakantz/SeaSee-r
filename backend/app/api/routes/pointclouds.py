import os
import uuid
from redis import Redis
from rq import Queue

from typing import List, Union, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse

from app.schemas.pointcloud import (
    PointCloudMetadataResponse,
    CameraHeaderResponse,
    CameraFrameResponse,
    PointCloudStreamSummaryResponse
)
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel, conlist

from app.services.pointcloud import DatabasePointCloudStorageService
from app.api.dependencies.pointcloud import get_pointcloud_service, pointcloud_filter_parser
from app.schemas.filter import FilterCriterion
from app.core.config import settings
from app.core.database import get_db_session
from app.models.job import Job
from app.models.pointcloud import PointCloudMetadata
from app.models.camera import CameraHeader, CameraFrame

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
    storage_service: DatabasePointCloudStorageService = Depends(get_pointcloud_service)
):
    return await storage_service.list_pointclouds()


"""
Stream point cloud data directly from database as raw binary buffer (Float32 XYZ, Uint8 RGB).
Supports flexible field filtering with comparison operators using field__operator=value syntax.
"""
@router.get("/stream-binary")
async def stream_pointcloud_binary(
    lod: int = Query(..., ge=0, le=10, description="Level of Detail pyramid level (0-10)"),
    filters: List[FilterCriterion] = Depends(pointcloud_filter_parser),
    storage_service: DatabasePointCloudStorageService = Depends(get_pointcloud_service)
):
    return await storage_service.stream_pointcloud_binary(
        lod=lod,
        filters=filters
    )


"""
Retrieve point cloud selection summary (point count, bounding box, and connected metadata).
Supports flexible field filtering with comparison operators using field__operator=value syntax.
"""
@router.get("/stream-summary", response_model=PointCloudStreamSummaryResponse)
async def get_pointcloud_stream_summary(
    lod: int = Query(default=0, ge=0, le=10, description="Level of Detail pyramid level (0-10)"),
    filters: List[FilterCriterion] = Depends(pointcloud_filter_parser),
    storage_service: DatabasePointCloudStorageService = Depends(get_pointcloud_service)
):
    return await storage_service.get_pointcloud_stream_summary(
        lod=lod,
        filters=filters
    )





"""
Retrieve a .ply point cloud file from database storage.
"""
@router.get("/{filename_or_id}")
async def get_pointcloud(
    filename_or_id: str,
    lod: int = Query(0, ge=0, le=10, description="Level of Detail pyramid level (0-10)"),
    storage_service: DatabasePointCloudStorageService = Depends(get_pointcloud_service)
):
    return await storage_service.get_pointcloud(filename_or_id, lod=lod)


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
    from app.services.pointcloud import DatabasePointCloudStorageService
    
    db_service = DatabasePointCloudStorageService(db_session=db)

    deleted_db = await db_service.delete_pointcloud(identifier)
    
    ept_dir_path = os.path.join(settings.ept_dir, identifier)
    deleted_ept = False
    if os.path.isdir(ept_dir_path):
        shutil.rmtree(ept_dir_path)
        deleted_ept = True

    if not (deleted_db or deleted_ept):
        raise HTTPException(status_code=404, detail="Point cloud not found or could not be deleted.")
        
    return {"message": "Point cloud deleted successfully from available storages"}

@router.get("/{identifier}/camera-headers", response_model=List[CameraHeaderResponse])
async def get_camera_headers(
    identifier: str,
    db: AsyncSession = Depends(get_db_session)
):
    try:
        pc_uuid = uuid.UUID(identifier)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid UUID format")
        
    query = select(CameraHeader).where(CameraHeader.pointcloud_id == pc_uuid)
    result = await db.execute(query)
    headers = result.scalars().all()
    
    return list(headers)

@router.get("/{identifier}/camera-routes", response_model=List[CameraFrameResponse])
async def get_camera_routes(
    identifier: str,
    db: AsyncSession = Depends(get_db_session)
):
    import json
    from geoalchemy2.functions import ST_AsGeoJSON

    try:
        pc_uuid = uuid.UUID(identifier)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid UUID format")

    headers_query = select(CameraHeader.id).where(CameraHeader.pointcloud_id == pc_uuid)
    headers_res = await db.execute(headers_query)
    header_ids = headers_res.scalars().all()

    if not header_ids:
        return []

    query = select(
        CameraFrame.id,
        CameraFrame.camera_header_id,
        CameraFrame.timestamp,
        ST_AsGeoJSON(CameraFrame.position).label("pos_geojson"),
        ST_AsGeoJSON(CameraFrame.direction).label("dir_geojson"),
        CameraFrame.rotation,
        CameraFrame.relative_time,
        CameraFrame.filename
    ).where(CameraFrame.camera_header_id.in_(header_ids)).order_by(
        CameraFrame.timestamp.asc(),
        CameraFrame.filename.asc()
    )

    result = await db.execute(query)
    rows = result.all()

    frames = []
    for r in rows:
        pos_coords = json.loads(r.pos_geojson)["coordinates"] if r.pos_geojson else None
        dir_coords = json.loads(r.dir_geojson)["coordinates"] if r.dir_geojson else None

        frames.append(CameraFrameResponse(
            id=r.id,
            camera_header_id=r.camera_header_id,
            timestamp=r.timestamp,
            position=pos_coords,
            direction=dir_coords,
            rotation=r.rotation,
            relative_time=r.relative_time,
            filename=r.filename
        ))

    return frames

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
        
    query = select(PointCloudMetadata).where(PointCloudMetadata.id == pc_uuid)
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
    multiply_x: int = Query(1, ge=1),
    multiply_y: int = Query(1, ge=1),
    offset_step_x: Optional[float] = None,
    offset_step_y: Optional[float] = None,
    db: AsyncSession = Depends(get_db_session)
):
    """
    Initialize new point cloud ingestion from OpenSfM output directories.
    Supports multiplying ingestion in a multiply_x x multiply_y grid with global position offsets.
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
            fused_laz_path = os.path.join(folder_path, "undistorted", "depthmaps", "fused.laz")
            if os.path.isfile(fused_laz_path):
                # Determine grid offset step sizes
                step_x = offset_step_x
                step_y = offset_step_y
                if step_x is None or step_y is None:
                    try:
                        from app.services.pointcloud.pdal import get_pointcloud_stats
                        bbox, _ = await get_pointcloud_stats(fused_laz_path)
                        width_x = abs(bbox.get("max_x", 0.0) - bbox.get("min_x", 0.0))
                        height_y = abs(bbox.get("max_y", 0.0) - bbox.get("min_y", 0.0))
                        if step_x is None:
                            step_x = max(width_x * 1.1, 10.0) if width_x > 0 else 10.0
                        if step_y is None:
                            step_y = max(height_y * 1.1, 10.0) if height_y > 0 else 10.0
                    except Exception:
                        if step_x is None:
                            step_x = 10.0
                        if step_y is None:
                            step_y = 10.0

                for ix in range(multiply_x):
                    for iy in range(multiply_y):
                        grid_offset_x = ix * step_x
                        grid_offset_y = iy * step_y

                        file_uuid_str = str(uuid.uuid4())
                        name_suffix = f"{f_name}_grid_{ix}_{iy}" if (multiply_x > 1 or multiply_y > 1) else f_name

                        job_record = Job(
                            name=f"Ingest OpenSfM {name_suffix}",
                            task_type="opensfm_ingest",
                            payload={
                                "filename": name_suffix,
                                "safe_filename": f"{file_uuid_str}.laz",
                                "total_bytes": os.path.getsize(fused_laz_path),
                                "file_id": file_uuid_str,
                                "folder_path": folder_path,
                                "offset_x": grid_offset_x,
                                "offset_y": grid_offset_y,
                                "grid_x": ix,
                                "grid_y": iy,
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
                            "grid_x": ix,
                            "grid_y": iy,
                            "offset_x": grid_offset_x,
                            "offset_y": grid_offset_y,
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

    query = select(PointCloudMetadata).where(PointCloudMetadata.id == pc_uuid)
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
            fused_laz_path = os.path.join(folder_path, "undistorted", "depthmaps", "fused.laz")
            if os.path.isfile(fused_laz_path):
                try:
                    cand_bbox, cand_points, cand_srs = await get_pointcloud_srs_and_stats(fused_laz_path)
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
                    task_type="opensfm_append",
                    payload={
                        "filename": f_name,
                        "folder_path": folder_path,
                        "existing_id": str(existing_pc.id),
                        "file_id": str(existing_pc.id),
                        "is_append": True,
                        "total_bytes": os.path.getsize(fused_laz_path)
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
    if os.path.isfile(item_path) and item_path.lower().endswith(('.geotif', '.tif', '.tiff', '.geotiff')):
        return item_path
    elif os.path.isdir(item_path):
        for root, _, files in os.walk(item_path):
            for file in files:
                if file.lower().endswith(('.geotif', '.tif', '.tiff', '.geotiff')):
                    return os.path.join(root, file)
    return None


@router.post("/ingest-emodnet/init")
async def ingest_emodnet_init(
    folder_name: Optional[str] = None,
    file_name: Optional[str] = None,
    filename: Optional[str] = None,
    file_path: Optional[str] = None,
    db: AsyncSession = Depends(get_db_session)
):
    """
    Initialize new point cloud ingestion from EMODnet GeoTIFF bathymetry data files
    using PDAL pipeline running inside Docker.
    Supports targeting specific folder names, file names, or direct .tiff/.tif/.geotif files.
    """
    ingestion_dir = settings.emodnet_ingestion_dir
    if not os.path.exists(ingestion_dir) or not os.path.isdir(ingestion_dir):
        raise HTTPException(status_code=404, detail="EMODnet ingestion directory not found.")

    redis_conn = Redis.from_url(settings.redis_url)
    q = Queue("pointcloud_tasks", connection=redis_conn)

    target_name = file_name or filename or file_path or folder_name

    items_to_process = []
    if target_name and os.path.isabs(target_name) and os.path.exists(target_name):
        items_to_process.append((os.path.basename(target_name), target_name))
    elif os.path.exists(ingestion_dir) and os.path.isdir(ingestion_dir):
        for f_name in os.listdir(ingestion_dir):
            if target_name:
                target_base = os.path.basename(target_name)
                target_no_ext = os.path.splitext(target_base)[0]
                f_no_ext = os.path.splitext(f_name)[0]
                if f_name != target_name and f_name != target_base and f_no_ext != target_name and f_no_ext != target_no_ext:
                    continue
            items_to_process.append((f_name, os.path.join(ingestion_dir, f_name)))

    jobs_created = []

    for f_name, item_path in items_to_process:
        geotiff_path = _find_geotiff_in_item(item_path)

        if geotiff_path:
            file_uuid_str = str(uuid.uuid4())

            job_record = Job(
                name=f"Ingest EMODnet {f_name}",
                task_type="emodnet_ingest",
                payload={
                    "filename": f_name,
                    "file_id": file_uuid_str,
                    "geotiff_path": geotiff_path,
                    "folder_path": item_path if os.path.isdir(item_path) else os.path.dirname(item_path),
                    "total_bytes": os.path.getsize(geotiff_path)
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
                "file": f_name,
                "job_id": str(job_record.id),
                "file_id": file_uuid_str,
                "geotiff": os.path.basename(geotiff_path)
            })

    return {"message": f"Started {len(jobs_created)} EMODnet ingestion jobs", "jobs": jobs_created}


@router.post("/ingest-emodnet/append")
async def ingest_emodnet_append(
    existing_id: str,
    folder_name: Optional[str] = None,
    file_name: Optional[str] = None,
    filename: Optional[str] = None,
    file_path: Optional[str] = None,
    db: AsyncSession = Depends(get_db_session)
):
    """
    Append EMODnet GeoTIFF bathymetry data files into an existing point cloud
    if conditions (within bounding box, matching coordinate system) are met.
    Supports targeting specific folder names, file names, or direct .tiff/.tif/.geotif files.
    """
    try:
        pc_uuid = uuid.UUID(str(existing_id))
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid UUID format for existing point cloud.")

    query = select(PointCloudMetadata).where(PointCloudMetadata.id == pc_uuid)
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

    target_name = file_name or filename or file_path or folder_name

    items_to_process = []
    if target_name and os.path.isabs(target_name) and os.path.exists(target_name):
        items_to_process.append((os.path.basename(target_name), target_name))
    elif os.path.exists(ingestion_dir) and os.path.isdir(ingestion_dir):
        for f_name in os.listdir(ingestion_dir):
            if target_name:
                target_base = os.path.basename(target_name)
                target_no_ext = os.path.splitext(target_base)[0]
                f_no_ext = os.path.splitext(f_name)[0]
                if f_name != target_name and f_name != target_base and f_no_ext != target_name and f_no_ext != target_no_ext:
                    continue
            items_to_process.append((f_name, os.path.join(ingestion_dir, f_name)))

    jobs_created = []
    skipped_folders = []

    for f_name, item_path in items_to_process:
        geotiff_path = _find_geotiff_in_item(item_path)

        if geotiff_path:
            try:
                cand_bbox, cand_points, cand_srs = await get_pointcloud_srs_and_stats(geotiff_path)
            except Exception as e:
                skipped_folders.append({"folder": f_name, "file": f_name, "reason": f"Failed to parse PDAL stats from GeoTIFF: {str(e)}"})
                continue

            bbox_valid = check_bbox_within_or_overlapping(existing_bbox, cand_bbox)
            srs_valid = check_coordinate_systems_match(existing_srs, cand_srs)

            if not bbox_valid:
                skipped_folders.append({"folder": f_name, "file": f_name, "reason": "Candidate GeoTIFF outside existing bounding box."})
                continue

            if not srs_valid:
                skipped_folders.append({"folder": f_name, "file": f_name, "reason": f"Coordinate system mismatch: existing={existing_srs}, candidate={cand_srs}."})
                continue

            job_record = Job(
                name=f"Append EMODnet {f_name} to {existing_id}",
                task_type="emodnet_append",
                payload={
                    "filename": f_name,
                    "geotiff_path": geotiff_path,
                    "folder_path": item_path if os.path.isdir(item_path) else os.path.dirname(item_path),
                    "existing_id": str(existing_pc.id),
                    "file_id": str(existing_pc.id),
                    "is_append": True,
                    "total_bytes": os.path.getsize(geotiff_path)
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
                "file": f_name,
                "job_id": str(job_record.id),
                "existing_id": str(existing_pc.id),
                "geotiff": os.path.basename(geotiff_path)
            })

    return {
        "message": f"Started {len(jobs_created)} EMODnet append jobs",
        "jobs": jobs_created,
        "skipped": skipped_folders
    }



