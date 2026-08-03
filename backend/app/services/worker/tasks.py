import os
import asyncio
import json
import uuid
import time
from urllib.parse import urlparse
from datetime import datetime
from rq import get_current_job
from sqlalchemy import update, text, select

from app.core.config import settings, StorageType
from app.core.database import async_session
from app.models.job import Job
from app.models.pointcloud import PointCloud, PointCloudCameraRoute

from app.services.pointcloud.entwine import build_ept
from app.services.pointcloud.pdal import (
    get_pointcloud_stats,
    get_pointcloud_srs_and_stats,
    get_pointcloud_dimensions,
    build_ept_pdal_docker,
    process_emodnet_csv,
    format_libpq_connection_string,
    ingest_pgpointcloud
)
from app.services.opensfm.ingest import (
    parse_reconstruction_json,
    extract_camera_route_csv
)

async def _update_job_status(
    job_id_str: str,
    status: str,
    progress: float = 0.0,
    error_message: str = None,
    result: dict = None
):
    """Updates job status, progress percentage, error message, and results in PostgreSQL."""
    async with async_session() as session:
        values = {
            "status": status,
            "progress": round(progress, 2),
            "error_message": error_message
        }
        if result is not None:
            values["result"] = result
        if status == "RUNNING":
            values["started_at"] = datetime.utcnow()
        elif status in ("COMPLETED", "FAILED"):
            values["completed_at"] = datetime.utcnow()

        stmt = update(Job).where(Job.id == job_id_str).values(**values)
        await session.execute(stmt)
        await session.commit()


def run_background_job(job_id_str: str):
    """
    Main RQ background worker entrypoint to execute enqueued jobs.
    Fetches job record from DB and dispatches to appropriate task handler.
    """
    return asyncio.run(_run_background_job_async(job_id_str))


async def _run_background_job_async(job_id_str: str):
    async with async_session() as session:
        res = await session.execute(select(Job).where(Job.id == job_id_str))
        job_record = res.scalar_one_or_none()
        if not job_record:
            return {"status": "error", "message": f"Job {job_id_str} not found"}

        payload = job_record.payload or {}
        name = job_record.name or ""

    task_type = payload.get("task_type") or payload.get("type")

    # Dispatch by explicit task_type
    if task_type == "pointcloud_upload":
        return await _process_pointcloud_upload_async(job_id_str, payload)
    elif task_type in ("video_upload", "video_reconstruction"):
        return await _process_video_upload_async(job_id_str, payload)
    elif task_type in ("opensfm_ingest", "opensfm_append"):
        return await _process_opensfm_job_async(job_id_str, payload)
    elif task_type in ("emodnet_ingest", "emodnet_append"):
        return await _process_emodnet_job_async(job_id_str, payload)
    elif task_type in ("emodnet_csv_ingest", "emodnet_csv_process"):
        return await _process_emodnet_csv_job_async(job_id_str, payload)

    # Default fallback handler
    return await _process_default_job_async(job_id_str, name)


async def _process_pointcloud_upload_async(job_id_str: str, payload: dict):
    """Processes point cloud file upload jobs."""
    file_id = payload.get("file_id")
    safe_filename = payload.get("safe_filename")
    file_path = payload.get("file_path")

    # Locate file on disk if full path is omitted
    if not file_path and safe_filename:
        for candidate_dir in [settings.pointcloud_local_dir, settings.video_dir, settings.upload_dir]:
            candidate = os.path.join(candidate_dir, safe_filename)
            if os.path.exists(candidate):
                file_path = candidate
                break
        if not file_path:
            file_path = os.path.join(settings.pointcloud_local_dir, safe_filename)

    if not file_path or not os.path.exists(file_path):
        error_msg = f"Point cloud file not found on disk for job {job_id_str} (safe_filename: {safe_filename})"
        await _update_job_status(job_id_str, "FAILED", 0.0, error_msg)
        return {"status": "error", "message": error_msg}

    storage_type = payload.get("storage_type", settings.pointcloud_storage_type.value)
    return await _ingest_pointcloud_pipeline_async(file_path, file_id or job_id_str, job_id_str, storage_type)


