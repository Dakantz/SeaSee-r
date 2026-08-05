import logging
import struct
from typing import AsyncGenerator
from app.repositories.pointcloud_repository import PointCloudRepository
from app.services.pointcloud.exporters.base import BasePointCloudExporter

logger = logging.getLogger(__name__)

class BinaryStreamExporter(BasePointCloudExporter):
    """
    Exports raw binary point cloud stream packed as Float32 XYZ and Uint8 RGB.
    """
    def __init__(self, repository: PointCloudRepository, chunk_size: int = 15000):
        super().__init__(repository)
        self.chunk_size = chunk_size

    async def export_stream(self, pointcloud_id: str, lod: int = 0) -> AsyncGenerator[bytes, None]:
        try:
            buffer = bytearray()
            async for x, y, z, r, g, b in self.repository.stream_points(pointcloud_id, lod=lod):
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
            logger.error(f"Error during binary streaming for {pointcloud_id}: {e}", exc_info=True)
            raise e
