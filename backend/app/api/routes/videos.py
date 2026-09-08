import os
import uuid
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.database import get_db_session
from app.models.video import Video, UploadMetadata
from app.models.pointcloud import PointCloudMetadata
from app.schemas.video import VideoResponse, UploadMetadataResponse

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

