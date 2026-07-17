import uuid
from datetime import datetime
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.models.video import Video, VideoStatus, VideoMetadata
from app.services.tusd.base import WebhookPayload
from app.utils.file_manager import FileManager

class VideoUploadService:
    @staticmethod
    async def handle_create(payload: WebhookPayload, db: AsyncSession) -> dict:
        filename = payload.metadata.get("filename", payload.safe_filename)
        file_uuid_str = payload.metadata.get("file_id")
        
        if not file_uuid_str:
            return {"status": "ignored", "reason": "Missing file_id"}
            
        try:
            file_uuid = uuid.UUID(file_uuid_str)
        except ValueError:
            return {"status": "ignored", "reason": "Invalid file_id UUID format"}

        video = Video(
            id=file_uuid,
            filename=filename,
            safe_filename=payload.safe_filename,
            status=VideoStatus.UPLOADING,
            total_bytes=payload.total_bytes
        )
        db.add(video)
        await db.commit()
        return {"status": "ok", "action": "created_video"}

    @staticmethod
    async def handle_finish(payload: WebhookPayload, db: AsyncSession) -> dict:
        stmt = select(Video).where(Video.safe_filename == payload.safe_filename)
        result = await db.execute(stmt)
        video = result.scalar_one_or_none()
        
        if video:
            video.status = VideoStatus.COMPLETED
            video.completed_at = datetime.utcnow()
            await db.commit()

        try:
            FileManager.move_file(
                src=payload.original_file_path, 
                dest_dir=settings.video_dir, 
                safe_filename=payload.safe_filename
            )
        except Exception as e:
            if video:
                video.status = VideoStatus.UPLOADING
                video.completed_at = None
                await db.commit()
            raise HTTPException(status_code=500, detail="Failed to move uploaded file")
            
        return {"status": "ok", "type": "video"}

    @staticmethod
    async def handle_terminate(payload: WebhookPayload, db: AsyncSession) -> dict:
        stmt = select(Video).options(selectinload(Video.metadata_files)).where(Video.safe_filename == payload.safe_filename)
        result = await db.execute(stmt)
        video = result.scalar_one_or_none()
        if video:
            for mf in video.metadata_files:
                import os
                mf_path = os.path.join(settings.video_dir, "metadata", str(mf.id))
                FileManager.remove_file(mf_path)
            await db.delete(video)
            await db.commit()
        return {"status": "ok", "action": "terminated_video"}
