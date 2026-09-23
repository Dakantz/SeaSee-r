from typing import Dict, List, Optional
from pydantic import BaseModel

class HealthCheck(BaseModel):
    status: str
    version: str

class WorkerInfo(BaseModel):
    name: str
    status: str = "online"
    container_id: Optional[str] = None
    state: Optional[str] = None
    current_job_id: Optional[str] = None
    queues: List[str] = []
    queued_jobs_count: int = 0
    total_working_time: float = 0.0
    last_heartbeat: Optional[str] = None
    python_version: Optional[str] = None
    ip_address: Optional[str] = None

class SystemDiagnostics(BaseModel):
    cpu_usage: float | None
    memory_usage: float | None
    active_connections: int | None
    services_status: Dict[str, str]
    recent_errors: List[str]
    workers: List[WorkerInfo] = []


