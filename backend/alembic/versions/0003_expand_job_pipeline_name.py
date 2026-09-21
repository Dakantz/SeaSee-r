"""expand_job_pipeline_name

Revision ID: 0003_expand_job_pipeline_name
Revises: 0002_job_pipeline
Create Date: 2026-09-21 18:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '0003_expand_job_pipeline_name'
down_revision: Union[str, None] = '0002_job_pipeline'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column('pipelines', 'name', type_=sa.Text(), existing_type=sa.String(length=255), nullable=False)
    op.alter_column('jobs', 'name', type_=sa.Text(), existing_type=sa.String(length=255), nullable=False)


def downgrade() -> None:
    op.alter_column('jobs', 'name', type_=sa.String(length=255), existing_type=sa.Text(), nullable=False)
    op.alter_column('pipelines', 'name', type_=sa.String(length=255), existing_type=sa.Text(), nullable=False)
