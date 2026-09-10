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
        subfolder: str = "undistorted",
        reconstruction_index: int = 0,
        is_append: bool = False,
        offset_x: float = 0.0,
        offset_y: float = 0.0
    ) -> Dict[str, Any]:
        """Async implementation for OpenSfM pointcloud and camera trajectory processing."""
        try:
            # 1. Ingest fused.laz point cloud using PointCloudUploadTaskHandler
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

            shots_geojson_path = os.path.join(folder_path, subfolder, "shots.geojson")
            if not os.path.exists(shots_geojson_path):
                shots_geojson_path = os.path.join(folder_path, "shots.geojson")

            reconstruction_json_path = os.path.join(folder_path, "reconstruction.json")

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

            if os.path.exists(shots_geojson_path):
                header_info, frames_list = parse_shots_geojson(shots_geojson_path)
            elif os.path.exists(reconstruction_json_path):
                reconstructions = parse_reconstruction_json(reconstruction_json_path)
                if reconstructions:
                    if 0 <= reconstruction_index < len(reconstructions):
                        data = reconstructions[reconstruction_index]
                    else:
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
        except Exception as e:
            error_msg = str(e)
            logger.error(f"Exception processing OpenSfM ingestion for {file_path}: {error_msg}")
            if job_id:
                await self.update_job_status(job_id, "FAILED", 0.0, error_msg)
            raise e

    async def execute(self, job_id: str, payload: Dict[str, Any], name: str = "", task_type: str = "") -> Dict[str, Any]:
        folder_path = payload.get("folder_path")
        subfolder = payload.get("subfolder", "undistorted")
        reconstruction_index = int(payload.get("reconstruction_index", 0))
        is_append = payload.get("is_append", False) or (task_type == "opensfm_append")
        file_id = (payload.get("existing_id") or payload.get("file_id")) if is_append else (payload.get("file_id") or job_id)
        
        file_path = payload.get("file_path")

        # If file_path and folder_path are missing, look up parent job results in DB
        if not file_path and not folder_path and job_id:
            try:
                from sqlalchemy import select
                from app.models.job import Job
                async with async_session() as session:
                    j_res = await session.execute(select(Job).where(Job.id == uuid.UUID(job_id)))
                    job_rec = j_res.scalar_one_or_none()
                    if job_rec and job_rec.depends_on:
                        parent_uuids = [uuid.UUID(d) for d in job_rec.depends_on if isinstance(d, str)]
                        if parent_uuids:
                            p_res = await session.execute(select(Job).where(Job.id.in_(parent_uuids)))
                            parents = p_res.scalars().all()
                            for p in parents:
                                if p.result and isinstance(p.result, dict):
                                    folder_path = p.result.get("dataset_dir") or p.result.get("folder_path")
                                    if folder_path:
                                        logger.info(f"Retrieved folder_path '{folder_path}' from parent job {p.id}")
                                        break
            except Exception as lookup_err:
                logger.warning(f"Could not look up parent job result for job {job_id}: {lookup_err}")

        # Fallback to default dataset directory if folder_path is still missing
        if not file_path and not folder_path:
            num_frames = payload.get("num_frames", 500)
            dataset_name = payload.get("dataset_name") or f"video_dataset_fixed_{num_frames}_frames_entire_video"
            folder_path = os.path.join(settings.opensfm_ingestion_dir, dataset_name)

        if not file_path and folder_path:
            cand1 = os.path.join(folder_path, subfolder, "depthmaps", "fused.laz")
            cand2 = os.path.join(folder_path, subfolder, "depthmaps", "merged.ply")
            cand3 = os.path.join(folder_path, subfolder, "fused.laz")
            cand4 = os.path.join(folder_path, "depthmaps", "fused.laz")
            cand5 = os.path.join(folder_path, "depthmaps", "merged.ply")
            cand6 = os.path.join(folder_path, "undistorted", "depthmaps", "fused.laz")
            if os.path.isfile(cand1):
                file_path = cand1
            elif os.path.isfile(cand2):
                file_path = cand2
            elif os.path.isfile(cand3):
                file_path = cand3
            elif os.path.isfile(cand4):
                file_path = cand4
            elif os.path.isfile(cand5):
                file_path = cand5
            elif os.path.isfile(cand6):
                file_path = cand6
            else:
                file_path = cand1

        if not file_path or not os.path.exists(file_path):
            err_msg = f"Point cloud file not found at '{file_path}'. Ensure OpenSfM reconstruction finished and generated fused.laz or merged.ply."
            logger.error(err_msg)
            await self.update_job_status(job_id, "FAILED", 0.0, error_message=err_msg)
            raise RuntimeError(err_msg)

        offset_x = float(payload.get("offset_x", 0.0))
        offset_y = float(payload.get("offset_y", 0.0))

        return await self.process_opensfm(
            file_path=file_path,
            file_id=file_id,
            job_id=job_id,
            folder_path=folder_path,
            subfolder=subfolder,
            reconstruction_index=reconstruction_index,
            is_append=is_append,
            offset_x=offset_x,
            offset_y=offset_y
        )


