import uuid
from datetime import datetime
from sqlalchemy import Column, String, Integer, Float, DateTime, ForeignKey, Index, BigInteger
from sqlalchemy.dialects.postgresql import UUID, ARRAY
from sqlalchemy.types import NullType

from app.core.database import Base

class PointCloud(Base):
    __tablename__ = "pointclouds"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_id = Column(UUID(as_uuid=True), ForeignKey("jobs.id", ondelete="SET NULL"), nullable=True)
    orig_filename = Column(String(255), nullable=False)
    safe_filename = Column(String(255), nullable=True)
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
    
    transform_matrix = Column(ARRAY(Float), nullable=False, default=[1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0])

class PointCloudPatch(Base):
    __tablename__ = "pointcloud_patches"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    pointcloud_id = Column(UUID(as_uuid=True), ForeignKey("pointclouds.id", ondelete="CASCADE"), nullable=False)
    lod = Column(Integer, nullable=False, default=0)
    patch = Column(NullType)

    __table_args__ = (
        Index("idx_pointcloud_patches_pc_lod", "pointcloud_id", "lod"),
    )




class BathymetryRaster(Base):
    __tablename__ = "bathymetry_raster"

    rid = Column(Integer, primary_key=True, autoincrement=True)
    rast = Column(NullType)
    filename = Column(String(255), nullable=True)
    pointcloud_id = Column(UUID(as_uuid=True), ForeignKey("pointclouds.id", ondelete="CASCADE"), nullable=True)


