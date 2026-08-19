from datetime import datetime
from uuid import UUID
from typing import Optional, List
from pydantic import BaseModel, ConfigDict, computed_field

class PointCloudMetadataResponse(BaseModel):
    id: UUID
    job_id: Optional[UUID] = None
    video_metadata_id: Optional[UUID] = None
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

    @computed_field
    @property
    def center(self) -> Optional[List[float]]:
        if (
            self.min_x is not None and self.max_x is not None and
            self.min_y is not None and self.max_y is not None and
            self.min_z is not None and self.max_z is not None
        ):
            return [(self.min_x + self.max_x) / 2.0, (self.min_y + self.max_y) / 2.0, (self.min_z + self.max_z) / 2.0]
        return None

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
    rotation: Optional[List[float]] = None
    relative_time: Optional[float] = None
    filename: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class PointCloudBoundingBox(BaseModel):
    min_x: Optional[float] = None
    min_y: Optional[float] = None
    min_z: Optional[float] = None
    max_x: Optional[float] = None
    max_y: Optional[float] = None
    max_z: Optional[float] = None


class PointCloudStreamSummaryResponse(BaseModel):
    total_points: int
    number_of_points: int
    bounding_box: Optional[PointCloudBoundingBox] = None
    center: Optional[List[float]] = None
    connected_pointclouds: List[PointCloudMetadataResponse] = []
    connected_camera_headers: List[CameraHeaderResponse] = []

    @computed_field
    @property
    def centerpoint(self) -> Optional[List[float]]:
        if self.center:
            return self.center
        if (
            self.bounding_box and
            self.bounding_box.min_x is not None and self.bounding_box.max_x is not None and
            self.bounding_box.min_y is not None and self.bounding_box.max_y is not None and
            self.bounding_box.min_z is not None and self.bounding_box.max_z is not None
        ):
            return [
                (self.bounding_box.min_x + self.bounding_box.max_x) / 2.0,
                (self.bounding_box.min_y + self.bounding_box.max_y) / 2.0,
                (self.bounding_box.min_z + self.bounding_box.max_z) / 2.0,
            ]
        return None

    model_config = ConfigDict(from_attributes=True)
