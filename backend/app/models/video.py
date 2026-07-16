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
    filename = Column(String(255), nullable=False)
    safe_filename = Column(String(255), nullable=False, unique=True)
    status = Column(SQLEnum(VideoStatus), nullable=False, default=VideoStatus.PENDING)
    total_bytes = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    completed_at = Column(DateTime(timezone=True), nullable=True)

    metadata_files = relationship("VideoMetadata", back_populates="video", cascade="all, delete-orphan")

class VideoMetadata(Base):
    __tablename__ = "video_metadata"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    video_id = Column(UUID(as_uuid=True), ForeignKey("videos.id", ondelete="CASCADE"), nullable=False)
    filename = Column(String(255), nullable=False)
    safe_filename = Column(String(255), nullable=False, index=True)
    content_type = Column(String(100), nullable=True)
    total_bytes = Column(Integer, nullable=True)
    status = Column(SQLEnum(VideoStatus), nullable=False, default=VideoStatus.PENDING)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    completed_at = Column(DateTime(timezone=True), nullable=True)

    video = relationship("Video", back_populates="metadata_files")
