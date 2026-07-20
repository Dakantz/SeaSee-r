import os
import uuid
from datetime import datetime
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_

from app.core.config import settings
from app.models.video import Video, VideoStatus, VideoMetadata
from app.services.tusd.base_upload_service import WebhookPayload
from app.utils.file_manager import FileManager

class MetadataUploadService:
    @staticmethod
    async def handle_create(payload: WebhookPayload, db: AsyncSession) -> dict:
        filename = payload.metadata.get("filename", "")
        content_type = payload.metadata.get("filetype", "application/json")
        batch_id_str = payload.metadata.get("batch_id")
        file_uuid_str = payload.file_id
        
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

        metadata_file = VideoMetadata(
            id=file_uuid,
            batch_id=batch_id,
            orig_filename=filename,
            safe_filename=new_safe_filename,
            content_type=content_type,
            total_bytes=payload.total_bytes,
            status=VideoStatus.UPLOADING
        )
        db.add(metadata_file)
        await db.commit()
        return {"status": "ok", "action": "created_metadata"}

    @staticmethod
    async def handle_finish(payload: WebhookPayload, db: AsyncSession) -> dict:
        metadata_dir = settings.metadata_dir
        
        file_uuid_str = payload.file_id
        try:
            file_uuid = uuid.UUID(file_uuid_str)
        except ValueError:
            return {"status": "ignored", "reason": "Invalid file_id"}

        stmt = select(VideoMetadata).where(VideoMetadata.id == file_uuid)
        result = await db.execute(stmt)
        metadata_file_db = result.scalar_one_or_none()
        
        if metadata_file_db:
            metadata_file_db.status = VideoStatus.COMPLETED
            metadata_file_db.completed_at = datetime.utcnow()
            await db.commit()

        try:
            if metadata_file_db:
                FileManager.move_file(
                    src=payload.original_file_path, 
                    dest_dir=metadata_dir, 
                    safe_filename=metadata_file_db.safe_filename
                )
                FileManager.remove_file(f"{payload.original_file_path}.info")
            else:
                FileManager.remove_file(payload.original_file_path)
                raise HTTPException(status_code=404, detail="Metadata not found")
        except Exception as e:
            if metadata_file_db:
                metadata_file_db.status = VideoStatus.UPLOADING
                metadata_file_db.completed_at = None
                await db.commit()
            raise HTTPException(status_code=500, detail="Failed to move uploaded file")
                
        return {"status": "ok", "type": "video_metadata"}

    @staticmethod
    async def handle_terminate(payload: WebhookPayload, db: AsyncSession) -> dict:
        file_uuid_str = payload.file_id
        try:
            file_uuid = uuid.UUID(file_uuid_str)
        except ValueError:
            return {"status": "ignored", "reason": "Invalid file_id"}
            
        stmt = select(VideoMetadata).where(VideoMetadata.id == file_uuid)
        result = await db.execute(stmt)
        mf = result.scalar_one_or_none()
        if mf:
            import os
            mf_path = os.path.join(settings.metadata_dir, mf.safe_filename)
            FileManager.remove_file(mf_path)
            await db.delete(mf)
            await db.commit()
        return {"status": "ok", "action": "terminated_metadata"}
