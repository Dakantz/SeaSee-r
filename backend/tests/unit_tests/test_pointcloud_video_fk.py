import uuid
from datetime import datetime, timezone
import pytest
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.database import async_session
from app.models.pointcloud import PointCloudMetadata
from app.models.video import Video, UploadMetadata, VideoStatus


@pytest.fixture
def anyio_backend():
    return 'asyncio'


@pytest.mark.anyio
async def test_pointcloud_video_fk_relationship(test_environment):
    async with async_session() as db_session:
        # Create upload metadata
        upload = UploadMetadata(
            id=uuid.uuid4(),
            orig_filename="test_video.mp4",
            safe_filename="test_video.mp4",
            status=VideoStatus.COMPLETED,
            created_at=datetime.now(timezone.utc)
        )
        db_session.add(upload)
        await db_session.flush()

        # Create video metadata
        video = Video(
            id=uuid.uuid4(),
            upload_metadata_id=upload.id,
            video_start_at=datetime.now(timezone.utc),
            video_stop_at=datetime.now(timezone.utc)
        )
        db_session.add(video)
        await db_session.flush()

        # Create multiple point clouds associated with the same video metadata (1-to-N relationship)
        pc1 = PointCloudMetadata(
            id=uuid.uuid4(),
            orig_filename="pc1.ply",
            number_of_points=100,
            pcid=1,
            created_at=datetime.now(timezone.utc),
            video_metadata_id=video.id
        )
        pc2 = PointCloudMetadata(
            id=uuid.uuid4(),
            orig_filename="pc2.ply",
            number_of_points=200,
            pcid=1,
            created_at=datetime.now(timezone.utc),
            video_metadata_id=video.id
        )
        db_session.add_all([pc1, pc2])
        await db_session.commit()

        # Query video and verify relationship navigation using selectinload
        stmt = select(Video).options(selectinload(Video.pointclouds)).where(Video.id == video.id)
        res = await db_session.execute(stmt)
        retrieved_video = res.scalar_one()

        # Verify video -> pointclouds 1 to N
        pointcloud_ids = [pc.id for pc in retrieved_video.pointclouds]
        assert len(retrieved_video.pointclouds) == 2
        assert pc1.id in pointcloud_ids
        assert pc2.id in pointcloud_ids

        # Query pointcloud and verify pointcloud -> video relationship navigation
        stmt_pc = select(PointCloudMetadata).options(selectinload(PointCloudMetadata.video_metadata)).where(PointCloudMetadata.id == pc1.id)
        res_pc = await db_session.execute(stmt_pc)
        retrieved_pc = res_pc.scalar_one()
        assert retrieved_pc.video_metadata_id == video.id
        assert retrieved_pc.video_metadata.id == video.id
