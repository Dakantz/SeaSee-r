import uuid
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from redis import Redis
from rq import Queue

from app.core.config import settings
from app.models.job import Job
from app.services.tusd.base import WebhookPayload
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
        new_safe_filename = f"{uuid_str}.ply"

        job_record = Job(
            name=f"Convert {payload.filename} to EPT",
            payload={
                "filename": payload.filename, 
                "safe_filename": new_safe_filename, 
                "total_bytes": payload.total_bytes, 
                "file_id": uuid_str
            },
            status="PENDING", 
            progress=0.0
        )
        db.add(job_record)
        await db.commit()
        await db.refresh(job_record)
            
        try:
            new_file_path = FileManager.move_file(
                src=payload.original_file_path,
                dest_dir=settings.pointcloud_local_dir,
                safe_filename=new_safe_filename
            )
        except Exception as e:
            await db.delete(job_record)
            await db.commit()
            raise HTTPException(status_code=500, detail="Failed to move uploaded file")
            
        redis_conn = Redis.from_url(settings.redis_url)
        q = Queue("pointcloud_tasks", connection=redis_conn)
        q.enqueue(
            "app.services.worker.tasks.convert_to_ept", 
            new_file_path, 
            uuid_str, 
            job_id=str(job_record.id), 
            storage_type=settings.pointcloud_storage_type.value
        )
        return {"status": "ok", "type": "pointcloud"}

    @staticmethod
    async def handle_terminate(payload: WebhookPayload, db: AsyncSession) -> dict:
        return {"status": "ignored", "reason": "Pointcloud termination unhandled"}
