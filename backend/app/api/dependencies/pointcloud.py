from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db_session
from app.services.pointcloud import DatabasePointCloudStorageService


def get_pointcloud_service(
    db: AsyncSession = Depends(get_db_session)
) -> DatabasePointCloudStorageService:
    """
    Dependency to provide the active point cloud storage service.
    """
    return DatabasePointCloudStorageService(db_session=db)


