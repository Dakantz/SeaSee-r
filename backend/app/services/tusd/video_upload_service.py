import uuid
import os
from datetime import datetime, timezone
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.models.video import Video, VideoStatus, UploadMetadata
from app.services.tusd.base_upload_service import WebhookPayload
from app.utils.file_manager import FileManager

class VideoUploadService:
    @staticmethod
    async def handle_create(payload: WebhookPayload, db: AsyncSession) -> dict:
        filename = payload.metadata.get("filename", "")
        file_uuid_str = payload.file_id
        batch_id_str = payload.metadata.get("batch_id")
        content_type = payload.metadata.get("filetype", "video/mp4")
        
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

        upload_meta = UploadMetadata(
            id=file_uuid,
            batch_id=batch_id,
            orig_filename=filename,
            safe_filename=new_safe_filename,
            content_type=content_type,
            status=VideoStatus.UPLOADING,
        )
        db.add(upload_meta)

        video_start_at_str = payload.metadata.get("video_start_at")
        video_stop_at_str = payload.metadata.get("video_stop_at")
        now = datetime.now(timezone.utc)
        
        start_at = now
        if video_start_at_str:
            try:
                start_at = datetime.fromisoformat(video_start_at_str)
                if start_at.tzinfo is None:
                    start_at = start_at.replace(tzinfo=timezone.utc)
            except Exception:
                start_at = now

        stop_at = now
        if video_stop_at_str:
            try:
                stop_at = datetime.fromisoformat(video_stop_at_str)
                if stop_at.tzinfo is None:
                    stop_at = stop_at.replace(tzinfo=timezone.utc)
            except Exception:
                stop_at = now

        video = Video(
            id=uuid.uuid4(),
            upload_metadata_id=upload_meta.id,
            content_type=content_type,
            total_bytes=payload.total_bytes,
            video_start_at=start_at,
            video_stop_at=stop_at,
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
            
        stmt = select(UploadMetadata).options(selectinload(UploadMetadata.videos)).where(UploadMetadata.id == file_uuid)
        result = await db.execute(stmt)
        upload_meta = result.scalar_one_or_none()
        
        if upload_meta:
            upload_meta.status = VideoStatus.COMPLETED
            upload_meta.completed_at = datetime.now(timezone.utc)

            v_start_str = payload.metadata.get("video_start_at")
            v_stop_str = payload.metadata.get("video_stop_at")
            if upload_meta.videos:
                for v in upload_meta.videos:
                    if payload.total_bytes and not v.total_bytes:
                        v.total_bytes = payload.total_bytes
                    if v_start_str:
                        try:
                            parsed_start = datetime.fromisoformat(v_start_str)
                            if parsed_start.tzinfo is None:
                                parsed_start = parsed_start.replace(tzinfo=timezone.utc)
                            v.video_start_at = parsed_start
                        except Exception:
                            pass
                    if v_stop_str:
                        try:
                            parsed_stop = datetime.fromisoformat(v_stop_str)
                            if parsed_stop.tzinfo is None:
                                parsed_stop = parsed_stop.replace(tzinfo=timezone.utc)
                            v.video_stop_at = parsed_stop
                        except Exception:
                            pass
            await db.commit()

        try:
            if upload_meta:
                FileManager.move_file(
                    src=payload.original_file_path, 
                    dest_dir=settings.video_dir, 
                    safe_filename=upload_meta.safe_filename
                )
                FileManager.remove_file(f"{payload.original_file_path}.info")
            else:
                raise HTTPException(status_code=404, detail="Upload metadata not found")
        except Exception as e:
            if upload_meta:
                upload_meta.status = VideoStatus.UPLOADING
                upload_meta.completed_at = None
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
            
        stmt = select(UploadMetadata).where(UploadMetadata.id == file_uuid)
        result = await db.execute(stmt)
        upload_meta = result.scalar_one_or_none()
        if upload_meta:
            await db.delete(upload_meta)
            await db.commit()
        return {"status": "ok", "action": "terminated_video"}
