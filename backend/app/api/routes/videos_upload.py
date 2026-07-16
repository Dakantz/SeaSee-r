import os
import uuid
from datetime import datetime
import aiofiles

from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.database import get_db_session
from app.models.video import Video, VideoStatus, VideoMetadata

router = APIRouter(
    prefix="/videos/upload",
    tags=["Video Uploads"]
)

# ==========================================
# 1. INIT ENDPOINTS
# ==========================================

@router.post("/init")
async def init_resumable_upload(
    filename: str = Form(...),
    total_bytes: int = Form(None),
    db: AsyncSession = Depends(get_db_session)
):
    """
    Initialize a resumable upload. Returns a safe_filename to use for subsequent chunks.
    """
    file_id = str(uuid.uuid4())
    original_ext = os.path.splitext(filename)[1]
    safe_filename = f"{file_id}{original_ext}"
    file_path = os.path.join(settings.video_dir, safe_filename)
    
    # Create empty file
    async with aiofiles.open(file_path, 'wb') as f:
        pass
        
    # Create DB record
    video = Video(
        id=uuid.UUID(file_id),
        filename=filename,
        safe_filename=safe_filename,
        status=VideoStatus.UPLOADING,
        total_bytes=total_bytes
    )
    db.add(video)
    await db.commit()
        
    return {"file_id": file_id, "safe_filename": safe_filename}


@router.post("/metadata/init_multiple")
async def init_metadata_upload_multiple(
    video_safe_filenames: str = Form(...),
    filename: str = Form(...),
    content_type: str = Form(None),
    total_bytes: int = Form(None),
    db: AsyncSession = Depends(get_db_session)
):
    """
    Initialize metadata uploads for multiple videos simultaneously.
    """
    video_filenames_list = [x.strip() for x in video_safe_filenames.split(',') if x.strip()]
    stmt = select(Video).where(Video.safe_filename.in_(video_filenames_list))
    result = await db.execute(stmt)
    videos = result.scalars().all()
    
    if not videos:
        raise HTTPException(status_code=404, detail="No valid videos found")

    metadata_records = []
    
    # Generate ONE safe_filename for all the metadata entries
    file_id = str(uuid.uuid4())
    original_ext = os.path.splitext(filename)[1]
    safe_filename = f"{file_id}{original_ext}"
    file_path = os.path.join(settings.video_dir, safe_filename)
    
    # Create empty file ONCE
    async with aiofiles.open(file_path, 'wb') as f:
        pass
        
    metadata_records.append(safe_filename)
    
    for video in videos:
        metadata_file = VideoMetadata(
            id=uuid.uuid4(),
            video_id=video.id,
            filename=filename,
            safe_filename=safe_filename,
            content_type=content_type,
            total_bytes=total_bytes,
            status=VideoStatus.UPLOADING
        )
        db.add(metadata_file)
        
    await db.commit()
    
    return {"safe_filenames": metadata_records}


@router.post("/{video_safe_filename}/metadata/init")
async def init_metadata_upload(
    video_safe_filename: str,
    filename: str = Form(...),
    content_type: str = Form(None),
    total_bytes: int = Form(None),
    db: AsyncSession = Depends(get_db_session)
):
    """
    Initialize a resumable metadata file upload. Returns a safe_filename to use for subsequent chunks.
    """
    # Verify the video exists
    stmt = select(Video).where(Video.safe_filename == video_safe_filename)
    result = await db.execute(stmt)
    video = result.scalar_one_or_none()
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")

    file_id = str(uuid.uuid4())
    original_ext = os.path.splitext(filename)[1]
    safe_filename = f"{file_id}{original_ext}"
    file_path = os.path.join(settings.video_dir, safe_filename)
    
    # Create empty file
    async with aiofiles.open(file_path, 'wb') as f:
        pass
        
    # Create DB record
    metadata_file = VideoMetadata(
        id=uuid.UUID(file_id),
        video_id=video.id,
        filename=filename,
        safe_filename=safe_filename,
        content_type=content_type,
        total_bytes=total_bytes,
        status=VideoStatus.UPLOADING
    )
    db.add(metadata_file)
    await db.commit()
        
    return {"file_id": file_id, "safe_filename": safe_filename}


