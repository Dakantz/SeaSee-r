import os
import shutil
import tempfile
import asyncio
import pytest
from fastapi.testclient import TestClient
from fastapi import HTTPException
from unittest import TestCase

from app.main import app
from app.core.config import settings
from unittest.mock import MagicMock, AsyncMock
from app.main import app
from app.core.config import settings
from app.services.pointcloud import (
    DatabasePointCloudStorageService
)
from app.api.dependencies.pointcloud import get_pointcloud_service

client = TestClient(app)

class TestPointCloudServices(TestCase):
    def test_database_service_get_invalid_uuid(self):
        mock_db = MagicMock()
        db_service = DatabasePointCloudStorageService(db_session=mock_db)
        with self.assertRaises(HTTPException) as context:
            asyncio.run(db_service.get_pointcloud("???"))
        self.assertEqual(context.exception.status_code, 400)
        self.assertEqual(context.exception.detail, "Invalid Point Cloud UUID format.")

    def test_database_service_get_not_found(self):
        mock_result = MagicMock()
        mock_result.first.return_value = None  # No metadata found
        
        mock_db = MagicMock()
        mock_db.execute = AsyncMock(return_value=mock_result)
        
        db_service = DatabasePointCloudStorageService(db_session=mock_db)
        with self.assertRaises(HTTPException) as context:
            asyncio.run(db_service.get_pointcloud("a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"))
        
        self.assertEqual(context.exception.status_code, 404)
        self.assertEqual(context.exception.detail, "Point cloud metadata not found in database.")

    def test_database_service_get_db_failure(self):
        mock_db = MagicMock()
        mock_db.execute.side_effect = Exception("DB Connection Lost")
        
        db_service = DatabasePointCloudStorageService(db_session=mock_db)
        with self.assertRaises(HTTPException) as context:
            asyncio.run(db_service.get_pointcloud("a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"))
        
        self.assertEqual(context.exception.status_code, 500)
        self.assertIn("Database query failed", context.exception.detail)

    def test_database_service_list_success(self):
        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = ["uuid-1", "uuid-2"]
        
        mock_db = MagicMock()
        mock_db.execute = AsyncMock(return_value=mock_result)
        
        db_service = DatabasePointCloudStorageService(db_session=mock_db)
        files = asyncio.run(db_service.list_pointclouds())
        
        self.assertEqual(files, ["uuid-1", "uuid-2"])

    def test_database_service_list_failure(self):
        mock_db = MagicMock()
        mock_db.execute.side_effect = Exception("Query error")
        
        db_service = DatabasePointCloudStorageService(db_session=mock_db)
        files = asyncio.run(db_service.list_pointclouds())
        
        self.assertEqual(files, [])

    def test_database_service_stream_binary_invalid_uuid(self):
        mock_db = MagicMock()
        db_service = DatabasePointCloudStorageService(db_session=mock_db)
        # Verify call succeeds with empty filter params
        response = asyncio.run(db_service.stream_pointcloud_binary(lod=0, filters=[]))
        self.assertEqual(response.media_type, "application/octet-stream")

    def test_database_service_stream_binary_success(self):
        import struct
        from unittest.mock import patch
        from app.schemas.filter import FilterCriterion

        mock_meta_result = MagicMock()
        mock_meta_result.first.return_value = ["a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"]

        async def mock_async_iter():
            yield (1.0, 2.0, 3.0, 255, 128, 64)

        class AsyncStreamContext:
            def __aiter__(self):
                return mock_async_iter()

        mock_session_inst = MagicMock()
        mock_session_inst.stream = AsyncMock(return_value=AsyncStreamContext())

        class AsyncSessionContextManager:
            async def __aenter__(self):
                return mock_session_inst
            async def __aexit__(self, exc_type, exc, tb):
                pass

        mock_db = MagicMock()
        mock_db.execute = AsyncMock(return_value=mock_meta_result)

        with patch("app.services.pointcloud.database.async_session", return_value=AsyncSessionContextManager()):
            db_service = DatabasePointCloudStorageService(db_session=mock_db)
            response = asyncio.run(db_service.stream_pointcloud_binary(lod=1, filters=[FilterCriterion(field="pointcloud_id", operator="eq", value="a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11")]))
            
            self.assertEqual(response.media_type, "application/octet-stream")


            async def consume_stream():
                chunks = []
                async for chunk in response.body_iterator:
                    chunks.append(chunk)
                return b"".join(chunks)

            binary_data = asyncio.run(consume_stream())
            self.assertEqual(len(binary_data), 16)
            x, y, z, r, g, b, a = struct.unpack('<3f4B', binary_data)
            self.assertAlmostEqual(x, 1.0)
            self.assertAlmostEqual(y, 2.0)
            self.assertAlmostEqual(z, 3.0)
            self.assertEqual(r, 255)
            self.assertEqual(g, 128)
            self.assertEqual(b, 64)
            self.assertEqual(a, 255)


