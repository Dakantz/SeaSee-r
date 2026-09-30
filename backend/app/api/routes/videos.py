import os
import uuid
from typing import List, Optional, Set, Union
import time

from fastapi import APIRouter, HTTPException, Depends, Query
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.database import get_db_session
from app.models.video import Video, UploadMetadata
from app.models.pointcloud import PointCloudMetadata
from app.models.job import JobStatus
from app.models.log_data import LogData
from app.schemas.video import VideoResponse, UploadMetadataResponse, BatchOverviewResponse, StartBatchPipelineRequest
from app.schemas.job import PipelineResponse, PipelineCreate, PipelineJobCreate
from app.schemas.log_data import LogDataResponse
from app.services.worker.pipeline_service import build_pipeline_and_jobs
from app.api.routes.jobs import _enqueue_job_to_redis, _are_dependencies_satisfied, _get_pipeline_or_404
from app.api.routes.logs import parse_timestamp_to_ms

router = APIRouter(
    prefix="/videos",
    tags=["Videos"]
)

def _enrich_video_response(video: Video) -> VideoResponse:
    """Helper to populate stream_url, download_url, and duration on VideoResponse."""
    resp = VideoResponse.model_validate(video)
    resp.stream_url = f"/videos/{video.id}/stream"
    resp.download_url = f"/videos/{video.id}/file"
    if video.video_stop_at and video.video_start_at and video.video_stop_at > video.video_start_at:
        resp.duration = round((video.video_stop_at - video.video_start_at).total_seconds(), 3)
    else:
        try:
            file_path = _find_video_file_path(video)
            if file_path and os.path.exists(file_path):
                import cv2
                cap = cv2.VideoCapture(file_path)
                fps = cap.get(cv2.CAP_PROP_FPS)
                frame_count = cap.get(cv2.CAP_PROP_FRAME_COUNT)
                cap.release()
                if fps > 0 and frame_count > 0:
                    resp.duration = round(float(frame_count / fps), 3)
        except Exception:
            pass
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
# BATCH OVERVIEW ENDPOINTS
# ==========================================


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
    - Log data counts and filenames
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
                SUM(GREATEST(duration, 0)) as total_video_length,
                ARRAY_AGG(DISTINCT orig_filename) FILTER (WHERE orig_filename IS NOT NULL) as video_filenames
            FROM batch_videos
            GROUP BY batch_id
        ),
        batch_logs AS (
            SELECT 
                batch_id,
                orig_filename
            FROM upload_metadata
            WHERE batch_id IS NOT NULL AND (content_type LIKE '%json%' OR orig_filename LIKE '%.json')
        ),
        batch_log_stats AS (
            SELECT
                batch_id,
                COUNT(DISTINCT orig_filename) as log_count,
                ARRAY_AGG(DISTINCT orig_filename) FILTER (WHERE orig_filename IS NOT NULL) as log_filenames
            FROM batch_logs
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
            COALESCE(u.first_upload_created_at, p.first_pc_created_at) as created_at,
            COALESCE(l.log_count, 0) as log_count,
            COALESCE(v.video_filenames, ARRAY[]::varchar[]) as video_filenames,
            COALESCE(l.log_filenames, ARRAY[]::varchar[]) as log_filenames
        FROM batch_ids b
        LEFT JOIN batch_video_stats v ON b.batch_id = v.batch_id
        LEFT JOIN batch_log_stats l ON b.batch_id = l.batch_id
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
            created_at=row.created_at,
            log_count=int(getattr(row, "log_count", 0) or 0),
            video_filenames=list(getattr(row, "video_filenames", []) or []),
            log_filenames=list(getattr(row, "log_filenames", []) or []),
        )
        for row in rows
    ]


