import logging
import psutil
import asyncio
import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from app.schemas.health import HealthCheck, SystemDiagnostics
from app.core.database import get_db_session
from app.core.config import settings
from redis.asyncio import Redis as AsyncRedis
from redis import Redis as SyncRedis
from rq import Worker

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

def check_worker_online_sync() -> bool:
    try:
        workers = Worker.all(connection=sync_redis_client)
        return len(workers) > 0
    except Exception as e:
        logger.error(f"Worker health check failed: {e}")
        return False

async def check_tusd_online() -> bool:
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            response = await client.options("http://tusd:8080/files/")
            return response.status_code in (200, 204)
    except Exception as e:
        logger.error(f"TUSD health check failed: {e}")
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
    
    worker_online = await asyncio.to_thread(check_worker_online_sync)
    worker_status = "online" if worker_online else "offline"

    tusd_online = await check_tusd_online()
    tusd_status = "online" if tusd_online else "offline"

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

    return SystemDiagnostics(
        cpu_usage=cpu_usage,
        memory_usage=memory_usage,
        active_connections=None,
        services_status={
            "database": db_status,
            "redis": redis_status,
            "pgPointcloud": pg_pointcloud_status,
            "worker": worker_status,
            "tusd": tusd_status
        },
        recent_errors=[]
    )