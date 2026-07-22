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
