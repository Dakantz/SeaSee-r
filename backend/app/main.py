from fastapi import FastAPI
from fastapi.routing import APIRoute
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes.health import router as health_router
from app.api.routes.pointclouds import router as pointclouds_router
from app.api.routes.jobs import router as jobs_router

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

# Add CORS middleware to allow the frontend to communicate with the backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins, adjust in production
    allow_credentials=False,
    allow_methods=["*"],  # Allows all methods
    allow_headers=["*"],  # Allows all headers
)

# Serve generated EPT point cloud files statically
app.mount("/ept", StaticFiles(directory=settings.ept_dir), name="ept")

# Include modular routers
app.include_router(health_router)
app.include_router(pointclouds_router)
app.include_router(jobs_router)