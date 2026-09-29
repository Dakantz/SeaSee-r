import os
import json
import uuid
import logging
import asyncio
from datetime import datetime, timezone, timedelta
from dataclasses import dataclass, field
from typing import Dict, Any, Optional, List, Tuple, Union
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import async_session
from app.models.video import Video, UploadMetadata
from app.models.log_data import LogData

logger = logging.getLogger(__name__)


@dataclass
class ImageExifOverride:
    """
    Data model representing EXIF override parameters for an individual image.
    Supports capture_time, gps, orientation, camera, and yaw/pitch/roll telemetry.
    """
    capture_time: Optional[float] = None
    gps: Optional[Dict[str, Any]] = None
    orientation: Optional[int] = None
    camera: Optional[str] = None
    yaw: Optional[float] = None
    pitch: Optional[float] = None
    roll: Optional[float] = None
    ypr: Optional[Dict[str, float]] = None
    extra: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        """Serializes the override parameters to OpenSfM exif_overrides compatible dictionary."""
        data: Dict[str, Any] = {}
        if self.capture_time is not None:
            data["capture_time"] = float(self.capture_time)
        if self.gps is not None:
            data["gps"] = self.gps
        if self.orientation is not None:
            data["orientation"] = self.orientation
        if self.camera is not None:
            data["camera"] = self.camera
        if self.yaw is not None:
            data["yaw"] = float(self.yaw)
        if self.pitch is not None:
            data["pitch"] = float(self.pitch)
        if self.roll is not None:
            data["roll"] = float(self.roll)
        if self.ypr is not None:
            data["ypr"] = self.ypr
        elif self.yaw is not None and self.pitch is not None and self.roll is not None:
            data["ypr"] = {
                "yaw": float(self.yaw),
                "pitch": float(self.pitch),
                "roll": float(self.roll)
            }
        if self.extra:
            data.update(self.extra)
        return data


class ExifOverridesBuilder:
    """
    Builder and manager for generating OpenSfM exif_overrides.json files.
    Maintains a mapping of image filenames to their respective metadata overrides.
    """

    def __init__(self) -> None:
        self._overrides: Dict[str, ImageExifOverride] = {}

    @property
    def overrides(self) -> Dict[str, ImageExifOverride]:
        return self._overrides

    def add_override(
        self,
        image_name: str,
        capture_time: Optional[float] = None,
        gps: Optional[Dict[str, Any]] = None,
        orientation: Optional[int] = None,
        camera: Optional[str] = None,
        yaw: Optional[float] = None,
        pitch: Optional[float] = None,
        roll: Optional[float] = None,
        ypr: Optional[Dict[str, float]] = None,
        **extra: Any
    ) -> ImageExifOverride:
        """Adds or updates an EXIF override entry for a given image filename."""
        if image_name in self._overrides:
            entry = self._overrides[image_name]
            if capture_time is not None:
                entry.capture_time = capture_time
            if gps is not None:
                entry.gps = gps
            if orientation is not None:
                entry.orientation = orientation
            if camera is not None:
                entry.camera = camera
            if yaw is not None:
                entry.yaw = yaw
            if pitch is not None:
                entry.pitch = pitch
            if roll is not None:
                entry.roll = roll
            if ypr is not None:
                entry.ypr = ypr
            if extra:
                entry.extra.update(extra)
        else:
            entry = ImageExifOverride(
                capture_time=capture_time,
                gps=gps,
                orientation=orientation,
                camera=camera,
                yaw=yaw,
                pitch=pitch,
                roll=roll,
                ypr=ypr,
                extra=extra
            )
            self._overrides[image_name] = entry
        return entry

    def add_ypr(
        self,
        image_name: str,
        yaw: float,
        pitch: float,
        roll: float
    ) -> ImageExifOverride:
        """Convenience method to register yaw, pitch, and roll telemetry for an image."""
        return self.add_override(
            image_name,
            yaw=yaw,
            pitch=pitch,
            roll=roll,
            ypr={"yaw": yaw, "pitch": pitch, "roll": roll}
        )

    def add_capture_time(self, image_name: str, capture_time: float) -> ImageExifOverride:
        """Convenience method to register capture_time for an image."""
        return self.add_override(image_name, capture_time=capture_time)

    def get_override(self, image_name: str) -> Optional[Dict[str, Any]]:
        """Returns the dictionary representation of an image override if present."""
        if image_name in self._overrides:
            return self._overrides[image_name].to_dict()
        return None

    def to_dict(self) -> Dict[str, Dict[str, Any]]:
        """Exports the entire collection to an OpenSfM-compatible exif_overrides dictionary."""
        return {
            img_name: override.to_dict()
            for img_name, override in self._overrides.items()
        }

    def save_to_json(self, file_path: str, indent: int = 2) -> str:
        """
        Writes the current overrides dictionary to the specified JSON file path.
        Creates parent directories if necessary.
        """
        os.makedirs(os.path.dirname(os.path.abspath(file_path)), exist_ok=True)
        data = self.to_dict()
        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=indent)
        logger.info(f"Successfully saved {len(data)} EXIF overrides to {file_path}")
        return file_path


