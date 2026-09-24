import os
import uuid
from typing import List

from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.database import get_db_session
from app.models.video import Video, UploadMetadata
from app.schemas.video import VideoResponse, UploadMetadataResponse, BatchIdResponse

router = APIRouter(
    prefix="/videos",
    tags=["Videos"]
)

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
    Get a list of all videos.
    """
    stmt = select(Video).options(selectinload(Video.upload_metadata)).offset(skip).limit(limit)
    result = await db.execute(stmt)
    videos = result.scalars().all()
    return videos


@router.get("/{video_id}", response_model=VideoResponse)
async def get_video(
    video_id: uuid.UUID,
    db: AsyncSession = Depends(get_db_session)
):
    """
    Get information about a specific video by ID.
    """
    stmt = select(Video).options(selectinload(Video.upload_metadata)).where(Video.id == video_id)
    result = await db.execute(stmt)
    video = result.scalar_one_or_none()
    
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
        
    return video


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
