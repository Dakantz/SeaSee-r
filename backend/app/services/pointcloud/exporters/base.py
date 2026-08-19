from abc import ABC, abstractmethod
from typing import AsyncGenerator
from app.repositories.pointcloud_repository import PointCloudRepository

class BasePointCloudExporter(ABC):
    def __init__(self, repository: PointCloudRepository):
        self.repository = repository

    @abstractmethod
    async def export_stream(self, *args, **kwargs) -> AsyncGenerator[bytes, None]:
        """
        Abstract method to generate binary data stream chunks for a pointcloud.
        """
        pass
