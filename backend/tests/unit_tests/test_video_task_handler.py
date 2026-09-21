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


@pytest.mark.anyio
async def test_video_task_handler_fails_when_missing_log_file():
    batch_id = uuid.uuid4()
    video_upload_id = uuid.uuid4()
    job_id = str(uuid.uuid4())

    async with async_session() as session:
        job = Job(
            id=job_id,
            name="test_video_job_no_log",
            task_type="video_upload",
            status=JobStatus.PENDING,
            progress=0.0,
            created_at=datetime.now(timezone.utc),
            payload={"file_id": str(video_upload_id), "batch_id": str(batch_id)}
        )
        session.add(job)

        video_meta = UploadMetadata(
            id=video_upload_id,
            batch_id=batch_id,
            orig_filename="ROV-Video.mp4",
            safe_filename=f"{video_upload_id}.mp4",
            content_type="video/mp4",
            status=VideoStatus.COMPLETED
        )
        session.add(video_meta)

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

    handler = VideoTaskHandler()
    payload = {"file_id": str(video_upload_id), "batch_id": str(batch_id)}

    with pytest.raises(ValueError, match="Video pipeline validation failed"):
        await handler.execute(job_id=job_id, payload=payload)

    # Verify Job status updated to FAILED in DB
    async with async_session() as session:
        res = await session.execute(select(Job).where(Job.id == uuid.UUID(job_id)))
        failed_job = res.scalar_one_or_none()
        assert failed_job is not None
        assert failed_job.status == JobStatus.FAILED
        assert "log file (.json)" in failed_job.error_message


@pytest.mark.anyio
async def test_video_task_handler_fails_when_missing_video_record():
    batch_id = uuid.uuid4()
    log_upload_id = uuid.uuid4()
    job_id = str(uuid.uuid4())

    async with async_session() as session:
        job = Job(
            id=job_id,
            name="test_video_job_no_video",
            task_type="video_upload",
            status=JobStatus.PENDING,
            progress=0.0,
            created_at=datetime.now(timezone.utc),
            payload={"file_id": str(log_upload_id), "batch_id": str(batch_id)}
        )
        session.add(job)

        log_meta = UploadMetadata(
            id=log_upload_id,
            batch_id=batch_id,
            orig_filename="ROV-Log.json",
            safe_filename=f"{log_upload_id}.json",
            content_type="application/json",
            status=VideoStatus.COMPLETED
        )
        session.add(log_meta)
        await session.commit()

    os.makedirs(settings.metadata_dir, exist_ok=True)
    log_file_path = os.path.join(settings.metadata_dir, f"{log_upload_id}.json")
    with open(log_file_path, "w", encoding="utf-8") as f:
        json.dump([{"timestamp": 12345, "payload": {}}], f)

    handler = VideoTaskHandler()
    payload = {"file_id": str(log_upload_id), "batch_id": str(batch_id)}

    try:
        with pytest.raises(ValueError, match="Video pipeline validation failed"):
            await handler.execute(job_id=job_id, payload=payload)

        async with async_session() as session:
            res = await session.execute(select(Job).where(Job.id == uuid.UUID(job_id)))
            failed_job = res.scalar_one_or_none()
            assert failed_job is not None
            assert failed_job.status == JobStatus.FAILED
            assert "video file" in failed_job.error_message
    finally:
        if os.path.exists(log_file_path):
            os.remove(log_file_path)


@pytest.mark.anyio
async def test_video_task_handler_handles_multiple_videos_in_batch():
    batch_id = uuid.uuid4()
    video1_id = uuid.uuid4()
    video2_id = uuid.uuid4()
    log_upload_id = uuid.uuid4()
    job_id = str(uuid.uuid4())

    async with async_session() as session:
        job = Job(
            id=job_id,
            name="test_video_job_multi",
            task_type="video_upload",
            status=JobStatus.PENDING,
            progress=0.0,
            created_at=datetime.now(timezone.utc),
            payload={"file_id": str(video1_id), "batch_id": str(batch_id)}
        )
        session.add(job)

        v1_meta = UploadMetadata(
            id=video1_id,
            batch_id=batch_id,
            orig_filename="part1.mp4",
            safe_filename=f"{video1_id}.mp4",
            content_type="video/mp4",
            status=VideoStatus.COMPLETED
        )
        v2_meta = UploadMetadata(
            id=video2_id,
            batch_id=batch_id,
            orig_filename="part2.mp4",
            safe_filename=f"{video2_id}.mp4",
            content_type="video/mp4",
            status=VideoStatus.COMPLETED
        )
        log_meta = UploadMetadata(
            id=log_upload_id,
            batch_id=batch_id,
            orig_filename="log.json",
            safe_filename=f"{log_upload_id}.json",
            content_type="application/json",
            status=VideoStatus.COMPLETED
        )
        session.add_all([v1_meta, v2_meta, log_meta])

        v1_rec = Video(
            id=uuid.uuid4(),
            upload_metadata_id=video1_id,
            content_type="video/mp4",
            total_bytes=1024,
            video_start_at=datetime.now(timezone.utc),
            video_stop_at=datetime.now(timezone.utc)
        )
        v2_rec = Video(
            id=uuid.uuid4(),
            upload_metadata_id=video2_id,
            content_type="video/mp4",
            total_bytes=1024,
            video_start_at=datetime.now(timezone.utc),
            video_stop_at=datetime.now(timezone.utc)
        )
        session.add_all([v1_rec, v2_rec])
        await session.commit()
        v1_rec_id, v2_rec_id = v1_rec.id, v2_rec.id

    os.makedirs(settings.metadata_dir, exist_ok=True)
    log_file_path = os.path.join(settings.metadata_dir, f"{log_upload_id}.json")
    with open(log_file_path, "w", encoding="utf-8") as f:
        json.dump([{"timestamp": 9999, "payload": {"temp": 15.0}}], f)

    handler = VideoTaskHandler()
    payload = {"file_id": str(video1_id), "batch_id": str(batch_id)}

    try:
        result = await handler.execute(job_id=job_id, payload=payload)
        assert result["status"] == "success"
        assert result["log_rows_inserted"] == 2

        async with async_session() as session:
            res1 = await session.execute(select(LogData).where(LogData.video_metadata_id == v1_rec_id))
            res2 = await session.execute(select(LogData).where(LogData.video_metadata_id == v2_rec_id))
            assert len(res1.scalars().all()) == 1
            assert len(res2.scalars().all()) == 1
    finally:
        if os.path.exists(log_file_path):
            os.remove(log_file_path)


