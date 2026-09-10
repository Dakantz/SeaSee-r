import uuid
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.models.job import Job, JobStatus, Pipeline, PipelineStatus
from app.services.worker.tasks import _process_job_dependency_updates


@pytest.mark.anyio
async def test_process_job_dependency_updates_completes_dependent_job():
    job1_id = uuid.uuid4()
    job2_id = uuid.uuid4()

    mock_session = AsyncMock()

    mock_job1 = MagicMock(spec=Job)
    mock_job1.pipeline_id = None

    mock_job2 = MagicMock(spec=Job)
    mock_job2.id = job2_id
    mock_job2.status = JobStatus.BLOCKED
    mock_job2.depends_on = [str(job1_id)]

    res_job1 = MagicMock()
    res_job1.scalar_one_or_none.return_value = mock_job1

    res_blocked = MagicMock()
    res_blocked.scalars.return_value.all.return_value = [mock_job2]

    res_parent_statuses = MagicMock()
    res_parent_statuses.scalars.return_value.all.return_value = [JobStatus.COMPLETED]

    mock_session.execute.side_effect = [res_job1, res_blocked, res_parent_statuses]

    with patch("redis.Redis.from_url") as mock_redis, patch("rq.Queue") as mock_queue:
        await _process_job_dependency_updates(mock_session, str(job1_id), "COMPLETED")
        assert mock_job2.status == JobStatus.PENDING


@pytest.mark.anyio
async def test_process_job_dependency_updates_fails_dependent_job():
    job1_id = uuid.uuid4()
    job2_id = uuid.uuid4()

    mock_session = AsyncMock()

    mock_job1 = MagicMock(spec=Job)
    mock_job1.pipeline_id = None

    res_job1 = MagicMock()
    res_job1.scalar_one_or_none.return_value = mock_job1

    mock_job2 = MagicMock(spec=Job)
    mock_job2.id = job2_id
    mock_job2.status = JobStatus.BLOCKED
    mock_job2.depends_on = [str(job1_id)]

    res_candidates = MagicMock()
    res_candidates.scalars.return_value.all.return_value = [mock_job2]

    mock_session.execute.side_effect = [res_job1, res_candidates, MagicMock(scalars=MagicMock(return_value=MagicMock(all=MagicMock(return_value=[]))))]

    await _process_job_dependency_updates(mock_session, str(job1_id), "FAILED")
    assert mock_job2.status == JobStatus.FAILED
    assert "Parent dependency job" in mock_job2.error_message
