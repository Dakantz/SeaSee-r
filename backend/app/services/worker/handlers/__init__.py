from app.services.worker.handlers.base import BaseTaskHandler
from app.services.worker.handlers.pointcloud import PointCloudUploadTaskHandler
from app.services.worker.handlers.video import VideoTaskHandler
from app.services.worker.handlers.opensfm import OpenSfMTaskHandler
from app.services.worker.handlers.emodnet import EMODnetGeoTIFFTaskHandler, EMODnetCSVTaskHandler
from app.services.worker.handlers.default import DefaultTaskHandler

def register_all_handlers(registry):
    registry.register(PointCloudUploadTaskHandler())
    registry.register(VideoTaskHandler())
    registry.register(OpenSfMTaskHandler())
    registry.register(EMODnetGeoTIFFTaskHandler())
    registry.register(EMODnetCSVTaskHandler())
    registry.register_default(DefaultTaskHandler())

__all__ = [
    "BaseTaskHandler",
    "PointCloudUploadTaskHandler",
    "VideoTaskHandler",
    "OpenSfMTaskHandler",
    "EMODnetGeoTIFFTaskHandler",
    "EMODnetCSVTaskHandler",
    "DefaultTaskHandler",
    "register_all_handlers"
]
