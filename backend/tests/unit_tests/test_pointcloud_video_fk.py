import uuid
from datetime import datetime, timezone
import pytest
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.database import async_session
from app.models.pointcloud import PointCloudMetadata
from app.models.video import UploadMetadata, VideoStatus


@pytest.fixture
def anyio_backend():
    return 'asyncio'


@pytest.mark.anyio
async def test_pointcloud_upload_batch_id_nn_relationship(test_environment):
    async with async_session() as db_session:
        batch_id = uuid.uuid4()

        # Create multiple upload metadata records for the same batch (e.g., video split into multiple files)
        upload1 = UploadMetadata(
            id=uuid.uuid4(),
            batch_id=batch_id,
            orig_filename="test_video_part1.mp4",
            safe_filename="test_video_part1.mp4",
            status=VideoStatus.COMPLETED,
            created_at=datetime.now(timezone.utc)
        )
        upload2 = UploadMetadata(
            id=uuid.uuid4(),
            batch_id=batch_id,
            orig_filename="test_video_part2.mp4",
            safe_filename="test_video_part2.mp4",
            status=VideoStatus.COMPLETED,
            created_at=datetime.now(timezone.utc)
        )
        db_session.add_all([upload1, upload2])
        await db_session.flush()

        # Create multiple point clouds associated with the same batch_id (e.g., multiple reconstructions)
        pc1 = PointCloudMetadata(
            id=uuid.uuid4(),
            orig_filename="pc1.ply",
            number_of_points=100,
            pcid=1,
            created_at=datetime.now(timezone.utc),
            batch_id=batch_id,
            reconstruction_index=0
        )
        pc2 = PointCloudMetadata(
            id=uuid.uuid4(),
            orig_filename="pc2.ply",
            number_of_points=200,
            pcid=1,
            created_at=datetime.now(timezone.utc),
            batch_id=batch_id,
            reconstruction_index=1
        )
        db_session.add_all([pc1, pc2])
        await db_session.commit()

        # Query UploadMetadata and verify navigation to PointClouds (N-to-N via batch_id)
        stmt_u = select(UploadMetadata).options(selectinload(UploadMetadata.pointclouds)).where(UploadMetadata.id == upload1.id)
        res_u = await db_session.execute(stmt_u)
        retrieved_upload = res_u.scalar_one()

        assert len(retrieved_upload.pointclouds) == 2
        retrieved_pc_ids = {pc.id for pc in retrieved_upload.pointclouds}
        assert pc1.id in retrieved_pc_ids
        assert pc2.id in retrieved_pc_ids

        # Query PointCloudMetadata and verify navigation to Uploads (N-to-N via batch_id)
        stmt_pc = select(PointCloudMetadata).options(selectinload(PointCloudMetadata.upload_metadata)).where(PointCloudMetadata.id == pc1.id)
        res_pc = await db_session.execute(stmt_pc)
        retrieved_pc = res_pc.scalar_one()

        assert retrieved_pc.batch_id == batch_id
        assert len(retrieved_pc.upload_metadata) == 2
        retrieved_upload_ids = {u.id for u in retrieved_pc.upload_metadata}
        assert upload1.id in retrieved_upload_ids
        assert upload2.id in retrieved_upload_ids
