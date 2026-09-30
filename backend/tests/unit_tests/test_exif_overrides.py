import os
import json
import uuid
import pytest
from datetime import datetime, timezone, timedelta
from unittest.mock import AsyncMock, patch, MagicMock

from app.services.opensfm.exif_overrides import (
    ExifOverridesBuilder,
    ImageExifOverride,
    calculate_capture_time,
    get_video_metadata_timestamps,
    register_frames_for_video,
)
from app.services.worker.handlers.frame_extraction import FrameExtractionTaskHandler


def test_image_exif_override_serialization():
    override = ImageExifOverride(capture_time=1727604000.123456)
    d = override.to_dict()
    assert d == {"capture_time": 1727604000.123456}

    # Extensibility check for future GPS/camera metadata
    override.gps = {"latitude": 45.123, "longitude": 9.456, "altitude": 10.0}
    override.camera = "v2 brown 1920 1080"
    d2 = override.to_dict()
    assert d2["capture_time"] == 1727604000.123456
    assert d2["gps"]["latitude"] == 45.123
    assert d2["camera"] == "v2 brown 1920 1080"


def test_exif_overrides_builder(tmp_path):
    builder = ExifOverridesBuilder()
    builder.add_capture_time("image_00001.png", 1727604000.0)
    builder.add_capture_time("image_00002.png", 1727604001.0)
    builder.add_capture_time("image_00003.png", 1727604002.0)

    overrides = builder.to_dict()
    assert len(overrides) == 3
    assert overrides["image_00001.png"]["capture_time"] == 1727604000.0
    assert overrides["image_00002.png"]["capture_time"] == 1727604001.0
    assert overrides["image_00003.png"]["capture_time"] == 1727604002.0

    out_file = str(tmp_path / "exif_overrides.json")
    saved_path = builder.save_to_json(out_file)
    assert os.path.exists(saved_path)

    with open(saved_path, "r", encoding="utf-8") as f:
        loaded = json.load(f)
    assert loaded == overrides


def test_calculate_capture_time():
    start = datetime(2026, 9, 29, 10, 0, 0, tzinfo=timezone.utc)
    stop = datetime(2026, 9, 29, 10, 0, 10, tzinfo=timezone.utc)
    start_sec = start.timestamp()
    stop_sec = stop.timestamp()

    # 10 frames at 1 fps over 10 seconds
    fps = 1.0
    for idx in range(10):
        t = calculate_capture_time(
            video_start_at=start,
            video_stop_at=stop,
            frame_index=idx,
            fps=fps,
            video_duration=10.0
        )
        expected = start_sec + idx * 1.0
        assert pytest.approx(t, 1e-4) == expected

    # Test clamping
    t_over = calculate_capture_time(
        video_start_at=start,
        video_stop_at=stop,
        frame_index=15,
        fps=fps,
        video_duration=10.0
    )
    assert t_over == stop_sec

    # Test proportional scaling when video_duration differs slightly from metadata
    t_scaled = calculate_capture_time(
        video_start_at=start,
        video_stop_at=stop,
        frame_index=5,
        fps=1.0,
        video_duration=20.0  # video reported as 20s while meta says 10s
    )
    assert pytest.approx(t_scaled, 1e-4) == start_sec + 2.5


@pytest.mark.anyio
async def test_get_video_metadata_timestamps_payload():
    payload = {
        "video_start_at": "2026-09-29T10:00:00+00:00",
        "video_stop_at": "2026-09-29T10:05:00+00:00",
    }
    start, stop = await get_video_metadata_timestamps("test.mp4", payload=payload)
    assert start.year == 2026
    assert start.minute == 0
    assert stop.minute == 5


@pytest.mark.anyio
async def test_get_video_metadata_timestamps_db_lookup():
    mock_video = MagicMock()
    mock_video.video_start_at = datetime(2026, 9, 4, 13, 42, 10, tzinfo=timezone.utc)
    mock_video.video_stop_at = datetime(2026, 9, 4, 13, 45, 10, tzinfo=timezone.utc)

    mock_result = MagicMock()
    mock_result.scalars.return_value.first.return_value = mock_video

    mock_session = AsyncMock()
    mock_session.execute = AsyncMock(return_value=mock_result)

    start, stop = await get_video_metadata_timestamps(
        "c577b3e5-dbd0-3ba9-a776-aa289eff9376.mp4",
        session=mock_session
    )
    assert start == mock_video.video_start_at
    assert stop == mock_video.video_stop_at

    # Verify session execute was called with a query using or_
    mock_session.execute.assert_called_once()


