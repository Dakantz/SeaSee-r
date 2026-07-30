import os
from typing import List
from fastapi.responses import FileResponse, StreamingResponse
from fastapi import HTTPException
from app.services.pointcloud.base import PointCloudStorageService

class LocalPointCloudStorageService(PointCloudStorageService):
    def __init__(self, base_dir: str):
        self.base_dir = base_dir
        if not os.path.exists(self.base_dir):
            os.makedirs(self.base_dir)

    async def get_pointcloud(self, identifier: str) -> FileResponse:
        # Prevent simple path traversal attacks
        safe_filename = os.path.basename(identifier)
        if not safe_filename.endswith(".ply"):
            safe_filename += ".ply"

        file_path = os.path.join(self.base_dir, safe_filename)

        if not os.path.isfile(file_path):
            raise HTTPException(status_code=404, detail="Point cloud file not found.")

        return FileResponse(
            path=file_path,
            media_type="application/octet-stream",
            filename=safe_filename
        )

    """List all .ply files in the local directory."""
    async def list_pointclouds(self) -> List[str]:
        files = []
        for filename in os.listdir(self.base_dir):
            if filename.endswith(".ply"):
                files.append(filename)
        return files

    async def delete_pointcloud(self, identifier: str) -> bool:
        safe_filename = os.path.basename(identifier)
        if not safe_filename.endswith(".ply"):
            safe_filename += ".ply"

        file_path = os.path.join(self.base_dir, safe_filename)

        if os.path.isfile(file_path):
            os.remove(file_path)
            return True
        return False

    async def stream_pointcloud_binary(self, identifier: str, lod: int = 0) -> StreamingResponse:
        raise HTTPException(
            status_code=501,
            detail="Binary streaming is only supported for database storage."
        )

