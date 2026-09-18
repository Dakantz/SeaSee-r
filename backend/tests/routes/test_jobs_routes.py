from unittest.mock import AsyncMock, MagicMock
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.core.database import get_db_session
from app.models.job import JobStatus

# Create a mock database session
mock_db_session = MagicMock()
mock_db_session.add = MagicMock()
mock_db_session.commit = AsyncMock()
mock_db_session.refresh = AsyncMock()
mock_db_session.execute = AsyncMock()
mock_db_session.delete = AsyncMock()


# Dependency override helper
async def override_get_db_session():
    yield mock_db_session

@pytest.fixture(autouse=True)
def setup_dependency_override():
    mock_db_session.execute.side_effect = None
    mock_db_session.execute.return_value = MagicMock()
    app.dependency_overrides[get_db_session] = override_get_db_session
    yield
    mock_db_session.execute.side_effect = None
    app.dependency_overrides.clear()


def test_create_pipeline(client):
    pipeline_id = "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22"
    job_id = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"

    mock_job = MagicMock()
    mock_job.id = job_id
    mock_job.name = "test_job"
    mock_job.task_type = "pointcloud_upload"
    mock_job.status = JobStatus.PENDING
    mock_job.progress = 0.0
    mock_job.payload = {"arg": 1}
    mock_job.result = None
    mock_job.error_message = None
    mock_job.created_at = "2026-07-15T11:00:00Z"
    mock_job.started_at = None
    mock_job.completed_at = None
    mock_job.pipeline_id = pipeline_id
    mock_job.depends_on = []

    mock_pipeline = MagicMock()
    mock_pipeline.id = pipeline_id
    mock_pipeline.name = "Test Pipeline"
    mock_pipeline.description = None
    mock_pipeline.status = "RUNNING"
    mock_pipeline.created_at = "2026-07-15T11:00:00Z"
    mock_pipeline.completed_at = None
    mock_pipeline.jobs = [mock_job]

    mock_db_session.execute.return_value.scalar_one_or_none.return_value = mock_pipeline

    payload = {
        "name": "Test Pipeline",
        "jobs": [
            {"id_key": "step1", "name": "test_job", "task_type": "pointcloud_upload", "payload": {"arg": 1}}
        ]
    }

    response = client.post("/jobs/pipelines", json=payload)
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "Test Pipeline"
    assert len(data["jobs"]) == 1
    assert data["jobs"][0]["name"] == "test_job"


def test_list_jobs(client):
    mock_job = MagicMock()
    mock_job.id = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"
    mock_job.name = "Standalone Job"
    mock_job.task_type = "video_frame_extraction"
    mock_job.status = JobStatus.PENDING
    mock_job.progress = 0.0
    mock_job.payload = {}
    mock_job.result = None
    mock_job.error_message = None
    mock_job.created_at = "2026-07-15T11:00:00Z"
    mock_job.started_at = None
    mock_job.completed_at = None
    mock_job.pipeline_id = None
    mock_job.depends_on = []

    mock_result = MagicMock()
    mock_result.scalars.return_value.all.return_value = [mock_job]
    mock_db_session.execute.return_value = mock_result

    response = client.get("/jobs")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["name"] == "Standalone Job"


def test_list_pipelines(client):
    mock_pipeline = MagicMock()
    mock_pipeline.id = "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22"
    mock_pipeline.name = "Test Pipeline"
    mock_pipeline.status = "RUNNING"
    mock_pipeline.created_at = "2026-07-15T11:00:00Z"
    mock_pipeline.completed_at = None
    mock_pipeline.jobs = []

    mock_result = MagicMock()
    mock_result.scalars.return_value.all.return_value = [mock_pipeline]
    mock_db_session.execute.return_value = mock_result

    response = client.get("/jobs/pipelines")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["name"] == "Test Pipeline"


def test_get_pipeline(client):
    pipeline_id = "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22"
    mock_pipeline = MagicMock()
    mock_pipeline.id = pipeline_id
    mock_pipeline.name = "Test Pipeline"
    mock_pipeline.status = "RUNNING"
    mock_pipeline.created_at = "2026-07-15T11:00:00Z"
    mock_pipeline.completed_at = None
    mock_pipeline.jobs = []

    mock_db_session.execute.return_value.scalar_one_or_none.return_value = mock_pipeline

    response = client.get(f"/jobs/pipelines/{pipeline_id}")
    assert response.status_code == 200
    data = response.json()
    assert data["id"] == pipeline_id
    assert data["name"] == "Test Pipeline"


