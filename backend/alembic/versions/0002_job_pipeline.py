"""add_job_pipeline

Revision ID: 0002_job_pipeline
Revises: 0001_initial_schema
Create Date: 2026-09-10 16:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = '0002_job_pipeline'
down_revision: Union[str, None] = '0001_initial_schema'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Pipelines Table
    op.create_table(
        'pipelines',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('status', sa.Enum('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED', name='pipelinestatus'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    )

    # 2. Add columns to jobs table
    op.add_column('jobs', sa.Column('pipeline_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('pipelines.id', ondelete='CASCADE'), nullable=True))
    op.add_column('jobs', sa.Column('depends_on', sa.JSON(), nullable=True, server_default='[]'))

    # Update jobstatus enum to include BLOCKED and CANCELLED
    op.execute("ALTER TYPE jobstatus ADD VALUE IF NOT EXISTS 'BLOCKED';")
    op.execute("ALTER TYPE jobstatus ADD VALUE IF NOT EXISTS 'CANCELLED';")


def downgrade() -> None:
    op.drop_column('jobs', 'depends_on')
    op.drop_column('jobs', 'pipeline_id')
    op.drop_table('pipelines')
    op.execute("DROP TYPE IF EXISTS pipelinestatus")
