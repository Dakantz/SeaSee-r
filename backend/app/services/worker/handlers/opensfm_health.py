import logging
from typing import Tuple

logger = logging.getLogger(__name__)


def check_opensfm_gpu_health() -> Tuple[bool, str]:
    """
    Checks internal OpenSfM C++ / OpenCL GPU availability within the container environment.
    Verifies that OpenSfM core C++ modules (pygeometry, pymap, pybundle, pydense) are loadable
    and that pydense.DepthmapClusterEstimator.is_available() reports True (GPU/OpenCL devices available).

    Returns:
        (True, message) if OpenSfM and GPU/OpenCL are healthy.
        (False, error_message) if OpenSfM is missing, bindings failed, or GPU/OpenCL is unavailable.
    """
    try:
        import opensfm
        import opensfm.pygeometry
        import opensfm.pymap
        import opensfm.pybundle
        from opensfm import pydense
    except ImportError as e:
        msg = f"OpenSfM Python library or C++ bindings are not available ({e})."
        logger.warning(msg)
        return False, msg
    except Exception as e:
        msg = f"Failed to load OpenSfM C++ modules ({e})."
        logger.warning(msg)
        return False, msg

    try:
        if not pydense.DepthmapClusterEstimator.is_available():
            msg = (
                "OpenCL/GPU DepthmapClusterEstimator is unavailable. "
                "The container has lost access to the GPU driver. "
                "Please restart the opensfm container with 'docker compose restart opensfm'."
            )
            logger.warning(msg)
            return False, msg
    except Exception as e:
        msg = f"Error checking OpenSfM DepthmapClusterEstimator availability: {e}"
        logger.warning(msg)
        return False, msg

    return True, "OpenSfM C++ bindings and OpenCL GPU estimator are healthy."
