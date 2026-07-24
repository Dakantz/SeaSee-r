"""add_video_metadata_table

Revision ID: abcdef123456
Revises: 5bf8c505d38a
Create Date: 2026-07-16 17:35:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'abcdef123456'
down_revision: Union[str, None] = '5bf8c505d38a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('video_metadata',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('video_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('orig_filename', sa.String(length=255), nullable=False),
        sa.Column('safe_filename', sa.String(length=255), nullable=False),
        sa.Column('content_type', sa.String(length=100), nullable=True),
        sa.Column('total_bytes', sa.Integer(), nullable=True),
        sa.Column('status', sa.Enum('PENDING', 'UPLOADING', 'COMPLETED', 'FAILED', name='videostatus'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['video_id'], ['videos.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )


def downgrade() -> None:
    op.drop_table('video_metadata')