import enum
import uuid
from datetime import datetime
from sqlalchemy import Column, String, Enum as SQLEnum, Float, DateTime, JSON, Text
from sqlalchemy.dialects.postgresql import UUID

from app.core.database import Base

class JobStatus(str, enum.Enum):
    PENDING = "PENDING"
    RUNNING = "RUNNING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"

class Job(Base):
    __tablename__ = "jobs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(255), nullable=False)
    task_type = Column(String(100), nullable=True)
    status = Column(SQLEnum(JobStatus), nullable=False, default=JobStatus.PENDING)
    progress = Column(Float, nullable=False, default=0.0)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    payload = Column(JSON, nullable=True)
    result = Column(JSON, nullable=True)
    error_message = Column(Text, nullable=True)