async def _process_video_upload_async(job_id_str: str, payload: dict):
    """Processes video upload/reconstruction jobs."""
    filename = payload.get("filename", "video")
    await _update_job_status(job_id_str, "RUNNING", 10.0)
    await asyncio.sleep(1)
    await _update_job_status(job_id_str, "RUNNING", 50.0)
    await asyncio.sleep(1)
    res_data = {
        "status": "success",
        "job_id": job_id_str,
        "message": f"Video processing completed for {filename}",
        "video_id": payload.get("file_id"),
        "batch_id": payload.get("batch_id")
    }
    await _update_job_status(job_id_str, "COMPLETED", 100.0, result=res_data)
    return res_data


async def _process_opensfm_job_async(job_id_str: str, payload: dict):
    """Processes OpenSfM ingestion task dispatched via Job ID."""
    folder_path = payload.get("folder_path")
    is_append = payload.get("is_append", False) or (payload.get("task_type") == "opensfm_append")
    file_id = (payload.get("existing_id") or payload.get("file_id")) if is_append else (payload.get("file_id") or job_id_str)
    storage_type = payload.get("storage_type", settings.pointcloud_storage_type.value)
    fused_ply_path = os.path.join(folder_path, "undistorted", "depthmaps", "fused.ply") if folder_path else payload.get("file_path")

    return await _process_opensfm_async(
        file_path=fused_ply_path,
        file_id=file_id,
        job_id=job_id_str,
        storage_type=storage_type,
        folder_path=folder_path,
        is_append=is_append
    )


async def _process_default_job_async(job_id_str: str, name: str):
    """Fallback execution handler for generic or unclassified background tasks."""
    await _update_job_status(job_id_str, "RUNNING", 10.0)
    await asyncio.sleep(1)
    await _update_job_status(job_id_str, "RUNNING", 50.0)
    await asyncio.sleep(1)

    res_data = {"status": "success", "job_id": job_id_str, "name": name}
    await _update_job_status(job_id_str, "COMPLETED", 100.0, result=res_data)
    return res_data


