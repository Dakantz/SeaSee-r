from abc import ABC, abstractmethod
from typing import List
from fastapi.responses import FileResponse

class PointCloudStorageService(ABC):
    """Fetch and return the point cloud file as a response."""
    @abstractmethod
    async def get_pointcloud(self, identifier: str) -> FileResponse:
        pass

    """Return a list of available point clouds."""
    @abstractmethod
    async def list_pointclouds(self) -> list:
        pass
