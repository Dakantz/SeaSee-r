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

        # Verify PointCloudMetadataResponse schema includes batch_id
        from app.schemas.pointcloud import PointCloudMetadataResponse
        pydantic_res = PointCloudMetadataResponse.model_validate(retrieved_pc)
        assert pydantic_res.batch_id == batch_id
        data_dump = pydantic_res.model_dump()
        assert "batch_id" in data_dump
        assert data_dump["batch_id"] == batch_id


@pytest.mark.anyio
async def test_upsert_pointcloud_metadata_batch_id_direct_and_fallback(test_environment):
    from app.services.pointcloud.db_utils import upsert_pointcloud_metadata
    from app.models.job import Job

    test_batch_id = uuid.uuid4()
    pc_id = uuid.uuid4()
    parent_job_id = uuid.uuid4()
    child_job_id = uuid.uuid4()

    async with async_session() as session:
        # Create a parent job that has the batch_id in payload
        parent_job = Job(
            id=parent_job_id,
            name="Parent OpenSfM Dense",
            task_type="opensfm_dense",
            status="COMPLETED",
            payload={"batch_id": str(test_batch_id), "dataset_name": "test_dataset"}
        )
        child_job = Job(
            id=child_job_id,
            name="Child OpenSfM Ingest",
            task_type="opensfm_ingest",
            status="RUNNING",
            payload={},
            depends_on=[str(parent_job_id)]
        )
        session.add_all([parent_job, child_job])
        await session.commit()

        # Upsert pointcloud with fallback via child_job_id
        pc = await upsert_pointcloud_metadata(
            session=session,
            file_id=str(pc_id),
            file_path="/dummy/path/reconstruction.ply",
            bbox={"min_x": 0.0, "max_x": 10.0, "min_y": 0.0, "max_y": 10.0, "min_z": 0.0, "max_z": 5.0},
            number_of_points=500,
            pcid=1,
            job_id=str(child_job_id)
        )
        assert pc.batch_id == test_batch_id
