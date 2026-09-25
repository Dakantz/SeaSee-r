import uuid
from datetime import datetime
from sqlalchemy import Column, String, Integer, Float, DateTime, ForeignKey, Index, BigInteger, func
from sqlalchemy.orm import relationship, foreign, remote
from sqlalchemy.dialects.postgresql import UUID, ARRAY
from sqlalchemy.types import NullType, UserDefinedType

from geoalchemy2 import Geometry
from app.core.database import Base
from app.core.config import settings


class PCPatch(UserDefinedType):
    """
    SQLAlchemy UserDefinedType mapping for pgPointcloud's PCPATCH data type.
    """
    def __init__(self, pcid: int | None = None, as_hex: bool = False):
        self.pcid = pcid
        self.as_hex = as_hex

    def get_col_spec(self, **kw):
        if self.pcid is not None:
            return f"PCPATCH({self.pcid})"
        return "PCPATCH"

    def bind_processor(self, dialect):
        def process(value):
            if value is None:
                return None
            return value
        return process

    def result_processor(self, dialect, coltype):
        def process(value):
            if value is None:
                return None
            return value
        return process

    def column_expression(self, col):
        if self.as_hex:
            return func.PC_AsHex(col)
        return col

    class comparator_factory(UserDefinedType.Comparator):
        def num_points(self):
            return func.PC_NumPoints(self.expr)

        def envelope(self):
            return func.PC_Envelope(self.expr)

        def summary(self):
            return func.PC_Summary(self.expr)


class PointCloudMetadata(Base):
    __tablename__ = "pointcloud_metadata"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_id = Column(UUID(as_uuid=True), ForeignKey("jobs.id", ondelete="SET NULL"), nullable=True)
    batch_id = Column(UUID(as_uuid=True), nullable=True, index=True)
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

    # Center point geometry
    center = Column(Geometry(geometry_type="POINTZ", srid=settings.backend_srid), nullable=True)

    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    pcid = Column(Integer, nullable=False)  # pgPointcloud format format schema ID
    
    transform_matrix = Column(ARRAY(Float), nullable=False, default=[1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0])
    
    # OpenSfM reconstruction statistics
    reconstruction_index = Column(Integer, nullable=True, default=0)
    views = Column(Integer, nullable=True)
    sparse_points = Column(Integer, nullable=True)
    dense_points = Column(Integer, nullable=True)

    upload_metadata = relationship(
        "UploadMetadata",
        primaryjoin="foreign(PointCloudMetadata.batch_id) == remote(UploadMetadata.batch_id)",
        uselist=True,
        viewonly=True,
    )


POINTCLOUD_PATCH_MODELS = {}

def _create_patch_model(lod: int):
    table_name = f"pointcloud_patches_lod{lod}"
    index_name = f"idx_pointcloud_patches_lod{lod}_pc"
    cls_name = f"PointCloudPatchLOD{lod}"

    attrs = {
        "__tablename__": table_name,
        "id": Column(BigInteger, primary_key=True, autoincrement=True),
        "pointcloud_id": Column(UUID(as_uuid=True), ForeignKey("pointcloud_metadata.id", ondelete="CASCADE"), nullable=False),
        "patch": Column(PCPatch()),
        "__table_args__": (
            Index(index_name, "pointcloud_id"),
        ),
    }
    return type(cls_name, (Base,), attrs)

for _lod in range(11):
    _model = _create_patch_model(_lod)
    POINTCLOUD_PATCH_MODELS[_lod] = _model
    globals()[f"PointCloudPatchLOD{_lod}"] = _model

PointCloudPatch = PointCloudPatchLOD0


class BathymetryRaster(Base):
    __tablename__ = "bathymetry_raster"

    rid = Column(Integer, primary_key=True, autoincrement=True)
    rast = Column(NullType)
    filename = Column(String(255), nullable=True)
    pointcloud_id = Column(UUID(as_uuid=True), ForeignKey("pointcloud_metadata.id", ondelete="CASCADE"), nullable=True)



