from app.services.worker.handlers.base import BaseTaskHandler
from app.services.worker.handlers.pointcloud import PointCloudUploadTaskHandler
from app.services.worker.handlers.video import VideoTaskHandler
from app.services.worker.handlers.opensfm_ingest import OpenSfMIngestTaskHandler
from app.services.worker.handlers.opensfm_reconstruct import OpenSfMReconstructTaskHandler
from app.services.worker.handlers.emodnet import EMODnetGeoTIFFTaskHandler, EMODnetCSVTaskHandler
from app.services.worker.handlers.frame_extraction import FrameExtractionTaskHandler
from app.services.worker.handlers.default import DefaultTaskHandler

def register_all_handlers(registry):
    registry.register(PointCloudUploadTaskHandler())
    registry.register(VideoTaskHandler())
    registry.register(OpenSfMIngestTaskHandler())
    registry.register(OpenSfMReconstructTaskHandler())
    registry.register(EMODnetGeoTIFFTaskHandler())
    registry.register(EMODnetCSVTaskHandler())
    registry.register(FrameExtractionTaskHandler())
    registry.register_default(DefaultTaskHandler())

__all__ = [
    "BaseTaskHandler",
    "PointCloudUploadTaskHandler",
    "VideoTaskHandler",
    "OpenSfMIngestTaskHandler",
    "OpenSfMReconstructTaskHandler",
    "EMODnetGeoTIFFTaskHandler",
    "EMODnetCSVTaskHandler",
    "FrameExtractionTaskHandler",
    "DefaultTaskHandler",
    "register_all_handlers"
]