async def _ingest_pointcloud_to_db_async(
    file_path: str,
    file_id: str,
    job_id: str = None,
    is_append: bool = False
):
    """
    Database Ingestion via PDAL & Metadata insertion/update.
    Ingests point cloud at lod0, lod1, lod2, lod3 levels.
    """
    print(f"Ingesting pointcloud {file_id} (is_append={is_append}) to database...")
    
    # Extract bbox and point count via PDAL
    bbox, number_of_points = await get_pointcloud_stats(file_path)
    
    connection_str = format_libpq_connection_string(settings.database_url)

    pcid = None
    if is_append:
        async with async_session() as session:
            try:
                res = await session.execute(
                    text("SELECT PC_PCId(patch) FROM pointcloud_patches WHERE pointcloud_id = :id AND lod = 0 LIMIT 1"),
                    {"id": uuid.UUID(file_id)}
                )
                row = res.first()
                if row and row[0] is not None:
                    pcid = int(row[0])
            except Exception as e:
                print(f"Failed to query existing pcid from pointcloud_patches: {e}")

            if pcid is None:
                try:
                    stmt_existing = select(PointCloud).where(PointCloud.id == uuid.UUID(file_id))
                    res_existing = await session.execute(stmt_existing)
                    rec = res_existing.scalar_one_or_none()
                    if rec and rec.pcid:
                        pcid = rec.pcid
                except Exception as e:
                    print(f"Failed to query existing metadata for pcid: {e}")

    target_dims = None
    if is_append and pcid:
        try:
            async with async_session() as session:
                res = await session.execute(
                    text("SELECT schema FROM pointcloud_formats WHERE pcid = :pcid"),
                    {"pcid": pcid}
                )
                row = res.first()
                if row and row[0]:
                    import re
                    target_dims = re.findall(r"<pc:name>(.*?)</pc:name>", row[0])
        except Exception as e:
            print(f"Failed to query pcid schema: {e}")

    if not target_dims:
        target_dims = ["X", "Y", "Z", "Red", "Green", "Blue"]
        if not is_append:
            pcid = None

    source_dims = await get_pointcloud_dimensions(file_path)
    print(f"Source file dimensions: {source_dims}")
    print(f"Target schema dimensions: {target_dims}")

    # Execute PDAL pgPointcloud ingestion for LOD levels: lod0, lod1, lod2, lod3
    for lod in range(4):
        step = 2 ** lod
        ingested_pcid = await ingest_pgpointcloud(
            file_path=file_path,
            connection_str=connection_str,
            pointcloud_id=file_id,
            lod=lod,
            capacity=400,
            srid=4326,
            overwrite=not is_append,
            pcid=pcid,
            target_dimensions=target_dims,
            step=step
        )
        if lod == 0 and pcid is None and ingested_pcid is not None:
            pcid = ingested_pcid

    # Query PCID from database if still None
    if pcid is None:
        pcid = 1
        async with async_session() as session:
            try:
                res = await session.execute(
                    text("SELECT PC_PCId(patch) FROM pointcloud_patches WHERE pointcloud_id = :id AND lod = 0 LIMIT 1"),
                    {"id": uuid.UUID(file_id)}
                )
                row = res.first()
                if row and row[0] is not None:
                    pcid = int(row[0])
            except Exception as e:
                print(f"Failed to query pcid from pointcloud_patches: {e}")
            except Exception as e:
                print(f"Failed to query pcid from {lod0_table_name}: {e}")
            try:
                res = await session.execute(
                    text("SELECT pcid FROM pointcloud_formats ORDER BY pcid DESC LIMIT 1")
                )
                row = res.first()
                if row:
                    pcid = int(row[0])
            except Exception as e2:
                print(f"Failed to query pointcloud_formats: {e2}")

    # Fetch job record to get original filename and update or insert metadata record
    async with async_session() as session:
        orig_filename = os.path.basename(file_path)
        safe_filename = os.path.basename(file_path)
        if job_id:
            stmt_job = select(Job).where(Job.id == job_id)
            res_job = await session.execute(stmt_job)
            job_record = res_job.scalar_one_or_none()
            if job_record and isinstance(job_record.payload, dict):
                orig_filename = job_record.payload.get("filename", orig_filename)
                safe_filename = job_record.payload.get("safe_filename", safe_filename)

        target_uuid = uuid.UUID(file_id)
        stmt_existing = select(PointCloud).where(PointCloud.id == target_uuid)
        res_existing = await session.execute(stmt_existing)
        existing_record = res_existing.scalar_one_or_none()

        if is_append and existing_record:
            # Update existing PointCloud metadata record with accumulated points and expanded bbox
            existing_record.number_of_points = (existing_record.number_of_points or 0) + number_of_points
            if bbox.get("min_x") is not None:
                existing_record.min_x = min(existing_record.min_x, bbox["min_x"]) if existing_record.min_x is not None else bbox["min_x"]
            if bbox.get("max_x") is not None:
                existing_record.max_x = max(existing_record.max_x, bbox["max_x"]) if existing_record.max_x is not None else bbox["max_x"]
            if bbox.get("min_y") is not None:
                existing_record.min_y = min(existing_record.min_y, bbox["min_y"]) if existing_record.min_y is not None else bbox["min_y"]
            if bbox.get("max_y") is not None:
                existing_record.max_y = max(existing_record.max_y, bbox["max_y"]) if existing_record.max_y is not None else bbox["max_y"]
            if bbox.get("min_z") is not None:
                existing_record.min_z = min(existing_record.min_z, bbox["min_z"]) if existing_record.min_z is not None else bbox["min_z"]
            if bbox.get("max_z") is not None:
                existing_record.max_z = max(existing_record.max_z, bbox["max_z"]) if existing_record.max_z is not None else bbox["max_z"]
            await session.commit()
        else:
            # Insert new PointCloud metadata record
            metadata_record = PointCloud(
                id=target_uuid,
                job_id=uuid.UUID(job_id) if job_id else None,
                orig_filename=orig_filename,
                safe_filename=safe_filename,
                number_of_points=number_of_points,
                min_x=bbox.get("min_x"),
                min_y=bbox.get("min_y"),
                min_z=bbox.get("min_z"),
                max_x=bbox.get("max_x"),
                max_y=bbox.get("max_y"),
                max_z=bbox.get("max_z"),
                pcid=pcid
            )
            session.add(metadata_record)
            await session.commit()

    print(f"Successfully ingested pointcloud {file_id} metadata and data to database.")


