import uuid
import os
import pytest
from datetime import datetime, timezone
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.database import async_session
from app.models.video import Video, UploadMetadata, VideoStatus
from app.services.tusd.base_upload_service import WebhookPayload
from app.services.tusd.video_upload_service import VideoUploadService
from app.core.config import settings


@pytest.mark.anyio
async def test_video_upload_service_timestamps(tmp_path):
    file_id = str(uuid.uuid4())
    batch_id = str(uuid.uuid4())

    start_iso = "2026-09-29T08:00:00.000Z"
    stop_iso = "2026-09-29T08:15:00.000Z"

    payload = WebhookPayload(
        event_name="post-create",
        file_id=file_id,
        upload_type="video",
        filename="test_clip.mp4",
        safe_filename=f"{file_id}.mp4",
        total_bytes=10485760,
        original_file_path=str(tmp_path / file_id),
        metadata={
            "upload_type": "video",
            "batch_id": batch_id,
            "filename": "test_clip.mp4",
            "video_start_at": start_iso,
            "video_stop_at": stop_iso,
        },
        upload_data={"ID": file_id, "Size": 10485760}
    )

    async with async_session() as session:
        # 1. Test handle_create
        res = await VideoUploadService.handle_create(payload, session)
        assert res["status"] == "ok"
        assert res["action"] == "created_video"

        # Verify database record
        stmt = select(UploadMetadata).options(selectinload(UploadMetadata.videos)).where(UploadMetadata.id == uuid.UUID(file_id))
        db_res = await session.execute(stmt)
        upload_meta = db_res.scalar_one_or_none()
        assert upload_meta is not None
        assert upload_meta.status == VideoStatus.UPLOADING
        assert len(upload_meta.videos) == 1

        vid = upload_meta.videos[0]
        assert vid.video_start_at == datetime(2026, 9, 29, 8, 0, 0, tzinfo=timezone.utc)
        assert vid.video_stop_at == datetime(2026, 9, 29, 8, 15, 0, tzinfo=timezone.utc)

        # 2. Test handle_finish updates
        # Create a dummy source file
        dummy_file = tmp_path / file_id
        dummy_file.write_bytes(b"dummy video data")
        dummy_info = tmp_path / f"{file_id}.info"
        dummy_info.write_text("info")

        finish_payload = WebhookPayload(
            event_name="post-finish",
            file_id=file_id,
            upload_type="video",
            filename="test_clip.mp4",
            safe_filename=f"{file_id}.mp4",
            total_bytes=10485760,
            original_file_path=str(dummy_file),
            metadata={
                "upload_type": "video",
                "batch_id": batch_id,
                "video_start_at": start_iso,
                "video_stop_at": stop_iso,
            },
            upload_data={"ID": file_id, "Size": 10485760}
        )

        res_finish = await VideoUploadService.handle_finish(finish_payload, session)
        assert res_finish["status"] == "ok"

        # Verify completed status
        db_res_after = await session.execute(stmt)
        upload_meta_after = db_res_after.scalar_one_or_none()
        assert upload_meta_after.status == VideoStatus.COMPLETED
        assert upload_meta_after.completed_at is not None

        # Clean up moved file
        dest_file = os.path.join(settings.video_dir, upload_meta.safe_filename)
        if os.path.exists(dest_file):
            os.remove(dest_file)

        # Cleanup DB
        await session.delete(upload_meta_after)
        await session.commit()
