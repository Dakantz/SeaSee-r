from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings, StorageType
from app.core.database import get_db_session
from app.services.pointcloud import (
    PointCloudStorageService,
    LocalPointCloudStorageService,
    DatabasePointCloudStorageService
)

def get_pointcloud_service(
    db: AsyncSession = Depends(get_db_session)
) -> PointCloudStorageService:
    """
    Dependency to provide the active point cloud storage service 
    based on the configuration.
    """
    if settings.pointcloud_storage_type == StorageType.database:
        return DatabasePointCloudStorageService(db_session=db)

    if settings.pointcloud_storage_type == StorageType.filesystem:
        return LocalPointCloudStorageService(base_dir=settings.pointcloud_local_dir)

    raise ValueError("Invalid point cloud storage type: ", settings.pointcloud_storage_type)