def parse_timestamp_value(value: Any) -> Optional[datetime]:
    """Helper to convert various timestamp formats (datetime, float/int seconds, ISO string) to a UTC datetime."""
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)
    if isinstance(value, (int, float)):
        # Check if milliseconds or seconds
        secs = value / 1000.0 if value > 1e11 else float(value)
        return datetime.fromtimestamp(secs, tz=timezone.utc)
    if isinstance(value, str):
        val_str = value.strip()
        try:
            # Check numeric timestamp string
            numeric_val = float(val_str)
            return parse_timestamp_value(numeric_val)
        except ValueError:
            pass
        try:
            # Try ISO 8601 parsing
            dt = datetime.fromisoformat(val_str)
            if dt.tzinfo is None:
                return dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc)
        except Exception:
            pass
    return None


def calculate_capture_time(
    video_start_at: Union[datetime, float, int],
    video_stop_at: Union[datetime, float, int],
    frame_index: int,
    fps: Optional[float] = None,
    total_frames: Optional[int] = None,
    video_duration: Optional[float] = None
) -> float:
    """
    Calculates the exact UNIX timestamp (in seconds, with sub-second precision)
    for a frame extracted from a video segment.

    Parameters:
    - video_start_at: Start time of the video recording (datetime or epoch seconds).
    - video_stop_at: Stop time of the video recording (datetime or epoch seconds).
    - frame_index: 0-based index of the extracted frame within this video segment.
    - fps: Extraction frame rate (frames per second).
    - total_frames: Total number of frames extracted from this video segment (used if fps is not provided).
    - video_duration: Duration of the video in seconds (from ffprobe or video stream).

    Returns:
    - float: POSIX capture_time in seconds since epoch.
    """
    start_sec = (
        video_start_at.timestamp()
        if isinstance(video_start_at, datetime)
        else float(video_start_at)
    )
    stop_sec = (
        video_stop_at.timestamp()
        if isinstance(video_stop_at, datetime)
        else float(video_stop_at)
    )

    delta_time = stop_sec - start_sec

    # 1. If extraction fps is provided and valid
    if fps is not None and fps > 0:
        offset_in_video = frame_index / fps

        # If video_duration is known and delta_time is positive, scale proportionally
        if video_duration is not None and video_duration > 0 and delta_time > 0:
            scale = delta_time / video_duration
            capture_time = start_sec + (offset_in_video * scale)
        else:
            capture_time = start_sec + offset_in_video

        if delta_time > 0:
            capture_time = min(max(capture_time, start_sec), stop_sec)

        return round(capture_time, 6)

    # 2. If total_frames is provided without fps
    if total_frames is not None and total_frames > 1 and delta_time > 0:
        fraction = frame_index / (total_frames - 1)
        capture_time = start_sec + (fraction * delta_time)
        return round(capture_time, 6)

    # 3. Fallback
    capture_time = start_sec + float(frame_index)
    if delta_time > 0:
        capture_time = min(max(capture_time, start_sec), stop_sec)
    return round(capture_time, 6)


