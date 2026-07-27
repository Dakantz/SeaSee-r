import uuid
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from redis import Redis
from rq import Queue

from app.core.config import settings
from app.models.job import Job
from app.services.tusd.base_upload_service import WebhookPayload
from app.utils.file_manager import FileManager

class PointCloudUploadService:
    @staticmethod
    async def handle_create(payload: WebhookPayload, db: AsyncSession) -> dict:
        return {"status": "ignored", "reason": "Pointcloud creates handled in post-finish"}

    @staticmethod
    async def handle_finish(payload: WebhookPayload, db: AsyncSession) -> dict:
        file_uuid_str = payload.metadata.get("file_id") or payload.file_id
        try:
            file_uuid = uuid.UUID(file_uuid_str)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid UUID format for file_id")
            
        uuid_str = str(file_uuid)
        import pathlib
        extension = pathlib.Path(payload.filename).suffix if payload.filename else ""
        new_safe_filename = f"{uuid_str}{extension}"
            
        try:
            new_file_path = FileManager.move_file(
                src=payload.original_file_path,
                dest_dir=settings.pointcloud_local_dir,
                safe_filename=new_safe_filename
            )
            FileManager.remove_file(f"{payload.original_file_path}.info")
        except Exception as e:
            raise HTTPException(status_code=500, detail="Failed to move uploaded file")

        return {"status": "ok", "type": "pointcloud"}


    @staticmethod
    async def handle_terminate(payload: WebhookPayload, db: AsyncSession) -> dict:
        return {"status": "ignored", "reason": "Pointcloud termination unhandled"}
