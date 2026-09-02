import uuid
from datetime import datetime
from sqlalchemy import Column, String, Integer, Float, DateTime, ForeignKey, BigInteger
from sqlalchemy.dialects.postgresql import UUID, ARRAY
from geoalchemy2 import Geometry

from app.core.database import Base
from app.core.config import settings

class CameraHeader(Base):
    __tablename__ = "camera_headers"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    pointcloud_id = Column(UUID(as_uuid=True), ForeignKey("pointcloud_metadata.id", ondelete="CASCADE"), nullable=False)
    focal = Column(Float, nullable=True)
    width = Column(Integer, nullable=True)
    height = Column(Integer, nullable=True)
    camera = Column(String(255), nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)


class CameraFrame(Base):
    __tablename__ = "camera_frames"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    camera_header_id = Column(UUID(as_uuid=True), ForeignKey("camera_headers.id", ondelete="CASCADE"), nullable=False, index=True)
    timestamp = Column(BigInteger, nullable=False, index=True)
    position = Column(Geometry(geometry_type="POINTZ", srid=settings.camera_srid), nullable=True)
    direction = Column(Geometry(geometry_type="POINTZ", srid=settings.camera_srid), nullable=True)
    rotation = Column(ARRAY(Float), nullable=True)
    relative_time = Column(Float, nullable=True)
    filename = Column(String(255), nullable=True)
