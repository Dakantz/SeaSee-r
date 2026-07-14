from fastapi import FastAPI
from fastapi.routing import APIRoute
from fastapi.middleware.cors import CORSMiddleware

from routes.health.health_routes import router as health_router

# Custom function to generate unique and clean operation IDs for the frontend client
def custom_generate_unique_id(route: APIRoute):
    return f"{route.name}"

app = FastAPI(
    title="SeaSee-r API",
    description="Backend API for SeaSee-r SLAM and Pointcloud visualization",
    version="0.1.0",
    generate_unique_id_function=custom_generate_unique_id,
)

# Add CORS middleware to allow the frontend to communicate with the backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins, adjust in production
    allow_credentials=False,
    allow_methods=["*"],  # Allows all methods
    allow_headers=["*"],  # Allows all headers
)

# Include modular routers
app.include_router(health_router)

# --- Future Proofing / Architectural Separation ---
# In the future, this is where we would connect to the pgPointcloud database.
# 
# Recommended future structure:
# backend/
# ├── app/
# │   ├── core/         # config, security
# │   ├── routes/       # routes (routers here)
# │   ├── db/           # database connection, sessions (pgPointcloud connection)
# │   ├── models/       # SQLAlchemy models
# │   └── schemas/      # Pydantic schemas
# ├── main.py           # entrypoint (includes FastAPI app)
# └── requirements.txt  
