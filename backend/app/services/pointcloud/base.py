from abc import ABC, abstractmethod
from typing import List, Union
from fastapi.responses import FileResponse, StreamingResponse

class PointCloudStorageService(ABC):
    """Fetch and return the point cloud file as a response."""
    @abstractmethod
    async def get_pointcloud(self, identifier: str) -> FileResponse:
        pass

    """Return a list of available point clouds."""
    @abstractmethod
    async def list_pointclouds(self) -> list:
        pass

    """Delete a point cloud and its associated data."""
    @abstractmethod
    async def delete_pointcloud(self, identifier: str) -> bool:
        pass

    """Stream point cloud data directly as raw binary buffer (Float32 XYZ, Uint16 RGB)."""
    @abstractmethod
    async def stream_pointcloud_binary(self, identifier: str, lod: int = 0) -> StreamingResponse:
        pass

