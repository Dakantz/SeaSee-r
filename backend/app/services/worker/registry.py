import logging
from typing import Dict, List, Optional, Any
from app.services.worker.handlers.base import BaseTaskHandler

logger = logging.getLogger(__name__)

class TaskRegistry:
    """
    Registry for matching job task_types to their corresponding task handlers.
    """
    def __init__(self):
        self._handlers: Dict[str, BaseTaskHandler] = {}
        self._default_handler: Optional[BaseTaskHandler] = None

    def register(self, handler: BaseTaskHandler) -> None:
        """
        Registers a TaskHandler instance for its declared task_types.
        """
        for task_type in handler.task_types:
            self._handlers[task_type] = handler
            logger.info(f"Registered TaskHandler '{handler.__class__.__name__}' for task_type '{task_type}'")

    def register_default(self, handler: BaseTaskHandler) -> None:
        """
        Registers the default fallback handler for unclassified task types.
        """
        self._default_handler = handler
        logger.info(f"Registered default TaskHandler '{handler.__class__.__name__}'")

    def get_handler(self, task_type: str) -> Optional[BaseTaskHandler]:
        """
        Retrieves registered handler for task_type or default handler fallback.
        """
        return self._handlers.get(task_type, self._default_handler)

    async def dispatch(self, job_id_str: str, task_type: str = "", payload: Dict[str, Any] = None, name: str = "") -> Dict[str, Any]:
        """
        Dispatches job execution to registered TaskHandler based on task_type.
        """
        payload = payload or {}
        handler = self.get_handler(task_type)

        if not handler:
            error_msg = f"No task handler registered for task_type '{task_type}' (Job: {job_id_str})"
            logger.error(error_msg)
            return {"status": "error", "message": error_msg}

        logger.info(f"Dispatching job {job_id_str} (type: '{task_type}') to handler '{handler.__class__.__name__}'")
        return await handler.execute(job_id_str, payload, name=name, task_type=task_type)


def _init_default_registry() -> TaskRegistry:
    registry = TaskRegistry()
    from app.services.worker.handlers import register_all_handlers
    register_all_handlers(registry)
    return registry


# Global singleton instance
task_registry = _init_default_registry()
