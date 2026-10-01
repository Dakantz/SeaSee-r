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
    assert "opk" in f1
    assert "yaw" not in f1 and "pitch" not in f1 and "roll" not in f1 and "ypr" not in f1
    assert "omega" in f1["opk"] and "phi" in f1["opk"] and "kappa" in f1["opk"]

    # Frame 2 at base_ts_ms + 1000 (matches mock_logs[1])
    f2 = overrides["image_00002.png"]
    assert "capture_time" in f2
    assert "opk" in f2
    assert "yaw" not in f2 and "pitch" not in f2 and "roll" not in f2 and "ypr" not in f2


def test_opk_from_ypr_and_omits_unused():
    from app.services.opensfm.exif_overrides import opk_from_ypr, ImageExifOverride, ExifOverridesBuilder

    # 1. Direct opk_from_ypr conversion verification
    opk = opk_from_ypr(yaw=166.8124, pitch=-26.9126, roll=0.0845, lat=52.0, lon=13.0, alt=100.0)
    assert pytest.approx(opk["omega"], 1e-2) == 26.32
    assert pytest.approx(opk["phi"], 1e-2) == 5.84
    assert pytest.approx(opk["kappa"], 1e-2) == -168.20

    # 2. ImageExifOverride formats to OPK and discards yaw/pitch/roll/ypr
    override = ImageExifOverride(
        capture_time=1785617503.0,
        yaw=166.8124,
        pitch=-26.9126,
        roll=0.0845,
        ypr={"yaw": 166.8124, "pitch": -26.9126, "roll": 0.0845},
        extra={"unused_ypr_in_extra": 123, "yaw": 999.0}
    )
    serialized = override.to_dict()

    assert serialized["capture_time"] == 1785617503.0
    assert "opk" in serialized
    assert serialized["opk"]["omega"] == opk_from_ypr(166.8124, -26.9126, 0.0845)["omega"]
    assert serialized["opk"]["phi"] == opk_from_ypr(166.8124, -26.9126, 0.0845)["phi"]
    assert serialized["opk"]["kappa"] == opk_from_ypr(166.8124, -26.9126, 0.0845)["kappa"]

    # Verify unused fields are completely omitted
    assert "yaw" not in serialized
    assert "pitch" not in serialized
    assert "roll" not in serialized
    assert "ypr" not in serialized
    assert serialized["unused_ypr_in_extra"] == 123

    # 3. Builder add_opk convenience method
    builder = ExifOverridesBuilder()
    builder.add_opk("test_img.jpg", omega=10.0, phi=20.0, kappa=30.0, accuracy=0.5)
    b_dict = builder.to_dict()
    assert b_dict["test_img.jpg"]["opk"] == {
        "omega": 10.0,
        "phi": 20.0,
        "kappa": 30.0,
        "accuracy": 0.5,
    }


def test_interpolate_scalar():
    from app.services.opensfm.exif_overrides import interpolate_scalar

    # Both valid
    assert interpolate_scalar(10.0, 20.0, 0.5) == 15.0

    # Bounds checking: min_val=0.0 filters negative out-of-range values like -1
    assert interpolate_scalar(-1.0, 3.5, 0.0, min_val=0.0) is None
    assert interpolate_scalar(-1.0, 3.5, 0.5, min_val=0.0) == 3.5
    assert interpolate_scalar(4.0, -1.0, 0.2, min_val=0.0) == 4.0
    assert interpolate_scalar(4.0, -1.0, 0.8, min_val=0.0) is None
    assert interpolate_scalar(-1.0, -1.0, 0.5, min_val=0.0) is None
    assert interpolate_scalar(2.0, 4.0, 0.25, min_val=0.0) == 2.5


def test_interpolate_telemetry_altitude_scale():
    from app.services.opensfm.exif_overrides import interpolate_telemetry_from_logs

    # Log 1: user payload example with altitude = -1 (invalid altimeter reading)
    log_1 = (
        1777974510000,
        {
            "yaw": 324.1468,
            "left": 0,
            "roll": 9.359772,
            "depth": 0,
            "pitch": 0.6206665,
            "right": 0,
            "altitude": -1,
            "distance": 0,
            "temperature": 23.37
        }
    )

    # Log 2: 1000 ms later with valid altitude = 3.58 meters
    log_2 = (
        1777974511000,
        {
            "yaw": 326.1468,
            "left": 0,
            "roll": 9.4000,
            "depth": 1.2,
            "pitch": 0.7000,
            "right": 0,
            "altitude": 3.58,
            "distance": 1.5,
            "temperature": 23.30
        }
    )

    logs = [log_1, log_2]

    # Exactly at log_1: altitude is -1 so should be omitted/None, but ypr, depth, temp should be present
    res_t1 = interpolate_telemetry_from_logs(1777974510000, logs)
    assert res_t1 is not None
    assert "altitude" not in res_t1
    assert pytest.approx(res_t1["yaw"], 1e-4) == 324.1468
    assert pytest.approx(res_t1["depth"], 1e-4) == 0.0
    assert pytest.approx(res_t1["temperature"], 1e-4) == 23.37

    # At midpoint (500 ms in): since log_1 had -1 and log_2 had 3.58, only valid altitude 3.58 is retained
    res_mid = interpolate_telemetry_from_logs(1777974510500, logs)
    assert res_mid is not None
    assert pytest.approx(res_mid["altitude"], 1e-4) == 3.58
    assert pytest.approx(res_mid["yaw"], 1e-4) == 325.1468
    assert pytest.approx(res_mid["depth"], 1e-4) == 0.6

    # Test between two valid altitudes
    log_3 = (
        1777974512000,
        {
            "yaw": 328.0,
            "pitch": 1.0,
            "roll": 9.0,
            "altitude": 4.58
        }
    )
    logs_valid = [log_2, log_3]
    res_mid_valid = interpolate_telemetry_from_logs(1777974511500, logs_valid)
    assert res_mid_valid is not None
    assert pytest.approx(res_mid_valid["altitude"], 1e-4) == 4.08


