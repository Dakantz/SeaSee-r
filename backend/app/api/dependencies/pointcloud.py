from fastapi import Depends
from app.core.config import settings, StorageType
from app.services.pointcloud import (
    PointCloudStorageService,
    LocalPointCloudStorageService,
    DatabasePointCloudStorageService
)

def get_pointcloud_service() -> PointCloudStorageService:
    """
    Dependency to provide the active point cloud storage service 
    based on the configuration.
    """
    if settings.pointcloud_storage_type == StorageType.database:
        return DatabasePointCloudStorageService()

    if settings.pointcloud_storage_type == StorageType.filesystem:
        return LocalPointCloudStorageService(base_dir=settings.pointcloud_local_dir)

    raise ValueError("Invalid point cloud storage type: ", settings.pointcloud_storage_type)
