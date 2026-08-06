from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db_session
from app.repositories.pointcloud_repository import PointCloudRepository
from app.services.pointcloud.exporters import BinaryStreamExporter, PLYStreamExporter
from app.services.pointcloud.database import DatabasePointCloudStorageService


def get_pointcloud_repository(
    db: AsyncSession = Depends(get_db_session)
) -> PointCloudRepository:
    """
    Dependency to provide PointCloudRepository instance.
    """
    return PointCloudRepository(db_session=db)


def get_binary_exporter(
    repo: PointCloudRepository = Depends(get_pointcloud_repository)
) -> BinaryStreamExporter:
    """
    Dependency to provide BinaryStreamExporter instance.
    """
    return BinaryStreamExporter(repository=repo)


def get_ply_exporter(
    repo: PointCloudRepository = Depends(get_pointcloud_repository)
) -> PLYStreamExporter:
    """
    Dependency to provide PLYStreamExporter instance.
    """
    return PLYStreamExporter(repository=repo)


def get_pointcloud_service(
    db: AsyncSession = Depends(get_db_session)
) -> DatabasePointCloudStorageService:
    """
    Dependency to provide the active point cloud storage service.
    """
    return DatabasePointCloudStorageService(db_session=db)
