from datetime import datetime
from uuid import UUID
from typing import Optional, List
from pydantic import BaseModel, ConfigDict

class PointCloudMetadataResponse(BaseModel):
    id: UUID
    job_id: Optional[UUID] = None
    orig_filename: str
    safe_filename: Optional[str] = None
    number_of_points: int
    
    # 3D bounding box coordinates
    min_x: Optional[float] = None
    min_y: Optional[float] = None
    min_z: Optional[float] = None
    max_x: Optional[float] = None
    max_y: Optional[float] = None
    max_z: Optional[float] = None
    
    created_at: datetime
    pcid: int
    transform_matrix: List[float]

    model_config = ConfigDict(from_attributes=True)

class CameraHeaderResponse(BaseModel):
    id: UUID
    pointcloud_id: UUID
    focal: Optional[float] = None
    width: Optional[int] = None
    height: Optional[int] = None
    camera: Optional[str] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class CameraFrameResponse(BaseModel):
    id: UUID
    camera_header_id: UUID
    timestamp: int
    position: Optional[List[float]] = None
    direction: Optional[List[float]] = None
    relative_time: Optional[float] = None
    filename: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)
