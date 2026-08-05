import os
import uuid
import logging
from typing import Dict, Any, Optional
from app.core.config import settings
from app.core.database import async_session
from app.models.pointcloud import PointCloudCameraRoute
from app.services.worker.handlers.base import BaseTaskHandler
from app.services.worker.handlers.pointcloud import PointCloudUploadTaskHandler
from app.services.pointcloud.entwine import build_ept
from app.services.opensfm.ingest import (
    parse_reconstruction_json,
    extract_camera_route_csv
)

logger = logging.getLogger(__name__)

class OpenSfMTaskHandler(BaseTaskHandler):
    task_types = ["opensfm_ingest", "opensfm_append"]

    async def process_opensfm(
        self,
        file_path: str,
        file_id: str,
        job_id: Optional[str] = None,
        folder_path: Optional[str] = None,
        is_append: bool = False
    ) -> Dict[str, Any]:
        """Async implementation for OpenSfM pointcloud and camera trajectory processing."""
        # 1. Ingest fused.ply point cloud using PointCloudUploadTaskHandler
        pc_handler = PointCloudUploadTaskHandler()
        await pc_handler.ingest_pointcloud_pipeline(
            file_path=file_path,
            file_id=file_id,
            job_id=job_id,
            mark_completed=False,
            is_append=is_append
        )

        # 2. Process camera trajectory from reconstruction.json
        if not folder_path:
            logger.info("No folder_path provided, skipping camera trajectory processing.")
            if job_id:
                await self.update_job_status(job_id, "COMPLETED", 100.0)
            return {"status": "success", "file_id": file_id}

        reconstruction_json_path = os.path.join(folder_path, "reconstruction.json")
        reconstructions = parse_reconstruction_json(reconstruction_json_path)

        if not reconstructions:
            logger.info(f"No valid reconstruction data in {reconstruction_json_path}, skipping camera route processing.")
            if job_id:
                await self.update_job_status(job_id, "COMPLETED", 100.0)
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
                logger.error(f"Error building EPT for camera CSV: {e}")
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
            await self.update_job_status(job_id, "COMPLETED", 100.0)
        return {"status": "success", "file_id": file_id}

    async def execute(self, job_id: str, payload: Dict[str, Any], name: str = "") -> Dict[str, Any]:
        folder_path = payload.get("folder_path")
        is_append = payload.get("is_append", False) or (payload.get("task_type") == "opensfm_append")
        file_id = (payload.get("existing_id") or payload.get("file_id")) if is_append else (payload.get("file_id") or job_id)
        fused_ply_path = os.path.join(folder_path, "undistorted", "depthmaps", "fused.ply") if folder_path else payload.get("file_path")

        return await self.process_opensfm(
            file_path=fused_ply_path,
            file_id=file_id,
            job_id=job_id,
            folder_path=folder_path,
            is_append=is_append
        )
