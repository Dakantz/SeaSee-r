import enum
import uuid
from datetime import datetime
from sqlalchemy import Column, String, Enum as SQLEnum, Integer, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.dialects.postgresql import UUID

from app.core.database import Base

class VideoStatus(str, enum.Enum):
    PENDING = "PENDING"
    UPLOADING = "UPLOADING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"

class Video(Base):
    __tablename__ = "videos"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    batch_id = Column(UUID(as_uuid=True), nullable=True)
    orig_filename = Column(String(255), nullable=False)
    safe_filename = Column(String(255), nullable=True)
    status = Column(SQLEnum(VideoStatus), nullable=False, default=VideoStatus.PENDING)
    total_bytes = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    completed_at = Column(DateTime(timezone=True), nullable=True)


class VideoMetadata(Base):
    __tablename__ = "video_metadata"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    batch_id = Column(UUID(as_uuid=True), nullable=True)
    orig_filename = Column(String(255), nullable=False)
    safe_filename = Column(String(255), nullable=True)
    content_type = Column(String(100), nullable=True)
    total_bytes = Column(Integer, nullable=True)
    status = Column(SQLEnum(VideoStatus), nullable=False, default=VideoStatus.PENDING)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    completed_at = Column(DateTime(timezone=True), nullable=True)
