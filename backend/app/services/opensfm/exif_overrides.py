import os
import json
import uuid
import logging
import asyncio
import numpy as np
from datetime import datetime, timezone, timedelta
from dataclasses import dataclass, field
from typing import Dict, Any, Optional, List, Tuple, Union
from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import async_session
from app.models.video import Video, UploadMetadata
from app.models.log_data import LogData

logger = logging.getLogger(__name__)

# Constants for WGS84 ellipsoid model matching OpenSfM geo calculations
WGS84_A: float = 6378137.0
WGS84_B: float = 6356752.314245


def ecef_from_lla(lat: float, lon: float, alt: float) -> Tuple[float, float, float]:
    """Computes ECEF coordinates (X, Y, Z) from latitude, longitude, and altitude under WGS84."""
    a2 = WGS84_A ** 2
    b2 = WGS84_B ** 2
    lat_rad = np.radians(lat)
    lon_rad = np.radians(lon)
    L = 1.0 / np.sqrt(a2 * np.cos(lat_rad) ** 2 + b2 * np.sin(lat_rad) ** 2)
    x = (a2 * L + alt) * np.cos(lat_rad) * np.cos(lon_rad)
    y = (a2 * L + alt) * np.cos(lat_rad) * np.sin(lon_rad)
    z = (b2 * L + alt) * np.sin(lat_rad)
    return float(x), float(y), float(z)


def ecef_from_topocentric_transform(lat: float, lon: float, alt: float) -> np.ndarray:
    """Transformation matrix from topocentric frame at reference position to ECEF."""
    x, y, z = ecef_from_lla(lat, lon, alt)
    sa = np.sin(np.radians(lat))
    ca = np.cos(np.radians(lat))
    so = np.sin(np.radians(lon))
    co = np.cos(np.radians(lon))
    return np.array([
        [-so, -sa * co, ca * co, x],
        [co, -sa * so, ca * so, y],
        [0.0, ca, sa, z],
        [0.0, 0.0, 0.0, 1.0],
    ])


def topocentric_from_lla(
    lat: float,
    lon: float,
    alt: float,
    reflat: float,
    reflon: float,
    refalt: float,
) -> Tuple[float, float, float]:
    """Transforms WGS84 LLA coordinates to local topocentric (East, North, Up) coordinates."""
    T = np.linalg.inv(ecef_from_topocentric_transform(reflat, reflon, refalt))
    x, y, z = ecef_from_lla(lat, lon, alt)
    tx = T[0, 0] * x + T[0, 1] * y + T[0, 2] * z + T[0, 3]
    ty = T[1, 0] * x + T[1, 1] * y + T[1, 2] * z + T[1, 3]
    tz = T[2, 0] * x + T[2, 1] * y + T[2, 2] * z + T[2, 3]
    return float(tx), float(ty), float(tz)


def opk_from_ypr(
    yaw: float,
    pitch: float,
    roll: float,
    lat: float = 0.0,
    lon: float = 0.0,
    alt: float = 0.0,
    apply_pitch_offset: bool = False,
) -> Dict[str, float]:
    """
    Converts Yaw, Pitch, Roll (in degrees) to Omega, Phi, Kappa (OPK in degrees)
    adhering strictly to OpenSfM's opk_from_ypr convention.
    """
    y, p, r = np.radians([yaw, pitch, roll])

    # YPR rotation matrix (body to navigation)
    cnb = np.array([
        [
            np.cos(y) * np.cos(p),
            np.cos(y) * np.sin(p) * np.sin(r) - np.sin(y) * np.cos(r),
            np.cos(y) * np.sin(p) * np.cos(r) + np.sin(y) * np.sin(r),
        ],
        [
            np.sin(y) * np.cos(p),
            np.sin(y) * np.sin(p) * np.sin(r) + np.cos(y) * np.cos(r),
            np.sin(y) * np.sin(p) * np.cos(r) - np.cos(y) * np.sin(r),
        ],
        [-np.sin(p), np.cos(p) * np.sin(r), np.cos(p) * np.cos(r)],
    ])

    if apply_pitch_offset:
        cnb = cnb.dot(np.array([[0.0, 0.0, 1.0], [0.0, 1.0, 0.0], [-1.0, 0.0, 0.0]]))

    # Conversion between image and body coordinates
    cbb = np.array([[0.0, 1.0, 0.0], [1.0, 0.0, 0.0], [0.0, 0.0, -1.0]])

    delta = 1e-10
    p1 = np.array(topocentric_from_lla(lat + delta, lon, alt, lat, lon, alt))
    p2 = np.array(topocentric_from_lla(lat - delta, lon, alt, lat, lon, alt))
    xnp = p1 - p2
    m = np.linalg.norm(xnp)
    if m == 0:
        xnp = np.array([0.0, 1.0, 0.0])
    else:
        xnp /= m

    znp = np.array([0.0, 0.0, -1.0]).T
    ynp = np.cross(znp, xnp)
    cen = np.array([xnp, ynp, znp]).T

    # OPK rotation matrix
    ceb = cen.dot(cnb).dot(cbb)

    return {
        "omega": round(float(np.degrees(np.arctan2(-ceb[1][2], ceb[2][2]))), 4),
        "phi": round(float(np.degrees(np.arcsin(ceb[0][2]))), 4),
        "kappa": round(float(np.degrees(np.arctan2(-ceb[0][1], ceb[0][0]))), 4),
    }


