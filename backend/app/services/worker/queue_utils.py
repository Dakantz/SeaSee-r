from typing import Optional

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