async def _get_container_creation_time(video_path: str) -> Optional[datetime]:
    """Attempts to extract container creation timestamp using ffprobe tags."""
    if not os.path.exists(video_path):
        return None
    try:
        cmd = [
            "ffprobe",
            "-v", "error",
            "-show_entries", "format_tags=creation_time",
            "-of", "default=noprint_wrappers=1:nokey=1",
            video_path
        ]
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        stdout, _ = await proc.communicate()
        if proc.returncode == 0 and stdout:
            date_str = stdout.decode().strip()
            if date_str:
                return parse_timestamp_value(date_str)
    except Exception as e:
        logger.debug(f"Failed to probe creation_time for {video_path}: {e}")
    return None


async def get_video_metadata_timestamps(
    video_path: str,
    payload: Optional[Dict[str, Any]] = None,
    session: Optional[AsyncSession] = None,
    video_duration: Optional[float] = None
) -> Tuple[datetime, datetime]:
    """
    Resolves the video recording start and stop timestamps (`video_start_at` and `video_stop_at`).
    
    Resolution order:
    1. Direct payload fields: `video_start_at` / `video_stop_at` (or per-video mapping in payload).
    2. Database lookup: matches video filename/UUID against `upload_metadata` and `video_metadata`.
    3. Video container tags via ffprobe (`creation_time`).
    4. File modification time / current UTC time fallback.
    """
    payload = payload or {}
    basename = os.path.basename(video_path)
    stem = os.path.splitext(basename)[0]

    # 1. Check payload per-video dictionary
    videos_meta = payload.get("videos_metadata") or payload.get("videos")
    if isinstance(videos_meta, dict):
        v_entry = videos_meta.get(basename) or videos_meta.get(stem)
        if isinstance(v_entry, dict):
            start = parse_timestamp_value(v_entry.get("video_start_at") or v_entry.get("start_at"))
            stop = parse_timestamp_value(v_entry.get("video_stop_at") or v_entry.get("stop_at"))
            if start and stop:
                return start, stop

    # Check top-level payload start and stop
    p_start = parse_timestamp_value(payload.get("video_start_at"))
    p_stop = parse_timestamp_value(payload.get("video_stop_at"))
    if p_start and p_stop:
        return p_start, p_stop

    # 2. Database lookup
    async def _query_db(db: AsyncSession) -> Optional[Tuple[datetime, datetime]]:
        try:
            stmt = (
                select(Video)
                .join(UploadMetadata, Video.upload_metadata_id == UploadMetadata.id)
                .where(
                    (UploadMetadata.safe_filename == basename) |
                    (UploadMetadata.orig_filename == basename) |
                    (UploadMetadata.safe_filename == stem) |
                    (UploadMetadata.orig_filename == stem)
                )
            )

            # Check if stem is a valid UUID
            try:
                file_uuid = uuid.UUID(stem)
                stmt = stmt.or_where(UploadMetadata.id == file_uuid)
            except ValueError:
                pass

            # Also check payload file_id if present
            payload_file_id = payload.get("file_id")
            if payload_file_id:
                try:
                    p_uuid = uuid.UUID(str(payload_file_id))
                    stmt = stmt.or_where(UploadMetadata.id == p_uuid)
                except ValueError:
                    pass

            result = await db.execute(stmt)
            video_rec = result.scalars().first()
            if video_rec and video_rec.video_start_at and video_rec.video_stop_at:
                return video_rec.video_start_at, video_rec.video_stop_at
        except Exception as err:
            logger.warning(f"Error querying video metadata from database for {basename}: {err}")
        return None

    if session:
        db_res = await _query_db(session)
        if db_res:
            return db_res
    else:
        try:
            async with async_session() as db:
                db_res = await _query_db(db)
                if db_res:
                    return db_res
        except Exception as e:
            logger.debug(f"Could not connect to database for video metadata: {e}")

    # 3. Check ffprobe container creation_time
    container_time = await _get_container_creation_time(video_path)
    dur = video_duration or 0.0
    if container_time:
        stop_time = container_time + timedelta(seconds=dur if dur > 0 else 1.0)
        return container_time, stop_time

    # 4. Fallback: file mtime or UTC now
    try:
        mtime = os.path.getmtime(video_path)
        end_time = datetime.fromtimestamp(mtime, tz=timezone.utc)
    except Exception:
        end_time = datetime.now(timezone.utc)

    start_time = end_time - timedelta(seconds=dur if dur > 0 else 1.0)
    return start_time, end_time


