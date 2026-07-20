import uuid
import os
from datetime import datetime
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.models.video import Video, VideoStatus, VideoMetadata
from app.services.tusd.base_upload_service import WebhookPayload
from app.utils.file_manager import FileManager

class VideoUploadService:
    @staticmethod
    async def handle_create(payload: WebhookPayload, db: AsyncSession) -> dict:
        filename = payload.metadata.get("filename", "")
        file_uuid_str = payload.file_id
        batch_id_str = payload.metadata.get("batch_id")
        
        if not file_uuid_str:
            return {"status": "ignored", "reason": "Missing file_id"}
            
        try:
            file_uuid = uuid.UUID(file_uuid_str)
        except ValueError:
            return {"status": "ignored", "reason": "Invalid file_id UUID format"}

        batch_id = None
        if batch_id_str:
            try:
                batch_id = uuid.UUID(batch_id_str)
            except ValueError:
                pass

        import pathlib
        extension = pathlib.Path(filename).suffix if filename else ""
        new_safe_filename = f"{file_uuid}{extension}"

        video = Video(
            id=file_uuid,
            batch_id=batch_id,
            orig_filename=filename,
            safe_filename=new_safe_filename,
            status=VideoStatus.UPLOADING,
            total_bytes=payload.total_bytes
        )
        db.add(video)
        await db.commit()
        return {"status": "ok", "action": "created_video"}


    @staticmethod
    async def handle_finish(payload: WebhookPayload, db: AsyncSession) -> dict:
        file_uuid_str = payload.file_id
        try:
            file_uuid = uuid.UUID(file_uuid_str)
        except ValueError:
            return {"status": "ignored", "reason": "Invalid file_id"}
            
        stmt = select(Video).where(Video.id == file_uuid)
        result = await db.execute(stmt)
        video = result.scalar_one_or_none()
        
        if video:
            video.status = VideoStatus.COMPLETED
            video.completed_at = datetime.utcnow()
            await db.commit()

        try:
            if video:
                FileManager.move_file(
                    src=payload.original_file_path, 
                    dest_dir=settings.video_dir, 
                    safe_filename=video.safe_filename
                )
                FileManager.remove_file(f"{payload.original_file_path}.info")
            else:
                raise HTTPException(status_code=404, detail="Video not found")
        except Exception as e:
            if video:
                video.status = VideoStatus.UPLOADING
                video.completed_at = None
                await db.commit()
            raise HTTPException(status_code=500, detail="Failed to move uploaded file")
            
        return {"status": "ok", "type": "video"}


    @staticmethod
    async def handle_terminate(payload: WebhookPayload, db: AsyncSession) -> dict:
        file_uuid_str = payload.file_id
        try:
            file_uuid = uuid.UUID(file_uuid_str)
        except ValueError:
            return {"status": "ignored", "reason": "Invalid file_id"}
            
        stmt = select(Video).where(Video.id == file_uuid)
        result = await db.execute(stmt)
        video = result.scalar_one_or_none()
        if video:
            await db.delete(video)
            await db.commit()
        return {"status": "ok", "action": "terminated_video"}
