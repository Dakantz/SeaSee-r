import os
import uuid
import aiofiles
from redis import Redis
from rq import Queue

from typing import List, Union
from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException
from fastapi.responses import FileResponse
from app.schemas.pointcloud import PointCloudMetadataResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.services.pointcloud import PointCloudStorageService
from app.api.dependencies.pointcloud import get_pointcloud_service
from app.core.config import settings
from app.core.database import get_db_session
from app.models.job import Job

router = APIRouter(
    prefix="/pointclouds",
    tags=["Point Clouds"]
)

"""
Retrieve a list of available point clouds.
"""
@router.get("/", response_model=List[Union[PointCloudMetadataResponse, str]])
async def list_pointclouds(
    storage_service: PointCloudStorageService = Depends(get_pointcloud_service)
):
    return await storage_service.list_pointclouds()


"""
Retrieve a .ply point cloud file.

The underlying storage mechanism (local file system or database) is determined 
by the `POINTCLOUD_STORAGE_TYPE` configuration.
"""
@router.get("/{filename_or_id}", response_class=FileResponse)
async def get_pointcloud(
    filename_or_id: str,
    storage_service: PointCloudStorageService = Depends(get_pointcloud_service)
):
    return await storage_service.get_pointcloud(filename_or_id)