def lerp_value(v1: float, v2: float, alpha: float) -> float:
    """Linear interpolation between two float values."""
    return (1.0 - alpha) * v1 + alpha * v2


def lerp_angle(a1: float, a2: float, alpha: float) -> float:
    """Linear interpolation between two angles in degrees [0, 360) along the shortest path."""
    diff = (a2 - a1) % 360.0
    if diff > 180.0:
        diff -= 360.0
    return (a1 + alpha * diff) % 360.0


def interpolate_ypr_from_logs(
    target_timestamp_ms: int,
    log_entries: List[Tuple[int, Dict[str, Any]]]
) -> Optional[Dict[str, float]]:
    """
    Finds the 2 nearest timestamps in log_data that are within 1 second (1000 ms) of
    target_timestamp_ms, and computes the linear interpolation (lerp) of yaw, pitch, and roll.

    If only 1 entry is within 1 second, uses that entry's values.
    If no entries are within 1 second, returns None.
    """
    if not log_entries:
        return None

    # 1. Filter log_data entries within 1 second (1000 ms)
    within_one_sec = [
        (ts, payload)
        for ts, payload in log_entries
        if abs(ts - target_timestamp_ms) <= 1000
    ]

    if not within_one_sec:
        return None

    # 2. Find the 2 nearest timestamps to target_timestamp_ms
    within_one_sec.sort(key=lambda item: abs(item[0] - target_timestamp_ms))
    nearest = within_one_sec[:2]

    def _extract_ypr(p: Dict[str, Any]) -> Tuple[Optional[float], Optional[float], Optional[float]]:
        y = p.get("yaw")
        pi = p.get("pitch")
        r = p.get("roll")
        try:
            y_val = float(y) if y is not None else None
        except (ValueError, TypeError):
            y_val = None
        try:
            pi_val = float(pi) if pi is not None else None
        except (ValueError, TypeError):
            pi_val = None
        try:
            r_val = float(r) if r is not None else None
        except (ValueError, TypeError):
            r_val = None
        return y_val, pi_val, r_val

    if len(nearest) == 1:
        y, pi, r = _extract_ypr(nearest[0][1])
        if y is None and pi is None and r is None:
            return None
        res: Dict[str, float] = {}
        if y is not None:
            res["yaw"] = round(y, 4)
        if pi is not None:
            res["pitch"] = round(pi, 4)
        if r is not None:
            res["roll"] = round(r, 4)
        return res

    # 3. Sort the 2 nearest chronologically: t1 <= t2
    nearest.sort(key=lambda item: item[0])
    (t1, p1), (t2, p2) = nearest[0], nearest[1]

    if t2 == t1:
        alpha = 0.0
    else:
        alpha = (target_timestamp_ms - t1) / (t2 - t1)
        alpha = min(max(alpha, 0.0), 1.0)

    y1, pi1, r1 = _extract_ypr(p1)
    y2, pi2, r2 = _extract_ypr(p2)

    res: Dict[str, float] = {}

    # Lerp yaw
    if y1 is not None and y2 is not None:
        res["yaw"] = round(lerp_angle(y1, y2, alpha), 4)
    elif y1 is not None:
        res["yaw"] = round(y1, 4)
    elif y2 is not None:
        res["yaw"] = round(y2, 4)

    # Lerp pitch
    if pi1 is not None and pi2 is not None:
        res["pitch"] = round(lerp_value(pi1, pi2, alpha), 4)
    elif pi1 is not None:
        res["pitch"] = round(pi1, 4)
    elif pi2 is not None:
        res["pitch"] = round(pi2, 4)

    # Lerp roll
    if r1 is not None and r2 is not None:
        res["roll"] = round(lerp_value(r1, r2, alpha), 4)
    elif r1 is not None:
        res["roll"] = round(r1, 4)
    elif r2 is not None:
        res["roll"] = round(r2, 4)

    return res if res else None


