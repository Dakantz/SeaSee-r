import os
import uuid
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import FileResponse
from fastapi import APIRouter, HTTPException, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.database import get_db_session
from app.models.video import Video, UploadMetadata
from app.models.pointcloud import PointCloudMetadata
from app.schemas.video import VideoResponse, UploadMetadataResponse
from app.schemas.video import VideoResponse, UploadMetadataResponse, BatchIdResponse, BatchOverviewResponse

router = APIRouter(
    prefix="/videos",
    tags=["Videos"]
)

def _enrich_video_response(video: Video) -> VideoResponse:
    """Helper to populate stream_url and download_url on VideoResponse."""
    resp = VideoResponse.model_validate(video)
    resp.stream_url = f"/videos/{video.id}/stream"
    resp.download_url = f"/videos/{video.id}/file"
    return resp

def _find_video_file_path(video: Video) -> str:
    """Helper to locate the video file on disk."""
    filename = ""
    if video.upload_metadata:
        filename = video.upload_metadata.safe_filename or video.upload_metadata.orig_filename or ""

    candidates = [
        os.path.join(settings.video_dir, filename) if filename else "",
        os.path.join(settings.video_dir, f"{video.id}.MP4"),
        os.path.join(settings.video_dir, f"{video.id}.mp4"),
    ]
    for c in candidates:
        if c and os.path.exists(c):
            return c
    raise HTTPException(status_code=404, detail=f"Video file not found on server disk for video {video.id}")

# ==========================================
# BATCH ENDPOINTS
# ==========================================

@router.post("/batch-id", response_model=BatchIdResponse)
async def generate_batch_id():
    """
    Generate a new batch UUID for grouping files during tusd upload.
    """
    new_id = uuid.uuid4()
    return BatchIdResponse(batch_id=new_id, batchId=new_id)


@router.get("/batch-id", response_model=BatchIdResponse)
async def get_batch_id():
    """
    Get a newly generated batch UUID for grouping files during tusd upload.
    """
    new_id = uuid.uuid4()
    return BatchIdResponse(batch_id=new_id, batchId=new_id)


@router.get("/batches", response_model=List[BatchOverviewResponse])
@router.get("/batches/overview", response_model=List[BatchOverviewResponse])
async def get_batch_overviews(
    processed_only: bool = Query(True, description="Filter for batches with at least one reconstructed point cloud"),
    limit: int = Query(200, ge=1, le=1000, description="Maximum number of batches to return"),
    db: AsyncSession = Depends(get_db_session)
):
    """
    Get an overview of processed upload batches, including:
    - First video filename
    - Number of videos
    - Total video length
    - Number of reconstructed point clouds
    - Total points count
    """
    sql = text("""
        WITH batch_ids AS (
            SELECT DISTINCT batch_id FROM pointcloud_metadata WHERE batch_id IS NOT NULL
            UNION
            SELECT DISTINCT batch_id FROM upload_metadata WHERE batch_id IS NOT NULL
        ),
        batch_videos AS (
            SELECT 
                um.batch_id,
                um.orig_filename,
                um.created_at,
                vm.id as video_id,
                COALESCE(EXTRACT(EPOCH FROM (vm.video_stop_at - vm.video_start_at)), 0) as duration,
                ROW_NUMBER() OVER (
                    PARTITION BY um.batch_id 
                    ORDER BY 
                        CASE WHEN um.content_type LIKE 'video/%' THEN 0 ELSE 1 END,
                        um.created_at ASC, 
                        um.id ASC
                ) as rn
            FROM upload_metadata um
            LEFT JOIN video_metadata vm ON vm.upload_metadata_id = um.id
            WHERE um.batch_id IS NOT NULL AND (um.content_type LIKE 'video/%' OR vm.id IS NOT NULL)
        ),
        batch_video_stats AS (
            SELECT 
                batch_id,
                MAX(CASE WHEN rn = 1 THEN orig_filename END) as first_video_filename,
                COUNT(DISTINCT video_id) as video_count,
                COUNT(DISTINCT orig_filename) as upload_video_count,
                SUM(GREATEST(duration, 0)) as total_video_length
            FROM batch_videos
            GROUP BY batch_id
        ),
        batch_pc_stats AS (
            SELECT 
                batch_id,
                COUNT(*) as pointcloud_count,
                SUM(COALESCE(number_of_points, 0)) as total_points,
                MIN(created_at) as first_pc_created_at
            FROM pointcloud_metadata
            WHERE batch_id IS NOT NULL
            GROUP BY batch_id
        ),
        batch_earliest_upload AS (
            SELECT 
                batch_id,
                MIN(created_at) as first_upload_created_at
            FROM upload_metadata
            WHERE batch_id IS NOT NULL
            GROUP BY batch_id
        )
        SELECT 
            b.batch_id,
            COALESCE(v.first_video_filename, (SELECT orig_filename FROM pointcloud_metadata WHERE batch_id = b.batch_id LIMIT 1)) as first_video_filename,
            COALESCE(GREATEST(v.video_count, v.upload_video_count), 0) as video_count,
            COALESCE(v.total_video_length, 0.0) as total_video_length,
            COALESCE(p.pointcloud_count, 0) as pointcloud_count,
            COALESCE(p.total_points, 0) as total_points,
            COALESCE(u.first_upload_created_at, p.first_pc_created_at) as created_at
        FROM batch_ids b
        LEFT JOIN batch_video_stats v ON b.batch_id = v.batch_id
        LEFT JOIN batch_pc_stats p ON b.batch_id = p.batch_id
        LEFT JOIN batch_earliest_upload u ON b.batch_id = u.batch_id
        WHERE (:processed_only = FALSE OR COALESCE(p.pointcloud_count, 0) > 0)
        ORDER BY COALESCE(u.first_upload_created_at, p.first_pc_created_at) DESC NULLS LAST, p.pointcloud_count DESC
        LIMIT :limit;
    """)
    res = await db.execute(sql, {"processed_only": processed_only, "limit": limit})
    rows = res.fetchall()

    return [
        BatchOverviewResponse(
            batch_id=row.batch_id,
            first_video_filename=row.first_video_filename,
            video_count=int(row.video_count or 0),
            total_video_length=float(row.total_video_length or 0.0),
            pointcloud_count=int(row.pointcloud_count or 0),
            total_points=int(row.total_points or 0),
            created_at=row.created_at
        )
        for row in rows
    ]


