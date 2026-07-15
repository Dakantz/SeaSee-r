import socket
import urllib.parse
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from app.schemas.health import HealthCheck, SystemDiagnostics
from app.core.database import get_db_session
from app.core.config import settings
import os

router = APIRouter(tags=["System health"], prefix="/health")

def check_redis_online() -> bool:
    try:
        parsed = urllib.parse.urlparse(settings.redis_url)
        host = parsed.hostname or "localhost"
        port = parsed.port or 6379
        with socket.create_connection((host, port), timeout=1.0):
            return True
    except Exception:
        return False

@router.get("", response_model=HealthCheck)
async def health_check():
    """
    Dummy health check route to verify backend is running.
    """
    return HealthCheck(status="ok", version="1.0.0")

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
    except Exception:
        pass

    redis_status = "online" if check_redis_online() else "offline"

    return SystemDiagnostics(
        cpu_usage=get_cpu_usage(),
        memory_usage=get_memory_usage(),
        active_connections=None,
        services_status={
            "database": db_status,
            "redis": redis_status,
            "pgPointcloud": pg_pointcloud_status
        },
        recent_errors=[]
    )

def get_cpu_usage() -> float | None:
    try:
        load1, _, _ = os.getloadavg()
        cpu_count = os.cpu_count() or 1
        return round((load1 / cpu_count) * 100, 1)
    except Exception:
        return None

def get_memory_usage() -> float | None:
    try:
        with open('/proc/meminfo', 'r') as f:
            lines = f.readlines()
        mem_total = 0
        mem_available = 0
        for line in lines:
            if line.startswith('MemTotal:'):
                mem_total = int(line.split()[1])
            elif line.startswith('MemAvailable:'):
                mem_available = int(line.split()[1])
        if mem_total > 0:
            return round(((mem_total - mem_available) / mem_total) * 100, 1)
        return None
    except Exception:
        return None