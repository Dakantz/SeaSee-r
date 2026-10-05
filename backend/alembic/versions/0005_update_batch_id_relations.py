"""update_batch_id_relations

Revision ID: 0005_update_batch_id_relations
Revises: 0004_add_opensfm_stats
Create Date: 2026-09-25 12:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = '0005_update_batch_id_relations'
down_revision: Union[str, None] = '0004_add_opensfm_stats'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Update pointcloud_metadata
    op.execute("ALTER TABLE pointcloud_metadata DROP CONSTRAINT IF EXISTS pointcloud_metadata_video_metadata_id_fkey;")
    op.execute("DROP INDEX IF EXISTS idx_pointcloud_metadata_video_metadata_id;")
    op.drop_column('pointcloud_metadata', 'video_metadata_id')
    op.add_column('pointcloud_metadata', sa.Column('batch_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.create_index('idx_pointcloud_metadata_batch_id', 'pointcloud_metadata', ['batch_id'])

    # 2. Update log_data
    op.execute("ALTER TABLE log_data DROP CONSTRAINT IF EXISTS log_data_video_metadata_id_fkey;")
    op.drop_column('log_data', 'video_metadata_id')
    op.add_column('log_data', sa.Column('batch_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.create_index('idx_log_data_batch_id', 'log_data', ['batch_id'])

    # 3. Add index on upload_metadata.batch_id
    op.execute("CREATE INDEX IF NOT EXISTS idx_upload_metadata_batch_id ON upload_metadata (batch_id);")


def downgrade() -> None:
    # 1. Revert upload_metadata index
    op.execute("DROP INDEX IF EXISTS idx_upload_metadata_batch_id;")

    # 2. Revert log_data
    op.drop_index('idx_log_data_batch_id', table_name='log_data')
    op.drop_column('log_data', 'batch_id')
    op.add_column(
        'log_data',
        sa.Column('video_metadata_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('video_metadata.id', ondelete='CASCADE'), nullable=True)
    )

    # 3. Revert pointcloud_metadata
    op.drop_index('idx_pointcloud_metadata_batch_id', table_name='pointcloud_metadata')
    op.drop_column('pointcloud_metadata', 'batch_id')
    op.add_column(
        'pointcloud_metadata',
        sa.Column('video_metadata_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('video_metadata.id', ondelete='SET NULL'), nullable=True)
    )
    op.execute("CREATE INDEX IF NOT EXISTS idx_pointcloud_metadata_video_metadata_id ON pointcloud_metadata (video_metadata_id);")
