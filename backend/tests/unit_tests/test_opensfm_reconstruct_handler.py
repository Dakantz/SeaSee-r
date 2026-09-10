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
async def test_opensfm_reconstruct_missing_binary_raises(tmp_path):
    handler = OpenSfMReconstructTaskHandler()
    dataset_dir = tmp_path / "dataset"
    images_dir = dataset_dir / "images"
    images_dir.mkdir(parents=True)
    (images_dir / "img1.png").write_text("dummy")

    payload = {"dataset_dir": str(dataset_dir), "opensfm_bin": "/non/existent/bin"}

    with patch.object(handler, "update_job_status", new_callable=AsyncMock) as mock_update, \
         patch("shutil.which", return_value=None), \
         patch("os.path.exists", side_effect=lambda p: True if p in (str(dataset_dir), str(images_dir)) else False):
        with pytest.raises(RuntimeError, match="No executable OpenSfM binary found"):
            await handler.execute("job-123", payload)
        assert mock_update.called


@pytest.mark.anyio
async def test_opensfm_reconstruct_success(tmp_path):
    handler = OpenSfMReconstructTaskHandler()
    dataset_dir = tmp_path / "dataset"
    images_dir = dataset_dir / "images"
    images_dir.mkdir(parents=True)
    (images_dir / "img1.png").write_text("dummy")

    fake_bin = tmp_path / "opensfm_run_all"
    fake_bin.write_text("#!/bin/bash\nexit 0")
    fake_bin.chmod(0o755)

    payload = {"dataset_dir": str(dataset_dir), "opensfm_bin": str(fake_bin)}

    mock_proc = AsyncMock()
    mock_proc.returncode = 0
    mock_proc.communicate = AsyncMock(return_value=(b"Success", b""))

    with patch.object(handler, "update_job_status", new_callable=AsyncMock) as mock_update, \
         patch("asyncio.create_subprocess_exec", return_value=mock_proc) as mock_exec:
        res = await handler.execute("job-123", payload)

        assert res["status"] == "success"
        assert res["dataset_dir"] == str(dataset_dir)
        mock_exec.assert_called_once()
        mock_update.assert_any_call("job-123", "COMPLETED", 100.0, result=res)
