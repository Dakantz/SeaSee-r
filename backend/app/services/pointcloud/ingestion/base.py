from abc import ABC, abstractmethod
from typing import Any, Dict

class BaseIngestionStage(ABC):
    """
    Abstract interface for a single point cloud ingestion pipeline stage.
    """
    name: str

    @abstractmethod
    async def process(self, context: Dict[str, Any]) -> Dict[str, Any]:
        """
        Processes the ingestion context and returns updated context data.
        """
        pass