def test_image_exif_override_altitude_serialization():
    # 1. Valid altitude without full GPS coordinates creates relative_altitude but omits incomplete gps dictionary
    override = ImageExifOverride(
        capture_time=1777974510.0,
        altitude=3.58,
        altitude_std=0.05
    )
    d = override.to_dict()
    assert d["relative_altitude"] == 3.58
    assert "gps" not in d

    # 2. Existing full GPS coordinates (latitude and longitude) merge with altitude
    override_with_gps = ImageExifOverride(
        capture_time=1777974510.0,
        gps={"latitude": 42.1234, "longitude": 11.5678},
        altitude=2.75,
        altitude_std=0.1,
        dop=2.0
    )
    d_gps = override_with_gps.to_dict()
    assert d_gps["relative_altitude"] == 2.75
    assert "gps" in d_gps
    assert d_gps["gps"]["latitude"] == 42.1234
    assert d_gps["gps"]["longitude"] == 11.5678
    assert d_gps["gps"]["altitude"] == 2.75
    assert d_gps["gps"]["altitude_std"] == 0.1
    assert d_gps["gps"]["dop"] == 2.0

    # 3. Invalid negative altitude (-1) is not serialized
    override_invalid = ImageExifOverride(
        capture_time=1777974510.0,
        altitude=-1.0
    )
    d_inv = override_invalid.to_dict()
    assert "relative_altitude" not in d_inv
    assert "gps" not in d_inv


def test_builder_add_altitude():
    builder = ExifOverridesBuilder()
    builder.add_altitude(
        image_name="frame_001.png",
        altitude=4.25,
        altitude_std=0.05
    )
    overrides = builder.to_dict()
    assert "frame_001.png" in overrides
    assert overrides["frame_001.png"]["relative_altitude"] == 4.25
    assert "gps" not in overrides["frame_001.png"]

    # When full GPS is provided, gps dictionary is included
    builder.add_override(
        image_name="frame_002.png",
        altitude=4.25,
        gps={"latitude": 45.0, "longitude": 10.0},
        altitude_std=0.05
    )
    overrides2 = builder.to_dict()
    assert "gps" in overrides2["frame_002.png"]
    assert overrides2["frame_002.png"]["gps"]["latitude"] == 45.0
    assert overrides2["frame_002.png"]["gps"]["altitude"] == 4.25


@pytest.mark.anyio
async def test_register_frames_for_video_with_altitude_scale():
    builder = ExifOverridesBuilder()
    video_path = "/fake/underwater_rov.mp4"
    frame_filenames = ["image_00001.png", "image_00002.png"]
    fps = 1.0
    dur = 2.0

    start_iso = "2026-05-05T11:48:30+00:00"
    stop_iso = "2026-05-05T11:48:32+00:00"
    payload = {
        "video_start_at": start_iso,
        "video_stop_at": stop_iso,
        "altitude_std": 0.05
    }

    start_dt = datetime.fromisoformat(start_iso)
    base_ts_ms = int(start_dt.timestamp() * 1000)

    # Frame 1: altitude = -1 (invalid), Frame 2: altitude = 2.45m (valid scale)
    mock_logs = [
        (
            base_ts_ms,
            {
                "yaw": 324.14,
                "pitch": 0.62,
                "roll": 9.35,
                "altitude": -1,
                "depth": 0.0
            }
        ),
        (
            base_ts_ms + 1000,
            {
                "yaw": 325.0,
                "pitch": 0.65,
                "roll": 9.30,
                "altitude": 2.45,
                "depth": 0.5
            }
        ),
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

    # Frame 1 at base_ts_ms: altitude was -1 so no relative_altitude/gps altitude
    f1 = overrides["image_00001.png"]
    assert "opk" in f1
    assert "relative_altitude" not in f1
    assert "gps" not in f1
    assert "depth" not in f1 and "distance" not in f1 and "temperature" not in f1

    # Frame 2 at base_ts_ms + 1000: altitude was 2.45 so relative_altitude is registered, but gps is omitted without lat/lon
    f2 = overrides["image_00002.png"]
    assert "opk" in f2
    assert f2["relative_altitude"] == 2.45
    assert "gps" not in f2
    assert "depth" not in f2 and "distance" not in f2 and "temperature" not in f2

