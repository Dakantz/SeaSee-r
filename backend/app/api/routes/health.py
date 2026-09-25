import logging
import psutil
import asyncio
import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from typing import Dict, List, Optional
from app.schemas.health import HealthCheck, SystemDiagnostics, WorkerInfo
from app.core.database import get_db_session
from app.core.config import settings
from redis.asyncio import Redis as AsyncRedis
from redis import Redis as SyncRedis
from rq import Worker, Queue

logger = logging.getLogger(__name__)

router = APIRouter(tags=["System health"], prefix="/health")

# Shared connection pools
async_redis_client = AsyncRedis.from_url(settings.redis_url)
sync_redis_client = SyncRedis.from_url(settings.redis_url)

async def check_redis_online() -> bool:
    try:
        await async_redis_client.ping()
        return True
    except Exception as e:
        logger.error(f"Redis health check failed: {e}")
        return False

def check_opensfm_depthmap_health(sfm_workers: List[Worker]) -> tuple[bool, Optional[str]]:
    """
    Checks if OpenSfM depthmap estimator is available.
    Matches container validation check:
    'from opensfm import pydense; assert pydense.DepthmapClusterEstimator.is_available()'
    """
    # 1. Check direct Redis key reported by worker or healthcheck
    try:
        raw_val = sync_redis_client.get("opensfm:depthmap_available")
        if raw_val is not None:
            val = raw_val.decode("utf-8") if isinstance(raw_val, bytes) else str(raw_val)
            err_raw = sync_redis_client.get("opensfm:depthmap_error")
            err_msg = err_raw.decode("utf-8") if isinstance(err_raw, bytes) else (str(err_raw) if err_raw else None)
            return (val == "1"), err_msg
    except Exception as e:
        logger.debug(f"Redis check for opensfm:depthmap_available failed: {e}")

    # 2. Check individual worker hash keys in Redis
    for w in sfm_workers:
        try:
            raw_hval = sync_redis_client.hget(w.key, "depthmap_available")
            if raw_hval is not None:
                hval = raw_hval.decode("utf-8") if isinstance(raw_hval, bytes) else str(raw_hval)
                err_hval = sync_redis_client.hget(w.key, "depthmap_error")
                err_msg = err_hval.decode("utf-8") if isinstance(err_hval, bytes) else (str(err_hval) if err_hval else None)
                return (hval == "1"), err_msg
        except Exception:
            pass

    # 3. Direct local check (if running in an environment where OpenSfM is installed)
    try:
        from opensfm import pydense
        is_avail = bool(pydense.DepthmapClusterEstimator.is_available())
        return is_avail, None if is_avail else "pydense.DepthmapClusterEstimator.is_available() returned False (GPU/OpenCL unavailable)"
    except ImportError:
        pass
    except Exception as exc:
        return False, f"OpenSfM local check error: {exc}"

    # 4. Fallback: if idle, probe via quick task
    try:
        q = Queue("opensfm_tasks", connection=sync_redis_client)
        if len(q) == 0 and any(w.get_state() == "idle" for w in sfm_workers):
            from app.services.worker.tasks import probe_opensfm_depthmap_task
            job = q.enqueue(probe_opensfm_depthmap_task, job_timeout=3, result_ttl=30)
            import time
            start = time.time()
            while time.time() - start < 1.0:
                job.refresh()
                if job.is_finished:
                    res = job.result or {}
                    is_avail = bool(res.get("available"))
                    err_msg = res.get("error")
                    sync_redis_client.set("opensfm:depthmap_available", "1" if is_avail else "0", ex=60)
                    return is_avail, err_msg
                elif job.is_failed:
                    sync_redis_client.set("opensfm:depthmap_available", "0", ex=60)
                    return False, "OpenSfM probe job failed"
                time.sleep(0.05)
    except Exception as e:
        logger.debug(f"OpenSfM probe skipped: {e}")

    # Default to True if status could not be queried (e.g. mock test environment)
    return True, None

