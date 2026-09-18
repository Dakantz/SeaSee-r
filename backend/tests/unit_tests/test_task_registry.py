import pytest
from app.services.worker.registry import TaskRegistry, task_registry
from app.services.worker.handlers.base import BaseTaskHandler
from app.services.worker.handlers import (
    PointCloudUploadTaskHandler,
    VideoTaskHandler,
    OpenSfMIngestTaskHandler,
    EMODnetGeoTIFFTaskHandler,
    EMODnetCSVTaskHandler,
    DefaultTaskHandler
)

def test_registry_registration():
    reg = TaskRegistry()
    handler = PointCloudUploadTaskHandler()
    reg.register(handler)

    retrieved = reg.get_handler("pointcloud_upload")
    assert retrieved == handler

def test_registry_default_fallback():
    reg = TaskRegistry()
    default_h = DefaultTaskHandler()
    reg.register_default(default_h)

    retrieved = reg.get_handler("non_existent_task")
    assert retrieved == default_h

def test_global_task_registry_contains_default_handlers():
    assert task_registry.get_handler("pointcloud_upload") is not None
    assert task_registry.get_handler("video_upload") is not None
    assert task_registry.get_handler("opensfm_ingest") is not None
    assert task_registry.get_handler("opensfm_reconstruct") is not None
    assert task_registry.get_handler("emodnet_ingest") is not None
    assert task_registry.get_handler("emodnet_csv_ingest") is not None
    assert task_registry.get_handler("frame_extraction") is not None
    assert task_registry.get_handler("video_frame_extraction") is not None
