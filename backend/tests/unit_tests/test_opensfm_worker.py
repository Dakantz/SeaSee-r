import subprocess
from unittest.mock import patch, MagicMock

from app.services.worker.opensfm_worker import (
    check_opensfm_depthmap_available,
    _check_opensfm_depthmap_available_in_process,
    OpenSfMWorker,
)


def test_check_opensfm_depthmap_available_subprocess_success():
    mock_res = MagicMock(returncode=0, stdout="OpenSfM DepthmapClusterEstimator is available.", stderr="")
    with patch("subprocess.run", return_value=mock_res) as mock_run:
        available, error = check_opensfm_depthmap_available()
        assert available is True
        assert error is None
        mock_run.assert_called_once()
        cmd = mock_run.call_args[0][0]
        assert "-m" in cmd
        assert "app.services.worker.opensfm_worker" in cmd


def test_check_opensfm_depthmap_available_subprocess_failure():
    mock_res = MagicMock(returncode=1, stdout="", stderr="OpenSfM healthcheck failed: GPU unavailable")
    with patch("subprocess.run", return_value=mock_res):
        available, error = check_opensfm_depthmap_available()
        assert available is False
        assert "GPU unavailable" in error


def test_check_opensfm_depthmap_available_subprocess_timeout():
    with patch("subprocess.run", side_effect=subprocess.TimeoutExpired(cmd="test", timeout=15)):
        available, error = check_opensfm_depthmap_available()
        assert available is False
        assert "timed out" in error.lower()


def test_opensfm_worker_report_health():
    mock_conn = MagicMock()
    mock_conn.connection_pool.connection_kwargs = {"socket_timeout": 60}
    worker = OpenSfMWorker(queues=["opensfm_tasks"], connection=mock_conn)
    with patch("app.services.worker.opensfm_worker.check_opensfm_depthmap_available", return_value=(True, None)):
        worker.report_opensfm_health()
        worker.connection.hset.assert_called_with(worker.key, "depthmap_available", b"1")
        worker.connection.hdel.assert_called_with(worker.key, "depthmap_error")
        worker.connection.set.assert_called_with("opensfm:depthmap_available", b"1", ex=60)
