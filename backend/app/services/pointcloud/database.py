import logging
import os
import re
import subprocess
import uuid
from typing import List, Optional
from urllib.parse import unquote
from fastapi import HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import async_session
from app.repositories.pointcloud_repository import PointCloudRepository
from app.services.pointcloud.exporters import BinaryStreamExporter, PLYStreamExporter

logger = logging.getLogger(__name__)

class DatabasePointCloudStorageService:
    def __init__(self, db_session: AsyncSession):
        self.db = db_session
        self.repository = PointCloudRepository(db_session)
        self.binary_exporter = BinaryStreamExporter(self.repository)
        self.ply_exporter = PLYStreamExporter(self.repository)

    async def stream_pointcloud_binary(
        self, lod: int, custom_query: str
    ) -> StreamingResponse:
        """
        Streams point cloud data directly from database as raw binary buffer (Float32 XYZ, Uint8 RGB).
        Requires lod and custom_query parameters.
        """
        if not custom_query or not custom_query.strip():
            raise HTTPException(status_code=400, detail="Query parameter is required.")

        filename = f"pointcloud_lod{lod}.bin"

        return StreamingResponse(
            self.binary_exporter.export_stream(custom_query=custom_query, lod=lod),
            media_type="application/octet-stream",
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )

    async def get_pointcloud_stream_summary(
        self, lod: int, custom_query: str
    ) -> dict:
        """
        Returns summary (point count, bounding box, and connected pointcloud metadata) for the custom query selection.
        """
        if not custom_query or not custom_query.strip():
            raise HTTPException(status_code=400, detail="Query parameter is required.")

        try:
            return await self.repository.get_summary_info(custom_query, lod=lod)
        except Exception as e:
            logger.error(f"Database query failed in get_pointcloud_stream_summary: {e}", exc_info=True)
            raise HTTPException(status_code=500, detail=f"Database query failed: {str(e)}")

    async def get_pointcloud(self, identifier: str, lod: int = 0) -> StreamingResponse:
        """
        Streams point cloud data directly from database as binary PLY file.
        """
        pointcloud_uuid = identifier
        if "?" in identifier:
            parts = identifier.split("?", 1)
            pointcloud_uuid = parts[0]
            if lod == 0:
                for param in parts[1].split("&"):
                    if param.startswith("lod="):
                        try:
                            lod = int(param.split("=")[1])
                        except ValueError:
                            lod = 0

        if pointcloud_uuid.endswith(".ply"):
            pointcloud_uuid = pointcloud_uuid[:-4]

        clean_uuid = re.sub(r'[^a-fA-F0-9\-]', '', pointcloud_uuid)
        if not clean_uuid:
            raise HTTPException(status_code=400, detail="Invalid Point Cloud UUID format.")

        try:
            valid_uuid = str(uuid.UUID(clean_uuid))
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid Point Cloud UUID format.")

        try:
            row = await self.repository.get_metadata_by_id(valid_uuid)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Database query failed: {str(e)}")

        if not row:
            raise HTTPException(status_code=404, detail="Point cloud metadata not found in database.")

        orig_filename = row[1] if row and len(row) > 1 and row[1] else valid_uuid
        base_name = os.path.splitext(orig_filename)[0]
        download_filename = f"{base_name}_lod{lod}.ply"

        return StreamingResponse(
            self.ply_exporter.export_stream(valid_uuid, lod=lod),
            media_type="application/octet-stream",
            headers={"Content-Disposition": f'attachment; filename="{download_filename}"'}
        )

    async def list_pointclouds(self) -> List:
        """Queries point clouds metadata table for available point clouds."""
        return await self.repository.list_all()

    async def delete_pointcloud(self, identifier: str) -> bool:
        """Deletes point cloud metadata and patches from database."""
        pointcloud_uuid = identifier
        if "?" in identifier:
            parts = identifier.split("?")
            pointcloud_uuid = parts[0]

        clean_uuid = re.sub(r'[^a-fA-F0-9\-]', '', pointcloud_uuid)
        if not clean_uuid:
            return False

        return await self.repository.delete(clean_uuid)
