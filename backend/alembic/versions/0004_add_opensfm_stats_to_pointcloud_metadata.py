"""add_opensfm_stats_to_pointcloud_metadata

Revision ID: 0004_add_opensfm_stats
Revises: 0003_expand_job_pipeline_name
Create Date: 2026-09-22 16:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '0004_add_opensfm_stats'
down_revision: Union[str, None] = '0003_expand_job_pipeline_name'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('pointcloud_metadata', sa.Column('reconstruction_index', sa.Integer(), nullable=True, server_default='0'))
    op.add_column('pointcloud_metadata', sa.Column('views', sa.Integer(), nullable=True))
    op.add_column('pointcloud_metadata', sa.Column('sparse_points', sa.Integer(), nullable=True))
    op.add_column('pointcloud_metadata', sa.Column('dense_points', sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column('pointcloud_metadata', 'dense_points')
    op.drop_column('pointcloud_metadata', 'sparse_points')
    op.drop_column('pointcloud_metadata', 'views')
    op.drop_column('pointcloud_metadata', 'reconstruction_index')