async def _ingest_pointcloud_pipeline_async(
    file_path: str,
    file_id: str,
    job_id: str = None,
    storage_type: str = None,
    mark_completed: bool = True,
    is_append: bool = False
):
    """
    Core pipeline to process point cloud file:
    1. Converts point cloud to EPT format using Entwine with progress tracking.
    2. If database storage is enabled, extracts PDAL stats & ingests points into pgPointcloud table.
    3. Writes or updates metadata record in pointclouds table.
    """
    if job_id:
        await _update_job_status(job_id, "RUNNING", 0.0)

    output_dir = os.path.join(settings.ept_dir, file_id)

    ext = os.path.splitext(file_path)[1].lower()
    valid_pc_exts = ['.las', '.laz', '.ply']
    if ext not in valid_pc_exts:
        error_msg = f"Cannot convert file '{os.path.basename(file_path)}' to EPT: Invalid format '{ext}'. Expected: {', '.join(valid_pc_exts)}."
        if job_id:
            await _update_job_status(job_id, "FAILED", 0.0, error_msg)
        raise ValueError(error_msg)

    try:
        # 1. Entwine EPT Conversion with throttled DB progress updates
        async def on_progress(pct: float):
            if job_id:
                await _update_job_status(job_id, "RUNNING", pct)

        await build_ept(
            file_path=file_path,
            output_dir=output_dir,
            scale="0.001",
            progress_callback=on_progress,
            min_progress_delta=1.0,
            min_time_interval=0.5
        )

        print(f"Successfully converted {file_path} to EPT at {output_dir}")

        current_storage_type = storage_type or settings.pointcloud_storage_type.value

        # 2. Database Ingestion via PDAL & Metadata insertion/update if storage_type == 'database'
        if current_storage_type == StorageType.database.value:
            await _ingest_pointcloud_to_db_async(
                file_path=file_path,
                file_id=file_id,
                job_id=job_id,
                is_append=is_append
            )

        if job_id and mark_completed:
            await _update_job_status(job_id, "COMPLETED", 100.0)

        return {"status": "success", "file_id": file_id, "ept_dir": output_dir}

    except Exception as e:
        error_msg = str(e)
        print(f"Exception processing point cloud {file_path}: {error_msg}")
        if job_id:
            await _update_job_status(job_id, "FAILED", 0.0, error_msg)
        raise e


# Keep _convert_to_ept_async alias for backwards compatibility
_convert_to_ept_async = _ingest_pointcloud_pipeline_async


def convert_to_ept(file_path: str, file_id: str, storage_type: str = None):
    """
    Legacy RQ task entrypoint to convert a .las/.laz/.ply file to EPT format.
    """
    current_job = get_current_job()
    job_id = current_job.id if current_job else None
    return asyncio.run(_ingest_pointcloud_pipeline_async(file_path, file_id, job_id, storage_type))


def process_opensfm(file_path: str, file_id: str, storage_type: str = None, folder_path: str = None):
    """
    Legacy RQ task entrypoint to process OpenSfM output files.
    """
    current_job = get_current_job()
    job_id = current_job.id if current_job else None
    return asyncio.run(_process_opensfm_async(file_path, file_id, job_id, storage_type, folder_path))


