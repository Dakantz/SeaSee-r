import uuid
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.models.job import Job, JobStatus
from app.services.worker.tasks import handle_rq_job_failure, sync_job_status_from_redis


@pytest.mark.anyio
async def test_handle_rq_job_failure_updates_db_status():
    import asyncio
    job_id = uuid.uuid4()
    mock_rq_job = MagicMock()
    mock_rq_job.id = str(job_id)
    mock_rq_job.exc_info = "Work-horse terminated unexpectedly; waitpid returned 134 (signal 6);"

    with patch("app.services.worker.tasks._update_job_status", new_callable=AsyncMock) as mock_update:
        handle_rq_job_failure(mock_rq_job, None, Exception, "Workhorse killed", None)
        await asyncio.sleep(0)
        mock_update.assert_called_once()
        args, kwargs = mock_update.call_args
        assert args[0] == str(job_id)
        assert args[1] == "FAILED"
        assert "Workhorse killed" in kwargs["error_message"]


@pytest.mark.anyio
async def test_handle_rq_job_failure_extracts_timeout_from_abandoned_job_error():
    import asyncio
    job_id = uuid.uuid4()
    mock_rq_job = MagicMock()
    mock_rq_job.id = str(job_id)
    mock_rq_job.exc_info = (
        "Traceback (most recent call last):\n"
        "  File '/opt/conda/envs/opensfm/lib/python3.10/site-packages/rq/timeouts.py', line 63, in handle_death_penalty\n"
        "    raise self._exception(f'Task exceeded maximum timeout value ({self._timeout} seconds)')\n"
        "rq.timeouts.JobTimeoutException: Task exceeded maximum timeout value (1 seconds)\n"
    )

    class AbandonedJobError(Exception):
        pass

    with patch("app.services.worker.tasks._update_job_status", new_callable=AsyncMock) as mock_update:
        handle_rq_job_failure(mock_rq_job, None, AbandonedJobError, "Job execution failed (AbandonedJobError)", None)
        await asyncio.sleep(0)
        mock_update.assert_called_once()
        args, kwargs = mock_update.call_args
        assert args[0] == str(job_id)
        assert args[1] == "FAILED"
        assert kwargs["error_message"] == "Task exceeded maximum timeout value (1 seconds)"



@pytest.mark.anyio
async def test_sync_job_status_from_redis_reconciles_failed_job():
    job_id = uuid.uuid4()
    mock_job = MagicMock(spec=Job)
    mock_job.id = job_id
    mock_job.status = JobStatus.PENDING

    mock_session = AsyncMock()

    mock_rq_job = MagicMock()
    mock_rq_job.is_failed = True
    mock_rq_job.exc_info = "Worker crashed with signal 6"

    with patch("rq.job.Job.fetch", return_value=mock_rq_job), \
         patch("app.services.worker.tasks._process_job_dependency_updates", new_callable=AsyncMock) as mock_dep:
        synced = await sync_job_status_from_redis(mock_session, mock_job)
        assert synced is True
        assert mock_job.status == JobStatus.FAILED
        assert "Worker crashed with signal 6" in mock_job.error_message
        mock_session.commit.assert_awaited_once()
        mock_dep.assert_awaited_once_with(mock_session, str(job_id), "FAILED")


@pytest.mark.anyio
async def test_sync_job_status_from_redis_skips_completed_job():
    mock_job = MagicMock(spec=Job)
    mock_job.status = JobStatus.COMPLETED

    mock_session = AsyncMock()
    synced = await sync_job_status_from_redis(mock_session, mock_job)
    assert synced is False
