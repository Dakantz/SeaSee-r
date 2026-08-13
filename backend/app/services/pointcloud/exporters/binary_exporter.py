import logging
import numpy as np
from typing import AsyncGenerator, Optional
from app.repositories.pointcloud_repository import PointCloudRepository
from app.services.pointcloud.exporters.base import BasePointCloudExporter

logger = logging.getLogger(__name__)

# 16-byte aligned structured dtype: 3x Float32 (12B) + 4x Uint8 (4B) = 16 bytes stride
VERTEX_DTYPE = np.dtype([
    ('x', '<f4'),
    ('y', '<f4'),
    ('z', '<f4'),
    ('r', 'u1'),
    ('g', 'u1'),
    ('b', 'u1'),
    ('a', 'u1')
])

class BinaryStreamExporter(BasePointCloudExporter):
    """
    Exports raw binary point cloud stream packed as Float32 XYZ and Uint8 RGBA (16-byte aligned).
    """
    def __init__(self, repository: PointCloudRepository, chunk_size: int = 524288):
        super().__init__(repository)
        self.chunk_size = chunk_size

    async def export_stream(self, custom_query: str, lod: int = 0) -> AsyncGenerator[bytes, None]:
        try:
            batch_capacity = self.chunk_size // 16
            points_batch = []

            async for x, y, z, r, g, b in self.repository.stream_points(custom_query=custom_query, lod=lod):
                r_u8 = min(255, max(0, r >> 8 if r > 255 else r))
                g_u8 = min(255, max(0, g >> 8 if g > 255 else g))
                b_u8 = min(255, max(0, b >> 8 if b > 255 else b))

                points_batch.append((x, y, z, r_u8, g_u8, b_u8, 255))
                if len(points_batch) >= batch_capacity:
                    arr = np.array(points_batch, dtype=VERTEX_DTYPE)
                    yield arr.tobytes()
                    points_batch.clear()

            if points_batch:
                arr = np.array(points_batch, dtype=VERTEX_DTYPE)
                yield arr.tobytes()
                points_batch.clear()
        except Exception as e:
            logger.error(f"Error during binary streaming lod={lod}: {e}", exc_info=True)
            raise e

