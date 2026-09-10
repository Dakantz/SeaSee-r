from datetime import datetime
from uuid import UUID
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, ConfigDict

from app.models.job import JobStatus, PipelineStatus

class JobCreate(BaseModel):
    name: str
    task_type: Optional[str] = None
    payload: Optional[Dict[str, Any]] = None
    depends_on: Optional[List[UUID]] = None
    pipeline_id: Optional[UUID] = None

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
    pipeline_id: Optional[UUID] = None
    depends_on: Optional[List[Any]] = []

    model_config = ConfigDict(from_attributes=True)

class PipelineJobCreate(BaseModel):
    id_key: Optional[str] = None
    name: str
    task_type: Optional[str] = None
    payload: Optional[Dict[str, Any]] = None
    depends_on: Optional[List[str]] = []

class PipelineCreate(BaseModel):
    name: str
    jobs: List[PipelineJobCreate]

class PipelineResponse(BaseModel):
    id: UUID
    name: str
    status: PipelineStatus
    created_at: datetime
    updated_at: datetime
    jobs: List[JobResponse] = []

    model_config = ConfigDict(from_attributes=True)

