import json
import re
import subprocess
from typing import List
from fastapi import HTTPException, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.database import get_db_session
from urllib.parse import urlparse
from app.core.config import settings
from app.models import PointCloudMetadata
from app.models.video import Video, VideoMetadata
from app.services.pointcloud.base import PointCloudStorageService

class DatabasePointCloudStorageService(PointCloudStorageService):
    def __init__(self, db_session: AsyncSession):
        self.db = db_session

    async def get_pointcloud(self, identifier: str) -> StreamingResponse:
        """
        Fetches the pointcloud from a dynamic pgPointcloud table for a given 
        identifier (UUID) and LOD, streams the result as a PLY file using a PDAL reader.
        """
        # Parse identifier and optional lod parameters (e.g. "uuid?lod=1")
        lod = 0
        pointcloud_uuid = identifier
        if "?" in identifier:
            parts = identifier.split("?")
            pointcloud_uuid = parts[0]
            for param in parts[1].split("&"):
                if param.startswith("lod="):
                    try:
                        lod = int(param.split("=")[1])
                    except ValueError:
                        lod = 0

        # Sanitize UUID to prevent SQL Injection in table names
        clean_uuid = re.sub(r'[^a-fA-F0-9\-]', '', pointcloud_uuid)
        # Remove hyphens for table name representation
        table_uuid = clean_uuid.replace("-", "")
        if not table_uuid:
            raise HTTPException(status_code=400, detail="Invalid Point Cloud UUID format.")

        dynamic_table_name = f"pc_{table_uuid}_lod{lod}"

        # Verify that the point cloud metadata exists in pointclouds table
        try:
            result = await self.db.execute(
                text("SELECT id FROM pointclouds WHERE id = :id"),
                {"id": clean_uuid}
            )
            row = result.first()
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Database query failed: {str(e)}")

        if not row:
            raise HTTPException(status_code=404, detail="Point cloud metadata not found in database.")

        # Dynamically build libpq connection string from settings
        db_url = settings.database_url.replace("postgresql+asyncpg://", "postgresql://")
        parsed = urlparse(db_url)
        conn_parts = []
        if parsed.hostname:
            conn_parts.append(f"host={parsed.hostname}")
        if parsed.port:
            conn_parts.append(f"port={parsed.port}")
        if parsed.username:
            conn_parts.append(f"user={parsed.username}")
        if parsed.password:
            conn_parts.append(f"password={parsed.password}")
        if parsed.path:
            conn_parts.append(f"dbname={parsed.path.lstrip('/')}")
        connection_str = " ".join(conn_parts)

        # Build a PDAL read pipeline configuration
        pdal_pipeline = {
            "pipeline": [
                {
                    "type": "readers.pgpointcloud",
                    "connection": connection_str,
                    "table": dynamic_table_name,
                    "column": "patch",
                    "spatialreference": "EPSG:4326"
                },
                {
                    "type": "writers.ply",
                    "filename": "stdout"
                }
            ]
        }

        # Run PDAL process and stream output stdout directly
        def generate_ply():
            try:
                proc = subprocess.Popen(
                    ["pdal", "pipeline", "--stdin"],
                    stdin=subprocess.PIPE,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=False
                )
                stdout, stderr = proc.communicate(input=json.dumps(pdal_pipeline).encode('utf-8'))
                if proc.returncode != 0:
                    raise RuntimeError(f"PDAL export failed: {stderr.decode('utf-8')}")
                yield stdout
            except FileNotFoundError:
                raise HTTPException(status_code=500, detail="PDAL CLI is not installed on the system.")
            except Exception as e:
                raise HTTPException(status_code=500, detail=f"Failed to export point cloud: {str(e)}")

        return StreamingResponse(
            generate_ply(),
            media_type="application/octet-stream",
            headers={"Content-Disposition": f"attachment; filename={pointcloud_uuid}_lod{lod}.ply"}
        )

    async def list_pointclouds(self) -> list:
        """Queries the pointclouds metadata table for available point cloud IDs."""
        try:
            from app.models import PointCloudMetadata
            from sqlalchemy import select
            stmt = select(PointCloudMetadata)
            result = await self.db.execute(stmt)
            return list(result.scalars().all())
        except Exception as e:
            print(f"Error fetching pointclouds: {e}")
            # Fallback to empty list if DB is not setup or offline
            return []
