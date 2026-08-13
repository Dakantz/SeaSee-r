import logging
import struct
from typing import AsyncGenerator
from app.repositories.pointcloud_repository import PointCloudRepository
from app.services.pointcloud.exporters.base import BasePointCloudExporter

logger = logging.getLogger(__name__)

class PLYStreamExporter(BasePointCloudExporter):
    """
    Exports binary_little_endian 1.0 PLY format point cloud byte stream.
    """
    def __init__(self, repository: PointCloudRepository, chunk_size: int = 65536):
        super().__init__(repository)
        self.chunk_size = chunk_size

    async def export_stream(self, pointcloud_id: str, lod: int = 0) -> AsyncGenerator[bytes, None]:
        try:
            total_points = await self.repository.get_total_point_count(pointcloud_id, lod=lod)

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

            custom_sql = f"SELECT PC_Explode(patch) AS pt FROM pointcloud_patches_lod{lod} WHERE pointcloud_id = '{pointcloud_id}'"
            async for x, y, z, r, g, b in self.repository.stream_points(custom_query=custom_sql, lod=lod):
                r_u8 = min(255, max(0, r >> 8 if r > 255 else r))
                g_u8 = min(255, max(0, g >> 8 if g > 255 else g))
                b_u8 = min(255, max(0, b >> 8 if b > 255 else b))

                buffer.extend(struct.pack('<3f3B', x, y, z, r_u8, g_u8, b_u8))
                if len(buffer) >= self.chunk_size:
                    yield bytes(buffer)
                    buffer.clear()

            if buffer:
                yield bytes(buffer)
        except Exception as e:
            logger.error(f"Error during PLY stream export for {pointcloud_id}: {e}", exc_info=True)
            raise e
