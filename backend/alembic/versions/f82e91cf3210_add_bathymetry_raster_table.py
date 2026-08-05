"""Add bathymetry_raster table and PostGIS raster extension

Revision ID: f82e91cf3210
Revises: e71d80be2196
Create Date: 2026-08-05 14:10:00.000000

"""
from typing import Sequence, Union
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'f82e91cf3210'
down_revision: Union[str, Sequence[str], None] = 'e71d80be2196'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.execute("CREATE EXTENSION IF NOT EXISTS postgis;")
    op.execute("CREATE EXTENSION IF NOT EXISTS postgis_raster;")
    op.execute("""
        CREATE TABLE IF NOT EXISTS bathymetry_raster (
            rid SERIAL PRIMARY KEY,
            rast RASTER,
            filename TEXT,
            pointcloud_id UUID REFERENCES pointclouds(id) ON DELETE CASCADE
        );
    """)


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DROP TABLE IF EXISTS bathymetry_raster CASCADE;")
