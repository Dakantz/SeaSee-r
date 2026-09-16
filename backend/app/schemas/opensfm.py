from pydantic import BaseModel, Field
from typing import Optional

class OpenSfMConfig(BaseModel):
    processes: int = Field(default=2, ge=1, description="Number of parallel processes for OpenSfM execution")
    feature_process_size: int = Field(default=2048, ge=256, description="Max image dimension for feature extraction")
    mem_ceiling: int = Field(default=12288, ge=1024, description="Memory ceiling limit in MB")
    depthmap_max_image_size: int = Field(default=2048, ge=256, description="Max image size for depth map generation")
    depthmap_cluster_max_size: int = Field(default=12, ge=1, description="Max cluster size for depth maps")
    depthmap_max_cluster_views: int = Field(default=32, ge=1, description="Max views per cluster for depth maps")
    depthmap_fusion_svo_max_voxels: int = Field(default=50000000, ge=100000, description="Max voxels for SVO fusion")
    undistorted_image_max_size: int = Field(default=2048, ge=256, description="Max size for undistorted images")
    submodel_size: int = Field(default=60, ge=1, description="Submodel size parameter")

class OpenSfMConfigResponse(BaseModel):
    config: OpenSfMConfig
    raw_yaml: str
    file_path: str

class OpenSfMConfigUpdate(BaseModel):
    config: Optional[OpenSfMConfig] = None
    raw_yaml: Optional[str] = None
