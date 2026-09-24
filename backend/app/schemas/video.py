from typing import Optional, List
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from app.models.video import VideoStatus


class UploadMetadataResponse(BaseModel):
    id: UUID
    batch_id: Optional[UUID] = None
    orig_filename: str
    safe_filename: Optional[str] = None
    content_type: Optional[str] = None
    status: VideoStatus
    created_at: datetime
    completed_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


# Alias for backward compatibility
VideoMetadataResponse = UploadMetadataResponse


class VideoResponse(BaseModel):
    id: UUID
    upload_metadata_id: UUID
    content_type: Optional[str] = None
    total_bytes: Optional[int] = None
    video_start_at: datetime
    video_stop_at: datetime
    upload_metadata: Optional[UploadMetadataResponse] = None

    model_config = ConfigDict(from_attributes=True)


class BatchIdResponse(BaseModel):
    batch_id: UUID
    batchId: Optional[UUID] = None

    model_config = ConfigDict(from_attributes=True)
