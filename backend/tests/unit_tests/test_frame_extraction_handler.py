import os
import uuid
import pytest
import numpy as np
import cv2
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
        # Simulate creating a sharp image file in images_dir
        for arg in args:
            if isinstance(arg, str) and arg.endswith("image_%05d.png"):
                img_dir = os.path.dirname(arg)
                os.makedirs(img_dir, exist_ok=True)
                dummy_img = os.path.join(img_dir, "image_00001.png")
                sharp_img = np.zeros((100, 100), dtype=np.uint8)
                sharp_img[25:75, 25:75] = 255
                cv2.imwrite(dummy_img, sharp_img)
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
        assert res["kept_images"] == 1
        assert res["rejected_images"] == 0
        mock_update.assert_any_call(dummy_job_id, "COMPLETED", 100.0, result=res)


@pytest.mark.anyio
async def test_frame_extraction_blur_filtering(tmp_path):
    video_dir = str(tmp_path / "videos")
    output_dir = str(tmp_path / "opensfm_ingestion")
    os.makedirs(video_dir, exist_ok=True)
    os.makedirs(output_dir, exist_ok=True)

    dummy_video = os.path.join(video_dir, "test_video.mp4")
    with open(dummy_video, "w") as f:
        f.write("fake mp4 content")

    handler = FrameExtractionTaskHandler()
    dummy_job_id = str(uuid.uuid4())

    async def mock_get_duration(path):
        return 10.0

    mock_proc = MagicMock()
    mock_proc.returncode = 0
    mock_proc.communicate = AsyncMock(return_value=(b"", b""))

    async def mock_subprocess_exec(*args, **kwargs):
        for arg in args:
            if isinstance(arg, str) and arg.endswith("image_%05d.png"):
                img_dir = os.path.dirname(arg)
                os.makedirs(img_dir, exist_ok=True)
                
                # Image 1: Sharp image (high Laplacian variance)
                sharp_path = os.path.join(img_dir, "image_00001.png")
                sharp_img = np.zeros((100, 100), dtype=np.uint8)
                sharp_img[25:75, 25:75] = 255
                cv2.imwrite(sharp_path, sharp_img)

                # Image 2: Blurry/flat image (zero Laplacian variance)
                blurry_path = os.path.join(img_dir, "image_00002.png")
                blurry_img = np.zeros((100, 100), dtype=np.uint8)
                cv2.imwrite(blurry_path, blurry_img)
        return mock_proc

    with patch("app.services.worker.handlers.frame_extraction.settings") as mock_settings, \
         patch.object(handler, "_get_video_duration", side_effect=mock_get_duration), \
         patch("asyncio.create_subprocess_exec", side_effect=mock_subprocess_exec), \
         patch.object(handler, "update_job_status", new_callable=AsyncMock) as mock_update:

        mock_settings.video_dir = video_dir
        mock_settings.opensfm_ingestion_dir = output_dir
        mock_settings.opensfm_config = str(tmp_path / "config.yaml")

        res = await handler.execute(dummy_job_id, payload={"num_frames": 50, "blur_threshold": 100.0})

        assert res["status"] == "success"
        assert res["total_extracted"] == 2
        assert res["kept_images"] == 1
        assert res["rejected_images"] == 1
        assert res["rejected_dir"] is not None

        images_dir = res["images_dir"]
        rejected_dir = res["rejected_dir"]

        assert os.path.exists(os.path.join(images_dir, "image_00001.png"))
        assert not os.path.exists(os.path.join(images_dir, "image_00002.png"))
        assert os.path.exists(os.path.join(rejected_dir, "image_00002.png"))

