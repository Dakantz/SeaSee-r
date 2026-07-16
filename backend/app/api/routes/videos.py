import os
import uuid
import aiofiles
from fastapi import APIRouter, UploadFile, File, Form, HTTPException

from app.core.config import settings

router = APIRouter(
    prefix="/videos",
    tags=["Videos"]
)

@router.post("/upload")
async def upload_video(file: UploadFile = File(...)):
    # Generate unique ID for the file
    file_id = str(uuid.uuid4())
    original_ext = os.path.splitext(file.filename)[1]
    safe_filename = f"{file_id}{original_ext}"
    
    file_path = os.path.join(settings.video_dir, safe_filename)
    
    # Save file asynchronously in chunks to support files of any size
    async with aiofiles.open(file_path, 'wb') as out_file:
        while content := await file.read(1024 * 1024):  # read in 1MB chunks
            await out_file.write(content)
            
    return {"message": "Video uploaded successfully", "file_id": file_id, "filename": safe_filename}


@router.post("/upload/resumable/init")
async def init_resumable_upload(filename: str = Form(...)):
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
    file: UploadFile = File(...)
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
            
    return {"message": "Chunk uploaded successfully", "uploaded_bytes": os.path.getsize(file_path)}