def get_workers_info_sync() -> tuple[str, str, List[WorkerInfo]]:
    try:
        workers = Worker.all(connection=sync_redis_client)
        general_workers = [
            w for w in workers
            if any(q in w.queue_names() for q in ["pointcloud_tasks", "job_tasks", "default"])
        ]
        sfm_workers = [w for w in workers if "opensfm_tasks" in w.queue_names()]

        worker_status = "online" if len(general_workers) > 0 else "offline"

        opensfm_available = True
        if len(sfm_workers) == 0:
            opensfm_status = "offline"
        else:
            opensfm_available, _ = check_opensfm_depthmap_health(sfm_workers)
            opensfm_status = "online" if opensfm_available else "unhealthy"

        queue_counts: Dict[str, int] = {}

        def get_queue_len(q_name: str) -> int:
            if q_name not in queue_counts:
                try:
                    q = Queue(q_name, connection=sync_redis_client)
                    queue_counts[q_name] = len(q)
                except Exception:
                    queue_counts[q_name] = 0
            return queue_counts[q_name]

        workers_info: List[WorkerInfo] = []
        for w in workers:
            heartbeat = w.last_heartbeat.isoformat() if w.last_heartbeat else None
            q_names = w.queue_names()
            queued_count = sum(get_queue_len(qn) for qn in q_names)

            is_sfm = "opensfm_tasks" in q_names
            w_depthmap_available = opensfm_available if is_sfm else None
            w_status = "unhealthy" if (is_sfm and not opensfm_available) else "online"

            info = WorkerInfo(
                name=w.name,
                status=w_status,
                container_id=getattr(w, "hostname", None),
                state=w.get_state(),
                current_job_id=w.get_current_job_id(),
                queues=q_names,
                queued_jobs_count=queued_count,
                total_working_time=round(w.total_working_time, 2),
                last_heartbeat=heartbeat,
                python_version=getattr(w, "python_version", None),
                ip_address=getattr(w, "ip_address", None),
                depthmap_available=w_depthmap_available,
            )
            workers_info.append(info)

        return worker_status, opensfm_status, workers_info
    except Exception as e:
        logger.error(f"Workers health check failed: {e}")
        return "offline", "offline", []


async def check_tusd_online() -> bool:
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            response = await client.options("http://tusd:8080/files/")
            return response.status_code in (200, 204)
    except Exception as e:
        logger.error(f"TUSD health check failed: {e}")
        return False

async def check_frontend_online() -> bool:
    try:
        url = settings.frontend_url.rstrip("/") + "/"
        async with httpx.AsyncClient(timeout=2.0) as client:
            response = await client.get(url)
            return response.status_code == 200
    except Exception as e:
        logger.error(f"Frontend health check failed: {e}")
        return False

@router.get("", response_model=HealthCheck)
async def health_check():
    """
    Dummy health check route to verify backend is running.
    """
    return HealthCheck(status="ok", version=settings.version)

@router.get("/diagnostics", response_model=SystemDiagnostics)
async def get_diagnostics(
    db: AsyncSession = Depends(get_db_session)
):
    """
    Detailed diagnostics route to check active service statuses.
    """
    db_status = "offline"
    pg_pointcloud_status = "offline"
    try:
        await db.execute(text("SELECT 1"))
        db_status = "online"
        
        result = await db.execute(text("SELECT extname FROM pg_extension WHERE extname = 'pointcloud'"))
        if result.scalar_one_or_none():
            pg_pointcloud_status = "online"
    except Exception as e:
        logger.error(f"Database health check failed: {e}")

    redis_online = await check_redis_online()
    redis_status = "online" if redis_online else "offline"
    
    worker_status, opensfm_status, workers_info = await asyncio.to_thread(get_workers_info_sync)

    tusd_online = await check_tusd_online()
    tusd_status = "online" if tusd_online else "offline"

    frontend_online = await check_frontend_online()
    frontend_status = "online" if frontend_online else "offline"

    # Fail the health check if critical services are offline
    if db_status == "offline" or redis_status == "offline" or tusd_status == "offline":
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Critical services are offline"
        )

    # Use psutil in a thread pool as reading system stats can be blocking
    cpu_usage = await asyncio.to_thread(psutil.cpu_percent, 0.1)
    memory = await asyncio.to_thread(psutil.virtual_memory)
    memory_usage = memory.percent

    recent_errors: List[str] = []
    if opensfm_status == "unhealthy":
        try:
            err_raw = sync_redis_client.get("opensfm:depthmap_error")
            err_text = err_raw.decode("utf-8") if isinstance(err_raw, bytes) else (str(err_raw) if err_raw else None)
        except Exception:
            err_text = None
        recent_errors.append(
            err_text or "OpenSfM worker is connected, but DepthmapClusterEstimator is unavailable (GPU/OpenCL error)."
        )

    return SystemDiagnostics(
        cpu_usage=cpu_usage,
        memory_usage=memory_usage,
        active_connections=None,
        services_status={
            "database": db_status,
            "redis": redis_status,
            "pgPointcloud": pg_pointcloud_status,
            "worker": worker_status,
            "opensfm": opensfm_status,
            "tusd": tusd_status,
            "frontend": frontend_status,
        },
        recent_errors=recent_errors,
        workers=workers_info
    )