@router.post("/batches/{batch_id}/pipeline", response_model=List[PipelineResponse])
async def start_batch_pipeline(
    batch_id: uuid.UUID,
    req: StartBatchPipelineRequest = StartBatchPipelineRequest(),
    db: AsyncSession = Depends(get_db_session)
):
    """
    Start an OpenSfM reconstruction pipeline for an already uploaded batch.
    Works for any batch, even if previous pipelines have already been run.
    """
    stmt = (
        select(UploadMetadata)
        .options(selectinload(UploadMetadata.videos))
        .where(UploadMetadata.batch_id == batch_id)
        .order_by(UploadMetadata.created_at.asc(), UploadMetadata.orig_filename.asc())
    )
    res = await db.execute(stmt)
    records = list(res.scalars().all())
    if not records:
        raise HTTPException(status_code=404, detail=f"No uploads found for batch {batch_id}")

    video_records = [
        r for r in records 
        if (r.content_type and r.content_type.startswith("video/")) 
        or (r.orig_filename and r.orig_filename.lower().endswith((".mp4", ".mov", ".avi", ".mkv")))
        or (r.videos and len(r.videos) > 0)
    ]
    if not video_records:
        raise HTTPException(status_code=400, detail=f"Batch {batch_id} does not contain any video files.")

    def get_sort_key(u: UploadMetadata):
        if u.videos and u.videos[0].video_start_at:
            return (0, u.videos[0].video_start_at)
        return (1, u.created_at)

    video_records.sort(key=get_sort_key)

    video_safe_filenames = [
        r.safe_filename or (f"{r.id}.mp4" if not r.orig_filename else f"{r.id}{os.path.splitext(r.orig_filename)[1]}")
        for r in video_records
    ]
    primary_file = video_records[0]
    primary_file_id = str(primary_file.id)
    primary_safe_filename = primary_file.safe_filename or video_safe_filenames[0]
    primary_orig_filename = primary_file.orig_filename

    if len(video_records) == 1:
        file_names_summary = primary_orig_filename
    else:
        first_two = ", ".join(r.orig_filename for r in video_records[:2])
        extra = f", +{len(video_records) - 2} more" if len(video_records) > 2 else ""
        file_names_summary = f"{len(video_records)} videos ({first_two}{extra})"

    created_pipelines = []
    if req.fps_list:
        fps_list = [float(f) for f in req.fps_list if float(f) > 0]
    elif req.frame_counts:
        fps_list = [1.0 for _ in req.frame_counts]
    else:
        fps_list = [1.0]

    blur_thresholds = req.blur_thresholds if req.blur_thresholds else [50.0]

    for fps in fps_list:
        for blur_threshold in blur_thresholds:
            batch_slug = str(batch_id).replace("-", "_")
            run_tag = int(time.time() * 1000) % 1000000
            fps_str = str(fps).replace(".", "_")
            dataset_name = f"dataset_{batch_slug}_fps{fps_str}_b{int(blur_threshold)}_{run_tag}"

            def truncate_str(s: str, max_len: int = 220) -> str:
                return s if len(s) <= max_len else s[:max_len - 3] + "..."

            pipe_create = PipelineCreate(
                name=truncate_str(f"Video OpenSfM Pipeline: {file_names_summary} (fps={fps}, blur={blur_threshold})"),
                jobs=[
                    PipelineJobCreate(
                        id_key="video_upload",
                        name=truncate_str(f"Log Ingestion: {file_names_summary}"),
                        task_type="video_upload",
                        payload={
                            "file_id": primary_file_id,
                            "batch_id": str(batch_id),
                            "filename": primary_orig_filename,
                            "safe_filename": primary_safe_filename,
                            "video_files": video_safe_filenames,
                        },
                        depends_on=[]
                    ),
                    PipelineJobCreate(
                        id_key="frame_extraction",
                        name=truncate_str(f"Frame Extraction: {file_names_summary} (fps={fps}, blur={blur_threshold})"),
                        task_type="frame_extraction",
                        payload={
                            "filename": primary_orig_filename,
                            "safe_filename": primary_safe_filename,
                            "video_files": video_safe_filenames,
                            "fps": fps,
                            "blur_threshold": blur_threshold,
                            "dataset_name": dataset_name,
                            "batch_id": str(batch_id),
                        },
                        depends_on=["video_upload"]
                    ),
                    PipelineJobCreate(
                        id_key="opensfm_sparse",
                        name=truncate_str(f"OpenSfM Sparse: {file_names_summary} (fps={fps}, blur={blur_threshold})"),
                        task_type="opensfm_sparse",
                        payload={
                            "dataset_name": dataset_name,
                            "file_id": primary_file_id,
                            "batch_id": str(batch_id),
                        },
                        depends_on=["frame_extraction"]
                    ),
                    PipelineJobCreate(
                        id_key="opensfm_dense",
                        name=truncate_str(f"OpenSfM Dense Component 0: {dataset_name}"),
                        task_type="opensfm_dense",
                        payload={
                            "dataset_name": dataset_name,
                            "file_id": primary_file_id,
                            "batch_id": str(batch_id),
                            "reconstruction_index": 0,
                            "subfolder": "undistorted",
                        },
                        depends_on=["opensfm_sparse"]
                    ),
                    PipelineJobCreate(
                        id_key="opensfm_ingest",
                        name=truncate_str(f"OpenSfM Ingest Component 0: {dataset_name}"),
                        task_type="opensfm_ingest",
                        payload={
                            "dataset_name": dataset_name,
                            "file_id": primary_file_id,
                            "batch_id": str(batch_id),
                            "reconstruction_index": 0,
                            "subfolder": "undistorted",
                        },
                        depends_on=["opensfm_dense"]
                    )
                ]
            )

            pipeline_model, jobs = build_pipeline_and_jobs(pipe_create)
            db.add(pipeline_model)
            for j in jobs:
                db.add(j)
            await db.commit()

            pipeline_db = await _get_pipeline_or_404(pipeline_model.id, db)

            completed_cache: Set[str] = set()
            for j in pipeline_db.jobs:
                if j.status == JobStatus.BLOCKED and j.depends_on:
                    if await _are_dependencies_satisfied(db, j.depends_on, completed_cache):
                        j.status = JobStatus.PENDING

            await db.commit()

            for j in pipeline_db.jobs:
                if j.status == JobStatus.PENDING:
                    await _enqueue_job_to_redis(j.id, j.task_type)

            created_pipelines.append(pipeline_db)

    return created_pipelines



