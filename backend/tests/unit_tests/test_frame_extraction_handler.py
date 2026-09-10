import os
import uuid
import pytest
from unittest.mock import AsyncMock, patch, MagicMock

from app.services.worker.handlers.frame_extraction import FrameExtractionTaskHandler


@pytest.mark.anyio
async def test_frame_extraction_no_videos_raises(tmp_path):
    video_dir = str(tmp_path / "videos")
    output_dir = str(tmp_path / "opensfm_ingestion")
    os.makedirs(video_dir, exist_ok=True)
    os.makedirs(output_dir, exist_ok=True)

    handler = FrameExtractionTaskHandler()
    dummy_job_id = str(uuid.uuid4())

    with patch("app.services.worker.handlers.frame_extraction.settings") as mock_settings, \
         patch.object(handler, "update_job_status", new_callable=AsyncMock) as mock_update:
        mock_settings.video_dir = video_dir
        mock_settings.opensfm_ingestion_dir = output_dir

        with pytest.raises(RuntimeError, match="No .mp4 or .MP4 video files found"):
            await handler.execute(dummy_job_id, payload={"num_frames": 10})

        mock_update.assert_any_call(dummy_job_id, "FAILED", 0.0, error_message=f"No .mp4 or .MP4 video files found in '{video_dir}'.")


@pytest.mark.anyio
async def test_frame_extraction_success(tmp_path):
    video_dir = str(tmp_path / "videos")
    output_dir = str(tmp_path / "opensfm_ingestion")
    os.makedirs(video_dir, exist_ok=True)
    os.makedirs(output_dir, exist_ok=True)

    # Create dummy video file
    dummy_video = os.path.join(video_dir, "test_video.mp4")
    with open(dummy_video, "w") as f:
        f.write("fake mp4 content")

    handler = FrameExtractionTaskHandler()
    dummy_job_id = str(uuid.uuid4())

    # Mock ffprobe duration return
    async def mock_get_duration(path):
        return 10.0

    # Mock ffmpeg subprocess
    mock_proc = MagicMock()
    mock_proc.returncode = 0
    mock_proc.communicate = AsyncMock(return_value=(b"", b""))

    async def mock_subprocess_exec(*args, **kwargs):
        # Simulate creating an image file in images_dir
        for arg in args:
            if isinstance(arg, str) and arg.endswith("image_%05d.png"):
                img_dir = os.path.dirname(arg)
                os.makedirs(img_dir, exist_ok=True)
                dummy_img = os.path.join(img_dir, "image_00001.png")
                with open(dummy_img, "w") as f:
                    f.write("fake png")
        return mock_proc

    with patch("app.services.worker.handlers.frame_extraction.settings") as mock_settings, \
         patch.object(handler, "_get_video_duration", side_effect=mock_get_duration), \
         patch("asyncio.create_subprocess_exec", side_effect=mock_subprocess_exec), \
         patch.object(handler, "update_job_status", new_callable=AsyncMock) as mock_update:

        mock_settings.video_dir = video_dir
        mock_settings.opensfm_ingestion_dir = output_dir
        mock_settings.opensfm_config = str(tmp_path / "config.yaml")

        res = await handler.execute(dummy_job_id, payload={"num_frames": 50})

        assert res["status"] == "success"
        assert res["job_id"] == dummy_job_id
        assert res["total_extracted"] == 1
        mock_update.assert_any_call(dummy_job_id, "COMPLETED", 100.0, result=res)
