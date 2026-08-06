import pytest
from unittest.mock import AsyncMock, patch
from app.services.worker.tasks import run_background_job, _run_background_job_async
from app.services.worker.registry import task_registry
from app.services.worker.handlers import (
    PointCloudUploadTaskHandler,
    OpenSfMTaskHandler,
    EMODnetGeoTIFFTaskHandler,
    EMODnetCSVTaskHandler,
    VideoTaskHandler,
    DefaultTaskHandler
)

@pytest.fixture
def anyio_backend():
    return 'asyncio'

@pytest.mark.anyio
async def test_job_not_found():
    res = await _run_background_job_async("non_existent_job_123")
    assert res["status"] == "error"
    assert "not found" in res["message"]

def test_handler_registration_and_types():
    assert isinstance(task_registry.get_handler("pointcloud_upload"), PointCloudUploadTaskHandler)
    assert isinstance(task_registry.get_handler("opensfm_ingest"), OpenSfMTaskHandler)
    assert isinstance(task_registry.get_handler("emodnet_ingest"), EMODnetGeoTIFFTaskHandler)
    assert isinstance(task_registry.get_handler("emodnet_csv_ingest"), EMODnetCSVTaskHandler)
    assert isinstance(task_registry.get_handler("video_upload"), VideoTaskHandler)
    assert isinstance(task_registry.get_handler("unknown_task"), DefaultTaskHandler)

@pytest.mark.anyio
async def test_handler_update_job_status_mocked():
    handler = PointCloudUploadTaskHandler()
    with patch.object(handler, "update_job_status", new_callable=AsyncMock) as mock_update:
        res = await handler.execute("job_123", {"safe_filename": "non_existent.ply"})
        assert res["status"] == "error"
        mock_update.assert_called_once()
        assert mock_update.call_args[0][1] == "FAILED"
