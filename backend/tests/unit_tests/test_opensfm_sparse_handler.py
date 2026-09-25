import os
import asyncio
import pytest
import uuid
from unittest.mock import AsyncMock, patch, MagicMock

from app.services.worker.handlers.opensfm_sparse import OpenSfMSparseTaskHandler


@pytest.fixture(autouse=True)
def mock_opensfm_health_default():
    with patch("app.services.worker.handlers.opensfm_sparse.check_opensfm_gpu_health", return_value=(True, "Healthy")):
        yield


@pytest.mark.anyio
async def test_opensfm_sparse_unhealthy_container_raises(tmp_path):
    handler = OpenSfMSparseTaskHandler()
    payload = {"dataset_dir": str(tmp_path)}

    with patch.object(handler, "update_job_status", new_callable=AsyncMock) as mock_update, \
         patch("app.services.worker.handlers.opensfm_sparse.check_opensfm_gpu_health", return_value=(False, "OpenCL/GPU DepthmapClusterEstimator is unavailable")):
        with pytest.raises(RuntimeError, match="OpenSfM health check failed"):
            await handler.execute("19732560-8306-4484-92d6-b101743fb329", payload)

        mock_update.assert_any_call(
            "19732560-8306-4484-92d6-b101743fb329",
            "FAILED",
            0.0,
            error_message="OpenSfM health check failed: OpenCL/GPU DepthmapClusterEstimator is unavailable"
        )


@pytest.mark.anyio
async def test_opensfm_sparse_missing_dataset_dir_raises(tmp_path):
    handler = OpenSfMSparseTaskHandler()
    non_existent = str(tmp_path / "non_existent_dataset")
    payload = {"dataset_dir": non_existent}

    with patch.object(handler, "update_job_status", new_callable=AsyncMock) as mock_update:
        with pytest.raises(RuntimeError, match="does not exist"):
            await handler.execute("19732560-8306-4484-92d6-b101743fb329", payload)
        assert mock_update.called


@pytest.mark.anyio
async def test_opensfm_sparse_missing_images_raises(tmp_path):
    handler = OpenSfMSparseTaskHandler()
    dataset_dir = tmp_path / "dataset"
    dataset_dir.mkdir()
    payload = {"dataset_dir": str(dataset_dir)}

    with patch.object(handler, "update_job_status", new_callable=AsyncMock) as mock_update:
        with pytest.raises(RuntimeError, match="No images found"):
            await handler.execute("19732560-8306-4484-92d6-b101743fb329", payload)
        assert mock_update.called


@pytest.mark.anyio
async def test_opensfm_sparse_missing_opensfm_library_raises(tmp_path):
    handler = OpenSfMSparseTaskHandler()
    dataset_dir = tmp_path / "dataset"
    images_dir = dataset_dir / "images"
    images_dir.mkdir(parents=True)
    (images_dir / "img1.png").write_text("dummy")

    payload = {"dataset_dir": str(dataset_dir)}

    with patch.object(handler, "update_job_status", new_callable=AsyncMock) as mock_update, \
         patch("app.services.worker.handlers.opensfm_sparse.HAS_OPENSFM", False):
        with pytest.raises(RuntimeError, match="OpenSfM Python library is not available"):
            await handler.execute("19732560-8306-4484-92d6-b101743fb329", payload)
        assert mock_update.called