def test_get_job(client):
    mock_job = MagicMock()
    mock_job.id = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"
    mock_job.name = "test_job"
    mock_job.task_type = "pointcloud_upload"
    mock_job.status = JobStatus.PENDING
    mock_job.progress = 0.0
    mock_job.payload = None
    mock_job.result = None
    mock_job.error_message = None
    mock_job.created_at = "2026-07-15T11:00:00Z"
    mock_job.started_at = None
    mock_job.completed_at = None
    mock_job.pipeline_id = None
    mock_job.depends_on = []

    mock_db_session.execute.return_value.scalar_one_or_none.return_value = mock_job

    response = client.get("/jobs/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11")
    assert response.status_code == 200
    data = response.json()
    assert data["id"] == "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"
    assert data["task_type"] == "pointcloud_upload"


def test_get_job_not_found(client):
    mock_db_session.execute.return_value.scalar_one_or_none.return_value = None

    response = client.get("/jobs/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11")
    assert response.status_code == 404
    assert response.json()["detail"] == "Job not found."


def test_retry_job_success(client):
    mock_job = MagicMock()
    mock_job.id = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"
    mock_job.name = "test_job"
    mock_job.task_type = "pointcloud_upload"
    mock_job.status = "FAILED"
    mock_job.progress = 0.0
    mock_job.payload = None
    mock_job.result = None
    mock_job.error_message = "Some error"
    mock_job.created_at = "2026-07-15T11:00:00Z"
    mock_job.started_at = None
    mock_job.completed_at = None
    mock_job.pipeline_id = None
    mock_job.depends_on = []

    mock_db_session.execute.return_value.scalar_one_or_none.return_value = mock_job

    response = client.post("/jobs/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11/retry")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "PENDING"
    assert data["error_message"] is None


def test_retry_job_not_failed(client):
    mock_job = MagicMock()
    mock_job.id = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"
    mock_job.name = "test_job"
    mock_job.status = "RUNNING"
    mock_job.pipeline_id = None

    mock_db_session.execute.return_value.scalar_one_or_none.return_value = mock_job

    response = client.post("/jobs/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11/retry")
    assert response.status_code == 400
    assert "Only failed or cancelled jobs can be retried" in response.json()["detail"]


def test_create_pipeline_cycle_error(client):
    payload = {
        "name": "Cycle Pipeline",
        "jobs": [
            {"id_key": "step1", "name": "Task 1", "depends_on": ["step2"]},
            {"id_key": "step2", "name": "Task 2", "depends_on": ["step1"]}
        ]
    }
    response = client.post("/jobs/pipelines", json=payload)
    assert response.status_code == 400
    assert "Circular dependency detected" in response.json()["detail"]


def test_cancel_job_success(client):
    mock_job = MagicMock()
    mock_job.id = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"
    mock_job.name = "test_job"
    mock_job.task_type = "pointcloud_upload"
    mock_job.status = JobStatus.RUNNING
    mock_job.progress = 45.0
    mock_job.payload = None
    mock_job.result = None
    mock_job.error_message = None
    mock_job.created_at = "2026-07-15T11:00:00Z"
    mock_job.started_at = "2026-07-15T11:01:00Z"
    mock_job.completed_at = None
    mock_job.pipeline_id = None
    mock_job.depends_on = []

    mock_db_session.execute.return_value.scalar_one_or_none.return_value = mock_job

    response = client.post("/jobs/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11/cancel")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "CANCELLED"
    assert data["error_message"] == "Job was cancelled by user."


def test_cancel_job_already_completed(client):
    mock_job = MagicMock()
    mock_job.id = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"
    mock_job.name = "test_job"
    mock_job.status = JobStatus.COMPLETED
    mock_job.pipeline_id = None

    mock_db_session.execute.return_value.scalar_one_or_none.return_value = mock_job

    response = client.post("/jobs/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11/cancel")
    assert response.status_code == 400
    assert "Only active jobs (PENDING, RUNNING, BLOCKED) can be cancelled" in response.json()["detail"]


def test_cancel_job_not_found(client):
    mock_db_session.execute.return_value.scalar_one_or_none.return_value = None

    response = client.post("/jobs/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11/cancel")
    assert response.status_code == 404
    assert response.json()["detail"] == "Job not found."