# ==========================================
# GET ENDPOINTS
# ==========================================

@router.get("", response_model=List[VideoResponse])
async def get_videos(
    skip: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(get_db_session)
):
    """
    Get a list of all videos with streaming and download links.
    """
    stmt = select(Video).options(selectinload(Video.upload_metadata)).offset(skip).limit(limit)
    result = await db.execute(stmt)
    videos = result.scalars().all()
    return [_enrich_video_response(v) for v in videos]


@router.get("/by-pointcloud/{identifier}", response_model=VideoResponse)
async def get_video_by_pointcloud(
    identifier: str,
    db: AsyncSession = Depends(get_db_session)
):
    """
    Get the associated video record for a given point cloud dataset.
    """
    pc_uuid = None
    try:
        pc_uuid = uuid.UUID(identifier)
    except ValueError:
        pass

    stmt = select(PointCloudMetadata).options(selectinload(PointCloudMetadata.video_metadata).selectinload(Video.upload_metadata))
    if pc_uuid:
        stmt = stmt.where(PointCloudMetadata.id == pc_uuid)
    else:
        stmt = stmt.where(
            (PointCloudMetadata.orig_filename == identifier) |
            (PointCloudMetadata.safe_filename == identifier)
        )

    result = await db.execute(stmt)
    pc = result.scalar_one_or_none()
    if not pc or not pc.video_metadata:
        # Fallback: check if single video exists
        fallback = await db.execute(select(Video).options(selectinload(Video.upload_metadata)).limit(1))
        vid = fallback.scalar_one_or_none()
        if vid:
            return _enrich_video_response(vid)
        raise HTTPException(status_code=404, detail="No video found for this point cloud")

    return _enrich_video_response(pc.video_metadata)


@router.get("/{video_id}", response_model=VideoResponse)
async def get_video(
    video_id: uuid.UUID,
    db: AsyncSession = Depends(get_db_session)
):
    """
    Get information and streaming links about a specific video by ID.
    """
    stmt = select(Video).options(selectinload(Video.upload_metadata)).where(Video.id == video_id)
    result = await db.execute(stmt)
    video = result.scalar_one_or_none()

    if not video:
        raise HTTPException(status_code=404, detail="Video not found")

    return _enrich_video_response(video)


@router.get("/{video_id}/stream")
async def stream_video(
    video_id: uuid.UUID,
    db: AsyncSession = Depends(get_db_session)
):
    """
    Stream video file directly for browser HTML5 video playback (supports HTTP 206 partial content range requests).
    """
    stmt = select(Video).options(selectinload(Video.upload_metadata)).where(Video.id == video_id)
    result = await db.execute(stmt)
    video = result.scalar_one_or_none()

    if not video:
        raise HTTPException(status_code=404, detail="Video not found")

    file_path = _find_video_file_path(video)
    filename = (video.upload_metadata.orig_filename if video.upload_metadata else None) or os.path.basename(file_path)

    return FileResponse(
        path=file_path,
        media_type="video/mp4",
        filename=filename,
        content_disposition_type="inline"
    )


@router.get("/{video_id}/file")
async def download_video_file(
    video_id: uuid.UUID,
    db: AsyncSession = Depends(get_db_session)
):
    """
    Download raw video file as an attachment.
    """
    stmt = select(Video).options(selectinload(Video.upload_metadata)).where(Video.id == video_id)
    result = await db.execute(stmt)
    video = result.scalar_one_or_none()
    
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")

    file_path = _find_video_file_path(video)
    filename = (video.upload_metadata.orig_filename if video.upload_metadata else None) or os.path.basename(file_path)

    return FileResponse(
        path=file_path,
        media_type="video/mp4",
        filename=filename,
        content_disposition_type="attachment"
    )


@router.get("/metadata/{metadata_id}", response_model=UploadMetadataResponse)
async def get_upload_metadata(
    metadata_id: uuid.UUID,
    db: AsyncSession = Depends(get_db_session)
):
    """
    Get information about a specific upload metadata record by ID.
    """
    stmt = select(UploadMetadata).where(UploadMetadata.id == metadata_id)
    result = await db.execute(stmt)
    metadata = result.scalar_one_or_none()
    
    if not metadata:
        raise HTTPException(status_code=404, detail="Metadata not found")
        
    return metadata

