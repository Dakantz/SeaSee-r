import sys
from redis import Redis
from rq import Worker
from app.core.config import settings

def test_worker_is_running(test_environment):
    redis_conn = Redis.from_url(settings.redis_url)
    workers = Worker.all(connection=redis_conn)
    assert len(workers) > 0, f"Expected at least 1 worker, got {len(workers)}"
