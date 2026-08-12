import logging
import uuid
from typing import List, Optional, AsyncGenerator, Tuple, Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text, select
from app.models.pointcloud import PointCloudMetadata

logger = logging.getLogger(__name__)

class PointCloudRepository:
    def __init__(self, db_session: AsyncSession):
        self.db = db_session

    async def get_metadata_by_id(self, pointcloud_id: str) -> Optional[Any]:
        """
        Retrieves PointCloud metadata record by UUID string.
        """
        try:
            result = await self.db.execute(
                text("SELECT id, orig_filename FROM pointcloud_metadata WHERE id = :id"),
                {"id": pointcloud_id}
            )
            row = result.first()
            if not row:
                return None
            return row
        except Exception as e:
            logger.error(f"Error querying pointcloud metadata for {pointcloud_id}: {e}", exc_info=True)
            raise e

    async def list_all(self) -> List[PointCloudMetadata]:
        """
        Retrieves all point cloud metadata records.
        """
        try:
            stmt = select(PointCloudMetadata)
            result = await self.db.execute(stmt)
            return list(result.scalars().all())
        except Exception as e:
            logger.error(f"Error fetching pointclouds list: {e}", exc_info=True)
            return []

    async def delete(self, pointcloud_id: str) -> bool:
        """
        Deletes point cloud metadata and all related patches from database.
        """
        try:
            result = await self.db.execute(
                text("DELETE FROM pointcloud_metadata WHERE id = :id RETURNING id"),
                {"id": pointcloud_id}
            )
            deleted = result.first()
            if not deleted:
                return False
            await self.db.commit()
            return True
        except Exception as e:
            logger.error(f"Error deleting pointcloud {pointcloud_id} from db: {e}", exc_info=True)
            await self.db.rollback()
            return False

    async def get_total_point_count(self, pointcloud_id: str, lod: int = 0) -> int:
        """
        Queries sum of points across all patches for given point cloud ID and LOD.
        """
        try:
            count_result = await self.db.execute(
                text("SELECT COALESCE(SUM(PC_NumPoints(patch)), 0) FROM pointcloud_patches WHERE pointcloud_id = :id AND lod = :lod"),
                {"id": pointcloud_id, "lod": lod}
            )
            return int(count_result.scalar() or 0)
        except Exception as e:
            logger.error(f"Error querying total point count for {pointcloud_id} lod={lod}: {e}", exc_info=True)
            return 0

    async def stream_points(self, pointcloud_id: str, lod: int = 0) -> AsyncGenerator[Tuple[float, float, float, int, int, int], None]:
        """
        Streams points directly from pgPointcloud table using PC_Explode and PC_Get.
        Yields tuple: (x, y, z, r, g, b)
        """
        import app.services.pointcloud.database as db_mod

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

        async with db_mod.async_session() as session:
            stream_result = await session.stream(query, {"id": pointcloud_id, "lod": lod})
            async for record in stream_result:
                x = float(record[0]) if record[0] is not None else 0.0
                y = float(record[1]) if record[1] is not None else 0.0
                z = float(record[2]) if record[2] is not None else 0.0
                r = int(record[3]) if record[3] is not None else 0
                g = int(record[4]) if record[4] is not None else 0
                b = int(record[5]) if record[5] is not None else 0
                yield (x, y, z, r, g, b)