def test_cancel_job_in_pipeline(client):
    pipeline_id = "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22"
    job1_id = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"
    job2_id = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22"
    job3_id = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33"

    mock_job1 = MagicMock()
    mock_job1.id = job1_id
    mock_job1.name = "job1"
    mock_job1.task_type = "task"
    mock_job1.status = JobStatus.COMPLETED
    mock_job1.progress = 100.0
    mock_job1.created_at = "2026-07-15T11:00:00Z"
    mock_job1.started_at = None
    mock_job1.completed_at = "2026-07-15T11:00:00Z"
    mock_job1.payload = None
    mock_job1.result = None
    mock_job1.error_message = None
    mock_job1.pipeline_id = pipeline_id
    mock_job1.depends_on = []

    mock_job2 = MagicMock()
    mock_job2.id = job2_id
    mock_job2.name = "job2"
    mock_job2.task_type = "task"
    mock_job2.status = JobStatus.RUNNING
    mock_job2.progress = 50.0
    mock_job2.created_at = "2026-07-15T11:00:00Z"
    mock_job2.started_at = None
    mock_job2.completed_at = None
    mock_job2.payload = None
    mock_job2.result = None
    mock_job2.error_message = None
    mock_job2.pipeline_id = pipeline_id
    mock_job2.depends_on = [job1_id]

    mock_job3 = MagicMock()
    mock_job3.id = job3_id
    mock_job3.name = "job3"
    mock_job3.task_type = "task"
    mock_job3.status = JobStatus.BLOCKED
    mock_job3.progress = 0.0
    mock_job3.created_at = "2026-07-15T11:00:00Z"
    mock_job3.started_at = None
    mock_job3.completed_at = None
    mock_job3.payload = None
    mock_job3.result = None
    mock_job3.error_message = None
    mock_job3.pipeline_id = pipeline_id
    mock_job3.depends_on = [job2_id]

    mock_pipeline = MagicMock()
    mock_pipeline.id = pipeline_id
    mock_pipeline.jobs = [mock_job1, mock_job2, mock_job3]
    mock_pipeline.status = "RUNNING"

    mock_db_session.execute.side_effect = [
        MagicMock(scalar_one_or_none=MagicMock(return_value=mock_job2)),
        MagicMock(scalar_one_or_none=MagicMock(return_value=mock_pipeline))
    ]

    response = client.post(f"/jobs/{job2_id}/cancel")
    assert response.status_code == 200

    assert mock_job1.status == JobStatus.COMPLETED
    assert mock_job2.status == JobStatus.CANCELLED
    assert mock_job3.status == JobStatus.CANCELLED
    assert mock_pipeline.status == "CANCELLED"


def test_retry_job_in_pipeline(client):
    pipeline_id = "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22"
    job1_id = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"
    job2_id = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22"
    job3_id = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33"

    mock_job1 = MagicMock()
    mock_job1.id = job1_id
    mock_job1.name = "job1"
    mock_job1.task_type = "task"
    mock_job1.status = JobStatus.COMPLETED
    mock_job1.progress = 100.0
    mock_job1.created_at = "2026-07-15T11:00:00Z"
    mock_job1.started_at = None
    mock_job1.completed_at = None
    mock_job1.payload = None
    mock_job1.result = None
    mock_job1.error_message = None
    mock_job1.pipeline_id = pipeline_id
    mock_job1.depends_on = []

    mock_job2 = MagicMock()
    mock_job2.id = job2_id
    mock_job2.name = "job2"
    mock_job2.task_type = "task"
    mock_job2.status = JobStatus.FAILED
    mock_job2.progress = 0.0
    mock_job2.created_at = "2026-07-15T11:00:00Z"
    mock_job2.started_at = None
    mock_job2.completed_at = None
    mock_job2.payload = None
    mock_job2.result = None
    mock_job2.error_message = "Error"
    mock_job2.pipeline_id = pipeline_id
    mock_job2.depends_on = [job1_id]

    mock_job3 = MagicMock()
    mock_job3.id = job3_id
    mock_job3.name = "job3"
    mock_job3.task_type = "task"
    mock_job3.status = JobStatus.FAILED
    mock_job3.progress = 0.0
    mock_job3.created_at = "2026-07-15T11:00:00Z"
    mock_job3.started_at = None
    mock_job3.completed_at = None
    mock_job3.payload = None
    mock_job3.result = None
    mock_job3.error_message = "Parent error"
    mock_job3.pipeline_id = pipeline_id
    mock_job3.depends_on = [job2_id]

    mock_pipeline = MagicMock()
    mock_pipeline.id = pipeline_id
    mock_pipeline.jobs = [mock_job1, mock_job2, mock_job3]

    mock_db_session.execute.side_effect = [
        MagicMock(scalar_one_or_none=MagicMock(return_value=mock_job2)),
        MagicMock(scalar_one_or_none=MagicMock(return_value=mock_pipeline))
    ]

    response = client.post(f"/jobs/{job2_id}/retry")
    assert response.status_code == 200

    assert mock_job1.status == JobStatus.COMPLETED
    assert mock_job2.status == JobStatus.PENDING
    assert mock_job3.status == JobStatus.BLOCKED
    assert mock_pipeline.status == "RUNNING"