# ==========================================
# GET ENDPOINTS
# ==========================================

@router.get("/batches/{batch_id}/logs", response_model=List[LogDataResponse])
async def get_batch_logs(
    batch_id: uuid.UUID,
    start_time: Optional[str] = Query(None, description="Start of timerange (ms, s, or ISO datetime string)"),
    end_time: Optional[str] = Query(None, description="End of timerange (ms, s, or ISO datetime string)"),
    start_ts: Optional[Union[int, float]] = Query(None, description="Start timestamp (ms or s)"),
    end_ts: Optional[Union[int, float]] = Query(None, description="End timestamp (ms or s)"),
    min_timestamp: Optional[Union[int, float]] = Query(None, description="Min timestamp (ms or s)"),
    max_timestamp: Optional[Union[int, float]] = Query(None, description="Max timestamp (ms or s)"),
    limit: Optional[int] = Query(None, ge=1, le=100000, description="Max records to return"),
    db: AsyncSession = Depends(get_db_session)
):
    """
    Get log_data for a specific batch_id and optional timerange.
    """
    start_ms = parse_timestamp_to_ms(start_ts if start_ts is not None else (min_timestamp if min_timestamp is not None else start_time))
    end_ms = parse_timestamp_to_ms(end_ts if end_ts is not None else (max_timestamp if max_timestamp is not None else end_time))

    stmt = select(LogData).where(LogData.batch_id == batch_id)
    if start_ms is not None:
        stmt = stmt.where(LogData.timestamp >= start_ms)
    if end_ms is not None:
        stmt = stmt.where(LogData.timestamp <= end_ms)

    stmt = stmt.order_by(LogData.timestamp.asc())
    if limit is not None and limit > 0:
        stmt = stmt.limit(limit)

    result = await db.execute(stmt)
    return list(result.scalars().all())


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


@router.get("/by-pointcloud/{identifier}", response_model=List[VideoResponse])
async def get_video_by_pointcloud(
    identifier: str,
    db: AsyncSession = Depends(get_db_session)
):
    """
    Get the associated video records for a given point cloud dataset via batch_id.
    Returns a list of videos ordered sequentially by start time and filename.
    """
    pc_uuid = None
    try:
        pc_uuid = uuid.UUID(identifier)
    except ValueError:
        pass

    stmt = select(PointCloudMetadata)
    if pc_uuid:
        stmt = stmt.where(PointCloudMetadata.id == pc_uuid)
    else:
        stmt = stmt.where(
            (PointCloudMetadata.orig_filename == identifier) |
            (PointCloudMetadata.safe_filename == identifier)
        )

    result = await db.execute(stmt)
    pc = result.scalar_one_or_none()
    if not pc:
        raise HTTPException(status_code=404, detail="Point cloud not found")

    videos: List[Video] = []
    if pc.batch_id:
        video_stmt = (
            select(Video)
            .join(UploadMetadata, Video.upload_metadata_id == UploadMetadata.id)
            .options(selectinload(Video.upload_metadata))
            .where(UploadMetadata.batch_id == pc.batch_id)
            .order_by(Video.video_start_at.asc(), UploadMetadata.orig_filename.asc())
        )
        vid_res = await db.execute(video_stmt)
        videos = list(vid_res.scalars().all())

    if not videos:
        # Check by filename match if batch_id didn't link
        video_stmt = (
            select(Video)
            .join(UploadMetadata, Video.upload_metadata_id == UploadMetadata.id)
            .options(selectinload(Video.upload_metadata))
            .where(
                (UploadMetadata.orig_filename == pc.orig_filename) |
                (UploadMetadata.safe_filename == pc.safe_filename)
            )
            .order_by(Video.video_start_at.asc(), UploadMetadata.orig_filename.asc())
        )
        vid_res = await db.execute(video_stmt)
        videos = list(vid_res.scalars().all())

    if not videos:
        # Fallback: check if single video exists
        fallback = await db.execute(
            select(Video)
            .options(selectinload(Video.upload_metadata))
            .order_by(Video.video_start_at.asc())
            .limit(1)
        )
        vid = fallback.scalar_one_or_none()
        if vid:
            videos = [vid]

    return [_enrich_video_response(v) for v in videos]


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

