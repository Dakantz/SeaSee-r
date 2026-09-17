import asyncio
import logging
from datetime import datetime
from typing import Dict, Any, Optional
from sqlalchemy import update, select

from app.core.database import async_session
from app.models.job import Job

logger = logging.getLogger(__name__)

async def _update_job_status(
    job_id_str: str,
    status: str,
    progress: float = 0.0,
    error_message: Optional[str] = None,
    result: Optional[dict] = None
):
    """Updates job status, progress percentage, error message, and results in PostgreSQL, and processes dependency queues."""
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
        elif status in ("COMPLETED", "FAILED", "CANCELLED"):
            values["completed_at"] = datetime.utcnow()

        stmt = update(Job).where(Job.id == job_id_str).values(**values)
        await session.execute(stmt)
        await session.commit()

        # Process dependency updates and pipeline status
        await _process_job_dependency_updates(session, job_id_str, status)


async def _process_job_dependency_updates(session, job_id_str: str, status: str):
    import uuid
    from redis import Redis
    from rq import Queue
    from app.core.config import settings
    from app.models.job import Job, JobStatus, Pipeline, PipelineStatus

    try:
        job_uuid = uuid.UUID(job_id_str)
    except (ValueError, TypeError):
        return

    job_res = await session.execute(select(Job).where(Job.id == job_uuid))
    job = job_res.scalar_one_or_none()
    pipeline_id = job.pipeline_id if job else None

    if status == "COMPLETED":
        res = await session.execute(select(Job).where(Job.status == JobStatus.BLOCKED))
        blocked_jobs = res.scalars().all()

        for dep_job in blocked_jobs:
            deps = dep_job.depends_on or []
            if job_id_str in deps or str(job_uuid) in deps:
                parent_uuids = []
                for d in deps:
                    try:
                        parent_uuids.append(uuid.UUID(str(d)))
                    except (ValueError, TypeError):
                        pass

                if parent_uuids:
                    p_res = await session.execute(select(Job.status).where(Job.id.in_(parent_uuids)))
                    parent_statuses = p_res.scalars().all()
                    if all(s == JobStatus.COMPLETED for s in parent_statuses):
                        dep_job.status = JobStatus.PENDING
                        await session.commit()

                        # Auto-enqueue dependent job
                        try:
                            from app.utils.queue_utils import enqueue_job
                            enqueue_job(dep_job.id, dep_job.task_type)
                        except Exception as e:
                            logger.warning(f"Could not enqueue dependent job {dep_job.id} to Redis Queue: {e}")

    elif status in ("FAILED", "CANCELLED"):
        queue_to_fail = [job_id_str]
        visited = set()

        while queue_to_fail:
            curr_id = queue_to_fail.pop(0)
            if curr_id in visited:
                continue
            visited.add(curr_id)

            res = await session.execute(
                select(Job).where(Job.status.in_([JobStatus.BLOCKED, JobStatus.PENDING]))
            )
            candidates = res.scalars().all()

            for cand in candidates:
                deps = cand.depends_on or []
                if curr_id in deps:
                    cand.status = JobStatus.FAILED
                    cand.error_message = f"Parent dependency job {curr_id} failed."
                    queue_to_fail.append(str(cand.id))

            await session.commit()

    if pipeline_id:
        p_res = await session.execute(select(Pipeline).where(Pipeline.id == pipeline_id))
        pipeline = p_res.scalar_one_or_none()
        if pipeline:
            pj_res = await session.execute(select(Job).where(Job.pipeline_id == pipeline_id))
            pipeline_jobs = pj_res.scalars().all()

            if any(j.status == JobStatus.FAILED for j in pipeline_jobs):
                pipeline.status = PipelineStatus.FAILED
            elif any(j.status == JobStatus.CANCELLED for j in pipeline_jobs):
                pipeline.status = PipelineStatus.CANCELLED
            elif all(j.status == JobStatus.COMPLETED for j in pipeline_jobs):
                pipeline.status = PipelineStatus.COMPLETED
            elif any(j.status in (JobStatus.RUNNING, JobStatus.PENDING, JobStatus.BLOCKED) for j in pipeline_jobs):
                pipeline.status = PipelineStatus.RUNNING

            await session.commit()


def handle_rq_job_failure(job, connection, type, value, traceback):
    """
    Callback invoked by the parent RQ worker process whenever a job fails
    (including when a child work-horse process crashes abruptly via SIGABRT/SIGSEGV).
    Ensures PostgreSQL database and downstream dependencies reflect JobStatus.FAILED.
    """
    job_id_str = str(job.id)
    error_msg = str(value) if value else (str(type) if type else "Job execution failed in Redis Queue")
    if job.exc_info and str(job.exc_info) not in error_msg:
        error_msg = f"{error_msg} | {job.exc_info}"

    logger.error(f"RQ failure callback triggered for job {job_id_str}: {error_msg}")
    try:
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None

        coro = _update_job_status(job_id_str, "FAILED", error_message=error_msg)
        if loop and loop.is_running():
            asyncio.create_task(coro)
        else:
            asyncio.run(coro)
    except Exception as e:
        logger.error(f"Failed to update DB job status in RQ on_failure callback for {job_id_str}: {e}")



async def sync_job_status_from_redis(session, job: Job) -> bool:
    """
    Reconciles PostgreSQL job record with Redis RQ status.
    If DB status is PENDING or RUNNING but Redis RQ status is FAILED,
    updates DB status to FAILED and invokes dependency updates.
    Returns True if status was updated, False otherwise.
    """
    from app.models.job import JobStatus
    if job.status not in (JobStatus.PENDING, JobStatus.RUNNING):
        return False

    try:
        from redis import Redis
        from rq.job import Job as RQJob
        from app.core.config import settings

        redis_conn = Redis.from_url(settings.redis_url)
        rq_job = RQJob.fetch(str(job.id), connection=redis_conn)
        if rq_job and rq_job.is_failed:
            err_msg = rq_job.exc_info or "Job failed in Redis Queue / worker process terminated"
            job.status = JobStatus.FAILED
            job.error_message = err_msg
            job.completed_at = datetime.utcnow()
            await session.commit()
            await _process_job_dependency_updates(session, str(job.id), "FAILED")
            return True
    except Exception as e:
        logger.debug(f"Redis status check skipped for job {job.id}: {e}")
    return False


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

    try:
        return await task_registry.dispatch(job_id_str, task_type=task_type, payload=payload, name=name)
    except BaseException as e:
        error_msg = str(e) or f"Task execution failed ({type(e).__name__})"
        logger.error(f"Job {job_id_str} failed with error: {error_msg}", exc_info=True)
        try:
            await _update_job_status(job_id_str, "FAILED", error_message=error_msg)
        except Exception as update_err:
            logger.error(f"Failed to update job status for {job_id_str}: {update_err}")
        raise


