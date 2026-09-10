import enum
import uuid
from datetime import datetime
from sqlalchemy import Column, String, Enum as SQLEnum, Float, DateTime, JSON, Text, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.core.database import Base

class JobStatus(str, enum.Enum):
    PENDING = "PENDING"
    BLOCKED = "BLOCKED"
    RUNNING = "RUNNING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"

class PipelineStatus(str, enum.Enum):
    PENDING = "PENDING"
    RUNNING = "RUNNING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"

class Pipeline(Base):
    __tablename__ = "pipelines"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(255), nullable=False)
    status = Column(SQLEnum(PipelineStatus), nullable=False, default=PipelineStatus.PENDING)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    jobs = relationship("Job", back_populates="pipeline", cascade="all, delete-orphan")

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
    
    pipeline_id = Column(UUID(as_uuid=True), ForeignKey("pipelines.id", ondelete="CASCADE"), nullable=True)
    depends_on = Column(JSON, nullable=False, default=list)

    pipeline = relationship("Pipeline", back_populates="jobs")

