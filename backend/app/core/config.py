from enum import Enum
from pydantic_settings import BaseSettings, SettingsConfigDict


class StorageType(str, Enum):
    filesystem = "filesystem"
    database = "database"


class Settings(BaseSettings):
    # 'filesystem' or 'database'
    pointcloud_storage_type: StorageType
    # directory for local .ply files
    pointcloud_local_dir: str = "./data/pointclouds"
    # directory for raw pointcloud uploads (.las, .laz, .ply)
    upload_dir: str = "./data/pointclouds"
    # directory for generated EPT datasets
    ept_dir: str = "./data/ept"
    
    # Database and Redis connections (with localhost fallback for local runs)
    database_url: str = "postgresql+asyncpg://postgres:postgres_secure_password@localhost:5432/seaseer"
    redis_url: str = "redis://localhost:6379/0"
    
    model_config = SettingsConfigDict(env_file=".env")


settings = Settings()