@dataclass
class ImageExifOverride:
    """
    Data model representing EXIF override parameters for an individual image.
    Supports capture_time, gps, orientation, camera, OPK camera orientation,
    and altitude / relative_altitude (used as guideline for real-world metric scale in OpenSfM).
    Telemetric yaw/pitch/roll angles are automatically converted into OPK priors,
    and unused telemetry fields (yaw, pitch, roll, ypr) are excluded from serialized output.
    """
    capture_time: Optional[float] = None
    gps: Optional[Dict[str, Any]] = None
    orientation: Optional[int] = None
    camera: Optional[str] = None
    opk: Optional[Dict[str, float]] = None
    altitude: Optional[float] = None
    relative_altitude: Optional[float] = None
    altitude_std: Optional[float] = None
    dop: Optional[float] = None
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
        if self.orientation is not None:
            data["orientation"] = self.orientation
        if self.camera is not None:
            data["camera"] = self.camera

        # Format relative altitude for OpenSfM orientation-based pair matching and scale
        rel_alt = self.relative_altitude
        if rel_alt is None and self.altitude is not None and self.altitude >= 0:
            rel_alt = self.altitude
        if rel_alt is not None and rel_alt >= 0:
            data["relative_altitude"] = round(float(rel_alt), 4)

        # Build GPS dictionary incorporating altitude / precision if available
        gps_dict: Dict[str, Any] = {}
        if self.gps is not None:
            gps_dict.update(self.gps)

        # Inject altitude into GPS dictionary if valid (>= 0) and not already present
        if self.altitude is not None and self.altitude >= 0 and "altitude" not in gps_dict:
            gps_dict["altitude"] = round(float(self.altitude), 4)
        if self.altitude_std is not None and "altitude_std" not in gps_dict:
            gps_dict["altitude_std"] = round(float(self.altitude_std), 4)
        if self.dop is not None and "dop" not in gps_dict:
            gps_dict["dop"] = round(float(self.dop), 4)

        # Only include "gps" if full GPS coordinates (latitude and longitude) are available
        if "latitude" in gps_dict and "longitude" in gps_dict:
            data["gps"] = gps_dict

        # Format camera orientation into OPK (omega, phi, kappa)
        if self.opk is not None:
            data["opk"] = self.opk
        else:
            y = self.yaw
            p = self.pitch
            r = self.roll
            if self.ypr is not None:
                if y is None:
                    y = self.ypr.get("yaw")
                if p is None:
                    p = self.ypr.get("pitch")
                if r is None:
                    r = self.ypr.get("roll")

            if y is not None and p is not None and r is not None:
                lat = 0.0
                lon = 0.0
                alt = 0.0
                if "gps" in data:
                    lat = float(data["gps"].get("latitude", 0.0))
                    lon = float(data["gps"].get("longitude", 0.0))
                    alt = float(data["gps"].get("altitude", 0.0))
                elif self.altitude is not None and self.altitude >= 0:
                    alt = float(self.altitude)
                elif self.relative_altitude is not None and self.relative_altitude >= 0:
                    alt = float(self.relative_altitude)

                opk_val = opk_from_ypr(float(y), float(p), float(r), lat=lat, lon=lon, alt=alt)
                if opk_val:
                    data["opk"] = opk_val

        # Preserve valid extra fields, but ensure unused orientation/raw telemetry keys are never saved
        if self.extra:
            filtered_extra = {
                k: v for k, v in self.extra.items()
                if k not in (
                    "yaw", "pitch", "roll", "ypr", "altitude", "relative_altitude",
                    "altitude_std", "dop", "depth", "distance", "temperature"
                )
            }
            data.update(filtered_extra)
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
        opk: Optional[Dict[str, float]] = None,
        altitude: Optional[float] = None,
        relative_altitude: Optional[float] = None,
        altitude_std: Optional[float] = None,
        dop: Optional[float] = None,
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
            if opk is not None:
                entry.opk = opk
            if altitude is not None:
                entry.altitude = altitude
            if relative_altitude is not None:
                entry.relative_altitude = relative_altitude
            if altitude_std is not None:
                entry.altitude_std = altitude_std
            if dop is not None:
                entry.dop = dop
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
                opk=opk,
                altitude=altitude,
                relative_altitude=relative_altitude,
                altitude_std=altitude_std,
                dop=dop,
                yaw=yaw,
                pitch=pitch,
                roll=roll,
                ypr=ypr,
                extra=extra
            )
            self._overrides[image_name] = entry
        return entry

    def add_altitude(
        self,
        image_name: str,
        altitude: float,
        relative_altitude: Optional[float] = None,
        altitude_std: Optional[float] = None,
        dop: Optional[float] = None,
    ) -> ImageExifOverride:
        """Convenience method to register altitude telemetry as scale guideline."""
        return self.add_override(
            image_name,
            altitude=altitude,
            relative_altitude=relative_altitude,
            altitude_std=altitude_std,
            dop=dop
        )

    def add_opk(
        self,
        image_name: str,
        omega: float,
        phi: float,
        kappa: float,
        accuracy: Optional[float] = None
    ) -> ImageExifOverride:
        """Convenience method to register OPK camera orientation prior for an image."""
        opk_dict: Dict[str, float] = {
            "omega": float(omega),
            "phi": float(phi),
            "kappa": float(kappa),
        }
        if accuracy is not None:
            opk_dict["accuracy"] = float(accuracy)
        return self.add_override(image_name, opk=opk_dict)

    def add_ypr(
        self,
        image_name: str,
        yaw: float,
        pitch: float,
        roll: float
    ) -> ImageExifOverride:
        """Convenience method to register yaw, pitch, and roll telemetry, converted to OPK."""
        return self.add_override(
            image_name,
            yaw=yaw,
            pitch=pitch,
            roll=roll,
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

    Raises:
    - RuntimeError: If timestamps cannot be resolved from any of the above sources.
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
            conditions = [
                UploadMetadata.safe_filename == basename,
                UploadMetadata.orig_filename == basename,
                UploadMetadata.safe_filename == stem,
                UploadMetadata.orig_filename == stem,
            ]

            # Check if stem is a valid UUID
            try:
                file_uuid = uuid.UUID(stem)
                conditions.append(UploadMetadata.id == file_uuid)
            except ValueError:
                pass

            # Also check payload file_id if present and matches this video
            payload_file_id = payload.get("file_id")
            payload_safe_filename = payload.get("safe_filename")
            payload_orig_filename = payload.get("filename")
            if payload_file_id and (
                (payload_safe_filename and payload_safe_filename == basename)
                or (payload_orig_filename and payload_orig_filename == basename)
                or (not payload_safe_filename and not payload_orig_filename)
            ):
                try:
                    p_uuid = uuid.UUID(str(payload_file_id))
                    conditions.append(UploadMetadata.id == p_uuid)
                except ValueError:
                    pass

            stmt = (
                select(Video)
                .join(UploadMetadata, Video.upload_metadata_id == UploadMetadata.id)
                .where(or_(*conditions))
            )

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

    # No valid recording timestamps could be resolved - raise an error instead of a silent fallback
    err_msg = (
        f"Failed to resolve recording timestamps (video_start_at / video_stop_at) for video '{video_path}'. "
        f"No valid timestamps found in payload, database (matching '{basename}'), or video container creation_time."
    )
    logger.error(err_msg)
    raise RuntimeError(err_msg)


def lerp_value(v1: float, v2: float, alpha: float) -> float:
    """Linear interpolation between two float values."""
    return (1.0 - alpha) * v1 + alpha * v2


def lerp_angle(a1: float, a2: float, alpha: float) -> float:
    """Linear interpolation between two angles in degrees [0, 360) along the shortest path."""
    diff = (a2 - a1) % 360.0
    if diff > 180.0:
        diff -= 360.0
    return (a1 + alpha * diff) % 360.0


def interpolate_scalar(
    v1: Optional[float],
    v2: Optional[float],
    alpha: float,
    min_val: Optional[float] = None,
    max_val: Optional[float] = None
) -> Optional[float]:
    """
    Interpolates between two optional scalar values taking validity bounds into account.
    If both values are within [min_val, max_val], returns their linear interpolation (lerp).
    If only one value is valid, returns that valid value if alpha is closer to its timestamp (alpha < 0.5 for v1, alpha >= 0.5 for v2).
    If neither is valid, returns None.
    """
    def _is_valid(v: Optional[float]) -> bool:
        if v is None:
            return False
        if min_val is not None and v < min_val:
            return False
        if max_val is not None and v > max_val:
            return False
        return True

    val1_valid = _is_valid(v1)
    val2_valid = _is_valid(v2)

    if val1_valid and val2_valid:
        return lerp_value(float(v1), float(v2), alpha)
    elif val1_valid and alpha < 0.5:
        return float(v1)
    elif val2_valid and alpha >= 0.5:
        return float(v2)
    return None


def interpolate_telemetry_from_logs(
    target_timestamp_ms: int,
    log_entries: List[Tuple[int, Dict[str, Any]]],
    max_time_diff_ms: int = 1000
) -> Optional[Dict[str, float]]:
    """
    Finds the 2 nearest timestamps in log_data that are within max_time_diff_ms (default 1000 ms) of
    target_timestamp_ms, and computes the linear interpolation (lerp) of telemetry parameters:
    - yaw (angular lerp along shortest path)
    - pitch, roll (linear lerp)
    - altitude (distance above seabed in meters, only valid when >= 0; negative values like -1 indicate out-of-range sonar ping and are filtered out)
    - depth (depth below water surface in meters)
    - distance (forward/sonar obstacle distance in meters, only valid when >= 0)
    - temperature (degrees Celsius)

    If only 1 entry is within max_time_diff_ms, uses that entry's valid values.
    If no entries are within max_time_diff_ms, returns None.
    """
    if not log_entries:
        return None

    # 1. Filter log_data entries within time window
    within_window = [
        (ts, payload)
        for ts, payload in log_entries
        if abs(ts - target_timestamp_ms) <= max_time_diff_ms
    ]

    if not within_window:
        return None

    # 2. Find the 2 nearest timestamps to target_timestamp_ms
    within_window.sort(key=lambda item: abs(item[0] - target_timestamp_ms))
    nearest = within_window[:2]

    def _safe_float(val: Any) -> Optional[float]:
        if val is None:
            return None
        try:
            return float(val)
        except (ValueError, TypeError):
            return None

    if len(nearest) == 1:
        p = nearest[0][1]
        res: Dict[str, float] = {}
        for key in ("yaw", "pitch", "roll", "temperature", "depth"):
            v = _safe_float(p.get(key))
            if v is not None:
                res[key] = round(v, 4)
        for key in ("altitude", "distance"):
            v = _safe_float(p.get(key))
            if v is not None and v >= 0:
                res[key] = round(v, 4)
        return res if res else None

    # 3. Sort the 2 nearest chronologically: t1 <= t2
    nearest.sort(key=lambda item: item[0])
    (t1, p1), (t2, p2) = nearest[0], nearest[1]

    if t2 == t1:
        alpha = 0.0
    else:
        alpha = (target_timestamp_ms - t1) / (t2 - t1)
        alpha = min(max(alpha, 0.0), 1.0)

    res: Dict[str, float] = {}

    # Lerp yaw (angular)
    y1 = _safe_float(p1.get("yaw"))
    y2 = _safe_float(p2.get("yaw"))
    if y1 is not None and y2 is not None:
        res["yaw"] = round(lerp_angle(y1, y2, alpha), 4)
    elif y1 is not None:
        res["yaw"] = round(y1, 4)
    elif y2 is not None:
        res["yaw"] = round(y2, 4)

    # Lerp pitch and roll
    for key in ("pitch", "roll"):
        v1 = _safe_float(p1.get(key))
        v2 = _safe_float(p2.get(key))
        val = interpolate_scalar(v1, v2, alpha)
        if val is not None:
            res[key] = round(val, 4)

    # Lerp altitude (valid >= 0, filtering out negative values such as -1)
    alt1 = _safe_float(p1.get("altitude"))
    alt2 = _safe_float(p2.get("altitude"))
    alt_val = interpolate_scalar(alt1, alt2, alpha, min_val=0.0)
    if alt_val is not None:
        res["altitude"] = round(alt_val, 4)

    # Lerp depth
    depth1 = _safe_float(p1.get("depth"))
    depth2 = _safe_float(p2.get("depth"))
    depth_val = interpolate_scalar(depth1, depth2, alpha)
    if depth_val is not None:
        res["depth"] = round(depth_val, 4)

    # Lerp distance (valid >= 0)
    dist1 = _safe_float(p1.get("distance"))
    dist2 = _safe_float(p2.get("distance"))
    dist_val = interpolate_scalar(dist1, dist2, alpha, min_val=0.0)
    if dist_val is not None:
        res["distance"] = round(dist_val, 4)

    # Lerp temperature
    temp1 = _safe_float(p1.get("temperature"))
    temp2 = _safe_float(p2.get("temperature"))
    temp_val = interpolate_scalar(temp1, temp2, alpha)
    if temp_val is not None:
        res["temperature"] = round(temp_val, 4)

    return res if res else None


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
    telemetry = interpolate_telemetry_from_logs(target_timestamp_ms, log_entries)
    if not telemetry:
        return None
    res: Dict[str, float] = {}
    for k in ("yaw", "pitch", "roll"):
        if k in telemetry:
            res[k] = telemetry[k]
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
    log_entries: Optional[List[Tuple[int, Dict[str, Any]]]] = None,
    default_altitude_std: Optional[float] = None
) -> None:
    """
    Computes exact capture_time for all frame filenames belonging to a video segment,
    interpolates orientation (yaw, pitch, roll) and scale guideline (altitude) from log_data (within 1 second),
    and records them into the ExifOverridesBuilder for OpenSfM reconstruction.
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

    matched_orientation_count = 0
    matched_altitude_count = 0

    base_gps = payload.get("gps") if payload and isinstance(payload.get("gps"), dict) else {}
    payload_lat = payload.get("latitude") if payload else None
    payload_lon = payload.get("longitude") if payload else None
    payload_alt_std = payload.get("altitude_std", default_altitude_std) if payload else default_altitude_std

    for fname, capture_time in zip(frame_filenames, frame_timestamps):
        frame_ts_ms = int(capture_time * 1000) if capture_time < 1e11 else int(capture_time)
        telemetry = interpolate_telemetry_from_logs(frame_ts_ms, logs) if logs else None

        if telemetry:
            yaw = telemetry.get("yaw")
            pitch = telemetry.get("pitch")
            roll = telemetry.get("roll")
            alt = telemetry.get("altitude")

            frame_gps = dict(base_gps)
            if payload_lat is not None and "latitude" not in frame_gps:
                frame_gps["latitude"] = float(payload_lat)
            if payload_lon is not None and "longitude" not in frame_gps:
                frame_gps["longitude"] = float(payload_lon)

            builder.add_override(
                image_name=fname,
                capture_time=capture_time,
                gps=frame_gps if frame_gps else None,
                yaw=yaw,
                pitch=pitch,
                roll=roll,
                altitude=alt,
                relative_altitude=alt,
                altitude_std=payload_alt_std,
            )
            if yaw is not None and pitch is not None and roll is not None:
                matched_orientation_count += 1
            if alt is not None and alt >= 0:
                matched_altitude_count += 1
        else:
            builder.add_capture_time(fname, capture_time)

    logger.info(
        f"Registered {total_frames} frame timestamps for video '{os.path.basename(video_path)}' "
        f"({matched_orientation_count} matched orientation OPK, {matched_altitude_count} matched scale altitude from log_data, "
        f"Start: {start_at.isoformat()}, Stop: {stop_at.isoformat()})"
    )
