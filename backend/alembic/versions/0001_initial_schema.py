"""initial_schema

Revision ID: 0001_initial_schema
Revises: 
Create Date: 2026-08-11 15:40:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '0001_initial_schema'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Extensions
    op.execute("CREATE EXTENSION IF NOT EXISTS postgis;")
    op.execute("CREATE EXTENSION IF NOT EXISTS postgis_raster;")
    op.execute("CREATE EXTENSION IF NOT EXISTS pointcloud;")

    # 1. Jobs Table
    op.create_table(
        'jobs',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('status', sa.Enum('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', name='jobstatus'), nullable=False),
        sa.Column('progress', sa.Float(), nullable=False, server_default='0.0'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('payload', sa.JSON(), nullable=True),
        sa.Column('result', sa.JSON(), nullable=True),
        sa.Column('error_message', sa.Text(), nullable=True),
    )

    # 2. PointClouds Table
    op.create_table(
        'pointclouds',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('job_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('jobs.id', ondelete='SET NULL'), nullable=True),
        sa.Column('orig_filename', sa.String(length=255), nullable=False),
        sa.Column('safe_filename', sa.String(length=255), nullable=True),
        sa.Column('number_of_points', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('min_x', sa.Float(), nullable=True),
        sa.Column('min_y', sa.Float(), nullable=True),
        sa.Column('min_z', sa.Float(), nullable=True),
        sa.Column('max_x', sa.Float(), nullable=True),
        sa.Column('max_y', sa.Float(), nullable=True),
        sa.Column('max_z', sa.Float(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('pcid', sa.Integer(), nullable=False),
        sa.Column('transform_matrix', postgresql.ARRAY(sa.Float()), nullable=False),
    )

    # 3. PointCloud Patches Table
    op.execute("""
        CREATE TABLE IF NOT EXISTS pointcloud_patches (
            id BIGSERIAL PRIMARY KEY,
            pointcloud_id UUID NOT NULL REFERENCES pointclouds(id) ON DELETE CASCADE,
            lod INTEGER NOT NULL DEFAULT 0,
            patch PCPATCH
        );
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_pointcloud_patches_pc_lod
        ON pointcloud_patches (pointcloud_id, lod);
    """)

    # 4. PointCloud Camera Routes Table
    op.create_table(
        'pointcloud_camera_routes',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('pointcloud_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('pointclouds.id', ondelete='CASCADE'), nullable=False),
        sa.Column('orig_filename', sa.String(length=255), nullable=False),
        sa.Column('safe_filename', sa.String(length=255), nullable=True),
        sa.Column('number_of_points', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('min_x', sa.Float(), nullable=True),
        sa.Column('min_y', sa.Float(), nullable=True),
        sa.Column('min_z', sa.Float(), nullable=True),
        sa.Column('max_x', sa.Float(), nullable=True),
        sa.Column('max_y', sa.Float(), nullable=True),
        sa.Column('max_z', sa.Float(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('pcid', sa.Integer(), nullable=False),
        sa.Column('transform_matrix', postgresql.ARRAY(sa.Float()), nullable=False),
    )

    # 5. Bathymetry Raster Table
    op.execute("""
        CREATE TABLE IF NOT EXISTS bathymetry_raster (
            rid SERIAL PRIMARY KEY,
            rast RASTER,
            filename VARCHAR(255),
            pointcloud_id UUID REFERENCES pointclouds(id) ON DELETE CASCADE
        );
    """)

    # 6. Upload Metadata Table
    op.create_table(
        'upload_metadata',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('batch_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('orig_filename', sa.String(length=255), nullable=False),
        sa.Column('safe_filename', sa.String(length=255), nullable=True),
        sa.Column('content_type', sa.String(length=100), nullable=True),
        sa.Column('status', sa.Enum('PENDING', 'UPLOADING', 'COMPLETED', 'FAILED', name='videostatus'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
    )

    # 7. Videos Table
    op.create_table(
        'videos',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('upload_metadata_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('upload_metadata.id', ondelete='CASCADE'), nullable=False),
        sa.Column('content_type', sa.String(length=100), nullable=True),
        sa.Column('total_bytes', sa.Integer(), nullable=True),
        sa.Column('video_start_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('video_stop_at', sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table('videos')
    op.drop_table('upload_metadata')
    op.execute("DROP TABLE IF EXISTS bathymetry_raster CASCADE;")
    op.drop_table('pointcloud_camera_routes')
    op.execute("DROP INDEX IF EXISTS idx_pointcloud_patches_pc_lod;")
    op.execute("DROP TABLE IF EXISTS pointcloud_patches CASCADE;")
    op.drop_table('pointclouds')
    op.drop_table('jobs')
    op.execute("DROP TYPE IF EXISTS jobstatus")
    op.execute("DROP TYPE IF EXISTS videostatus")