def test_dependency_injection():
    mock_db = MagicMock()
    service = get_pointcloud_service(db=mock_db)
    assert isinstance(service, DatabasePointCloudStorageService)


def test_endpoint_get_pointcloud():
    from fastapi.responses import StreamingResponse
    async def dummy_gen():
        yield b"ply\ntest data\n"
        
    mock_service = MagicMock()
    mock_service.get_pointcloud = AsyncMock(return_value=StreamingResponse(dummy_gen(), media_type="application/octet-stream"))
        
    app.dependency_overrides[get_pointcloud_service] = lambda: mock_service
    
    try:
        response = client.get("/pointclouds/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11")
        assert response.status_code == 200
        assert response.content == b"ply\ntest data\n"
    finally:
        app.dependency_overrides.clear()


def test_ingest_opensfm_append_not_found():
    # Attempting to append to non-existent pointcloud returns 404
    mock_db = MagicMock()
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = None
    mock_db.execute = AsyncMock(return_value=mock_result)

    from app.core.database import get_db_session
    app.dependency_overrides[get_db_session] = lambda: mock_db

    try:
        response = client.post("/pointclouds/ingest-opensfm/append?existing_id=a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11")
        assert response.status_code == 404
        assert "not found" in response.json()["detail"]
    finally:
        app.dependency_overrides.clear()


def test_ingest_emodnet_append_tiff_file():
    mock_db = MagicMock()
    mock_pc = MagicMock()
    mock_pc.id = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"
    mock_pc.min_x, mock_pc.max_x = -10.0, 10.0
    mock_pc.min_y, mock_pc.max_y = -10.0, 10.0
    mock_pc.min_z, mock_pc.max_z = -10.0, 10.0
    mock_pc.pcid = 1

    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = mock_pc
    mock_db.execute = AsyncMock(return_value=mock_result)
    mock_db.commit = AsyncMock()
    mock_db.refresh = AsyncMock()

    from app.core.database import get_db_session
    app.dependency_overrides[get_db_session] = lambda: mock_db

    os.makedirs(settings.emodnet_ingestion_dir, exist_ok=True)
    test_file = os.path.join(settings.emodnet_ingestion_dir, "exportImage.tiff")
    with open(test_file, "w") as f:
        f.write("dummy")

    from unittest.mock import patch
    with patch("app.api.routes.pointclouds.Redis.from_url"), \
         patch("app.api.routes.pointclouds.Queue"), \
         patch("app.services.pointcloud.pdal.get_pointcloud_srs_and_stats", new=AsyncMock(return_value=({"min_x": -5, "max_x": 5, "min_y": -5, "max_y": 5, "min_z": -5, "max_z": 5}, 100, "1"))), \
         patch("app.services.pointcloud.pdal.check_bbox_within_or_overlapping", return_value=True), \
         patch("app.services.pointcloud.pdal.check_coordinate_systems_match", return_value=True), \
         patch("os.path.getsize", return_value=1024):

        try:
            response = client.post("/pointclouds/ingest-emodnet/append?existing_id=a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11&file_name=exportImage.tiff")
            assert response.status_code == 200
            data = response.json()
            assert "jobs" in data
            assert len(data["jobs"]) == 1
            assert data["jobs"][0]["geotiff"] == "exportImage.tiff"
        finally:
            if os.path.exists(test_file):
                os.remove(test_file)
            app.dependency_overrides.clear()


