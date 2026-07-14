from enum import Enum
from pydantic_settings import BaseSettings, SettingsConfigDict


class StorageType(str, Enum):
    filesystem = "filesystem"
    database = "database"


class Settings(BaseSettings):
    # 'filesystem' or 'database'
    pointcloud_storage_type: StorageType = StorageType.filesystem
    # directory for local .ply files
    pointcloud_local_dir: str = "./data/pointclouds"
    
    model_config = SettingsConfigDict(env_file=".env")

settings = Settings()
