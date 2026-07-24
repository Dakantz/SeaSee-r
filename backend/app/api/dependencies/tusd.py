import os
from fastapi import Request, HTTPException
from typing import Optional
from app.core.config import settings
from app.services.tusd.base_upload_service import WebhookPayload

class IgnoreWebhook(Exception):
    def __init__(self, reason: str):
        self.reason = reason

async def parse_tusd_webhook(request: Request) -> WebhookPayload:
    try:
        data = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    # TUSD v2 uses 'Type' and nests 'Upload' inside 'Event'
    # Fallback to TUSD v1 format ('EventName' and top-level 'Upload') just in case
    event_name = data.get("Type") or data.get("EventName")
    
    event_data = data.get("Event", {})
    upload = event_data.get("Upload") or data.get("Upload", {})
    
    if not upload:
        raise IgnoreWebhook(reason="No upload data")
        
    file_id = upload.get("ID")
    metadata = upload.get("MetaData", {})
    
    upload_type = metadata.get("upload_type")
    if not upload_type:
        raise IgnoreWebhook(reason="No upload_type in metadata")
        
    filename = metadata.get("filename") or metadata.get("name")
    if not filename and upload_type == "video_metadata":
        filename = "metadata.json"
    elif not filename:
        filename = f"unknown-{file_id}"

    safe_filename = metadata.get("safe_filename")
    if not safe_filename:
        safe_filename = os.path.splitext(filename)[0]
        
    original_ext = os.path.splitext(filename)[1]
    if original_ext and not safe_filename.endswith(original_ext):
        safe_filename += original_ext
        
    metadata["safe_filename"] = safe_filename
        
    original_file_path = os.path.join(settings.upload_dir, file_id)

    return WebhookPayload(
        event_name=event_name,
        file_id=file_id,
        upload_type=upload_type,
        filename=filename,
        safe_filename=safe_filename,
        total_bytes=upload.get("Size", 0),
        original_file_path=original_file_path,
        metadata=metadata,
        upload_data=upload
    )
