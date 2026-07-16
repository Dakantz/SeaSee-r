import os
import uuid
from datetime import datetime
import aiofiles
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.config import settings
from app.core.database import get_db_session
from app.models.video import Video, VideoStatus

router = APIRouter(
    prefix="/videos",
    tags=["Videos"]
)

@router.post("/upload")
async def upload_video(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db_session)
):
    # Generate unique ID for the file
    file_id = str(uuid.uuid4())
    original_ext = os.path.splitext(file.filename)[1]
    safe_filename = f"{file_id}{original_ext}"
    
    file_path = os.path.join(settings.video_dir, safe_filename)
    
    # Save file asynchronously in chunks to support files of any size
    total_bytes = 0
    async with aiofiles.open(file_path, 'wb') as out_file:
        while content := await file.read(1024 * 1024):  # read in 1MB chunks
            await out_file.write(content)
            total_bytes += len(content)
            
    # Create DB record
    video = Video(
        id=uuid.UUID(file_id),
        filename=file.filename,
        safe_filename=safe_filename,
        status=VideoStatus.COMPLETED,
        total_bytes=total_bytes,
        completed_at=datetime.utcnow()
    )
    db.add(video)
    await db.commit()
    
    return {"message": "Video uploaded successfully", "file_id": file_id, "filename": safe_filename}


@router.post("/upload/resumable/init")
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


@router.get("/upload/resumable/{safe_filename}/status")
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


@router.post("/upload/resumable/{safe_filename}")
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


@router.delete("/upload/resumable/{safe_filename}")
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
    else:
        return {"message": "File not found"}
        
    # Remove from database
    stmt = select(Video).where(Video.safe_filename == safe_filename)
    result = await db.execute(stmt)
    video = result.scalar_one_or_none()
    
    if video:
        await db.delete(video)
        await db.commit()
        
    return {"message": "Upload cancelled successfully"}
