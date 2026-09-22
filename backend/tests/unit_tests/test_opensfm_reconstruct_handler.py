import os
import pytest
import uuid
from unittest.mock import AsyncMock, patch, MagicMock

from app.services.worker.handlers.opensfm_reconstruct import OpenSfMReconstructTaskHandler


@pytest.mark.anyio
async def test_opensfm_reconstruct_missing_dataset_dir_raises(tmp_path):
    handler = OpenSfMReconstructTaskHandler()
    non_existent = str(tmp_path / "non_existent_dataset")
    payload = {"dataset_dir": non_existent}

    with patch.object(handler, "update_job_status", new_callable=AsyncMock) as mock_update:
        with pytest.raises(RuntimeError, match="does not exist"):
            await handler.execute("19732560-8306-4484-92d6-b101743fb329", payload)
        assert mock_update.called


@pytest.mark.anyio
async def test_opensfm_reconstruct_missing_images_raises(tmp_path):
    handler = OpenSfMReconstructTaskHandler()
    dataset_dir = tmp_path / "dataset"
    dataset_dir.mkdir()
    payload = {"dataset_dir": str(dataset_dir)}

    with patch.object(handler, "update_job_status", new_callable=AsyncMock) as mock_update:
        with pytest.raises(RuntimeError, match="No images found"):
            await handler.execute("19732560-8306-4484-92d6-b101743fb329", payload)
        assert mock_update.called


@pytest.mark.anyio
async def test_opensfm_reconstruct_missing_opensfm_library_raises(tmp_path):
    handler = OpenSfMReconstructTaskHandler()
    dataset_dir = tmp_path / "dataset"
    images_dir = dataset_dir / "images"
    images_dir.mkdir(parents=True)
    (images_dir / "img1.png").write_text("dummy")

    payload = {"dataset_dir": str(dataset_dir)}

    with patch.object(handler, "update_job_status", new_callable=AsyncMock) as mock_update, \
         patch("app.services.worker.handlers.opensfm_reconstruct.HAS_OPENSFM", False):
        with pytest.raises(RuntimeError, match="OpenSfM Python library is not available"):
            await handler.execute("19732560-8306-4484-92d6-b101743fb329", payload)
        assert mock_update.called


@pytest.mark.anyio
async def test_opensfm_reconstruct_success(tmp_path):
    handler = OpenSfMReconstructTaskHandler()
    dataset_dir = tmp_path / "dataset"
    images_dir = dataset_dir / "images"
    images_dir.mkdir(parents=True)
    (images_dir / "img1.png").write_text("dummy")

    payload = {"dataset_dir": str(dataset_dir)}
    job_id = "19732560-8306-4484-92d6-b101743fb329"

    with patch.object(handler, "update_job_status", new_callable=AsyncMock) as mock_update, \
         patch("app.services.worker.handlers.opensfm_reconstruct.HAS_OPENSFM", True), \
         patch.object(handler, "_run_opensfm_pipeline") as mock_pipeline, \
         patch.object(handler, "_create_dynamic_component_jobs", new_callable=AsyncMock) as mock_dyn:
        res = await handler.execute(job_id, payload)

        assert res["status"] == "success"
        assert res["dataset_dir"] == str(dataset_dir)
        mock_pipeline.assert_called_once()
        mock_dyn.assert_called_once_with(str(dataset_dir), job_id, payload)
        mock_update.assert_any_call(job_id, "COMPLETED", 100.0, result=res)


@pytest.mark.anyio
async def test_opensfm_reconstruct_cancelled_initial_status(tmp_path):
    handler = OpenSfMReconstructTaskHandler()
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
async def test_opensfm_reconstruct_cancelled_during_pipeline(tmp_path):
    handler = OpenSfMReconstructTaskHandler()
    dataset_dir = tmp_path / "dataset"
    images_dir = dataset_dir / "images"
    images_dir.mkdir(parents=True)
    (images_dir / "img1.png").write_text("dummy")

    payload = {"dataset_dir": str(dataset_dir)}
    test_job_id = "19732560-8306-4484-92d6-b101743fb329"

    def raise_cancellation(*args, **kwargs):
        raise RuntimeError(f"Job {test_job_id} was cancelled by user.")

    with patch.object(handler, "update_job_status", new_callable=AsyncMock) as mock_update, \
         patch("app.services.worker.handlers.opensfm_reconstruct.HAS_OPENSFM", True), \
         patch.object(handler, "_run_opensfm_pipeline", side_effect=raise_cancellation):
        mock_update.return_value = True

        res = await handler.execute(test_job_id, payload)

        assert res["status"] == "cancelled"
        for call_args in mock_update.call_args_list:
            assert call_args[0][1] != "FAILED"


@pytest.mark.anyio
async def test_create_dynamic_component_jobs(tmp_path):
    handler = OpenSfMReconstructTaskHandler()
    dataset_dir = str(tmp_path / "dataset")
    test_job_id = str(uuid.uuid4())

    mock_dataset = MagicMock()
    mock_dataset.reconstruction_exists.return_value = True
    # 3 reconstruction components (component 0, component 1, component 2)
    mock_dataset.load_reconstruction.return_value = [{"shots": {}}, {"shots": {}}, {"shots": {}}]

    mock_session = MagicMock()
    mock_session.execute = AsyncMock()
    mock_session.commit = AsyncMock()
    mock_session_ctx = MagicMock()
    mock_session_ctx.__aenter__.return_value = mock_session
    mock_session_ctx.__aexit__.return_value = None

    added_jobs = []
    mock_session.add.side_effect = lambda j: added_jobs.append(j)

    with patch("app.services.worker.handlers.opensfm_reconstruct.HAS_OPENSFM", True), \
         patch("app.services.worker.handlers.opensfm_reconstruct.DataSet", return_value=mock_dataset), \
         patch("app.services.worker.handlers.opensfm_reconstruct.async_session", return_value=mock_session_ctx):
        
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
