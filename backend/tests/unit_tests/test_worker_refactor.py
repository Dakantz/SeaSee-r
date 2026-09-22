import pytest
from unittest.mock import AsyncMock, patch
from app.services.worker.tasks import run_background_job, _run_background_job_async
from app.services.worker.registry import task_registry
from app.services.worker.handlers import (
    PointCloudUploadTaskHandler,
    OpenSfMIngestTaskHandler,
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
    assert isinstance(task_registry.get_handler("opensfm_ingest"), OpenSfMIngestTaskHandler)
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

@pytest.mark.anyio
async def test_run_background_job_timeout_updates_status_to_failed():
    import uuid
    from rq.timeouts import JobTimeoutException
    from app.models.job import Job

    dummy_job_id = str(uuid.uuid4())
    mock_job = Job(id=uuid.UUID(dummy_job_id), task_type="opensfm_ingest", payload={}, name="Test Job")

    async def mock_execute(*args, **kwargs):
        class MockScalarResult:
            def scalar_one_or_none(self):
                return mock_job
        return MockScalarResult()

    mock_session = AsyncMock()
    mock_session.execute = AsyncMock(side_effect=mock_execute)

    class MockAsyncSessionContext:
        async def __aenter__(self):
            return mock_session
        async def __aexit__(self, exc_type, exc_val, exc_tb):
            pass

    with patch("app.services.worker.tasks.async_session", return_value=MockAsyncSessionContext()), \
         patch.object(task_registry, "dispatch", side_effect=JobTimeoutException("Task exceeded maximum timeout value (180 seconds)")), \
         patch("app.services.worker.tasks._update_job_status", new_callable=AsyncMock) as mock_update_status, \
         patch("app.services.worker.tasks.logger.error") as mock_logger_error:
        with pytest.raises(JobTimeoutException) as exc_info:
            await _run_background_job_async(dummy_job_id)

        assert "Task exceeded maximum timeout value" in str(exc_info.value)
        mock_update_status.assert_called_once_with(
            dummy_job_id,
            "FAILED",
            error_message="Task exceeded maximum timeout value (180 seconds)"
        )
        mock_logger_error.assert_any_call(
            f"Worker job {dummy_job_id} timed out: Task exceeded maximum timeout value (180 seconds)"
        )


@pytest.mark.anyio
async def test_run_background_job_cancelled_error_updates_status_to_timeout():
    import uuid
    import asyncio
    from app.models.job import Job

    dummy_job_id = str(uuid.uuid4())
    mock_job = Job(id=uuid.UUID(dummy_job_id), task_type="opensfm_reconstruct", payload={}, name="Test Job")

    async def mock_execute(*args, **kwargs):
        class MockScalarResult:
            def scalar_one_or_none(self):
                return mock_job
        return MockScalarResult()

    mock_session = AsyncMock()
    mock_session.execute = AsyncMock(side_effect=mock_execute)

    class MockAsyncSessionContext:
        async def __aenter__(self):
            return mock_session
        async def __aexit__(self, exc_type, exc_val, exc_tb):
            pass

    with patch("app.services.worker.tasks.async_session", return_value=MockAsyncSessionContext()), \
         patch.object(task_registry, "dispatch", side_effect=asyncio.CancelledError()), \
         patch("app.services.worker.tasks._update_job_status", new_callable=AsyncMock) as mock_update_status:
        with pytest.raises(asyncio.CancelledError):
            await _run_background_job_async(dummy_job_id)

        mock_update_status.assert_called_once_with(
            dummy_job_id,
            "FAILED",
            error_message="Task execution timed out after exceeding worker timeout limit (CancelledError)"
        )
