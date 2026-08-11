import os
import uuid
import logging
from typing import Dict, Any, Optional
from app.core.config import settings
from app.core.database import async_session
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

        # 2. Process camera trajectory and save CameraHeader and CameraFrames
        if not folder_path:
            logger.info("No folder_path provided, skipping camera frame processing.")
            if job_id:
                await self.update_job_status(job_id, "COMPLETED", 100.0)
            return {"status": "success", "file_id": file_id}

        shots_geojson_path = os.path.join(folder_path, "shots.geojson")
        reconstruction_json_path = os.path.join(folder_path, "reconstruction.json")

        from app.models.camera import CameraHeader, CameraFrame
        from app.services.opensfm.ingest import (
            parse_reconstruction_json,
            extract_camera_route_csv,
            parse_shots_geojson,
            get_camera_center
        )
        from geoalchemy2 import WKTElement

        header_info = {}
        frames_list = []

        if os.path.exists(shots_geojson_path):
            header_info, frames_list = parse_shots_geojson(shots_geojson_path)
        elif os.path.exists(reconstruction_json_path):
            reconstructions = parse_reconstruction_json(reconstruction_json_path)
            if reconstructions:
                data = reconstructions[0]
                cameras = data.get("cameras", {})
                first_cam_key = next(iter(cameras), "v2 unknown unknown 3840 2160 brown 0.85") if cameras else "v2 unknown unknown 3840 2160 brown 0.85"
                cam_data = cameras.get(first_cam_key, {}) if cameras else {}
                
                header_info = {
                    "focal": cam_data.get("focal", 0.48455320009205993),
                    "width": cam_data.get("width", 3840),
                    "height": cam_data.get("height", 2160),
                    "camera": first_cam_key,
                }

                shots = data.get("shots", {})
                for shot_id, sdata in shots.items():
                    if "rotation" not in sdata or "translation" not in sdata:
                        continue
                    rotation = sdata["rotation"]
                    translation = sdata["translation"]
                    center = get_camera_center(rotation, translation)
                    capture_time = sdata.get("capture_time", 0.0)
                    ts_val = int(capture_time * 1000) if capture_time > 1e8 else int(capture_time)
                    
                    frames_list.append({
                        "filename": shot_id,
                        "timestamp": ts_val,
                        "position": [center[0], center[1], center[2]],
                        "direction": rotation,
                        "relative_time": sdata.get("relative_time", 0.0)
                    })

        if header_info and frames_list:
            async with async_session() as session:
                header = CameraHeader(
                    id=uuid.uuid4(),
                    pointcloud_id=uuid.UUID(file_id),
                    focal=header_info.get("focal"),
                    width=header_info.get("width"),
                    height=header_info.get("height"),
                    camera=header_info.get("camera"),
                )
                session.add(header)
                await session.flush()

                for f in frames_list:
                    pos = f.get("position", [0.0, 0.0, 0.0])
                    rot = f.get("direction", [0.0, 0.0, 0.0])
                    pos_wkt = WKTElement(f"POINT Z ({pos[0]} {pos[1]} {pos[2]})", srid=settings.backend_srid)
                    dir_wkt = WKTElement(f"POINT Z ({rot[0]} {rot[1]} {rot[2]})", srid=settings.backend_srid)

                    frame = CameraFrame(
                        id=uuid.uuid4(),
                        camera_header_id=header.id,
                        timestamp=int(f.get("timestamp", 0)),
                        position=pos_wkt,
                        direction=dir_wkt,
                        relative_time=float(f.get("relative_time", 0.0)),
                        filename=f.get("filename")
                    )
                    session.add(frame)

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
