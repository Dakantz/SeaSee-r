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

def _find_opensfm_pointcloud(folder_path: Optional[str], file_path: Optional[str] = None) -> Optional[str]:
    if file_path and os.path.exists(file_path):
        return file_path
    if not folder_path:
        return None
    candidates = [
        os.path.join(folder_path, "odm_georeferencing", "odm_georeferenced_model.laz"),
        os.path.join(folder_path, "odm_filterpoints", "point_cloud.ply"),
        os.path.join(folder_path, "undistorted", "depthmaps", "fused.laz"),
        os.path.join(folder_path, "odm_meshing", "odm_mesh.ply"),
        os.path.join(folder_path, "point_cloud.ply"),
        os.path.join(folder_path, "fused.laz"),
    ]
    for c in candidates:
        if os.path.exists(c):
            return c
    return None

class OpenSfMTaskHandler(BaseTaskHandler):
    task_types = ["opensfm_ingest", "opensfm_append"]

    async def process_opensfm(
        self,
        file_path: str,
        file_id: str,
        job_id: Optional[str] = None,
        folder_path: Optional[str] = None,
        is_append: bool = False,
        offset_x: float = 0.0,
        offset_y: float = 0.0
    ) -> Dict[str, Any]:
        """Async implementation for OpenSfM pointcloud and camera trajectory processing."""
        # 1. Ingest fused.laz / point_cloud.ply using PointCloudUploadTaskHandler
        pc_handler = PointCloudUploadTaskHandler()
        await pc_handler.ingest_pointcloud_pipeline(
            file_path=file_path,
            file_id=file_id,
            job_id=job_id,
            mark_completed=False,
            is_append=is_append,
            offset_x=offset_x,
            offset_y=offset_y
        )

        # 2. Process camera trajectory and save CameraHeader and CameraFrames
        if not folder_path:
            logger.info("No folder_path provided, skipping camera frame processing.")
            if job_id:
                await self.update_job_status(job_id, "COMPLETED", 100.0)
            return {"status": "success", "file_id": file_id}

        shots_geojson_path = None
        for cand in [
            os.path.join(folder_path, "shots.geojson"),
            os.path.join(folder_path, "odm_report", "shots.geojson")
        ]:
            if os.path.exists(cand):
                shots_geojson_path = cand
                break

        reconstruction_json_path = None
        for cand in [
            os.path.join(folder_path, "reconstruction.json"),
            os.path.join(folder_path, "opensfm", "reconstruction.json"),
            os.path.join(folder_path, "opensfm", "reports", "reconstruction.json")
        ]:
            if os.path.exists(cand):
                reconstruction_json_path = cand
                break

        from app.models.camera import CameraHeader, CameraFrame
        from app.services.opensfm.ingest import (
            parse_reconstruction_json,
            extract_camera_route_csv,
            parse_shots_geojson,
            get_camera_center,
            get_camera_viewing_direction,
            get_camera_three_quaternion
        )
        from geoalchemy2 import WKTElement

        header_info = {}
        frames_list = []

        import re
        if reconstruction_json_path and os.path.exists(reconstruction_json_path):
            reconstructions = parse_reconstruction_json(reconstruction_json_path)
            if reconstructions:
                # Use the primary continuous connected reconstruction component (Cluster 0)
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
                    direction = get_camera_viewing_direction(rotation)
                    rot_quat = get_camera_three_quaternion(rotation)
                    capture_time = sdata.get("capture_time", 0.0)
                    ts_val = int(capture_time * 1000) if capture_time > 1e8 else int(capture_time)
                    
                    frames_list.append({
                        "filename": shot_id,
                        "timestamp": ts_val,
                        "position": [center[0], center[1], center[2]],
                        "direction": direction,
                        "rotation": rot_quat,
                        "relative_time": sdata.get("relative_time", 0.0)
                    })
        elif shots_geojson_path and os.path.exists(shots_geojson_path):
            header_info, frames_list = parse_shots_geojson(shots_geojson_path)

        def _get_frame_sort_key(f: Dict[str, Any]):
            fname = f.get("filename") or ""
            m = re.search(r"_(\d+)_(\d+)\.jpg$", fname)
            if m:
                return (int(m.group(1)), int(m.group(2)))
            return (f.get("timestamp", 0), 0)

        frames_list.sort(key=_get_frame_sort_key)

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
                    pos_wkt = WKTElement(f"POINT Z ({pos[0] + offset_x} {pos[1] + offset_y} {pos[2]})", srid=settings.backend_srid)
                    dir_wkt = WKTElement(f"POINT Z ({rot[0]} {rot[1]} {rot[2]})", srid=settings.backend_srid)

                    frame = CameraFrame(
                        id=uuid.uuid4(),
                        camera_header_id=header.id,
                        timestamp=int(f.get("timestamp", 0)),
                        position=pos_wkt,
                        direction=dir_wkt,
                        rotation=f.get("rotation"),
                        relative_time=float(f.get("relative_time", 0.0)),
                        filename=f.get("filename")
                    )
                    session.add(frame)

                await session.commit()

        if job_id:
            await self.update_job_status(job_id, "COMPLETED", 100.0)
        return {"status": "success", "file_id": file_id}

    async def execute(self, job_id: str, payload: Dict[str, Any], name: str = "", task_type: str = "") -> Dict[str, Any]:
        folder_path = payload.get("folder_path")
        is_append = payload.get("is_append", False) or (task_type == "opensfm_append")
        file_id = (payload.get("existing_id") or payload.get("file_id")) if is_append else (payload.get("file_id") or job_id)
        
        pointcloud_path = _find_opensfm_pointcloud(folder_path, payload.get("file_path"))
        if not pointcloud_path:
            error_msg = f"No point cloud file (.laz, .ply) found in folder '{folder_path}' for job {job_id}"
            logger.error(error_msg)
            if job_id:
                await self.update_job_status(job_id, "FAILED", 0.0, error=error_msg)
            raise FileNotFoundError(error_msg)

        offset_x = float(payload.get("offset_x", 0.0))
        offset_y = float(payload.get("offset_y", 0.0))

        return await self.process_opensfm(
            file_path=pointcloud_path,
            file_id=file_id,
            job_id=job_id,
            folder_path=folder_path,
            is_append=is_append,
            offset_x=offset_x,
            offset_y=offset_y
        )
