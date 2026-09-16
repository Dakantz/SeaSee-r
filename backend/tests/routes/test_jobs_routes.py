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

# Dependency override helper
async def override_get_db_session():
    yield mock_db_session

@pytest.fixture(autouse=True)
def setup_dependency_override():
    app.dependency_overrides[get_db_session] = override_get_db_session
    yield
    app.dependency_overrides.clear()

def test_create_job(client):
    # Mock refresh to set the UUID and created_at on the job model instance
    async def mock_refresh(instance):
        from datetime import datetime
        instance.id = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"
        instance.created_at = datetime.utcnow()
        instance.pipeline_id = None
        instance.depends_on = []
    mock_db_session.refresh.side_effect = mock_refresh


    response = client.post("/jobs", json={"name": "test_job", "task_type": "pointcloud_upload", "payload": {"arg": 1}})
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "test_job"
    assert data["task_type"] == "pointcloud_upload"
    assert data["status"] == "PENDING"
    assert data["progress"] == 0.0
    assert data["id"] == "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"

def test_list_jobs(client):
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

    mock_result = MagicMock()
    mock_result.scalars.return_value.all.return_value = [mock_job]
    mock_db_session.execute.return_value = mock_result

    response = client.get("/jobs")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["name"] == "test_job"
    assert data[0]["task_type"] == "pointcloud_upload"

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
    response = client.post("/jobs/pipeline", json=payload)
    assert response.status_code == 400
    assert "Circular dependency detected" in response.json()["detail"]

def test_create_pipeline_success(client):
    mock_pipeline = MagicMock()
    mock_pipeline.id = "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22"
    mock_pipeline.name = "Test Pipeline"
    mock_pipeline.status = "PENDING"
    mock_pipeline.created_at = "2026-07-15T11:00:00Z"
    mock_pipeline.updated_at = "2026-07-15T11:00:00Z"
    mock_pipeline.jobs = []

    mock_db_session.execute.return_value.scalar_one.return_value = mock_pipeline

    payload = {
        "name": "Test Pipeline",
        "jobs": [
            {"id_key": "step1", "name": "Task 1"},
            {"id_key": "step2", "name": "Task 2", "depends_on": ["step1"]}
        ]
    }
    response = client.post("/jobs/pipeline", json=payload)
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "Test Pipeline"


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

    mock_db_session.execute.return_value.scalar_one_or_none.return_value = mock_job

    response = client.post("/jobs/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11/cancel")
    assert response.status_code == 400
    assert "Only active jobs (PENDING, RUNNING, BLOCKED) can be cancelled" in response.json()["detail"]


def test_cancel_job_not_found(client):
    mock_db_session.execute.return_value.scalar_one_or_none.return_value = None

    response = client.post("/jobs/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11/cancel")
    assert response.status_code == 404
    assert response.json()["detail"] == "Job not found."



