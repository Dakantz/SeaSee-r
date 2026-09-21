from fastapi import FastAPI
from fastapi.routing import APIRoute
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes.health import router as health_router
from app.api.routes.pointclouds import router as pointclouds_router
from app.api.routes.jobs import router as jobs_router
from app.api.routes.videos import router as videos_router
from app.api.routes.tusd_webhooks import router as tusd_webhooks_router
from app.api.routes.bathymetry import router as bathymetry_router
from app.api.routes.opensfm import router as opensfm_router

# Custom function to generate unique and clean operation IDs for the frontend client
def custom_generate_unique_id(route: APIRoute):
    return f"{route.name}"

app = FastAPI(
    title="SeaSee-r API",
    description="Backend API for SeaSee-r SLAM and Pointcloud visualization",
    version="0.1.0",
    generate_unique_id_function=custom_generate_unique_id,
)

import os
from fastapi.staticfiles import StaticFiles
from app.core.config import settings

# Create directories if they don't exist
os.makedirs(settings.ept_dir, exist_ok=True)
os.makedirs(settings.upload_dir, exist_ok=True)
os.makedirs(settings.video_dir, exist_ok=True)
os.makedirs(settings.metadata_dir, exist_ok=True)
os.makedirs(settings.pointcloud_local_dir, exist_ok=True)
os.makedirs(settings.opensfm_ingestion_dir, exist_ok=True)
os.makedirs(settings.emodnet_ingestion_dir, exist_ok=True)

# Add CORS middleware to allow the frontend to communicate with the backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins, adjust in production
    allow_credentials=False,
    allow_methods=["*"],  # Allows all methods
    allow_headers=["*"],  # Allows all headers
)

import logging
from fastapi.responses import JSONResponse

logger = logging.getLogger("app.main")

@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    logger.error("Unhandled exception caught in request: %s", exc, exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal Server Error", "error": str(exc)}
    )

# Serve generated EPT point cloud files statically
app.mount("/ept", StaticFiles(directory=settings.ept_dir), name="ept")

# Include modular routers
app.include_router(health_router)
app.include_router(pointclouds_router)
app.include_router(jobs_router)
app.include_router(videos_router)
app.include_router(tusd_webhooks_router)
app.include_router(bathymetry_router)
app.include_router(opensfm_router, prefix="/api")