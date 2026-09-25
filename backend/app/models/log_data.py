import uuid
from datetime import datetime
from typing import Dict, Any, Optional

from sqlalchemy import BigInteger, DateTime, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship, foreign, remote
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.core.database import Base


class LogData(Base):
    __tablename__ = "log_data"

    # UUID Primary Key
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    
    # UUID Batch ID grouping telemetry with uploads
    batch_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), index=True, nullable=True)
    
    # Indexed BigInteger for fast chronological queries
    timestamp: Mapped[int] = mapped_column(BigInteger, index=True, nullable=False)
    
    # Human-readable datetime (optional, but good for raw SQL readability)
    time_recorded: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), index=True, nullable=True)
    
    # Optimized JSONB column for PostgreSQL
    payload: Mapped[Dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)

    # Relationships
    upload_metadata = relationship(
        "UploadMetadata",
        primaryjoin="foreign(LogData.batch_id) == remote(UploadMetadata.batch_id)",
        uselist=True,
        viewonly=True,
    )

    # Add a GIN index for blazing fast JSONB queries
    __table_args__ = (
        Index('ix_log_data_payload', 'payload', postgresql_using='gin'),
    )
