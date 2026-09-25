import os
import uuid
from typing import List

from fastapi import APIRouter, HTTPException, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text
from sqlalchemy.orm import selectinload

from app.core.database import get_db_session
from app.models.video import Video, UploadMetadata
from app.schemas.video import VideoResponse, UploadMetadataResponse, BatchIdResponse, BatchOverviewResponse

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
