from typing import Optional, List
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from app.models.video import VideoStatus


class VideoMetadataResponse(BaseModel):
    id: UUID
    batch_id: Optional[UUID] = None
    orig_filename: Optional[str] = None
    safe_filename: Optional[str] = None
    content_type: Optional[str] = None
    total_bytes: Optional[int] = None
    status: VideoStatus
    created_at: datetime
    completed_at: Optional[datetime] = None
    
    model_config = ConfigDict(from_attributes=True)


class VideoResponse(BaseModel):
    id: UUID
    batch_id: Optional[UUID] = None
    orig_filename: Optional[str] = None
    safe_filename: Optional[str] = None
    total_bytes: Optional[int] = None
    status: VideoStatus
    created_at: datetime
    completed_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)
