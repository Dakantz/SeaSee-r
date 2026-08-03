import os
import time
import shutil
import pytest
import anyio
from httpx import AsyncClient, ASGITransport
from sqlalchemy import text
from app.core.config import settings, StorageType
from app.core.database import async_session, engine

# Simple dummy PLY file content
PLY_CONTENT = b"""ply
format ascii 1.0
element vertex 3
property float x
property float y
property float z
end_header
0.0 0.0 0.0
0.0 1.0 0.0
1.0 1.0 0.0
"""

@pytest.fixture
def anyio_backend():
    return 'asyncio'

@pytest.fixture(autouse=True)
async def cleanup_engine():
    yield
    await engine.dispose()

@pytest.fixture
async def async_client(test_environment):
    from app.main import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac

async def clean_database_records(file_id: str, job_id: str):
    """Clean up the pointcloud metadata, patches, and jobs from database."""
    async with async_session() as session:
        # Delete patches for this pointcloud if pointcloud_patches table exists
        try:
            await session.execute(text("DELETE FROM pointcloud_patches WHERE pointcloud_id = :id"), {"id": file_id})
        except Exception:
            pass
        # Delete pointcloud metadata
        await session.execute(text("DELETE FROM pointclouds WHERE id = :id"), {"id": file_id})
        # Delete job record
        if job_id and job_id.lower() != "none":
            await session.execute(text("DELETE FROM jobs WHERE id = :job_id"), {"job_id": job_id})
        await session.commit()

@pytest.mark.anyio
async def test_pointcloud_filesystem_flow(async_client):
    """
    Test the upload, list, and download flow using filesystem storage.
    """
    # Override pointcloud storage type settings to filesystem
    original_storage_type = settings.pointcloud_storage_type
    settings.pointcloud_storage_type = StorageType.filesystem

    file_id = None
    job_id = None

    try:
        # 1. Simulate TUSD upload and webhook
        import uuid
        file_id = str(uuid.uuid4())
        
        os.makedirs(settings.upload_dir, exist_ok=True)
        with open(os.path.join(settings.upload_dir, file_id), "wb") as f:
            f.write(PLY_CONTENT)
            
        payload = {
            "EventName": "post-finish",
            "Upload": {
                "ID": file_id,
                "Size": len(PLY_CONTENT),
                "MetaData": {
                    "name": "test_fs.ply",
                    "filename": "test_fs.ply",
                    "filetype": "application/octet-stream",
                    "upload_type": "pointcloud"
                }
            }
        }
        response = await async_client.post("/webhooks/tusd", json=payload)
        assert response.status_code == 200
        assert response.json()["status"] == "ok"
        
        async with async_session() as session:
            res = await session.execute(text("SELECT id FROM jobs WHERE payload->>'file_id' = :file_id ORDER BY created_at DESC LIMIT 1"), {"file_id": file_id})
            job_id = str(res.scalar())

        # 2. Check that the file is in the list of pointclouds
        response = await async_client.get("/pointclouds/")
        assert response.status_code == 200
        pointclouds_list = response.json()
        assert f"{file_id}.ply" in pointclouds_list

        # 3. Download the uploaded file by ID
        response = await async_client.get(f"/pointclouds/{file_id}")
        assert response.status_code == 200
        assert response.content == PLY_CONTENT

    finally:
        # Restore configuration
        settings.pointcloud_storage_type = original_storage_type

        # Cleanup created files
        if file_id:
            file_path = os.path.join(settings.upload_dir, f"{file_id}.ply")
            if os.path.exists(file_path):
                os.remove(file_path)
            ept_path = os.path.join(settings.ept_dir, file_id)
            if os.path.exists(ept_path):
                shutil.rmtree(ept_path)
        
        # Cleanup database job record created by the upload endpoint
        if job_id:
            await clean_database_records(file_id=file_id, job_id=job_id)


@pytest.mark.anyio
async def test_pointcloud_database_flow(async_client):
    """
    Test the upload, wait for conversion, list, and download flow using database storage.
    """
    # Override pointcloud storage type settings to database
    original_storage_type = settings.pointcloud_storage_type
    settings.pointcloud_storage_type = StorageType.database

    file_id = None
    job_id = None

    try:
        # 1. Simulate TUSD upload and webhook
        import uuid
        file_id = str(uuid.uuid4())
        
        os.makedirs(settings.upload_dir, exist_ok=True)
        with open(os.path.join(settings.upload_dir, file_id), "wb") as f:
            f.write(PLY_CONTENT)
            
        # 1. Create PointCloud metadata record in DB
        from app.models import PointCloud
        async with async_session() as session:
            pc = PointCloud(
                id=uuid.UUID(file_id),
                orig_filename="test_db.ply",
                safe_filename=f"{file_id}.ply",
                number_of_points=3,
                pcid=1
            )
            session.add(pc)
            await session.commit()

        # 3. Check that the file is in the list of pointclouds
        response = await async_client.get("/pointclouds/")
        assert response.status_code == 200
        pointclouds_list = response.json()
        assert any(pc.get("id") == file_id for pc in pointclouds_list)

        # 4. Download the pointcloud from database stream
        from unittest.mock import patch, MagicMock
        mock_proc = MagicMock()
        mock_proc.communicate.return_value = (PLY_CONTENT, b"")
        mock_proc.returncode = 0

        with patch("app.services.pointcloud.database.subprocess.Popen", return_value=mock_proc):
            response = await async_client.get(f"/pointclouds/{file_id}")
            assert response.status_code == 200
            downloaded_content = response.content
            assert downloaded_content.startswith(b"ply\n")
            assert b"vertex" in downloaded_content

    finally:
        # Restore configuration
        settings.pointcloud_storage_type = original_storage_type

        # Cleanup created files
        if file_id:
            file_path = os.path.join(settings.upload_dir, f"{file_id}.ply")
            if os.path.exists(file_path):
                os.remove(file_path)
            ept_path = os.path.join(settings.ept_dir, file_id)
            if os.path.exists(ept_path):
                shutil.rmtree(ept_path)
        
        # Cleanup database metadata record, job, and dynamic table
        if file_id or job_id:
            await clean_database_records(file_id=file_id or "", job_id=job_id or "")
