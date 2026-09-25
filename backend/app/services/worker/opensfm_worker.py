import os
import sys
import logging
from typing import Tuple, Optional
from rq import Worker

import subprocess

logger = logging.getLogger(__name__)


def _check_opensfm_depthmap_available_in_process() -> Tuple[bool, Optional[str]]:
    """
    Direct in-process check for OpenSfM core bindings and GPU/OpenCL depthmap estimator availability.
    Only executed inside the isolated CLI subprocess (`python -m app.services.worker.opensfm_worker`),
    preventing OpenCL context initialization inside the parent RQ worker process before fork.
    """
    try:
        import opensfm
        import opensfm.pygeometry
        import opensfm.pymap
        import opensfm.pybundle
        from opensfm import pydense

        is_available = bool(pydense.DepthmapClusterEstimator.is_available())
        if not is_available:
            return False, "pydense.DepthmapClusterEstimator.is_available() returned False (GPU/OpenCL unavailable)"
        return True, None
    except ImportError as e:
        return False, f"OpenSfM modules not importable: {e}"
    except Exception as e:
        return False, f"OpenSfM depthmap check error: {e}"


def check_opensfm_depthmap_available() -> Tuple[bool, Optional[str]]:
    """
    Verifies OpenSfM core bindings and GPU/OpenCL depthmap estimator availability
    by running `python -m app.services.worker.opensfm_worker` in an isolated subprocess.

    This ensures that the main RQ worker process never loads OpenCL or initializes the GPU driver
    before forking child worker processes, preventing fork-related OpenCL driver corruption.

    Returns:
        (is_available: bool, error_message: Optional[str])
    """
    try:
        res = subprocess.run(
            [sys.executable, "-m", "app.services.worker.opensfm_worker"],
            capture_output=True,
            text=True,
            timeout=15,
        )
        if res.returncode == 0:
            return True, None

        err_msg = res.stderr.strip() or res.stdout.strip() or f"Subprocess exited with code {res.returncode}"
        return False, err_msg
    except subprocess.TimeoutExpired:
        return False, "OpenSfM healthcheck subprocess timed out after 15s"
    except Exception as e:
        return False, f"Failed to execute OpenSfM healthcheck subprocess: {e}"

class OpenSfMWorker(Worker):
    """
    Custom RQ Worker for OpenSfM tasks that automatically checks and reports
    GPU/OpenCL depthmap estimator availability to Redis on startup and heartbeat.
    """
    def register_birth(self):
        super().register_birth()
        self.report_opensfm_health()

    def heartbeat(self, timeout=None, pipeline=None):
        super().heartbeat(timeout=timeout, pipeline=pipeline)
        self.report_opensfm_health(pipeline=pipeline)

    def report_opensfm_health(self, pipeline=None):
        available, error = check_opensfm_depthmap_available()
        conn = pipeline if pipeline is not None else self.connection
        val = b"1" if available else b"0"
        try:
            conn.hset(self.key, "depthmap_available", val)
            if error:
                conn.hset(self.key, "depthmap_error", error)
                conn.set("opensfm:depthmap_error", error, ex=60)
            else:
                conn.hdel(self.key, "depthmap_error")
                conn.delete("opensfm:depthmap_error")
            conn.set("opensfm:depthmap_available", val, ex=60)
        except Exception as e:
            logger.error(f"Failed to record OpenSfM health status in Redis: {e}")

if __name__ == "__main__":
    from redis import Redis

    redis_url = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
    redis_conn = None
    try:
        redis_conn = Redis.from_url(redis_url)
    except Exception as exc:
        sys.stderr.write(f"Warning: Could not connect to Redis at {redis_url}: {exc}\n")

    available, error = _check_opensfm_depthmap_available_in_process()
    
    if redis_conn:
        try:
            val = "1" if available else "0"
            redis_conn.set("opensfm:depthmap_available", val, ex=60)
            if error:
                redis_conn.set("opensfm:depthmap_error", error, ex=60)
            else:
                redis_conn.delete("opensfm:depthmap_error")
        except Exception as exc:
            sys.stderr.write(f"Warning: Failed to update Redis status: {exc}\n")

    if not available:
        sys.stderr.write(f"OpenSfM healthcheck failed: {error}\n")
        sys.exit(1)
    
    print("OpenSfM DepthmapClusterEstimator is available.")
    sys.exit(0)
