import asyncio
from datetime import datetime
from typing import Dict, Any, Optional
from sqlalchemy import update, select

from app.core.database import async_session
from app.models.job import Job

async def _update_job_status(
    job_id_str: str,
    status: str,
    progress: float = 0.0,
    error_message: Optional[str] = None,
    result: Optional[dict] = None
):
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


def run_background_job(job_id_str: str) -> Dict[str, Any]:
    """
    Main RQ background worker entrypoint to execute enqueued jobs.
    Fetches job record from DB and dispatches to appropriate task handler.
    """
    return asyncio.run(_run_background_job_async(job_id_str))


async def _run_background_job_async(job_id_str: str) -> Dict[str, Any]:
    import uuid
    from app.services.worker.registry import task_registry

    try:
        job_uuid = uuid.UUID(job_id_str)
    except (ValueError, AttributeError, TypeError):
        return {"status": "error", "message": f"Job {job_id_str} not found"}

    async with async_session() as session:
        res = await session.execute(select(Job).where(Job.id == job_uuid))
        job_record = res.scalar_one_or_none()
        if not job_record:
            return {"status": "error", "message": f"Job {job_id_str} not found"}

        payload = job_record.payload or {}
        task_type = job_record.task_type or ""
        name = job_record.name or ""

    return await task_registry.dispatch(job_id_str, task_type=task_type, payload=payload, name=name)

