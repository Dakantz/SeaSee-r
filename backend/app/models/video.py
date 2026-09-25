import enum
import uuid
from datetime import datetime
from sqlalchemy import Column, String, Enum as SQLEnum, Integer, DateTime, ForeignKey
from sqlalchemy.orm import relationship, foreign, remote
from sqlalchemy.dialects.postgresql import UUID

from app.core.database import Base

class VideoStatus(str, enum.Enum):
    PENDING = "PENDING"
    UPLOADING = "UPLOADING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"

class UploadMetadata(Base):
    __tablename__ = "upload_metadata"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    batch_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    orig_filename = Column(String(255), nullable=False)
    safe_filename = Column(String(255), nullable=True)
    content_type = Column(String(100), nullable=True)
    status = Column(SQLEnum(VideoStatus), nullable=False, default=VideoStatus.PENDING)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    completed_at = Column(DateTime(timezone=True), nullable=True)

    videos = relationship("Video", back_populates="upload_metadata", cascade="all, delete-orphan")
    pointclouds = relationship(
        "PointCloudMetadata",
        primaryjoin="foreign(UploadMetadata.batch_id) == remote(PointCloudMetadata.batch_id)",
        uselist=True,
        viewonly=True,
    )


class Video(Base):
    __tablename__ = "video_metadata"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    upload_metadata_id = Column(UUID(as_uuid=True), ForeignKey("upload_metadata.id", ondelete="CASCADE"), nullable=False)
    content_type = Column(String(100), nullable=True)
    total_bytes = Column(Integer, nullable=True)
    video_start_at = Column(DateTime(timezone=True), nullable=False)
    video_stop_at = Column(DateTime(timezone=True), nullable=False)

    upload_metadata = relationship("UploadMetadata", back_populates="videos")

