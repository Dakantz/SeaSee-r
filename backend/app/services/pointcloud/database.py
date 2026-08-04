import json
import logging
import os
import re
import struct
import subprocess
import uuid
from typing import List
from fastapi import HTTPException, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.database import get_db_session, async_session
from urllib.parse import urlparse
from app.core.config import settings
from app.models import PointCloud
from app.models.video import Video, VideoMetadata
from app.services.pointcloud.base import PointCloudStorageService

class DatabasePointCloudStorageService(PointCloudStorageService):
    def __init__(self, db_session: AsyncSession):
        self.db = db_session

    async def stream_pointcloud_binary(self, identifier: str, lod: int = 0) -> StreamingResponse:
        """
        Queries point cloud points directly from pgPointcloud table using PC_Explode and PC_Get,
        packs XYZ (Float32) and RGB (Uint8) into a flat binary string, and streams as application/octet-stream.
        """
        pointcloud_uuid = identifier
        if "?" in identifier:
            parts = identifier.split("?")
            pointcloud_uuid = parts[0]
            for param in parts[1].split("&"):
                if param.startswith("lod="):
                    try:
                        lod = int(param.split("=")[1])
                    except ValueError:
                        pass

        clean_uuid = re.sub(r'[^a-fA-F0-9\-]', '', pointcloud_uuid)
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

        query = text("""
            SELECT 
                PC_Get(pt, 'X')         as x,
                PC_Get(pt, 'Y')         as y,
                PC_Get(pt, 'Z')         as z,
                PC_Get(pt, 'Red')       as r,
                PC_Get(pt, 'Green')     as g,
                PC_Get(pt, 'Blue')      as b
            FROM (
                SELECT PC_Explode(patch) AS pt 
                FROM pointcloud_patches 
                WHERE pointcloud_id = :id AND lod = :lod
            ) AS points;
        """)

        async def generate_binary():
            try:
                async with async_session() as session:
                    stream_result = await session.stream(query, {"id": clean_uuid, "lod": lod})
                    buffer = bytearray()
                    async for record in stream_result:
                        x = float(record[0]) if record[0] is not None else 0.0
                        y = float(record[1]) if record[1] is not None else 0.0
                        z = float(record[2]) if record[2] is not None else 0.0
                        r = int(record[3]) if record[3] is not None else 0
                        g = int(record[4]) if record[4] is not None else 0
                        b = int(record[5]) if record[5] is not None else 0

                        # Convert/scale 16-bit (0-65535) if needed and clamp to 0-255 (Uint8)
                        r_u8 = min(255, max(0, r >> 8 if r > 255 else r))
                        g_u8 = min(255, max(0, g >> 8 if g > 255 else g))
                        b_u8 = min(255, max(0, b >> 8 if b > 255 else b))

                        buffer.extend(struct.pack('<3f3B', x, y, z, r_u8, g_u8, b_u8))
                        if len(buffer) >= 15000:
                            yield bytes(buffer)
                            buffer.clear()

                    if buffer:
                        yield bytes(buffer)
            except Exception as e:
                logging.error(f"Error during binary streaming: {e}", exc_info=True)

        return StreamingResponse(
            generate_binary(),
            media_type="application/octet-stream",
            headers={"Content-Disposition": f"attachment; filename={pointcloud_uuid}_lod{lod}.bin"}
        )

    async def get_pointcloud(self, identifier: str, lod: int = 0) -> StreamingResponse:
        """
        Fetches the pointcloud from pgPointcloud table for a given 
        identifier (UUID) and LOD, and streams the result as a PLY file (binary_little_endian 1.0).
        """
        # Parse identifier and optional lod parameters (e.g. "uuid?lod=1" or "uuid.ply?lod=1")
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

        # Remove trailing .ply extension if present
        if pointcloud_uuid.endswith(".ply"):
            pointcloud_uuid = pointcloud_uuid[:-4]

        # Sanitize UUID string
        clean_uuid = re.sub(r'[^a-fA-F0-9\-]', '', pointcloud_uuid)
        if not clean_uuid:
            raise HTTPException(status_code=400, detail="Invalid Point Cloud UUID format.")

        # Verify that clean_uuid is a valid UUID format
        try:
            valid_uuid = str(uuid.UUID(clean_uuid))
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid Point Cloud UUID format.")

        # Verify that the point cloud metadata exists in pointclouds table
        try:
            result = await self.db.execute(
                text("SELECT id, orig_filename FROM pointclouds WHERE id = :id"),
                {"id": valid_uuid}
            )
            row = result.first()
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Database query failed: {str(e)}")

        if not row:
            raise HTTPException(status_code=404, detail="Point cloud metadata not found in database.")

        orig_filename = row[1] if row and len(row) > 1 and row[1] else valid_uuid
        base_name = os.path.splitext(orig_filename)[0]
        download_filename = f"{base_name}_lod{lod}.ply"

        # Query total count of points for PLY header vertex count
        try:
            count_result = await self.db.execute(
                text("SELECT COALESCE(SUM(PC_NumPoints(patch)), 0) FROM pointcloud_patches WHERE pointcloud_id = :id AND lod = :lod"),
                {"id": valid_uuid, "lod": lod}
            )
            total_points = int(count_result.scalar() or 0)
        except Exception as e:
            logging.error(f"Error querying point cloud count for PLY export: {e}", exc_info=True)
            total_points = 0

        query = text("""
            SELECT 
                PC_Get(pt, 'X')         as x,
                PC_Get(pt, 'Y')         as y,
                PC_Get(pt, 'Z')         as z,
                PC_Get(pt, 'Red')       as r,
                PC_Get(pt, 'Green')     as g,
                PC_Get(pt, 'Blue')      as b
            FROM (
                SELECT PC_Explode(patch) AS pt 
                FROM pointcloud_patches 
                WHERE pointcloud_id = :id AND lod = :lod
            ) AS points;
        """)

        async def generate_ply_binary():
            try:
                # PLY Header (binary_little_endian 1.0)
                header = (
                    f"ply\n"
                    f"format binary_little_endian 1.0\n"
                    f"element vertex {total_points}\n"
                    f"property float x\n"
                    f"property float y\n"
                    f"property float z\n"
                    f"property uchar red\n"
                    f"property uchar green\n"
                    f"property uchar blue\n"
                    f"end_header\n"
                ).encode('utf-8')

                buffer = bytearray(header)

                async with async_session() as session:
                    stream_result = await session.stream(query, {"id": valid_uuid, "lod": lod})
                    async for record in stream_result:
                        x = float(record[0]) if record[0] is not None else 0.0
                        y = float(record[1]) if record[1] is not None else 0.0
                        z = float(record[2]) if record[2] is not None else 0.0
                        r = int(record[3]) if record[3] is not None else 0
                        g = int(record[4]) if record[4] is not None else 0
                        b = int(record[5]) if record[5] is not None else 0

                        # Convert/scale 16-bit (0-65535) if needed and clamp to 0-255 (Uint8)
                        r_u8 = min(255, max(0, r >> 8 if r > 255 else r))
                        g_u8 = min(255, max(0, g >> 8 if g > 255 else g))
                        b_u8 = min(255, max(0, b >> 8 if b > 255 else b))

                        buffer.extend(struct.pack('<3f3B', x, y, z, r_u8, g_u8, b_u8))
                        if len(buffer) >= 65536:
                            yield bytes(buffer)
                            buffer.clear()

                    if buffer:
                        yield bytes(buffer)
            except Exception as e:
                logging.error(f"Error during PLY binary streaming: {e}", exc_info=True)

        return StreamingResponse(
            generate_ply_binary(),
            media_type="application/octet-stream",
            headers={"Content-Disposition": f'attachment; filename="{download_filename}"'}
        )

    async def list_pointclouds(self) -> list:
        """Queries the pointclouds metadata table for available point cloud IDs."""
        try:
            from app.models import PointCloud
            from sqlalchemy import select
            stmt = select(PointCloud)
            result = await self.db.execute(stmt)
            return list(result.scalars().all())
        except Exception as e:
            print(f"Error fetching pointclouds: {e}")
            # Fallback to empty list if DB is not setup or offline
            return []

    async def delete_pointcloud(self, identifier: str) -> bool:
        """Deletes point cloud metadata and all related patches from pointcloud_patches."""
        pointcloud_uuid = identifier
        if "?" in identifier:
            parts = identifier.split("?")
            pointcloud_uuid = parts[0]

        clean_uuid = re.sub(r'[^a-fA-F0-9\-]', '', pointcloud_uuid)
        if not clean_uuid:
            return False

        try:
            result = await self.db.execute(
                text("DELETE FROM pointclouds WHERE id = :id RETURNING id"),
                {"id": clean_uuid}
            )
            deleted = result.first()
            if not deleted:
                return False

            await self.db.commit()
            return True
        except Exception as e:
            print(f"Error deleting pointcloud from db: {e}")
            await self.db.rollback()
            return False