async def _process_opensfm_async(
    file_path: str,
    file_id: str,
    job_id: str,
    storage_type: str = None,
    folder_path: str = None,
    is_append: bool = False
):
    """
    Async implementation for OpenSfM pointcloud and camera trajectory processing.
    """
    # 1. Ingest fused.ply point cloud
    await _ingest_pointcloud_pipeline_async(
        file_path, file_id, job_id, storage_type, mark_completed=False, is_append=is_append
    )

    # 2. Process camera trajectory from reconstruction.json
    if not folder_path:
        print("No folder_path provided, skipping camera trajectory processing.")
        if job_id:
            await _update_job_status(job_id, "COMPLETED", 100.0)
        return {"status": "success", "file_id": file_id}

    reconstruction_json_path = os.path.join(folder_path, "reconstruction.json")
    reconstructions = parse_reconstruction_json(reconstruction_json_path)

    if not reconstructions:
        print(f"No valid reconstruction data in {reconstruction_json_path}, skipping camera route processing.")
        if job_id:
            await _update_job_status(job_id, "COMPLETED", 100.0)
        return {"status": "success", "file_id": file_id}

    for idx, data in enumerate(reconstructions):
        camera_file_id = str(uuid.uuid4())
        csv_file_path = os.path.join(folder_path, f"pointcloud_{idx}.csv")
        
        valid_shots = extract_camera_route_csv(data, csv_file_path)
        if valid_shots == 0:
            continue

        # Build EPT for camera route CSV
        camera_output_dir = os.path.join(settings.ept_dir, camera_file_id)
        try:
            await build_ept(csv_file_path, camera_output_dir, scale="0.001")
        except Exception as e:
            print(f"Error building EPT for camera CSV: {e}")
            continue

        async with async_session() as session:
            camera_route = PointCloudCameraRoute(
                id=uuid.UUID(camera_file_id),
                pointcloud_id=uuid.UUID(file_id),
                orig_filename=f"reconstruction_{idx}",
                safe_filename=f"pointcloud_{idx}.csv",
                number_of_points=valid_shots,
                pcid=1
            )
            session.add(camera_route)
            await session.commit()

    if job_id:
        await _update_job_status(job_id, "COMPLETED", 100.0)
    return {"status": "success", "file_id": file_id}


async def _process_emodnet_job_async(job_id_str: str, payload: dict):
    """Processes EMODnet GeoTIFF ingestion task using PDAL Docker pipeline."""
    geotiff_path = payload.get("geotiff_path")
    is_append = payload.get("is_append", False) or (payload.get("task_type") == "emodnet_append")
    file_id = (payload.get("existing_id") or payload.get("file_id")) if is_append else (payload.get("file_id") or job_id_str)
    storage_type = payload.get("storage_type", settings.pointcloud_storage_type.value)

    if not geotiff_path or not os.path.exists(geotiff_path):
        error_msg = f"GeoTIFF file not found for job {job_id_str}: {geotiff_path}"
        await _update_job_status(job_id_str, "FAILED", 0.0, error_msg)
        return {"status": "error", "message": error_msg}

    return await _process_emodnet_async(
        geotiff_path=geotiff_path,
        file_id=file_id,
        job_id=job_id_str,
        storage_type=storage_type,
        is_append=is_append
    )


