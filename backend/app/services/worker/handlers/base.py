from abc import ABC, abstractmethod
from typing import List, Dict, Any, Optional
from datetime import datetime
from sqlalchemy import update
from app.core.database import async_session
from app.models.job import Job
from app.services.worker.tasks import _update_job_status

class BaseTaskHandler(ABC):
    """
    Abstract base class for background job task handlers.
    """
    task_types: List[str] = []

    async def update_job_status(
        self,
        job_id_str: str,
        status: str,
        progress: float = 0.0,
        error_message: Optional[str] = None,
        result: Optional[dict] = None
    ) -> bool:
        """Updates job status, progress percentage, error message, and results in PostgreSQL. Returns False if job is CANCELLED."""
        return await _update_job_status(
            job_id_str=job_id_str,
            status=status,
            progress=progress,
            error_message=error_message,
            result=result
        )


    @abstractmethod
    async def execute(self, job_id: str, payload: Dict[str, Any], name: str = "", task_type: str = "") -> Dict[str, Any]:
        """
        Executes the background task logic for a given job ID, payload, and task_type.
        """
        pass

