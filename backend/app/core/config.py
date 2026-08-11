from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # API version
    version: str = "1.0.0"
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
    # directory for ingesting EMODnet bathymetry geotif files
    emodnet_ingestion_dir: str = "./data/emodnet_ingestion"
    
    # Database and Redis connections (with localhost fallback for local runs)
    database_url: str = "postgresql+asyncpg://postgres:postgres_secure_password@localhost:5432/seaseer"
    redis_url: str = "redis://localhost:6379/0"
    
    # Spatial reference system for camera positions and directions (default EPSG:3857 or EPSG:3765)
    camera_srid: int = 3857
    backend_srid: int = 3857
    
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
