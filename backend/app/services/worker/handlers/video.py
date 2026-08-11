import os
import json
import uuid
import logging
from typing import Dict, Any, Optional
from datetime import datetime, timezone
from dateutil import parser

from sqlalchemy import select, delete
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.database import async_session
from app.models.video import Video, UploadMetadata
from app.models.log_data import LogData
from app.services.worker.handlers.base import BaseTaskHandler

logger = logging.getLogger(__name__)

class VideoTaskHandler(BaseTaskHandler):
    task_types = ["video_upload", "video_reconstruction"]

    async def execute(self, job_id: str, payload: Dict[str, Any], name: str = "") -> Dict[str, Any]:
        file_id_str = payload.get("file_id") or payload.get("video_id")
        batch_id_str = payload.get("batch_id")
        file_path_override = payload.get("file_path") or payload.get("log_file_path")

        await self.update_job_status(job_id, "RUNNING", 10.0)

        file_uuid = None
        if file_id_str:
            try:
                file_uuid = uuid.UUID(str(file_id_str))
            except ValueError:
                pass

        batch_uuid = None
        if batch_id_str:
            try:
                batch_uuid = uuid.UUID(str(batch_id_str))
            except ValueError:
                pass

        async with async_session() as session:
            video_rec: Optional[Video] = None
            if file_uuid:
                # Try finding Video by Video.id or Video.upload_metadata_id
                stmt = select(Video).options(selectinload(Video.upload_metadata)).where(
                    (Video.id == file_uuid) | (Video.upload_metadata_id == file_uuid)
                )
                res = await session.execute(stmt)
                video_rec = res.scalar_one_or_none()

            if not video_rec and batch_uuid:
                # Try finding Video associated with UploadMetadata matching batch_id
                stmt = select(Video).options(selectinload(Video.upload_metadata)).join(UploadMetadata).where(
                    UploadMetadata.batch_id == batch_uuid
                )
                res = await session.execute(stmt)
                video_rec = res.scalar_one_or_none()

            if video_rec and not batch_uuid and video_rec.upload_metadata:
                batch_uuid = video_rec.upload_metadata.batch_id

            log_file_path: Optional[str] = None
            if file_path_override and os.path.exists(file_path_override):
                log_file_path = file_path_override

            if not log_file_path and batch_uuid:
                # Find log file in upload_metadata matching batch_id with content_type == 'application/json'
                stmt = select(UploadMetadata).where(
                    UploadMetadata.batch_id == batch_uuid,
                    UploadMetadata.content_type == "application/json"
                )
                if video_rec and video_rec.upload_metadata_id:
                    stmt = stmt.where(UploadMetadata.id != video_rec.upload_metadata_id)

                res = await session.execute(stmt)
                meta_records = res.scalars().all()

                for meta in meta_records:
                    fname = meta.orig_filename or meta.safe_filename or ""
                    ctype = meta.content_type or ""
                    if fname.endswith(".json") or ctype == "application/json":
                        if meta.safe_filename:
                            candidate = os.path.join(settings.metadata_dir, meta.safe_filename)
                            if os.path.exists(candidate):
                                log_file_path = candidate
                                break

            await self.update_job_status(job_id, "RUNNING", 50.0)

            inserted_count = 0
            if log_file_path and os.path.exists(log_file_path):
                logger.info(f"Processing ROV log file: {log_file_path} for job {job_id}")
                try:
                    with open(log_file_path, "r", encoding="utf-8") as f:
                        raw_data = json.load(f)

                    if isinstance(raw_data, list):
                        grouped: Dict[int, Dict[str, Any]] = {}
                        for item in raw_data:
                            if not isinstance(item, dict):
                                continue
                            ts = item.get("timestamp")
                            if ts is None:
                                continue

                            ts_val = int(ts)
                            time_str = item.get("time")
                            item_payload = item.get("payload") or {}

                            if ts_val not in grouped:
                                dt = None
                                if time_str:
                                    try:
                                        dt = parser.parse(time_str)
                                        if dt.tzinfo is None:
                                            dt = dt.replace(tzinfo=timezone.utc)
                                    except Exception:
                                        dt = datetime.fromtimestamp(ts_val / 1000.0, tz=timezone.utc)
                                else:
                                    dt = datetime.fromtimestamp(ts_val / 1000.0, tz=timezone.utc)

                                grouped[ts_val] = {
                                    "time_recorded": dt,
                                    "payload": {}
                                }

                            if isinstance(item_payload, dict):
                                grouped[ts_val]["payload"].update(item_payload)

                        if video_rec:
                            # Clear previous log data for idempotency
                            await session.execute(delete(LogData).where(LogData.video_metadata_id == video_rec.id))

                            log_rows = [
                                LogData(
                                    id=uuid.uuid4(),
                                    video_metadata_id=video_rec.id,
                                    timestamp=ts_val,
                                    time_recorded=info["time_recorded"],
                                    payload=info["payload"]
                                )
                                for ts_val, info in grouped.items()
                            ]
                            session.add_all(log_rows)
                            await session.commit()
                            inserted_count = len(log_rows)
                            logger.info(f"Inserted {inserted_count} log_data rows for video_metadata_id {video_rec.id}")
                except Exception as e:
                    logger.error(f"Error parsing log file {log_file_path}: {e}")
                    raise e
            else:
                logger.warning(f"No log JSON file found for batch_id {batch_uuid} (job {job_id})")

        video_metadata_id_str = str(video_rec.id) if video_rec else file_id_str
        res_data = {
            "status": "success",
            "job_id": job_id,
            "message": f"Video task processing completed for {video_metadata_id_str}",
            "video_id": video_metadata_id_str,
            "batch_id": str(batch_uuid) if batch_uuid else None,
            "log_file": log_file_path,
            "log_rows_inserted": inserted_count
        }

        await self.update_job_status(job_id, "COMPLETED", 100.0, result=res_data)
        return res_data