def test_cancel_job_in_pipeline_branch_isolation(client):
    pipeline_id = "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22"
    job1_id = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"
    job2_id = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22"
    job3_id = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33"
    job4_id = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44"

    mock_job1 = MagicMock()
    mock_job1.id = job1_id
    mock_job1.name = "job1"
    mock_job1.task_type = "task"
    mock_job1.status = JobStatus.COMPLETED
    mock_job1.progress = 100.0
    mock_job1.created_at = "2026-07-15T11:00:00Z"
    mock_job1.started_at = None
    mock_job1.completed_at = "2026-07-15T11:00:00Z"
    mock_job1.payload = None
    mock_job1.result = None
    mock_job1.error_message = None
    mock_job1.pipeline_id = pipeline_id
    mock_job1.depends_on = []

    mock_job2 = MagicMock()
    mock_job2.id = job2_id
    mock_job2.name = "job2"
    mock_job2.task_type = "task"
    mock_job2.status = JobStatus.RUNNING
    mock_job2.progress = 50.0
    mock_job2.created_at = "2026-07-15T11:00:00Z"
    mock_job2.started_at = None
    mock_job2.completed_at = None
    mock_job2.payload = None
    mock_job2.result = None
    mock_job2.error_message = None
    mock_job2.pipeline_id = pipeline_id
    mock_job2.depends_on = [job1_id]

    mock_job3 = MagicMock()
    mock_job3.id = job3_id
    mock_job3.name = "job3"
    mock_job3.task_type = "task"
    mock_job3.status = JobStatus.BLOCKED
    mock_job3.progress = 0.0
    mock_job3.created_at = "2026-07-15T11:00:00Z"
    mock_job3.started_at = None
    mock_job3.completed_at = None
    mock_job3.payload = None
    mock_job3.result = None
    mock_job3.error_message = None
    mock_job3.pipeline_id = pipeline_id
    mock_job3.depends_on = [job2_id]

    # Independent branch job
    mock_job4 = MagicMock()
    mock_job4.id = job4_id
    mock_job4.name = "job4"
    mock_job4.task_type = "task"
    mock_job4.status = JobStatus.RUNNING
    mock_job4.progress = 10.0
    mock_job4.created_at = "2026-07-15T11:00:00Z"
    mock_job4.started_at = None
    mock_job4.completed_at = None
    mock_job4.payload = None
    mock_job4.result = None
    mock_job4.error_message = None
    mock_job4.pipeline_id = pipeline_id
    mock_job4.depends_on = [job1_id]

    mock_pipeline = MagicMock()
    mock_pipeline.id = pipeline_id
    mock_pipeline.jobs = [mock_job1, mock_job2, mock_job3, mock_job4]
    mock_pipeline.status = "RUNNING"

    mock_db_session.execute.side_effect = [
        MagicMock(scalar_one_or_none=MagicMock(return_value=mock_job2)),
        MagicMock(scalar_one_or_none=MagicMock(return_value=mock_pipeline))
    ]

    response = client.post(f"/jobs/{job2_id}/cancel")
    assert response.status_code == 200

    assert mock_job1.status == JobStatus.COMPLETED
    assert mock_job2.status == JobStatus.CANCELLED
    assert mock_job3.status == JobStatus.CANCELLED
    assert mock_job4.status == JobStatus.RUNNING
    assert mock_pipeline.status == "RUNNING"


def test_delete_running_job(client):
    mock_db_session.execute.side_effect = None
    job_id = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"
    mock_job = MagicMock()
    mock_job.id = job_id
    mock_job.name = "running_job"
    mock_job.status = JobStatus.RUNNING
    mock_job.completed_at = None
    mock_job.error_message = None
    mock_job.pipeline_id = None

    mock_exec_result = MagicMock()
    mock_exec_result.scalar_one_or_none.return_value = mock_job
    mock_exec_result.scalars.return_value.all.return_value = []
    mock_db_session.execute.return_value = mock_exec_result

    response = client.delete(f"/jobs/{job_id}")
    assert response.status_code == 204
    assert mock_job.status == JobStatus.CANCELLED
    assert mock_job.completed_at is not None
    assert mock_job.error_message == "Job was cancelled before deletion."
    mock_db_session.delete.assert_called_with(mock_job)