def test_endpoint_stream_binary():
    import struct
    from fastapi.responses import StreamingResponse

    async def dummy_gen():
        yield struct.pack('<3f4B', 10.0, 20.0, 30.0, 255, 128, 0, 255)

    dummy_response = StreamingResponse(dummy_gen(), media_type="application/octet-stream")

    mock_service = MagicMock()
    mock_service.stream_pointcloud_binary = AsyncMock(return_value=dummy_response)

    app.dependency_overrides[get_pointcloud_service] = lambda: mock_service

    pc_id = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"

    try:
        response = client.get(f"/pointclouds/stream-binary?lod=2&pointcloud_id={pc_id}")
        assert response.status_code == 200

        assert response.headers["content-type"] == "application/octet-stream"
        assert len(response.content) == 16
        x, y, z, r, g, b, a = struct.unpack('<3f4B', response.content)
        assert x == 10.0
        assert y == 20.0
        assert z == 30.0
        assert r == 255
        assert g == 128
        assert b == 0
        assert a == 255
        mock_service.stream_pointcloud_binary.assert_called_once()
    finally:
        app.dependency_overrides.clear()


def test_endpoint_stream_binary_lod10():
    import struct
    from fastapi.responses import StreamingResponse

    async def dummy_gen():
        yield struct.pack('<3f4B', 5.0, 5.0, 5.0, 255, 255, 255, 255)

    dummy_response = StreamingResponse(dummy_gen(), media_type="application/octet-stream")

    mock_service = MagicMock()
    mock_service.stream_pointcloud_binary = AsyncMock(return_value=dummy_response)

    app.dependency_overrides[get_pointcloud_service] = lambda: mock_service

    pc_id = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"

    try:
        response = client.get(f"/pointclouds/stream-binary?lod=10&pointcloud_id={pc_id}")
        assert response.status_code == 200
        mock_service.stream_pointcloud_binary.assert_called_once()

        # Test invalid LOD > 10 returns 422 Unprocessable Entity
        err_response = client.get(f"/pointclouds/stream-binary?lod=11&pointcloud_id={pc_id}")
        assert err_response.status_code == 422
    finally:
        app.dependency_overrides.clear()


def test_endpoint_stream_binary_missing_required_params():
    # Test missing lod parameter returns 422
    res_no_lod = client.get("/pointclouds/stream-binary?pointcloud_id=a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11")
    assert res_no_lod.status_code == 422


def test_endpoint_stream_summary_success():
    mock_service = MagicMock()
    mock_service.get_pointcloud_stream_summary = AsyncMock(return_value={
        "total_points": 1500,
        "number_of_points": 1500,
        "bounding_box": {
            "min_x": -10.0, "min_y": -5.0, "min_z": 0.0,
            "max_x": 10.0, "max_y": 5.0, "max_z": 20.0
        },
        "center": [0.0, 0.0, 10.0],
        "connected_pointclouds": [{
            "id": "e360394b-a241-49e5-bb66-97fee8bd85ef",
            "orig_filename": "test.ply",
            "number_of_points": 1500,
            "created_at": "2026-01-01T00:00:00Z",
            "pcid": 1,
            "transform_matrix": [1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0]
        }]
    })

    app.dependency_overrides[get_pointcloud_service] = lambda: mock_service

    pc_id = "e360394b-a241-49e5-bb66-97fee8bd85ef"

    try:
        response = client.get(f"/pointclouds/stream-summary?lod=0&pointcloud_id={pc_id}&number_of_points_gte=100")
        assert response.status_code == 200
        data = response.json()
        assert data["total_points"] == 1500
        assert data["number_of_points"] == 1500
        assert data["bounding_box"] == {
            "min_x": -10.0, "min_y": -5.0, "min_z": 0.0,
            "max_x": 10.0, "max_y": 5.0, "max_z": 20.0
        }
        assert data["center"] == [0.0, 0.0, 10.0]
        assert data["centerpoint"] == [0.0, 0.0, 10.0]
        assert len(data["connected_pointclouds"]) == 1
        assert data["connected_pointclouds"][0]["id"] == "e360394b-a241-49e5-bb66-97fee8bd85ef"
        mock_service.get_pointcloud_stream_summary.assert_called_once()
    finally:
        app.dependency_overrides.clear()