@pytest.mark.anyio
async def test_opensfm_sparse_success(tmp_path):
    handler = OpenSfMSparseTaskHandler()
    dataset_dir = tmp_path / "dataset"
    images_dir = dataset_dir / "images"
    images_dir.mkdir(parents=True)
    (images_dir / "img1.png").write_text("dummy")

    payload = {"dataset_dir": str(dataset_dir)}
    job_id = "19732560-8306-4484-92d6-b101743fb329"

    with patch.object(handler, "update_job_status", new_callable=AsyncMock) as mock_update, \
         patch("app.services.worker.handlers.opensfm_sparse.HAS_OPENSFM", True), \
         patch.object(handler, "_run_opensfm_sparse_pipeline") as mock_pipeline, \
         patch.object(handler, "_create_dynamic_component_jobs", new_callable=AsyncMock) as mock_dyn:
        res = await handler.execute(job_id, payload)

        assert res["status"] == "success"
        assert res["dataset_dir"] == str(dataset_dir)
        mock_pipeline.assert_called_once()
        mock_dyn.assert_called_once_with(str(dataset_dir), job_id, payload)
        mock_update.assert_any_call(job_id, "COMPLETED", 100.0, result=res)


@pytest.mark.anyio
async def test_opensfm_sparse_cancelled_initial_status(tmp_path):
    handler = OpenSfMSparseTaskHandler()
    dataset_dir = tmp_path / "dataset"
    images_dir = dataset_dir / "images"
    images_dir.mkdir(parents=True)
    (images_dir / "img1.png").write_text("dummy")

    payload = {"dataset_dir": str(dataset_dir)}
    test_job_id = "19732560-8306-4484-92d6-b101743fb329"

    with patch.object(handler, "update_job_status", new_callable=AsyncMock) as mock_update:
        mock_update.return_value = False  # Job is cancelled
        res = await handler.execute(test_job_id, payload)

        assert res["status"] == "cancelled"
        assert "cancellation" in res["message"].lower()


@pytest.mark.anyio
async def test_opensfm_sparse_cancelled_during_pipeline(tmp_path):
    handler = OpenSfMSparseTaskHandler()
    dataset_dir = tmp_path / "dataset"
    images_dir = dataset_dir / "images"
    images_dir.mkdir(parents=True)
    (images_dir / "img1.png").write_text("dummy")

    payload = {"dataset_dir": str(dataset_dir)}
    test_job_id = "19732560-8306-4484-92d6-b101743fb329"

    def raise_cancellation(*args, **kwargs):
        raise RuntimeError(f"Job {test_job_id} was cancelled by user.")

    with patch.object(handler, "update_job_status", new_callable=AsyncMock) as mock_update, \
         patch("app.services.worker.handlers.opensfm_sparse.HAS_OPENSFM", True), \
         patch.object(handler, "_run_opensfm_sparse_pipeline", side_effect=raise_cancellation):
        mock_update.return_value = True

        res = await handler.execute(test_job_id, payload)

        assert res["status"] == "cancelled"
        for call_args in mock_update.call_args_list:
            assert call_args[0][1] != "FAILED"


@pytest.mark.anyio
async def test_create_dynamic_component_jobs(tmp_path):
    handler = OpenSfMSparseTaskHandler()
    dataset_dir = str(tmp_path / "dataset")
    test_job_id = str(uuid.uuid4())

    mock_dataset = MagicMock()
    mock_dataset.reconstruction_exists.return_value = True
    # 3 reconstruction components with 12 views each (component 0, component 1, component 2)
    mock_dataset.load_reconstruction.return_value = [
        {"shots": {f"s_{k}": {} for k in range(12)}} for _ in range(3)
    ]

    mock_session = MagicMock()
    mock_session.execute = AsyncMock()
    mock_session.commit = AsyncMock()
    mock_session_ctx = MagicMock()
    mock_session_ctx.__aenter__.return_value = mock_session
    mock_session_ctx.__aexit__.return_value = None

    added_jobs = []
    mock_session.add.side_effect = lambda j: added_jobs.append(j)

    with patch("app.services.worker.handlers.opensfm_sparse.HAS_OPENSFM", True), \
         patch("app.services.worker.handlers.opensfm_sparse.DataSet", return_value=mock_dataset), \
         patch("app.services.worker.handlers.opensfm_sparse.async_session", return_value=mock_session_ctx):
        
        await handler._create_dynamic_component_jobs(dataset_dir, test_job_id, {"dataset_name": "test_ds"})

        # Should add 4 jobs total: 2 dense jobs and 2 ingest jobs (for components 1 and 2)
        assert len(added_jobs) == 4
        dense_jobs = [j for j in added_jobs if j.task_type == "opensfm_dense"]
        ingest_jobs = [j for j in added_jobs if j.task_type == "opensfm_ingest"]

        assert len(dense_jobs) == 2
        assert len(ingest_jobs) == 2

        assert dense_jobs[0].payload["reconstruction_index"] == 1
        assert dense_jobs[0].payload["subfolder"] == "undistorted_1"
        assert dense_jobs[1].payload["reconstruction_index"] == 2
        assert dense_jobs[1].payload["subfolder"] == "undistorted_2"

        assert mock_session.commit.called


