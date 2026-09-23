import pytest
from unittest.mock import patch, MagicMock
import sys

from app.services.worker.handlers.opensfm_health import check_opensfm_gpu_health


def test_opensfm_gpu_health_success():
    mock_pydense = MagicMock()
    mock_pydense.DepthmapClusterEstimator.is_available.return_value = True

    mock_opensfm = MagicMock()
    mock_opensfm.pydense = mock_pydense
    mock_pygeometry = MagicMock()
    mock_pymap = MagicMock()
    mock_pybundle = MagicMock()

    with patch.dict(sys.modules, {
        "opensfm": mock_opensfm,
        "opensfm.pygeometry": mock_pygeometry,
        "opensfm.pymap": mock_pymap,
        "opensfm.pybundle": mock_pybundle,
        "opensfm.pydense": mock_pydense,
    }):
        is_healthy, msg = check_opensfm_gpu_health()
        assert is_healthy is True
        assert "healthy" in msg.lower()


def test_opensfm_gpu_health_gpu_unavailable():
    mock_pydense = MagicMock()
    mock_pydense.DepthmapClusterEstimator.is_available.return_value = False

    mock_opensfm = MagicMock()
    mock_opensfm.pydense = mock_pydense
    mock_pygeometry = MagicMock()
    mock_pymap = MagicMock()
    mock_pybundle = MagicMock()

    with patch.dict(sys.modules, {
        "opensfm": mock_opensfm,
        "opensfm.pygeometry": mock_pygeometry,
        "opensfm.pymap": mock_pymap,
        "opensfm.pybundle": mock_pybundle,
        "opensfm.pydense": mock_pydense,
    }):
        is_healthy, msg = check_opensfm_gpu_health()
        assert is_healthy is False
        assert "unavailable" in msg.lower()
        assert "docker compose restart opensfm" in msg


def test_opensfm_gpu_health_import_error():
    with patch.dict(sys.modules, {
        "opensfm": None,
        "opensfm.pygeometry": None,
        "opensfm.pymap": None,
        "opensfm.pybundle": None,
        "opensfm.pydense": None,
    }):
        is_healthy, msg = check_opensfm_gpu_health()
        assert is_healthy is False
        assert "not available" in msg.lower() or "failed" in msg.lower()
