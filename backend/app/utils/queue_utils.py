from typing import Optional, Any
from redis import Redis
from rq import Queue

from app.core.config import settings


def get_queue_name_for_task_type(task_type: Optional[str]) -> str:
    """
    Determines the appropriate Redis queue name for a given job task_type.
    Tasks requiring the dedicated OpenSfM worker container (heavy C++/GPU reconstruction)
    are routed to 'opensfm_tasks'. All other tasks (including point cloud ingestion, EPT building,
    and metadata parsing) default to 'pointcloud_tasks' to be processed by the standard task worker.
    """
    if task_type and task_type.lower() == "opensfm_reconstruct":
        return "opensfm_tasks"
    return "pointcloud_tasks"


def enqueue_job(job_id: Any, task_type: Optional[str] = None) -> Queue:
    """
    Enqueues a job into Redis RQ with standard timeout and on_failure callback.
    """
    queue_name = get_queue_name_for_task_type(task_type)
    redis_conn = Redis.from_url(settings.redis_url)
    q = Queue(queue_name, connection=redis_conn)
    q.enqueue(
        "app.services.worker.tasks.run_background_job",
        str(job_id),
        job_id=str(job_id),
        job_timeout=settings.job_timeout,
        on_failure="app.services.worker.tasks.handle_rq_job_failure"
    )
    return q
