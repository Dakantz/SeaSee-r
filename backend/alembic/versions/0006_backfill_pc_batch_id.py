"""backfill_pc_batch_id

Revision ID: 0006_backfill_pc_batch_id
Revises: 0005_update_batch_id_relations
Create Date: 2026-09-25 14:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = '0006_backfill_pc_batch_id'
down_revision: Union[str, None] = '0005_update_batch_id_relations'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Backfill pointcloud_metadata.batch_id from jobs.payload->>'batch_id' if available
    op.execute("""
        UPDATE pointcloud_metadata pm
        SET batch_id = (j.payload->>'batch_id')::uuid
        FROM jobs j
        WHERE pm.job_id = j.id
          AND pm.batch_id IS NULL
          AND j.payload->>'batch_id' IS NOT NULL
          AND j.payload->>'batch_id' ~ '^[0-9a-fA-F-]{36}$';
    """)
    # Also backfill if upload_metadata has matching file_id or filename
    op.execute("""
        UPDATE pointcloud_metadata pm
        SET batch_id = um.batch_id
        FROM upload_metadata um
        WHERE pm.batch_id IS NULL
          AND um.batch_id IS NOT NULL
          AND (
              pm.orig_filename LIKE '%' || replace(um.batch_id::text, '-', '_') || '%'
              OR pm.safe_filename LIKE '%' || replace(um.batch_id::text, '-', '_') || '%'
              OR pm.orig_filename LIKE '%' || um.batch_id::text || '%'
              OR pm.safe_filename LIKE '%' || um.batch_id::text || '%'
              OR pm.orig_filename LIKE '%' || replace(um.id::text, '-', '_') || '%'
              OR pm.safe_filename LIKE '%' || replace(um.id::text, '-', '_') || '%'
          );
    """)


def downgrade() -> None:
    pass
