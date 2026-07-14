from fastapi import APIRouter
from pydantic import BaseModel
from typing import Dict, List
import os

router = APIRouter(tags=["System health"], prefix="/health")

class HealthCheck(BaseModel):
    status: str
    version: str

@router.get("", response_model=HealthCheck)
async def health_check():
    """
    Dummy health check route to verify backend is running.
    """
    return HealthCheck(status="ok", version="1.0.0")

class SystemDiagnostics(BaseModel):
    cpu_usage: float | None
    memory_usage: float | None
    active_connections: int | None
    services_status: Dict[str, str]
    recent_errors: List[str]

@router.get("/diagnostics", response_model=SystemDiagnostics)
async def get_diagnostics():
    """
    Detailed diagnostics route to test complex generated types in hey-api.
    """
    return SystemDiagnostics(
        cpu_usage=get_cpu_usage(),
        memory_usage=get_memory_usage(),
        active_connections=None,
        services_status={
            "database": "online",
            "redis": "online",
            "pgPointcloud": "offline"
        },
        recent_errors= []
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