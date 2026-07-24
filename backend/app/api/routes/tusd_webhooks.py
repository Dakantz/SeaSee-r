from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db_session
from app.api.dependencies.tusd import parse_tusd_webhook, IgnoreWebhook
from app.services.tusd import (
    VideoUploadService,
    MetadataUploadService,
    PointCloudUploadService
)

router = APIRouter(
    prefix="/webhooks",
    tags=["TUSD Webhooks"]
)

# Strategy pattern map
WEBHOOK_HANDLERS = {
    ("post-create", "video"): VideoUploadService.handle_create,
    ("post-finish", "video"): VideoUploadService.handle_finish,
    ("post-terminate", "video"): VideoUploadService.handle_terminate,
    
    ("post-create", "video_metadata"): MetadataUploadService.handle_create,
    ("post-finish", "video_metadata"): MetadataUploadService.handle_finish,
    ("post-terminate", "video_metadata"): MetadataUploadService.handle_terminate,
    
    ("post-create", "pointcloud"): PointCloudUploadService.handle_create,
    ("post-finish", "pointcloud"): PointCloudUploadService.handle_finish,
    ("post-terminate", "pointcloud"): PointCloudUploadService.handle_terminate,
}

@router.post("/tusd")
async def tusd_webhook(
    request: Request,
    db: AsyncSession = Depends(get_db_session)
):
    try:
        payload = await parse_tusd_webhook(request)
    except IgnoreWebhook as e:
        return {"status": "ignored", "reason": e.reason}

    handler = WEBHOOK_HANDLERS.get((payload.event_name, payload.upload_type))
    
    if handler:
        return await handler(payload, db)
        
    return {"status": "ignored", "reason": f"Unhandled event {payload.event_name} or upload_type {payload.upload_type}"}
