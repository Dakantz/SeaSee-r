from typing import Optional

def get_queue_name_for_task_type(task_type: Optional[str]) -> str:
    """
    Determines the appropriate Redis queue name for a given job task_type.
    Tasks requiring the dedicated OpenSfM worker container are routed to 'opensfm_tasks'.
    All other tasks default to 'pointcloud_tasks'.
    """
    if task_type and task_type.lower().startswith("opensfm_"):
        return "opensfm_tasks"
    return "pointcloud_tasks"
