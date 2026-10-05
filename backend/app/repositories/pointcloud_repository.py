import logging
import uuid
from typing import List, Optional, AsyncGenerator, Tuple, Any, Dict
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text, select, bindparam
from app.models.pointcloud import PointCloudMetadata
from app.models.camera import CameraHeader
from app.schemas.filter import FilterCriterion


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

    async def get_summary_point_count(
        self,
        filters: Optional[List[FilterCriterion]] = None,
        lod: int = 0
    ) -> int:
        """
        Executes summary query to efficiently count selected points using parameter filters.
        """
        info = await self.get_summary_info(filters=filters, lod=lod)
        return info["total_points"]

    async def get_summary_info(
        self,
        filters: Optional[List[FilterCriterion]] = None,
        lod: int = 0
    ) -> dict:
        """
        Executes summary queries using parameter filters to return:
        - total point count
        - bounding box (min_x, min_y, min_z, max_x, max_y, max_z)
        - list of connected PointCloudMetadata objects via FK pointcloud_id
        - list of connected CameraHeader objects
        """
        from app.services.pointcloud.query_builder import PointCloudQueryBuilder

        summary_sql, distinct_ids_sql, bind_params, expanding_params = PointCloudQueryBuilder.build_summary_query(
            filters=filters,
            lod=lod
        )

        sum_stmt = text(summary_sql)
        distinct_stmt = text(distinct_ids_sql)
        if expanding_params:
            sum_stmt = sum_stmt.bindparams(*(bindparam(p, expanding=True) for p in expanding_params))
            distinct_stmt = distinct_stmt.bindparams(*(bindparam(p, expanding=True) for p in expanding_params))

        total_points = 0
        min_x, min_y, min_z = None, None, None
        max_x, max_y, max_z = None, None, None

        logger.info(f"Executing parameterized summary query: {summary_sql} with params {bind_params}")
        res = await self.db.execute(sum_stmt, bind_params)
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
        res_fk = await self.db.execute(distinct_stmt, bind_params)
        connected_ids = [r[0] for r in res_fk.all() if r[0] is not None]
        if connected_ids:
            stmt = select(PointCloudMetadata).where(PointCloudMetadata.id.in_(connected_ids)).order_by(
                PointCloudMetadata.batch_id.asc().nulls_last(),
                PointCloudMetadata.reconstruction_index.asc().nulls_last(),
                PointCloudMetadata.orig_filename.asc()
            )
            res_meta = await self.db.execute(stmt)
            connected_metadata_list = list(res_meta.scalars().all())

            stmt_cam = select(CameraHeader).where(CameraHeader.pointcloud_id.in_(connected_ids))
            res_cam = await self.db.execute(stmt_cam)
            connected_camera_headers_list = list(res_cam.scalars().all())

        bounding_box = None
        center = None
        if min_x is not None and max_x is not None and min_y is not None and max_y is not None and min_z is not None and max_z is not None:
            bounding_box = {
                "min_x": min_x,
                "min_y": min_y,
                "min_z": min_z,
                "max_x": max_x,
                "max_y": max_y,
                "max_z": max_z
            }
            center = [
                (min_x + max_x) / 2.0,
                (min_y + max_y) / 2.0,
                (min_z + max_z) / 2.0,
            ]

        return {
            "total_points": total_points,
            "number_of_points": total_points,
            "bounding_box": bounding_box,
            "center": center,
            "centerpoint": center,
            "connected_pointclouds": connected_metadata_list,
            "connected_camera_headers": connected_camera_headers_list
        }

    async def stream_points(
        self,
        filters: Optional[List[FilterCriterion]] = None,
        lod: int = 0
    ) -> AsyncGenerator[Tuple[float, float, float, int, int, int], None]:
        """
        Streams points directly from pgPointcloud table using PC_Explode and PC_Get.
        Uses PointCloudQueryBuilder to construct parameterized SQL.
        Yields tuple: (x, y, z, r, g, b)
        """
        from app.services.pointcloud.query_builder import PointCloudQueryBuilder
        import app.services.pointcloud.database as db_mod

        sql, bind_params, expanding_params = PointCloudQueryBuilder.build_binary_stream_query(
            filters=filters,
            lod=lod
        )

        query = text(sql)
        if expanding_params:
            query = query.bindparams(*(bindparam(p, expanding=True) for p in expanding_params))

        async with db_mod.async_session() as session:
            stream_result = await session.stream(query, bind_params)
            async for record in stream_result:
                x = float(record[0]) if len(record) > 0 and record[0] is not None else 0.0
                y = float(record[1]) if len(record) > 1 and record[1] is not None else 0.0
                z = float(record[2]) if len(record) > 2 and record[2] is not None else 0.0
                r = int(record[3]) if len(record) > 3 and record[3] is not None else 0
                g = int(record[4]) if len(record) > 4 and record[4] is not None else 0
                b = int(record[5]) if len(record) > 5 and record[5] is not None else 0
                yield (x, y, z, r, g, b)
