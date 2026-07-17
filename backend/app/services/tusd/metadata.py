import os
import uuid
from datetime import datetime
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_

from app.core.config import settings
from app.models.video import Video, VideoStatus, VideoMetadata
from app.services.tusd.base import WebhookPayload
from app.utils.file_manager import FileManager

class MetadataUploadService:
    @staticmethod
    async def handle_create(payload: WebhookPayload, db: AsyncSession) -> dict:
        video_safe_filenames_str = payload.metadata.get("video_safe_filenames")
        filename = payload.metadata.get("filename", "metadata.json")
        content_type = payload.metadata.get("filetype", "application/json")
        
        if not video_safe_filenames_str:
            return {"status": "ignored", "reason": "Missing video_safe_filenames"}
            
        video_safe_filenames = [x.strip() for x in video_safe_filenames_str.split(",") if x.strip()]
        
        conditions = [Video.safe_filename.startswith(x) for x in video_safe_filenames]
        stmt = select(Video).where(or_(*conditions))
        result = await db.execute(stmt)
        videos = result.scalars().all()
        
        if not videos:
            return {"status": "ignored", "reason": "No corresponding videos found"}
            
        for video in videos:
            metadata_file = VideoMetadata(
                id=uuid.uuid4(),
                video_id=video.id,
                filename=filename,
                safe_filename=payload.safe_filename,
                content_type=content_type,
                total_bytes=payload.total_bytes,
                status=VideoStatus.UPLOADING
            )
            db.add(metadata_file)
        await db.commit()
        return {"status": "ok", "action": "created_metadata"}

    @staticmethod
    async def handle_finish(payload: WebhookPayload, db: AsyncSession) -> dict:
        metadata_dir = os.path.join(settings.video_dir, "metadata")
        
        stmt = select(VideoMetadata).where(VideoMetadata.safe_filename == payload.safe_filename)
        result = await db.execute(stmt)
        metadata_files_db = result.scalars().all()
        
        for metadata_file_db in metadata_files_db:
            metadata_file_db.status = VideoStatus.COMPLETED
            metadata_file_db.completed_at = datetime.utcnow()
            
        await db.commit()

        try:
            if not metadata_files_db:
                FileManager.remove_file(payload.original_file_path)
            else:
                for i, metadata_file_db in enumerate(metadata_files_db):
                    dest_filename = str(metadata_file_db.id)
                    if i < len(metadata_files_db) - 1:
                        FileManager.copy_file(
                            src=payload.original_file_path, 
                            dest_dir=metadata_dir, 
                            safe_filename=dest_filename
                        )
                    else:
                        FileManager.move_file(
                            src=payload.original_file_path, 
                            dest_dir=metadata_dir, 
                            safe_filename=dest_filename
                        )
        except Exception as e:
            for metadata_file_db in metadata_files_db:
                metadata_file_db.status = VideoStatus.UPLOADING
                metadata_file_db.completed_at = None
            await db.commit()
            raise HTTPException(status_code=500, detail="Failed to move uploaded file")
                
        return {"status": "ok", "type": "video_metadata"}

    @staticmethod
    async def handle_terminate(payload: WebhookPayload, db: AsyncSession) -> dict:
        stmt = select(VideoMetadata).where(VideoMetadata.safe_filename == payload.safe_filename)
        result = await db.execute(stmt)
        metadata_files = result.scalars().all()
        for mf in metadata_files:
            import os
            mf_path = os.path.join(settings.video_dir, "metadata", str(mf.id))
            FileManager.remove_file(mf_path)
            await db.delete(mf)
        await db.commit()
        return {"status": "ok", "action": "terminated_metadata"}