# ==========================================
# 2. STATUS ENDPOINTS
# ==========================================

@router.get("/metadata_multiple/status")
async def get_metadata_multiple_status(safe_filenames: str):
    """
    Get the number of bytes uploaded for multiple identical metadata files.
    """
    names = [x.strip() for x in safe_filenames.split(',') if x.strip()]
    if not names:
        return {"uploaded_bytes": 0}
        
    # Assume they are all in sync and just check the first one
    file_path = os.path.join(settings.video_dir, names[0])
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")
        
    uploaded_bytes = os.path.getsize(file_path)
    return {"uploaded_bytes": uploaded_bytes}


@router.get("/metadata/{metadata_safe_filename}/status")
async def get_metadata_status(metadata_safe_filename: str):
    """
    Get the number of bytes uploaded so far for a metadata file.
    """
    file_path = os.path.join(settings.video_dir, metadata_safe_filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")
        
    uploaded_bytes = os.path.getsize(file_path)
    return {"uploaded_bytes": uploaded_bytes}


@router.get("/{safe_filename}/status")
async def get_resumable_status(safe_filename: str):
    """
    Get the number of bytes uploaded so far. 
    The client can use this to know where to resume the upload.
    """
    file_path = os.path.join(settings.video_dir, safe_filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")
        
    uploaded_bytes = os.path.getsize(file_path)
    return {"uploaded_bytes": uploaded_bytes}


# ==========================================
# 3. CHUNK UPLOAD ENDPOINTS
# ==========================================

@router.post("/metadata_multiple")
async def upload_metadata_chunk_multiple(
    safe_filenames: str = Form(...),
    offset: int = Form(...),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db_session)
):
    """
    Upload a chunk of the metadata file to multiple DB records.
    """
    names = [x.strip() for x in safe_filenames.split(',') if x.strip()]
    if not names:
        raise HTTPException(status_code=400, detail="No safe_filenames provided")
        
    for safe_filename in names:
        file_path = os.path.join(settings.video_dir, safe_filename)
        if not os.path.exists(file_path):
            continue
            
        current_size = os.path.getsize(file_path)
        if offset != current_size:
            continue # Skip files that are not at the expected offset
            
        await file.seek(0)
        # Append chunk
        async with aiofiles.open(file_path, 'ab') as out_file:
            while content := await file.read(1024 * 1024):
                await out_file.write(content)
            
        new_size = os.path.getsize(file_path)
        
        # Update database records
        stmt = select(VideoMetadata).where(VideoMetadata.safe_filename == safe_filename)
        result = await db.execute(stmt)
        metadata_files_db = result.scalars().all()
        
        for metadata_file_db in metadata_files_db:
            if metadata_file_db.total_bytes is not None and new_size >= metadata_file_db.total_bytes:
                metadata_file_db.status = VideoStatus.COMPLETED
                metadata_file_db.completed_at = datetime.utcnow()
            elif metadata_file_db.status == VideoStatus.PENDING:
                metadata_file_db.status = VideoStatus.UPLOADING
                
    await db.commit()
    
    # Check the size of the first file for progress
    first_file_path = os.path.join(settings.video_dir, names[0])
    if os.path.exists(first_file_path):
        final_size = os.path.getsize(first_file_path)
    else:
        # Fallback if file doesn't exist
        await file.seek(0, 2) # go to end
        final_size = offset + file.tell()
        
    return {"message": "Chunk uploaded successfully", "uploaded_bytes": final_size}


@router.post("/metadata/{metadata_safe_filename}")
async def upload_metadata_chunk(
    metadata_safe_filename: str,
    offset: int = Form(...),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db_session)
):
    """
    Upload a chunk of the metadata file.
    """
    file_path = os.path.join(settings.video_dir, metadata_safe_filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")
        
    current_size = os.path.getsize(file_path)
    if offset != current_size:
        raise HTTPException(
            status_code=400, 
            detail=f"Offset mismatch. Expected {current_size}, got {offset}"
        )
        
    # Append the chunk
    async with aiofiles.open(file_path, 'ab') as out_file:
        while content := await file.read(1024 * 1024):
            await out_file.write(content)
            
    new_size = os.path.getsize(file_path)
    
    # Update database records
    stmt = select(VideoMetadata).where(VideoMetadata.safe_filename == metadata_safe_filename)
    result = await db.execute(stmt)
    metadata_files_db = result.scalars().all()
    
    for metadata_file_db in metadata_files_db:
        if metadata_file_db.total_bytes is not None and new_size >= metadata_file_db.total_bytes:
            metadata_file_db.status = VideoStatus.COMPLETED
            metadata_file_db.completed_at = datetime.utcnow()
        elif metadata_file_db.status == VideoStatus.PENDING:
            metadata_file_db.status = VideoStatus.UPLOADING
            
        await db.commit()
        
    return {"message": "Chunk uploaded successfully", "uploaded_bytes": new_size}


@router.post("/{safe_filename}")
async def upload_resumable_chunk(
    safe_filename: str,
    offset: int = Form(...),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db_session)
):
    """
    Upload a chunk of the video. The offset must match the current file size on disk.
    """
    file_path = os.path.join(settings.video_dir, safe_filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")
        
    current_size = os.path.getsize(file_path)
    if offset != current_size:
        raise HTTPException(
            status_code=400, 
            detail=f"Offset mismatch. Expected {current_size}, got {offset}"
        )
        
    # Append the chunk
    async with aiofiles.open(file_path, 'ab') as out_file:
        while content := await file.read(1024 * 1024):
            await out_file.write(content)
            
    # Check if upload is completed
    new_size = os.path.getsize(file_path)
    
    # Update database record
    stmt = select(Video).where(Video.safe_filename == safe_filename)
    result = await db.execute(stmt)
    video = result.scalar_one_or_none()
    
    if video:
        if video.total_bytes is not None and new_size >= video.total_bytes:
            video.status = VideoStatus.COMPLETED
            video.completed_at = datetime.utcnow()
        elif video.status == VideoStatus.PENDING:
            video.status = VideoStatus.UPLOADING
            
        await db.commit()
            
    return {"message": "Chunk uploaded successfully", "uploaded_bytes": new_size}


# ==========================================
# 4. CANCEL & DELETE ENDPOINTS
# ==========================================

@router.delete("/{safe_filename}")
async def cancel_resumable_upload(
    safe_filename: str,
    db: AsyncSession = Depends(get_db_session)
):
    """
    Cancel an incomplete upload. Deletes the file from disk and the database record.
    """
    file_path = os.path.join(settings.video_dir, safe_filename)

    # Remove from disk if it exists
    if os.path.exists(file_path):
        os.remove(file_path)

    # Remove from database
    stmt = select(Video).options(selectinload(Video.metadata_files)).where(Video.safe_filename == safe_filename)
    result = await db.execute(stmt)
    video = result.scalar_one_or_none()

    if video:
        for mf in video.metadata_files:
            # Check if this safe_filename is used by any other video
            stmt_check = select(VideoMetadata).where(
                VideoMetadata.safe_filename == mf.safe_filename,
                VideoMetadata.video_id != video.id
            )
            result_check = await db.execute(stmt_check)
            other_mf = result_check.scalars().first()
            if not other_mf:
                mf_path = os.path.join(settings.video_dir, mf.safe_filename)
                if os.path.exists(mf_path):
                    os.remove(mf_path)
        await db.delete(video)
        await db.commit()

    return {"message": "Upload cancelled successfully"}


@router.delete("/metadata/{safe_filename}")
async def cancel_metadata_upload(
    safe_filename: str,
    db: AsyncSession = Depends(get_db_session)
):
    """
    Cancel an incomplete metadata upload. Deletes the file from disk and database records.
    """
    file_path = os.path.join(settings.video_dir, safe_filename)

    # Remove from disk if it exists
    if os.path.exists(file_path):
        os.remove(file_path)

    # Remove from database
    stmt = select(VideoMetadata).where(VideoMetadata.safe_filename == safe_filename)
    result = await db.execute(stmt)
    metadata_files = result.scalars().all()

    for mf in metadata_files:
        await db.delete(mf)
        
    await db.commit()

    return {"message": "Metadata upload cancelled successfully"}
