import os
import pytest
from unittest.mock import AsyncMock, patch, MagicMock

from app.services.worker.handlers.opensfm_reconstruct import OpenSfMReconstructTaskHandler


@pytest.mark.anyio
async def test_opensfm_reconstruct_missing_dataset_dir_raises(tmp_path):
    handler = OpenSfMReconstructTaskHandler()
    non_existent = str(tmp_path / "non_existent_dataset")
    payload = {"dataset_dir": non_existent}

    with patch.object(handler, "update_job_status", new_callable=AsyncMock) as mock_update:
        with pytest.raises(RuntimeError, match="does not exist"):
            await handler.execute("job-123", payload)
        assert mock_update.called


@pytest.mark.anyio
async def test_opensfm_reconstruct_missing_images_raises(tmp_path):
    handler = OpenSfMReconstructTaskHandler()
    dataset_dir = tmp_path / "dataset"
    dataset_dir.mkdir()
    payload = {"dataset_dir": str(dataset_dir)}

    with patch.object(handler, "update_job_status", new_callable=AsyncMock) as mock_update:
        with pytest.raises(RuntimeError, match="No images found"):
            await handler.execute("job-123", payload)
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
            await handler.execute("job-123", payload)
        assert mock_update.called


@pytest.mark.anyio
async def test_opensfm_reconstruct_success(tmp_path):
    handler = OpenSfMReconstructTaskHandler()
    dataset_dir = tmp_path / "dataset"
    images_dir = dataset_dir / "images"
    images_dir.mkdir(parents=True)
    (images_dir / "img1.png").write_text("dummy")

    payload = {"dataset_dir": str(dataset_dir)}

    with patch.object(handler, "update_job_status", new_callable=AsyncMock) as mock_update, \
         patch("app.services.worker.handlers.opensfm_reconstruct.HAS_OPENSFM", True), \
         patch.object(handler, "_run_opensfm_pipeline") as mock_pipeline:
        res = await handler.execute("job-123", payload)

        assert res["status"] == "success"
        assert res["dataset_dir"] == str(dataset_dir)
        mock_pipeline.assert_called_once()
        mock_update.assert_any_call("job-123", "COMPLETED", 100.0, result=res)


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
        # Verify FAILED status was never set
        for call_args in mock_update.call_args_list:
            assert call_args[0][1] != "FAILED"