@pytest.mark.anyio
async def test_get_video_metadata_timestamps_raises_error_without_fallback():
    # When no payload, db returns None, and ffprobe fails, must raise RuntimeError (no silent fallback)
    mock_result = MagicMock()
    mock_result.scalars.return_value.first.return_value = None

    mock_session = AsyncMock()
    mock_session.execute = AsyncMock(return_value=mock_result)

    with patch("app.services.opensfm.exif_overrides._get_container_creation_time", new_callable=AsyncMock) as mock_probe:
        mock_probe.return_value = None
        with pytest.raises(RuntimeError) as exc_info:
            await get_video_metadata_timestamps("unmatched_video.mp4", session=mock_session)

        assert "Failed to resolve recording timestamps" in str(exc_info.value)



@pytest.mark.anyio
async def test_frame_extraction_generates_exif_overrides_with_rejected_frames(tmp_path):
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

    # Create 4 frames: 2 sharp, 2 blurry (to test blur filtering exclusion)
    import numpy as np
    import cv2

    async def mock_subprocess_exec(*args, **kwargs):
        for arg in args:
            if isinstance(arg, str) and arg.endswith("image_%05d.png"):
                img_dir = os.path.dirname(arg)
                os.makedirs(img_dir, exist_ok=True)
                # Frame 1: sharp
                f1 = np.zeros((100, 100), dtype=np.uint8)
                f1[25:75, 25:75] = 255
                cv2.imwrite(os.path.join(img_dir, "image_00001.png"), f1)

                # Frame 2: blurry (completely uniform)
                f2 = np.ones((100, 100), dtype=np.uint8) * 128
                cv2.imwrite(os.path.join(img_dir, "image_00002.png"), f2)

                # Frame 3: sharp
                f3 = np.zeros((100, 100), dtype=np.uint8)
                f3[20:80, 20:80] = 255
                cv2.imwrite(os.path.join(img_dir, "image_00003.png"), f3)

                # Frame 4: blurry
                f4 = np.ones((100, 100), dtype=np.uint8) * 128
                cv2.imwrite(os.path.join(img_dir, "image_00004.png"), f4)
        return mock_proc

    start_iso = "2026-09-29T10:00:00+00:00"
    stop_iso = "2026-09-29T10:00:10+00:00"
    payload = {
        "fps": 0.4,
        "blur_threshold": 50.0,
        "video_start_at": start_iso,
        "video_stop_at": stop_iso
    }

    with patch("app.services.worker.handlers.frame_extraction.settings") as mock_settings, \
         patch.object(handler, "_get_video_duration", side_effect=mock_get_duration), \
         patch("asyncio.create_subprocess_exec", side_effect=mock_subprocess_exec), \
         patch.object(handler, "update_job_status", new_callable=AsyncMock):

        mock_settings.video_dir = video_dir
        mock_settings.opensfm_ingestion_dir = output_dir
        mock_settings.opensfm_config = str(tmp_path / "config.yaml")

        res = await handler.execute(dummy_job_id, payload=payload)

        assert res["status"] == "success"
        assert res["total_extracted"] == 4
        assert res["kept_images"] == 2
        assert res["rejected_images"] == 2
        assert res["total_overrides"] == 4

        dataset_dir = res["dataset_dir"]
        exif_file = os.path.join(dataset_dir, "exif_overrides.json")
        assert os.path.exists(exif_file)

        with open(exif_file, "r") as f:
            overrides = json.load(f)

        # Crucial check: EVERY extracted frame has capture_time, even the rejected ones (image_00002.png, image_00004.png)
        assert len(overrides) == 4
        assert "image_00001.png" in overrides
        assert "image_00002.png" in overrides
        assert "image_00003.png" in overrides
        assert "image_00004.png" in overrides

        for i in range(1, 5):
            fname = f"image_{i:05d}.png"
            assert "capture_time" in overrides[fname]
            assert isinstance(overrides[fname]["capture_time"], float)

        # Monotonically increasing capture_time
        t1 = overrides["image_00001.png"]["capture_time"]
        t2 = overrides["image_00002.png"]["capture_time"]
        t3 = overrides["image_00003.png"]["capture_time"]
        t4 = overrides["image_00004.png"]["capture_time"]
        assert t1 < t2 < t3 < t4

        # Also verify rejected_dir has a copy of exif_overrides.json
        reject_exif = os.path.join(res["rejected_dir"], "exif_overrides.json")
        assert os.path.exists(reject_exif)


def test_lerp_helpers():
    from app.services.opensfm.exif_overrides import lerp_value, lerp_angle

    # Standard linear lerp
    assert lerp_value(10.0, 20.0, 0.5) == 15.0
    assert lerp_value(0.0, 10.0, 0.25) == 2.5
    assert lerp_value(-5.0, 5.0, 0.5) == 0.0

    # Angular lerp: direct arc
    assert lerp_angle(10.0, 30.0, 0.5) == 20.0

    # Angular lerp: wrap-around across 0/360 degrees
    # From 350 deg to 10 deg: shortest arc is +20 deg, midpoint is 0 deg (or 360 deg)
    assert pytest.approx(lerp_angle(350.0, 10.0, 0.5), 1e-4) == 0.0

    # From 10 deg to 350 deg: shortest arc is -20 deg, midpoint is 0 deg
    assert pytest.approx(lerp_angle(10.0, 350.0, 0.5), 1e-4) == 0.0


