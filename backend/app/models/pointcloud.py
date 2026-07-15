import uuid
from datetime import datetime
from sqlalchemy import Column, String, Integer, Float, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID

from app.core.database import Base

class PointCloudMetadata(Base):
    __tablename__ = "pointclouds"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_id = Column(UUID(as_uuid=True), ForeignKey("jobs.id", ondelete="SET NULL"), nullable=True)
    name = Column(String(255), nullable=False)
    number_of_points = Column(Integer, nullable=False, default=0)
    
    # 3D bounding box coordinates
    min_x = Column(Float, nullable=True)
    min_y = Column(Float, nullable=True)
    min_z = Column(Float, nullable=True)
    max_x = Column(Float, nullable=True)
    max_y = Column(Float, nullable=True)
    max_z = Column(Float, nullable=True)

    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    pcid = Column(Integer, nullable=False)  # pgPointcloud format format schema ID
