from abc import ABC, abstractmethod
from typing import List, Dict, Any, Optional
from datetime import datetime
from sqlalchemy import update
from app.core.database import async_session
from app.models.job import Job

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
    ) -> None:
        """Updates job status, progress percentage, error message, and results in PostgreSQL."""
        async with async_session() as session:
            values = {
                "status": status,
                "progress": round(progress, 2),
                "error_message": error_message
            }
            if result is not None:
                values["result"] = result
            if status == "RUNNING":
                values["started_at"] = datetime.utcnow()
            elif status in ("COMPLETED", "FAILED"):
                values["completed_at"] = datetime.utcnow()

            stmt = update(Job).where(Job.id == job_id_str).values(**values)
            await session.execute(stmt)
            await session.commit()

    @abstractmethod
    async def execute(self, job_id: str, payload: Dict[str, Any], name: str = "", task_type: str = "") -> Dict[str, Any]:
        """
        Executes the background task logic for a given job ID, payload, and task_type.
        """
        pass

