import os
import pytest
from unittest.mock import AsyncMock, patch, MagicMock, ANY

from app.services.worker.handlers.opensfm_dense import OpenSfMDenseTaskHandler


@pytest.mark.anyio
async def test_opensfm_dense_missing_dataset_dir_raises(tmp_path):
    handler = OpenSfMDenseTaskHandler()
    non_existent = str(tmp_path / "non_existent_dataset")
    payload = {"dataset_dir": non_existent}

    with patch.object(handler, "update_job_status", new_callable=AsyncMock) as mock_update:
        with pytest.raises(RuntimeError, match="does not exist"):
            await handler.execute("19732560-8306-4484-92d6-b101743fb329", payload)
        assert mock_update.called


@pytest.mark.anyio
async def test_opensfm_dense_missing_opensfm_library_raises(tmp_path):
    handler = OpenSfMDenseTaskHandler()
    dataset_dir = tmp_path / "dataset"
    dataset_dir.mkdir()

    payload = {"dataset_dir": str(dataset_dir)}

    with patch.object(handler, "update_job_status", new_callable=AsyncMock) as mock_update, \
         patch("app.services.worker.handlers.opensfm_dense.HAS_OPENSFM", False):
        with pytest.raises(RuntimeError, match="OpenSfM Python library is not available"):
            await handler.execute("19732560-8306-4484-92d6-b101743fb329", payload)
        assert mock_update.called


@pytest.mark.anyio
async def test_opensfm_dense_success(tmp_path):
    handler = OpenSfMDenseTaskHandler()
    dataset_dir = tmp_path / "dataset"
    depthmaps_dir = dataset_dir / "undistorted" / "depthmaps"
    depthmaps_dir.mkdir(parents=True)
    (depthmaps_dir / "fused.laz").write_bytes(b"dummy laz content")

    payload = {"dataset_dir": str(dataset_dir), "reconstruction_index": 0, "subfolder": "undistorted"}

    def fake_dense_pipeline(d_dir, loop, j_id, r_idx, s_folder):
        pass

    with patch.object(handler, "update_job_status", new_callable=AsyncMock) as mock_update, \
         patch("app.services.worker.handlers.opensfm_dense.HAS_OPENSFM", True), \
         patch.object(handler, "_run_opensfm_dense_pipeline", side_effect=fake_dense_pipeline) as mock_pipeline:
        res = await handler.execute("19732560-8306-4484-92d6-b101743fb329", payload)

        assert res["status"] == "success"
        assert res["dataset_dir"] == str(dataset_dir)
        assert res["reconstruction_index"] == 0
        assert res["subfolder"] == "undistorted"
        mock_pipeline.assert_called_once()
        mock_update.assert_any_call("19732560-8306-4484-92d6-b101743fb329", "COMPLETED", 100.0, result=res)


@pytest.mark.anyio
async def test_opensfm_dense_missing_pointcloud_verification_raises(tmp_path):
    handler = OpenSfMDenseTaskHandler()
    dataset_dir = tmp_path / "dataset"
    dataset_dir.mkdir(parents=True)

    payload = {"dataset_dir": str(dataset_dir), "reconstruction_index": 0, "subfolder": "undistorted"}

    mock_dataset_cls = MagicMock()
    mock_actions = MagicMock()

    with patch.object(handler, "update_job_status", new_callable=AsyncMock) as mock_update, \
         patch("app.services.worker.handlers.opensfm_dense.HAS_OPENSFM", True), \
         patch("app.services.worker.handlers.opensfm_dense.DataSet", return_value=mock_dataset_cls), \
         patch("app.services.worker.handlers.opensfm_dense.actions", mock_actions):
        with pytest.raises(RuntimeError, match="fused.laz point cloud file was not generated"):
            await handler.execute("19732560-8306-4484-92d6-b101743fb329", payload)
        
        mock_update.assert_any_call("19732560-8306-4484-92d6-b101743fb329", "FAILED", 0.0, error_message=ANY)


@pytest.mark.anyio
async def test_opensfm_dense_cancelled(tmp_path):
    handler = OpenSfMDenseTaskHandler()
    dataset_dir = tmp_path / "dataset"
    dataset_dir.mkdir(parents=True)

    payload = {"dataset_dir": str(dataset_dir)}
    test_job_id = "19732560-8306-4484-92d6-b101743fb329"

    with patch.object(handler, "update_job_status", new_callable=AsyncMock) as mock_update:
        mock_update.return_value = False  # Job cancelled
        res = await handler.execute(test_job_id, payload)

        assert res["status"] == "cancelled"
        assert "cancellation" in res["message"].lower()