def test_interpolate_ypr_from_logs():
    from app.services.opensfm.exif_overrides import interpolate_ypr_from_logs

    # Example payload provided by user
    log_1 = (
        1777974509000,
        {
            "yaw": 320.0,
            "pitch": 0.0,
            "roll": 10.0,
            "depth": 0,
            "temperature": 23.37
        }
    )
    log_2 = (
        1777974510000,
        {
            "yaw": 330.0,
            "pitch": 2.0,
            "roll": 8.0,
            "depth": 0,
            "temperature": 23.37
        }
    )
    # Distant log (> 1 second away, should be ignored)
    log_far = (
        1777974520000,
        {
            "yaw": 100.0,
            "pitch": 10.0,
            "roll": 10.0
        }
    )

    logs = [log_1, log_far, log_2]

    # Target timestamp at 1777974509500 (halfway between log_1 and log_2, alpha = 0.5)
    target_ts = 1777974509500
    res = interpolate_ypr_from_logs(target_ts, logs)

    assert res is not None
    assert pytest.approx(res["yaw"], 1e-4) == 325.0
    assert pytest.approx(res["pitch"], 1e-4) == 1.0
    assert pytest.approx(res["roll"], 1e-4) == 9.0

    # Test exact user payload example
    user_payload_log1 = (
        1777974509000,
        {"yaw": 324.0, "pitch": 0.6, "roll": 9.0}
    )
    user_payload_log2 = (
        1777974510000,
        {"yaw": 324.3104, "pitch": 0.62719727, "roll": 9.347046}
    )
    res_user = interpolate_ypr_from_logs(1777974510000, [user_payload_log1, user_payload_log2])
    assert res_user is not None
    assert pytest.approx(res_user["yaw"], 1e-3) == 324.3104
    assert pytest.approx(res_user["pitch"], 1e-3) == 0.6272
    assert pytest.approx(res_user["roll"], 1e-3) == 9.3470


def test_interpolate_ypr_single_or_no_log_within_1s():
    from app.services.opensfm.exif_overrides import interpolate_ypr_from_logs

    log_entry = (1777974509000, {"yaw": 180.0, "pitch": 5.0, "roll": -2.0})

    # Within 1s (400ms away)
    res_single = interpolate_ypr_from_logs(1777974509400, [log_entry])
    assert res_single is not None
    assert res_single["yaw"] == 180.0
    assert res_single["pitch"] == 5.0
    assert res_single["roll"] == -2.0

    # More than 1s away (1500ms away) -> should return None
    res_none = interpolate_ypr_from_logs(1777974510501, [log_entry])
    assert res_none is None


@pytest.mark.anyio
async def test_register_frames_for_video_with_telemetry():
    from app.services.opensfm.exif_overrides import ExifOverridesBuilder, register_frames_for_video

    builder = ExifOverridesBuilder()
    video_path = "/fake/video.mp4"
    frame_filenames = ["image_00001.png", "image_00002.png"]
    fps = 1.0
    dur = 2.0

    start_iso = "2026-05-05T11:48:29+00:00"
    stop_iso = "2026-05-05T11:48:31+00:00"
    payload = {
        "video_start_at": start_iso,
        "video_stop_at": stop_iso
    }

    start_dt = datetime.fromisoformat(start_iso)
    base_ts_ms = int(start_dt.timestamp() * 1000)

    # Prepare log entries around frame timestamps
    mock_logs = [
        (base_ts_ms, {"yaw": 320.0, "pitch": 1.0, "roll": 5.0}),
        (base_ts_ms + 1000, {"yaw": 330.0, "pitch": 3.0, "roll": 7.0}),
    ]

    await register_frames_for_video(
        builder=builder,
        video_path=video_path,
        frame_filenames=frame_filenames,
        fps=fps,
        video_duration=dur,
        payload=payload,
        log_entries=mock_logs
    )

    overrides = builder.to_dict()
    assert len(overrides) == 2

    # Frame 1 at base_ts_ms (matches mock_logs[0])
    f1 = overrides["image_00001.png"]
    assert "capture_time" in f1
    assert "yaw" in f1 and "pitch" in f1 and "roll" in f1
    assert "ypr" in f1
    assert pytest.approx(f1["yaw"], 1e-4) == 320.0
    assert pytest.approx(f1["pitch"], 1e-4) == 1.0
    assert pytest.approx(f1["roll"], 1e-4) == 5.0

    # Frame 2 at base_ts_ms + 1000 (matches mock_logs[1])
    f2 = overrides["image_00002.png"]
    assert pytest.approx(f2["yaw"], 1e-4) == 330.0
    assert pytest.approx(f2["pitch"], 1e-4) == 3.0
    assert pytest.approx(f2["roll"], 1e-4) == 7.0