async def fetch_log_data_for_time_range(
    min_ts_ms: int,
    max_ts_ms: int,
    batch_id: Optional[Union[uuid.UUID, str]] = None,
    session: Optional[AsyncSession] = None
) -> List[Tuple[int, Dict[str, Any]]]:
    """
    Queries log_data from PostgreSQL within the time window [min_ts_ms - 1000, max_ts_ms + 1000].
    If batch_id is provided, filters for that batch or logs with batch_id IS NULL.
    """
    batch_uuid = None
    if batch_id:
        try:
            batch_uuid = uuid.UUID(str(batch_id))
        except ValueError:
            pass

    async def _query(db: AsyncSession) -> List[Tuple[int, Dict[str, Any]]]:
        stmt = (
            select(LogData.timestamp, LogData.payload)
            .where(
                LogData.timestamp >= min_ts_ms - 1000,
                LogData.timestamp <= max_ts_ms + 1000
            )
        )
        if batch_uuid:
            stmt = stmt.where(
                (LogData.batch_id == batch_uuid) | (LogData.batch_id.is_(None))
            )
        stmt = stmt.order_by(LogData.timestamp)
        result = await db.execute(stmt)
        rows = result.all()
        return [(int(row[0]), row[1] if isinstance(row[1], dict) else {}) for row in rows]

    try:
        if session:
            return await _query(session)
        async with async_session() as db:
            return await _query(db)
    except Exception as e:
        logger.debug(f"Could not query log_data for telemetry: {e}")
        return []


async def register_frames_for_video(
    builder: ExifOverridesBuilder,
    video_path: str,
    frame_filenames: List[str],
    fps: float,
    video_duration: float,
    payload: Optional[Dict[str, Any]] = None,
    session: Optional[AsyncSession] = None,
    log_entries: Optional[List[Tuple[int, Dict[str, Any]]]] = None
) -> None:
    """
    Computes exact capture_time for all frame filenames belonging to a video segment,
    interpolates yaw, pitch, and roll telemetry from log_data (within 1 second),
    and records them into the ExifOverridesBuilder.
    """
    start_at, stop_at = await get_video_metadata_timestamps(
        video_path=video_path,
        payload=payload,
        session=session,
        video_duration=video_duration
    )

    total_frames = len(frame_filenames)
    frame_timestamps: List[float] = []
    for idx, fname in enumerate(frame_filenames):
        capture_time = calculate_capture_time(
            video_start_at=start_at,
            video_stop_at=stop_at,
            frame_index=idx,
            fps=fps,
            total_frames=total_frames,
            video_duration=video_duration
        )
        frame_timestamps.append(capture_time)

    # Fetch log_data for this video's time window if not explicitly provided
    logs = log_entries
    if logs is None and frame_timestamps:
        min_ts_ms = int(min(frame_timestamps) * 1000)
        max_ts_ms = int(max(frame_timestamps) * 1000)
        batch_id = payload.get("batch_id") if payload else None
        logs = await fetch_log_data_for_time_range(
            min_ts_ms=min_ts_ms,
            max_ts_ms=max_ts_ms,
            batch_id=batch_id,
            session=session
        )

    matched_logs_count = 0
    for fname, capture_time in zip(frame_filenames, frame_timestamps):
        frame_ts_ms = int(capture_time * 1000) if capture_time < 1e11 else int(capture_time)
        ypr = interpolate_ypr_from_logs(frame_ts_ms, logs) if logs else None

        if ypr:
            builder.add_override(
                image_name=fname,
                capture_time=capture_time,
                yaw=ypr.get("yaw"),
                pitch=ypr.get("pitch"),
                roll=ypr.get("roll"),
                ypr=ypr
            )
            matched_logs_count += 1
        else:
            builder.add_capture_time(fname, capture_time)

    logger.info(
        f"Registered {total_frames} frame timestamps for video '{os.path.basename(video_path)}' "
        f"({matched_logs_count} matched telemetry from log_data, Start: {start_at.isoformat()}, Stop: {stop_at.isoformat()})"
    )
