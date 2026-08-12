import re
import uuid
from typing import Dict, Any, Optional, List
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from geoalchemy2 import WKTElement
from app.core.config import settings
from app.models.pointcloud import PointCloudMetadata
from app.models.job import Job

async def query_existing_pcid(session: AsyncSession, file_id: str) -> Optional[int]:
    """Queries pointcloud_patches and pointcloud_metadata to find an existing PCID for append operations."""
    pcid = None
    file_uuid = uuid.UUID(file_id)
    try:
        res = await session.execute(
            text("SELECT PC_PCId(patch) FROM pointcloud_patches WHERE pointcloud_id = :id AND lod = 0 LIMIT 1"),
            {"id": file_uuid}
        )
        row = res.first()
        if row and row[0] is not None:
            pcid = int(row[0])
    except Exception as e:
        print(f"Failed to query existing pcid from pointcloud_patches: {e}")

    if pcid is None:
        try:
            stmt = select(PointCloudMetadata).where(PointCloudMetadata.id == file_uuid)
            res = await session.execute(stmt)
            rec = res.scalar_one_or_none()
            if rec and rec.pcid:
                pcid = rec.pcid
        except Exception as e:
            print(f"Failed to query existing metadata for pcid: {e}")

    return pcid


async def query_target_dimensions_for_pcid(session: AsyncSession, pcid: Optional[int]) -> Optional[List[str]]:
    """Queries pointcloud_formats table for schema dimensions matching the PCID."""
    if not pcid:
        return None
    try:
        res = await session.execute(
            text("SELECT schema FROM pointcloud_formats WHERE pcid = :pcid"),
            {"pcid": pcid}
        )
        row = res.first()
        if row and row[0]:
            return re.findall(r"<pc:name>(.*?)</pc:name>", row[0])
    except Exception as e:
        print(f"Failed to query pcid schema: {e}")
    return None


def _compute_center_wkt(
    min_x: Optional[float], max_x: Optional[float],
    min_y: Optional[float], max_y: Optional[float],
    min_z: Optional[float], max_z: Optional[float]
) -> Optional[WKTElement]:
    if None not in (min_x, max_x, min_y, max_y):
        cx = (min_x + max_x) / 2.0
        cy = (min_y + max_y) / 2.0
        cz = (min_z + max_z) / 2.0 if (min_z is not None and max_z is not None) else 0.0
        return WKTElement(f"POINT Z ({cx} {cy} {cz})", srid=settings.backend_srid)
    return None


async def upsert_pointcloud_metadata(
    session: AsyncSession,
    file_id: str,
    file_path: str,
    bbox: Dict[str, Any],
    number_of_points: int,
    pcid: int,
    job_id: Optional[str] = None,
    is_append: bool = False,
    override_filename: Optional[str] = None,
    override_safe_filename: Optional[str] = None
) -> PointCloudMetadata:
    """
    Inserts a new PointCloudMetadata record or updates an existing record for append ops,
    merging bounding box bounds, updating center point geometry, and accumulating point counts.
    """
    import os
    target_uuid = uuid.UUID(file_id)
    orig_filename = override_filename or os.path.basename(file_path)
    safe_filename = override_safe_filename or os.path.basename(file_path)

    if job_id and (not override_filename or not override_safe_filename):
        try:
            stmt_job = select(Job).where(Job.id == job_id)
            res_job = await session.execute(stmt_job)
            job_record = res_job.scalar_one_or_none()
            if job_record and isinstance(job_record.payload, dict):
                orig_filename = override_filename or job_record.payload.get("filename", orig_filename)
                safe_filename = override_safe_filename or job_record.payload.get("safe_filename", safe_filename)
        except Exception as e:
            print(f"Failed to fetch job payload for metadata filenames: {e}")

    stmt_existing = select(PointCloudMetadata).where(PointCloudMetadata.id == target_uuid)
    res_existing = await session.execute(stmt_existing)
    existing_record = res_existing.scalar_one_or_none()

    if is_append and existing_record:
        existing_record.number_of_points = (existing_record.number_of_points or 0) + number_of_points
        if bbox.get("min_x") is not None:
            existing_record.min_x = min(existing_record.min_x, bbox["min_x"]) if existing_record.min_x is not None else bbox["min_x"]
        if bbox.get("max_x") is not None:
            existing_record.max_x = max(existing_record.max_x, bbox["max_x"]) if existing_record.max_x is not None else bbox["max_x"]
        if bbox.get("min_y") is not None:
            existing_record.min_y = min(existing_record.min_y, bbox["min_y"]) if existing_record.min_y is not None else bbox["min_y"]
        if bbox.get("max_y") is not None:
            existing_record.max_y = max(existing_record.max_y, bbox["max_y"]) if existing_record.max_y is not None else bbox["max_y"]
        if bbox.get("min_z") is not None:
            existing_record.min_z = min(existing_record.min_z, bbox["min_z"]) if existing_record.min_z is not None else bbox["min_z"]
        if bbox.get("max_z") is not None:
            existing_record.max_z = max(existing_record.max_z, bbox["max_z"]) if existing_record.max_z is not None else bbox["max_z"]

        existing_record.center = _compute_center_wkt(
            existing_record.min_x, existing_record.max_x,
            existing_record.min_y, existing_record.max_y,
            existing_record.min_z, existing_record.max_z
        )
        await session.commit()
        return existing_record

    min_x = bbox.get("min_x")
    min_y = bbox.get("min_y")
    min_z = bbox.get("min_z")
    max_x = bbox.get("max_x")
    max_y = bbox.get("max_y")
    max_z = bbox.get("max_z")
    center_wkt = _compute_center_wkt(min_x, max_x, min_y, max_y, min_z, max_z)

    if existing_record:
        existing_record.job_id = uuid.UUID(job_id) if job_id else None
        existing_record.orig_filename = orig_filename
        existing_record.safe_filename = safe_filename
        existing_record.number_of_points = number_of_points
        existing_record.min_x = min_x
        existing_record.min_y = min_y
        existing_record.min_z = min_z
        existing_record.max_x = max_x
        existing_record.max_y = max_y
        existing_record.max_z = max_z
        existing_record.center = center_wkt
        existing_record.pcid = pcid
        await session.commit()
        return existing_record

    metadata_record = PointCloudMetadata(
        id=target_uuid,
        job_id=uuid.UUID(job_id) if job_id else None,
        orig_filename=orig_filename,
        safe_filename=safe_filename,
        number_of_points=number_of_points,
        min_x=min_x,
        min_y=min_y,
        min_z=min_z,
        max_x=max_x,
        max_y=max_y,
        max_z=max_z,
        center=center_wkt,
        pcid=pcid
    )
    session.add(metadata_record)
    await session.commit()
    return metadata_record

