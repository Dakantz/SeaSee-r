from unittest.mock import patch, MagicMock
from app.schemas.health import WorkerInfo

def test_health_check(client):
    """
    Test the health check endpoint.
    It should return a 200 OK status and the correct JSON payload.
    """
    response = client.get("/health")
    assert response.status_code == 200
    
    data = response.json()
    assert data["status"] == "ok"
    assert data["version"] == "1.0.0"

def test_get_diagnostics(client):
    """
    Test the diagnostics endpoint with mocked dependencies including all WorkerInfo.
    """
    mock_workers = [
        WorkerInfo(
            name="sfm-worker-test",
            status="online",
            container_id="ab1b0c7f462d",
            state="idle",
            current_job_id=None,
            queues=["opensfm_tasks"],
            queued_jobs_count=2,
            successful_jobs=10,
            failed_jobs=1,
            total_working_time=123.45,
            last_heartbeat="2026-09-23T08:00:00Z",
            python_version="3.10.20",
        ),
        WorkerInfo(
            name="general-worker-test",
            status="online",
            container_id="c4d97e669b0d",
            state="idle",
            current_job_id=None,
            queues=["pointcloud_tasks", "job_tasks", "default"],
            queued_jobs_count=0,
            successful_jobs=25,
            failed_jobs=0,
            total_working_time=456.78,
            last_heartbeat="2026-09-23T08:00:00Z",
            python_version="3.14.6",
        )
    ]

    with patch("app.api.routes.health.check_redis_online", return_value=True), \
         patch("app.api.routes.health.get_workers_info_sync", return_value=("online", "online", mock_workers)), \
         patch("app.api.routes.health.check_tusd_online", return_value=True):
        
        response = client.get("/health/diagnostics")
        assert response.status_code == 200
        
        data = response.json()
        assert "services_status" in data
        assert data["services_status"]["database"] == "online"
        assert data["services_status"]["redis"] == "online"
        assert data["services_status"]["worker"] == "online"
        assert data["services_status"]["opensfm"] == "online"
        assert data["services_status"]["tusd"] == "online"
        
        assert "workers" in data
        assert len(data["workers"]) == 2
        sfm = next(w for w in data["workers"] if "opensfm_tasks" in w["queues"])
        assert sfm["status"] == "online"
        assert sfm["container_id"] == "ab1b0c7f462d"
        assert sfm["queued_jobs_count"] == 2
        assert sfm["successful_jobs"] == 10
        assert sfm["failed_jobs"] == 1

        gen = next(w for w in data["workers"] if "pointcloud_tasks" in w["queues"])
        assert gen["status"] == "online"
        assert gen["container_id"] == "c4d97e669b0d"
        assert gen["successful_jobs"] == 25