@pytest.mark.anyio
async def test_create_dynamic_component_jobs_filtered_by_min_views(tmp_path):
    handler = OpenSfMSparseTaskHandler()
    dataset_dir = str(tmp_path / "dataset")
    test_job_id = str(uuid.uuid4())

    mock_dataset = MagicMock()
    mock_dataset.reconstruction_exists.return_value = True
    # Component 0: 15 views, Component 1: 15 views (>=10), Component 2: 5 views (<10)
    mock_dataset.load_reconstruction.return_value = [
        {"shots": {f"s0_{k}": {} for k in range(15)}},
        {"shots": {f"s1_{k}": {} for k in range(15)}},
        {"shots": {f"s2_{k}": {} for k in range(5)}},
    ]

    mock_session = MagicMock()
    mock_session.execute = AsyncMock()
    mock_session.commit = AsyncMock()
    mock_session_ctx = MagicMock()
    mock_session_ctx.__aenter__.return_value = mock_session
    mock_session_ctx.__aexit__.return_value = None

    added_jobs = []
    mock_session.add.side_effect = lambda j: added_jobs.append(j)

    with patch("app.services.worker.handlers.opensfm_sparse.HAS_OPENSFM", True), \
         patch("app.services.worker.handlers.opensfm_sparse.DataSet", return_value=mock_dataset), \
         patch("app.services.worker.handlers.opensfm_sparse.async_session", return_value=mock_session_ctx):
        
        await handler._create_dynamic_component_jobs(dataset_dir, test_job_id, {"dataset_name": "test_ds"})

        # Only component 1 should get jobs; component 2 (<10 views) is ignored
        assert len(added_jobs) == 2
        dense_jobs = [j for j in added_jobs if j.task_type == "opensfm_dense"]
        assert len(dense_jobs) == 1
        assert dense_jobs[0].payload["reconstruction_index"] == 1


@pytest.mark.anyio
async def test_component_0_ignored_when_less_than_min_views(tmp_path):
    from app.models.job import Job, JobStatus
    handler = OpenSfMSparseTaskHandler()
    dataset_dir = str(tmp_path / "dataset")
    test_job_id = str(uuid.uuid4())

    mock_dataset = MagicMock()
    mock_dataset.reconstruction_exists.return_value = True
    # Component 0 has only 4 views (< 10)
    mock_dataset.load_reconstruction.return_value = [
        {"shots": {f"s0_{k}": {} for k in range(4)}},
    ]

    dense_job_0 = Job(
        id=uuid.uuid4(),
        name="Dense 0",
        task_type="opensfm_dense",
        payload={"reconstruction_index": 0},
        status=JobStatus.BLOCKED,
        depends_on=[test_job_id]
    )
    ingest_job_0 = Job(
        id=uuid.uuid4(),
        name="Ingest 0",
        task_type="opensfm_ingest",
        payload={"reconstruction_index": 0},
        status=JobStatus.BLOCKED,
        depends_on=[str(dense_job_0.id)]
    )

    mock_query_result = MagicMock()
    mock_query_result.scalars.return_value.all.return_value = [dense_job_0, ingest_job_0]

    mock_session = MagicMock()
    mock_session.execute = AsyncMock(return_value=mock_query_result)
    mock_session.commit = AsyncMock()
    mock_session_ctx = MagicMock()
    mock_session_ctx.__aenter__.return_value = mock_session
    mock_session_ctx.__aexit__.return_value = None

    with patch("app.services.worker.handlers.opensfm_sparse.HAS_OPENSFM", True), \
         patch("app.services.worker.handlers.opensfm_sparse.DataSet", return_value=mock_dataset), \
         patch("app.services.worker.handlers.opensfm_sparse.async_session", return_value=mock_session_ctx):
        
        await handler._create_dynamic_component_jobs(dataset_dir, test_job_id, {"dataset_name": "test_ds"})

        assert dense_job_0.status == JobStatus.CANCELLED
        assert "less than the required minimum" in dense_job_0.error_message
        assert ingest_job_0.status == JobStatus.CANCELLED


