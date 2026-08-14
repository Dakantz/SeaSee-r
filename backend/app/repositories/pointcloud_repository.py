import logging
import uuid
from typing import List, Optional, AsyncGenerator, Tuple, Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text, select
from app.models.pointcloud import PointCloudMetadata
from app.models.camera import CameraHeader

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
        Queries sum of points across all patches for given point cloud ID and LOD table.
        """
        table_name = f"pointcloud_patches_lod{lod}"
        try:
            count_result = await self.db.execute(
                text(f"SELECT COALESCE(SUM(PC_NumPoints(patch)), 0) FROM {table_name} WHERE pointcloud_id = :id"),
                {"id": pointcloud_id}
            )
            return int(count_result.scalar() or 0)
        except Exception as e:
            logger.error(f"Error querying total point count for {pointcloud_id} lod={lod}: {e}", exc_info=True)
            return 0

    async def get_summary_point_count(self, custom_query: str, lod: int = 0) -> int:
        """
        Executes modified summary query (using SUM(PC_NumPoints(patch))) to efficiently count selected points.
        """
        info = await self.get_summary_info(custom_query, lod=lod)
        return info["total_points"]

    async def get_summary_info(self, custom_query: str, lod: int = 0) -> dict:
        """
        Executes modified summary queries to return:
        - total point count
        - bounding box (min_x, min_y, min_z, max_x, max_y, max_z)
        - list of connected PointCloudMetadata objects via FK pointcloud_id
        """
        import re
        inner_query = custom_query.strip()
        target_table = f"pointcloud_patches_lod{lod}"
        inner_query = re.sub(r'\bpointcloud_patches(?:_lod\d+)?\b', target_table, inner_query, flags=re.IGNORECASE)

        # Transform stream selection queries (PC_Explode) to patch queries (SELECT *) for stream-summary
        inner_query = re.sub(r'SELECT\s+PC_Explode\(patch\)\s+AS\s+pt\s+FROM', 'SELECT * FROM', inner_query, flags=re.IGNORECASE)

        full_summary_str = f"""
            SELECT 
                COALESCE(SUM(PC_NumPoints(patch)), 0) AS total_points,
                MIN(PC_PatchMin(patch, 'X')) AS min_x,
                MIN(PC_PatchMin(patch, 'Y')) AS min_y,
                MIN(PC_PatchMin(patch, 'Z')) AS min_z,
                MAX(PC_PatchMax(patch, 'X')) AS max_x,
                MAX(PC_PatchMax(patch, 'Y')) AS max_y,
                MAX(PC_PatchMax(patch, 'Z')) AS max_z
            FROM (
                {inner_query}
            ) AS points;
        """

        distinct_fk_str = f"""
            SELECT DISTINCT pointcloud_id
            FROM (
                {inner_query}
            ) AS points;
        """

        total_points = 0
        min_x, min_y, min_z = None, None, None
        max_x, max_y, max_z = None, None, None

        logger.info(f"Executing modified summary query: {full_summary_str}")
        res = await self.db.execute(text(full_summary_str), {"lod": lod})
        row = res.first()
        if row:
            total_points = int(row[0] or 0)
            min_x = float(row[1]) if row[1] is not None else None
            min_y = float(row[2]) if row[2] is not None else None
            min_z = float(row[3]) if row[3] is not None else None
            max_x = float(row[4]) if row[4] is not None else None
            max_y = float(row[5]) if row[5] is not None else None
            max_z = float(row[6]) if row[6] is not None else None

        connected_metadata_list = []
        connected_camera_headers_list = []
        res_fk = await self.db.execute(text(distinct_fk_str), {"lod": lod})
        connected_ids = [r[0] for r in res_fk.all() if r[0] is not None]
        if connected_ids:
            stmt = select(PointCloudMetadata).where(PointCloudMetadata.id.in_(connected_ids))
            res_meta = await self.db.execute(stmt)
            connected_metadata_list = list(res_meta.scalars().all())

            stmt_cam = select(CameraHeader).where(CameraHeader.pointcloud_id.in_(connected_ids))
            res_cam = await self.db.execute(stmt_cam)
            connected_camera_headers_list = list(res_cam.scalars().all())

        bounding_box = None
        if min_x is not None and max_x is not None and min_y is not None and max_y is not None and min_z is not None and max_z is not None:
            bounding_box = {
                "min_x": min_x,
                "min_y": min_y,
                "min_z": min_z,
                "max_x": max_x,
                "max_y": max_y,
                "max_z": max_z
            }

        return {
            "total_points": total_points,
            "number_of_points": total_points,
            "bounding_box": bounding_box,
            "connected_pointclouds": connected_metadata_list,
            "connected_camera_headers": connected_camera_headers_list
        }

    async def stream_points(
        self, custom_query: str, lod: int = 0
    ) -> AsyncGenerator[Tuple[float, float, float, int, int, int], None]:
        """
        Streams points directly from pgPointcloud table using PC_Explode and PC_Get.
        Executes custom_query as the inner point selection subquery.
        Yields tuple: (x, y, z, r, g, b)
        """
        import re
        import app.services.pointcloud.database as db_mod

        inner_query = custom_query.strip()
        target_table = f"pointcloud_patches_lod{lod}"
        inner_query = re.sub(r'\bpointcloud_patches(?:_lod\d+)?\b', target_table, inner_query, flags=re.IGNORECASE)

        full_query_str = f"""
            SELECT 
                PC_Get(pt, 'X')         as x,
                PC_Get(pt, 'Y')         as y,
                PC_Get(pt, 'Z')         as z,
                PC_Get(pt, 'Red')       as r,
                PC_Get(pt, 'Green')     as g,
                PC_Get(pt, 'Blue')      as b
            FROM (
                {inner_query}
            ) AS points;
        """

        query = text(full_query_str)

        async with db_mod.async_session() as session:
            stream_result = await session.stream(query, {"lod": lod})
            async for record in stream_result:
                x = float(record[0]) if len(record) > 0 and record[0] is not None else 0.0
                y = float(record[1]) if len(record) > 1 and record[1] is not None else 0.0
                z = float(record[2]) if len(record) > 2 and record[2] is not None else 0.0
                r = int(record[3]) if len(record) > 3 and record[3] is not None else 0
                g = int(record[4]) if len(record) > 4 and record[4] is not None else 0
                b = int(record[5]) if len(record) > 5 and record[5] is not None else 0
                yield (x, y, z, r, g, b)