def test_query_builder_parameter_parsing():
    from app.services.pointcloud.query_builder import PointCloudQueryBuilder, parse_filter_key
    from app.schemas.filter import FilterCriterion

    field, op = parse_filter_key("number_of_points__gte")
    assert field == "number_of_points"
    assert op == "gte"

    field2, op2 = parse_filter_key("video_start_at_lt")
    assert field2 == "video_start_at"
    assert op2 == "lt"

    sql, bind, _ = PointCloudQueryBuilder.build_binary_stream_query(
        filters=[
            FilterCriterion(field="pointcloud_id", operator="eq", value="a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"),
            FilterCriterion(field="number_of_points", operator="gte", value=100),
            FilterCriterion(field="video_start_at", operator="gte", value="2026-01-01T00:00:00Z")
        ],
        lod=2
    )

    assert "pointcloud_patches_lod2" in sql
    assert "pm.id =" in sql
    assert "pm.number_of_points >=" in sql
    assert len(bind) == 3


def test_endpoint_stream_binary_invalid_field_400():
    res = client.get("/pointclouds/stream-binary?lod=0&unapproved_field=123")
    assert res.status_code == 400
    assert "Invalid or unauthorized filter field" in res.json()["detail"]


def test_endpoint_stream_summary_invalid_operator_400():
    res = client.get("/pointclouds/stream-summary?lod=0&number_of_points__invalidop=100")
    assert res.status_code == 400
    assert "Invalid filter operator" in res.json()["detail"]




def test_ingest_opensfm_init_laz_file():
    mock_db = MagicMock()
    mock_db.commit = AsyncMock()
    mock_db.refresh = AsyncMock()

    from app.core.database import get_db_session
    app.dependency_overrides[get_db_session] = lambda: mock_db

    folder_dir = os.path.join(settings.opensfm_ingestion_dir, "test_folder", "undistorted", "depthmaps")
    os.makedirs(folder_dir, exist_ok=True)
    laz_file = os.path.join(folder_dir, "fused.laz")
    with open(laz_file, "w") as f:
        f.write("dummy laz content")

    from unittest.mock import patch
    with patch("app.api.routes.pointclouds.Redis.from_url"), \
         patch("app.api.routes.pointclouds.Queue"):
        try:
            response = client.post("/pointclouds/ingest-opensfm/init?folder_name=test_folder")
            assert response.status_code == 200
            data = response.json()
            assert "jobs" in data
            assert len(data["jobs"]) == 1
            assert data["jobs"][0]["folder"] == "test_folder"

            # Test grid multiplication multiply_X=10, multiply_Y=10 (100 jobs in 10x10 grid)
            response_grid = client.post("/pointclouds/ingest-opensfm/init?folder_name=test_folder&multiply_x=10&multiply_y=10&offset_step_x=15.0&offset_step_y=20.0")
            assert response_grid.status_code == 200
            grid_data = response_grid.json()
            assert "jobs" in grid_data
            assert len(grid_data["jobs"]) == 100
            # Verify grid coordinates and offsets
            job_0_0 = grid_data["jobs"][0]
            assert job_0_0["grid_x"] == 0
            assert job_0_0["grid_y"] == 0
            assert job_0_0["offset_x"] == 0.0
            assert job_0_0["offset_y"] == 0.0

            job_9_9 = grid_data["jobs"][-1]
            assert job_9_9["grid_x"] == 9
            assert job_9_9["grid_y"] == 9
            assert job_9_9["offset_x"] == 9 * 15.0
            assert job_9_9["offset_y"] == 9 * 20.0
        finally:
            if os.path.exists(laz_file):
                os.remove(laz_file)
            shutil.rmtree(os.path.join(settings.opensfm_ingestion_dir, "test_folder"), ignore_errors=True)
            app.dependency_overrides.clear()




