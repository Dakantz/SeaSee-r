import os
import logging
from typing import Dict, Any, Optional
from app.core.config import settings
from app.core.database import async_session
from app.services.worker.handlers.base import BaseTaskHandler
from app.services.pointcloud.entwine import build_ept
from app.services.pointcloud.pdal import (
    get_pointcloud_stats,
    get_pointcloud_dimensions,
    format_libpq_connection_string,
    ingest_pgpointcloud
)
from app.services.pointcloud.db_utils import (
    query_existing_pcid,
    query_target_dimensions_for_pcid,
    upsert_pointcloud_metadata
)

logger = logging.getLogger(__name__)

class PointCloudUploadTaskHandler(BaseTaskHandler):
    task_types = ["pointcloud_upload"]

    async def ingest_pointcloud_to_db(
        self,
        file_path: str,
        file_id: str,
        job_id: Optional[str] = None,
        is_append: bool = False
    ) -> None:
        """Database Ingestion via PDAL & Metadata insertion/update."""
        logger.info(f"Ingesting pointcloud {file_id} (is_append={is_append}) to database...")
        bbox, number_of_points = await get_pointcloud_stats(file_path)
        connection_str = format_libpq_connection_string(settings.database_url)

        pcid = None
        target_dims = None

        async with async_session() as session:
            if is_append:
                pcid = await query_existing_pcid(session, file_id)
                if pcid:
                    target_dims = await query_target_dimensions_for_pcid(session, pcid)

        if not target_dims:
            target_dims = ["X", "Y", "Z", "Red", "Green", "Blue"]
            if not is_append:
                pcid = None

        source_dims = await get_pointcloud_dimensions(file_path)
        logger.info(f"Source file dimensions: {source_dims}")
        logger.info(f"Target schema dimensions: {target_dims}")

        # Execute PDAL pgPointcloud ingestion for LOD levels 0..3
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

        if pcid is None:
            async with async_session() as session:
                pcid = (await query_existing_pcid(session, file_id)) or 1

        async with async_session() as session:
            await upsert_pointcloud_metadata(
                session=session,
                file_id=file_id,
                file_path=file_path,
                bbox=bbox,
                number_of_points=number_of_points,
                pcid=pcid,
                job_id=job_id,
                is_append=is_append
            )

        logger.info(f"Successfully ingested pointcloud {file_id} metadata and data to database.")

    async def ingest_pointcloud_pipeline(
        self,
        file_path: str,
        file_id: str,
        job_id: Optional[str] = None,
        mark_completed: bool = True,
        is_append: bool = False
    ) -> Dict[str, Any]:
        """Core pipeline to convert to EPT and ingest to database."""
        if job_id:
            await self.update_job_status(job_id, "RUNNING", 0.0)

        output_dir = os.path.join(settings.ept_dir, file_id)

        ext = os.path.splitext(file_path)[1].lower()
        valid_pc_exts = ['.las', '.laz', '.ply']
        if ext not in valid_pc_exts:
            error_msg = f"Cannot convert file '{os.path.basename(file_path)}' to EPT: Invalid format '{ext}'. Expected: {', '.join(valid_pc_exts)}."
            if job_id:
                await self.update_job_status(job_id, "FAILED", 0.0, error_msg)
            raise ValueError(error_msg)

        try:
            async def on_progress(pct: float):
                if job_id:
                    await self.update_job_status(job_id, "RUNNING", pct)

            await build_ept(
                file_path=file_path,
                output_dir=output_dir,
                scale="0.001",
                progress_callback=on_progress,
                min_progress_delta=1.0,
                min_time_interval=0.5
            )

            logger.info(f"Successfully converted {file_path} to EPT at {output_dir}")

            await self.ingest_pointcloud_to_db(
                file_path=file_path,
                file_id=file_id,
                job_id=job_id,
                is_append=is_append
            )

            if job_id and mark_completed:
                await self.update_job_status(job_id, "COMPLETED", 100.0)

            return {"status": "success", "file_id": file_id, "ept_dir": output_dir}

        except Exception as e:
            error_msg = str(e)
            logger.error(f"Exception processing point cloud {file_path}: {error_msg}")
            if job_id:
                await self.update_job_status(job_id, "FAILED", 0.0, error_msg)
            raise e

    async def execute(self, job_id: str, payload: Dict[str, Any], name: str = "") -> Dict[str, Any]:
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
            error_msg = f"Point cloud file not found on disk for job {job_id} (safe_filename: {safe_filename})"
            await self.update_job_status(job_id, "FAILED", 0.0, error_msg)
            return {"status": "error", "message": error_msg}

        return await self.ingest_pointcloud_pipeline(file_path, file_id or job_id, job_id)
