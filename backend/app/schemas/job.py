from datetime import datetime
from uuid import UUID
from typing import Any, Dict, Optional
from pydantic import BaseModel, ConfigDict

from app.models.job import JobStatus

class JobCreate(BaseModel):
    name: str
    task_type: Optional[str] = None
    payload: Optional[Dict[str, Any]] = None

class JobResponse(BaseModel):
    id: UUID
    name: str
    task_type: Optional[str] = None
    status: JobStatus
    progress: float
    created_at: datetime
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    payload: Optional[Dict[str, Any]] = None
    result: Optional[Dict[str, Any]] = None
    error_message: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)
