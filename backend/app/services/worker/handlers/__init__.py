from app.services.worker.handlers.base import BaseTaskHandler
from app.services.worker.handlers.pointcloud import PointCloudUploadTaskHandler
from app.services.worker.handlers.video import VideoTaskHandler
from app.services.worker.handlers.opensfm_ingest import OpenSfMIngestTaskHandler
from app.services.worker.handlers.opensfm_sparse import OpenSfMSparseTaskHandler
from app.services.worker.handlers.opensfm_dense import OpenSfMDenseTaskHandler
from app.services.worker.handlers.emodnet import EMODnetGeoTIFFTaskHandler, EMODnetCSVTaskHandler
from app.services.worker.handlers.frame_extraction import FrameExtractionTaskHandler
from app.services.worker.handlers.default import DefaultTaskHandler

def register_all_handlers(registry):
    registry.register(PointCloudUploadTaskHandler())
    registry.register(VideoTaskHandler())
    registry.register(OpenSfMIngestTaskHandler())
    registry.register(OpenSfMSparseTaskHandler())
    registry.register(OpenSfMDenseTaskHandler())
    registry.register(EMODnetGeoTIFFTaskHandler())
    registry.register(EMODnetCSVTaskHandler())
    registry.register(FrameExtractionTaskHandler())
    registry.register_default(DefaultTaskHandler())

__all__ = [
    "BaseTaskHandler",
    "PointCloudUploadTaskHandler",
    "VideoTaskHandler",
    "OpenSfMIngestTaskHandler",
    "OpenSfMSparseTaskHandler",
    "OpenSfMDenseTaskHandler",
    "EMODnetGeoTIFFTaskHandler",
    "EMODnetCSVTaskHandler",
    "FrameExtractionTaskHandler",
    "DefaultTaskHandler",
    "register_all_handlers"
]