async def _process_emodnet_async(
    geotiff_path: str,
    file_id: str,
    job_id: str,
    storage_type: str = None,
    is_append: bool = False
):
    """
    Core pipeline to process EMODnet GeoTIFF bathymetry rasters:
    1. Converts GeoTIFF to EPSG:3857 EPT format using PDAL Docker pipeline.
    2. Extracts bounding box & point count via PDAL stats.
    3. If database storage is enabled, ingests points into pgPointcloud table.
    4. Writes or updates metadata record in pointclouds table.
    """
    if job_id:
        await _update_job_status(job_id, "RUNNING", 10.0)

    output_dir = os.path.join(settings.ept_dir, file_id)

    try:
        # 1. Build EPT from GeoTIFF in EPSG:3857 using PDAL Docker container
        await build_ept_pdal_docker(
            geotiff_path=geotiff_path,
            output_dir=output_dir,
            out_srs="EPSG:3857"
        )
        print(f"Successfully converted EMODnet GeoTIFF {geotiff_path} to EPT at {output_dir}")

        if job_id:
            await _update_job_status(job_id, "RUNNING", 60.0)

        current_storage_type = storage_type or settings.pointcloud_storage_type.value

        # 2. Extract stats (bbox & number of points)
        bbox, number_of_points, _ = await get_pointcloud_srs_and_stats(geotiff_path)

        pcid = None
        if current_storage_type == StorageType.database.value:
            print(f"Ingesting EMODnet pointcloud {file_id} (is_append={is_append}) to database...")
            connection_str = format_libpq_connection_string(settings.database_url)

            if is_append:
                async with async_session() as session:
                    try:
                        res = await session.execute(
                            text("SELECT PC_PCId(patch) FROM pointcloud_patches WHERE pointcloud_id = :id AND lod = 0 LIMIT 1"),
                            {"id": uuid.UUID(file_id)}
                        )
                        row = res.first()
                        if row and row[0] is not None:
                            pcid = int(row[0])
                    except Exception as e:
                        print(f"Failed to query pcid from pointcloud_patches: {e}")

                    if pcid is None:
                        try:
                            stmt_existing = select(PointCloud).where(PointCloud.id == uuid.UUID(file_id))
                            res_existing = await session.execute(stmt_existing)
                            rec = res_existing.scalar_one_or_none()
                            if rec and rec.pcid:
                                pcid = rec.pcid
                        except Exception as e:
                            print(f"Failed to query existing metadata for pcid: {e}")

            target_dims = None
            if pcid:
                try:
                    async with async_session() as session:
                        res = await session.execute(
                            text("SELECT schema FROM pointcloud_formats WHERE pcid = :pcid"),
                            {"pcid": pcid}
                        )
                        row = res.first()
                        if row and row[0]:
                            import re
                            target_dims = re.findall(r"<pc:name>(.*?)</pc:name>", row[0])
                except Exception as e:
                    print(f"Failed to query pcid schema: {e}")

            source_dims = await get_pointcloud_dimensions(geotiff_path)
            print(f"Source file dimensions: {source_dims}")
            print(f"Target schema dimensions: {target_dims if target_dims else ['X', 'Y', 'Z']}")

            ingested_pcid = await ingest_pgpointcloud(
                file_path=geotiff_path,
                connection_str=connection_str,
                pointcloud_id=file_id,
                lod=0,
                capacity=400,
                srid=3857,
                overwrite=not is_append,
                pcid=pcid,
                target_dimensions=target_dims
            )

            if pcid is None:
                pcid = ingested_pcid or 1

        # 3. Create or update PointCloud metadata record in DB
        async with async_session() as session:
            orig_filename = os.path.basename(geotiff_path)
            safe_filename = os.path.basename(geotiff_path)
            if job_id:
                stmt_job = select(Job).where(Job.id == job_id)
                res_job = await session.execute(stmt_job)
                job_record = res_job.scalar_one_or_none()
                if job_record and isinstance(job_record.payload, dict):
                    orig_filename = job_record.payload.get("filename", orig_filename)

            target_uuid = uuid.UUID(file_id)
            stmt_existing = select(PointCloud).where(PointCloud.id == target_uuid)
            res_existing = await session.execute(stmt_existing)
            existing_record = res_existing.scalar_one_or_none()

            if is_append and existing_record:
                existing_record.number_of_points = (existing_record.number_of_points or 0) + number_of_points
                if bbox.get("min_x") is not None:
                    existing_record.min_x = min(existing_record.min_x, bbox["min_x"]) if existing_record.min_x is not None else bbox["min_x"]
                if bbox.get("max_x") is not None:
                    existing_record.max_x = max(existing_record.max_x, bbox["max_x"]) if existing_record.max_x is not None else bbox["max_x"]
                if bbox.get("min_y") is not None:
                    existing_record.min_y = min(existing_record.min_y, bbox["min_y"]) if existing_record.min_y is not None else bbox["min_y"]
                if bbox.get("max_y") is not None:
                    existing_record.max_y = max(existing_record.max_y, bbox["max_y"]) if existing_record.max_y is not None else bbox["max_y"]
                if bbox.get("min_z") is not None:
                    existing_record.min_z = min(existing_record.min_z, bbox["min_z"]) if existing_record.min_z is not None else bbox["min_z"]
                if bbox.get("max_z") is not None:
                    existing_record.max_z = max(existing_record.max_z, bbox["max_z"]) if existing_record.max_z is not None else bbox["max_z"]
                await session.commit()
            else:
                metadata_record = PointCloud(
                    id=target_uuid,
                    job_id=uuid.UUID(job_id) if job_id else None,
                    orig_filename=orig_filename,
                    safe_filename=safe_filename,
                    number_of_points=number_of_points,
                    min_x=bbox.get("min_x"),
                    min_y=bbox.get("min_y"),
                    min_z=bbox.get("min_z"),
                    max_x=bbox.get("max_x"),
                    max_y=bbox.get("max_y"),
                    max_z=bbox.get("max_z"),
                    pcid=pcid
                )
                session.add(metadata_record)
                await session.commit()

        if job_id:
            await _update_job_status(job_id, "COMPLETED", 100.0)

        return {"status": "success", "file_id": file_id, "ept_dir": output_dir}

    except Exception as e:
        error_msg = str(e)
        print(f"Exception processing EMODnet GeoTIFF {geotiff_path}: {error_msg}")
        if job_id:
            await _update_job_status(job_id, "FAILED", 0.0, error_msg)
        raise e


