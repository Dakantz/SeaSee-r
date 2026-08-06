"""Add pointcloud_patches table

Revision ID: e71d80be2196
Revises: d60c7c7992f5
Create Date: 2026-08-03 16:47:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e71d80be2196'
down_revision: Union[str, Sequence[str], None] = 'd60c7c7992f5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
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


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DROP INDEX IF EXISTS idx_pointcloud_patches_pc_lod;")
    op.execute("DROP TABLE IF EXISTS pointcloud_patches;")