def test_sparse_handler_settings():
    from app.core.config import settings
    assert settings.opensfm_compute_mesh is False
    assert settings.opensfm_min_views_for_dense == 10


@pytest.mark.anyio
async def test_run_opensfm_sparse_pipeline_mesh_toggle(tmp_path):
    handler = OpenSfMSparseTaskHandler()
    loop = asyncio.get_running_loop()

    mock_dataset = MagicMock()
    mock_actions = MagicMock()

    with patch("app.services.worker.handlers.opensfm_sparse.DataSet", return_value=mock_dataset), \
         patch("app.services.worker.handlers.opensfm_sparse.actions", mock_actions), \
         patch("app.services.worker.handlers.opensfm_sparse.reconstruction", MagicMock()), \
         patch.object(handler, "update_job_status", new_callable=AsyncMock, return_value=True):

        # When compute_mesh is False (default)
        await asyncio.to_thread(handler._run_opensfm_sparse_pipeline, str(tmp_path), loop, "job-1", False)
        mock_actions.mesh.run_dataset.assert_not_called()

        # When compute_mesh is True
        mock_actions.reset_mock()
        await asyncio.to_thread(handler._run_opensfm_sparse_pipeline, str(tmp_path), loop, "job-2", True)
        mock_actions.mesh.run_dataset.assert_called_once_with(mock_dataset)



@pytest.mark.anyio
async def test_resolve_opensfm_config_path():
    from app.services.worker.handlers.opensfm_sparse import resolve_opensfm_config_path
    rel_path = "backend/app/core/openSfM/config.yaml"
    resolved = resolve_opensfm_config_path(rel_path)
    assert resolved is not None
    assert os.path.exists(resolved)
    assert resolved.endswith("config.yaml")


@pytest.mark.anyio
async def test_opensfm_sparse_copies_config(tmp_path):
    handler = OpenSfMSparseTaskHandler()
    dataset_dir = tmp_path / "dataset"
    images_dir = dataset_dir / "images"
    images_dir.mkdir(parents=True)
    (images_dir / "img1.png").write_text("dummy")

    config_source = tmp_path / "custom_config.yaml"
    config_source.write_text("processes: 4\n")

    payload = {
        "dataset_dir": str(dataset_dir),
        "opensfm_config": str(config_source)
    }
    job_id = "19732560-8306-4484-92d6-b101743fb329"

    with patch.object(handler, "update_job_status", new_callable=AsyncMock), \
         patch("app.services.worker.handlers.opensfm_sparse.HAS_OPENSFM", True), \
         patch.object(handler, "_run_opensfm_sparse_pipeline"), \
         patch.object(handler, "_create_dynamic_component_jobs", new_callable=AsyncMock):
        
        await handler.execute(job_id, payload)

        target_config = dataset_dir / "config.yaml"
        assert target_config.exists()
        assert target_config.read_text() == "processes: 4\n"