async def _process_emodnet_csv_job_async(job_id_str: str, payload: dict):
    """Processes EMODnet CSV upload task: cleans header, reprojects via PDAL, ingests to DB, and builds EPT."""
    file_path = payload.get("file_path")
    file_id = payload.get("file_id") or job_id_str
    storage_type = payload.get("storage_type", settings.pointcloud_storage_type.value)
    output_dir = os.path.join(settings.ept_dir, file_id)

    if not file_path or not os.path.exists(file_path):
        error_msg = f"EMODnet CSV file not found for job {job_id_str}: {file_path}"
        await _update_job_status(job_id_str, "FAILED", 0.0, error_msg)
        return {"status": "error", "message": error_msg}

    try:
        await _update_job_status(job_id_str, "RUNNING", 10.0)

        # Process EMODnet CSV using PDAL pipeline (reproject to EPSG:3857), ingest into pgPointcloud DB, & build EPT
        bbox, number_of_points, pcid = await process_emodnet_csv(
            csv_path=file_path,
            output_dir=output_dir,
            out_srs="EPSG:3857",
            storage_type=storage_type,
            file_id=file_id
        )
        print(f"Successfully processed EMODnet CSV {file_path} to EPT at {output_dir} (points: {number_of_points})")

        await _update_job_status(job_id_str, "RUNNING", 80.0)

        # Store or update pointcloud metadata record in PostgreSQL pointclouds table
        async with async_session() as session:
            job_uuid = uuid.UUID(job_id_str)
            target_uuid = uuid.UUID(file_id)
            orig_filename = payload.get("filename") or os.path.basename(file_path)
            safe_filename = payload.get("safe_filename") or os.path.basename(file_path)

            stmt_existing = select(PointCloud).where(PointCloud.id == target_uuid)
            res_existing = await session.execute(stmt_existing)
            existing_record = res_existing.scalar_one_or_none()

            if existing_record:
                existing_record.job_id = job_uuid
                existing_record.orig_filename = orig_filename
                existing_record.safe_filename = safe_filename
                existing_record.number_of_points = number_of_points
                existing_record.min_x = bbox.get("min_x")
                existing_record.min_y = bbox.get("min_y")
                existing_record.min_z = bbox.get("min_z")
                existing_record.max_x = bbox.get("max_x")
                existing_record.max_y = bbox.get("max_y")
                existing_record.max_z = bbox.get("max_z")
                existing_record.pcid = pcid or 0
            else:
                metadata_record = PointCloud(
                    id=target_uuid,
                    job_id=job_uuid,
                    orig_filename=orig_filename,
                    safe_filename=safe_filename,
                    number_of_points=number_of_points,
                    min_x=bbox.get("min_x"),
                    min_y=bbox.get("min_y"),
                    min_z=bbox.get("min_z"),
                    max_x=bbox.get("max_x"),
                    max_y=bbox.get("max_y"),
                    max_z=bbox.get("max_z"),
                    pcid=pcid or 0
                )
                session.add(metadata_record)
            await session.commit()

        res_data = {
            "status": "success",
            "file_id": file_id,
            "number_of_points": number_of_points,
            "ept_dir": output_dir,
            "ept_url": f"/ept/{file_id}/ept.json"
        }
        await _update_job_status(job_id_str, "COMPLETED", 100.0, result=res_data)
        return res_data

    except Exception as e:
        error_msg = str(e)
        print(f"Exception processing EMODnet CSV {file_path}: {error_msg}")
        await _update_job_status(job_id_str, "FAILED", 0.0, error_msg)
        raise e



