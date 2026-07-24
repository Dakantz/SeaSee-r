from enum import Enum
from pydantic_settings import BaseSettings, SettingsConfigDict


class StorageType(str, Enum):
    filesystem = "filesystem"
    database = "database"


class Settings(BaseSettings):
    # API version
    version: str = "1.0.0"
    # 'filesystem' or 'database'
    pointcloud_storage_type: StorageType
    # directory for local .ply files
    pointcloud_local_dir: str = "./data/pointclouds"
    # directory for raw resumable uploads before processing
    upload_dir: str = "./data/uploads"
    # directory for generated EPT datasets
    ept_dir: str = "./data/ept"
    # directory for video uploads
    video_dir: str = "./data/videos"
    # directory for metadata uploads
    metadata_dir: str = "./data/metadata"
    # directory for ingesting the pointclouds from opensfm
    opensfm_ingestion_dir: str = "./data/opensfm_ingestion"
    
    # Database and Redis connections (with localhost fallback for local runs)
    database_url: str = "postgresql+asyncpg://postgres:postgres_secure_password@localhost:5432/seaseer"
    redis_url: str = "redis://localhost:6379/0"
    
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
