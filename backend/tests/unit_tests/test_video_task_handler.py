import os
import json
import uuid
import pytest
from datetime import datetime, timezone
from sqlalchemy import select

from app.core.database import async_session
from app.models.video import Video, UploadMetadata, VideoStatus
from app.models.log_data import LogData
from app.models.job import Job, JobStatus
from app.services.worker.handlers.video import VideoTaskHandler
from app.core.config import settings


@pytest.mark.anyio
async def test_video_task_handler_processes_associated_log_file(tmp_path):
    batch_id = uuid.uuid4()
    video_upload_id = uuid.uuid4()
    log_upload_id = uuid.uuid4()
    job_id = str(uuid.uuid4())

    # Create dummy job in DB
    async with async_session() as session:
        job = Job(
            id=job_id,
            name="test_video_job",
            task_type="video_reconstruction",
            status=JobStatus.PENDING,
            progress=0.0,
            created_at=datetime.now(timezone.utc),
            payload={"file_id": str(video_upload_id), "batch_id": str(batch_id)}
        )
        session.add(job)

        # UploadMetadata for Video
        video_meta = UploadMetadata(
            id=video_upload_id,
            batch_id=batch_id,
            orig_filename="ROV-Video-2026-05-05.mp4",
            safe_filename=f"{video_upload_id}.mp4",
            content_type="video/mp4",
            status=VideoStatus.COMPLETED
        )
        session.add(video_meta)

        # UploadMetadata for JSON log
        log_meta = UploadMetadata(
            id=log_upload_id,
            batch_id=batch_id,
            orig_filename="ROV-Log-2026-05-02-2026-05-05-0505205315.json",
            safe_filename=f"{log_upload_id}.json",
            content_type="application/json",
            status=VideoStatus.COMPLETED
        )
        session.add(log_meta)

        # Video metadata record
        video_rec = Video(
            id=uuid.uuid4(),
            upload_metadata_id=video_upload_id,
            content_type="video/mp4",
            total_bytes=1024,
            video_start_at=datetime.now(timezone.utc),
            video_stop_at=datetime.now(timezone.utc)
        )
        session.add(video_rec)

        await session.commit()
        video_rec_id = video_rec.id

    # Create test JSON log file in settings.metadata_dir (or temp path)
    os.makedirs(settings.metadata_dir, exist_ok=True)
    log_file_path = os.path.join(settings.metadata_dir, f"{log_upload_id}.json")

    sample_log_data = [
        {
            "type": "depth",
            "time": "2026-05-05 11:48:29",
            "timestamp": 1777974509954,
            "payload": {
                "depth": 0,
                "temperature": 23.37
            }
        },
        {
            "type": "attitude",
            "time": "2026-05-05 11:48:29",
            "timestamp": 1777974509954,
            "payload": {
                "yaw": 324.3104,
                "roll": 9.347046,
                "pitch": 0.62719727
            }
        },
        {
            "type": "sonar",
            "time": "2026-05-05 11:48:29",
            "timestamp": 1777974509954,
            "payload": {
                "distance": 0,
                "altitude": -1,
                "left": 0,
                "right": 0
            }
        },
        {
            "type": "depth",
            "time": "2026-05-05 11:48:30",
            "timestamp": 1777974510472,
            "payload": {
                "depth": 1.5,
                "temperature": 22.1
            }
        },
        {
            "type": "attitude",
            "time": "2026-05-05 11:48:30",
            "timestamp": 1777974510472,
            "payload": {
                "yaw": 320.0,
                "roll": 8.0,
                "pitch": 0.5
            }
        }
    ]

    with open(log_file_path, "w", encoding="utf-8") as f:
        json.dump(sample_log_data, f)

    handler = VideoTaskHandler()
    payload = {
        "file_id": str(video_upload_id),
        "batch_id": str(batch_id)
    }

    try:
        result = await handler.execute(job_id=job_id, payload=payload)
        assert result["status"] == "success"
        assert result["log_rows_inserted"] == 2

        # Verify LogData in DB
        async with async_session() as session:
            stmt = select(LogData).where(LogData.video_metadata_id == video_rec_id).order_by(LogData.timestamp)
            res = await session.execute(stmt)
            log_rows = res.scalars().all()

            assert len(log_rows) == 2

            # Row 1 (timestamp 1777974509954)
            row1 = log_rows[0]
            assert row1.timestamp == 1777974509954
            assert row1.payload["depth"] == 0
            assert row1.payload["temperature"] == 23.37
            assert row1.payload["yaw"] == 324.3104
            assert row1.payload["roll"] == 9.347046
            assert row1.payload["pitch"] == 0.62719727
            assert row1.payload["distance"] == 0
            assert row1.payload["altitude"] == -1

            # Row 2 (timestamp 1777974510472)
            row2 = log_rows[1]
            assert row2.timestamp == 1777974510472
            assert row2.payload["depth"] == 1.5
            assert row2.payload["temperature"] == 22.1
            assert row2.payload["yaw"] == 320.0
    finally:
        if os.path.exists(log_file_path):
            os.remove(log_file_path)
