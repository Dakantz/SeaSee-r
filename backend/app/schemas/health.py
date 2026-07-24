from pydantic import BaseModel
from typing import Dict, List

class HealthCheck(BaseModel):
    status: str
    version: str

class SystemDiagnostics(BaseModel):
    cpu_usage: float | None
    memory_usage: float | None
    active_connections: int | None
    services_status: Dict[str, str]
    recent_errors: List[str]
