import io
import math
import logging
import os
import uuid
import aiofiles
from typing import Tuple, Optional
from fastapi import APIRouter, Response, HTTPException, Depends, UploadFile, File
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
import numpy as np
from PIL import Image
from redis import Redis
from rq import Queue

from app.core.database import get_db_session
from app.core.config import settings
from app.models.job import Job

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/bathymetry", tags=["bathymetry"])


def tile_to_bbox_3857(z: int, x: int, y: int) -> Tuple[float, float, float, float]:
    """
    Converts Web Mercator tile coordinates (z, x, y) to EPSG:3857 bounding box (xmin, ymin, xmax, ymax).
    Web Mercator bounds: X & Y range from -20037508.342789244 to 20037508.342789244.
    """
    max_extent = 20037508.342789244
    world_size = 2 * max_extent
    n = 1 << z  # 2^z tiles per side

    tile_size = world_size / n

    xmin = -max_extent + x * tile_size
    xmax = xmin + tile_size

    # Tile Y = 0 is top (north, +ymax), Tile Y = n-1 is bottom (south, -ymax)
    ymax = max_extent - y * tile_size
    ymin = ymax - tile_size

    return xmin, ymin, xmax, ymax


def select_pyramid_table(z: int) -> str:
    """
    Selects the appropriate PostGIS raster pyramid overview table based on zoom level z.
    - z <= 5: o_16_bathymetry_raster
    - z in [6, 7]: o_8_bathymetry_raster
    - z in [8, 9]: o_4_bathymetry_raster
    - z in [10, 11]: o_2_bathymetry_raster
    - z >= 12: bathymetry_raster (base table)
    """
    if z <= 5:
        return "o_16_bathymetry_raster"
    elif z <= 7:
        return "o_8_bathymetry_raster"
    elif z <= 9:
        return "o_4_bathymetry_raster"
    elif z <= 11:
        return "o_2_bathymetry_raster"
    else:
        return "bathymetry_raster"


def encode_terrain_rgb(elevation_matrix: np.ndarray) -> bytes:
    """
    Encodes a 2D float numpy array of elevation values into Mapbox Terrain-RGB PNG image bytes.
    Formula: elevation = -10000 + (R * 256^2 + G * 256 + B) * 0.1
    Inverse: val = round((elevation + 10000) * 10)
             R = floor(val / 65536) % 256
             G = floor((val % 65536) / 256)
             B = val % 256
    """
    elevation_clean = np.nan_to_num(elevation_matrix, nan=0.0)

    val = np.clip(np.round((elevation_clean + 10000.0) * 10.0), 0.0, 16777215.0).astype(np.uint32)

    r = ((val >> 16) & 0xFF).astype(np.uint8)
    g = ((val >> 8) & 0xFF).astype(np.uint8)
    b = (val & 0xFF).astype(np.uint8)

    rgb = np.stack([r, g, b], axis=-1)

    img = Image.fromarray(rgb, mode="RGB")
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def bbox_to_tile(xmin: float, ymin: float, xmax: float, ymax: float, z: int) -> Tuple[int, int]:
    """Converts EPSG:3857 bounding box center to tile coordinates (x, y) at zoom level z."""
    max_extent = 20037508.342789244
    world_size = 2 * max_extent
    n = 1 << z
    tile_size = world_size / n

    center_x = (xmin + xmax) / 2.0
    center_y = (ymin + ymax) / 2.0

    x = int((center_x + max_extent) / tile_size)
    y = int((max_extent - center_y) / tile_size)

    x = max(0, min(n - 1, x))
    y = max(0, min(n - 1, y))

    return x, y


@router.get("/info")
async def get_bathymetry_info(db: AsyncSession = Depends(get_db_session)):
    """
    Returns spatial metadata and sample Terrain-RGB tile URLs for ingested bathymetry datasets.
    """
    try:
        res = await db.execute(text("""
            SELECT 
                ST_XMin(ST_Extent(ST_Envelope(rast))),
                ST_YMin(ST_Extent(ST_Envelope(rast))),
                ST_XMax(ST_Extent(ST_Envelope(rast))),
                ST_YMax(ST_Extent(ST_Envelope(rast)))
            FROM bathymetry_raster;
        """))
        row = res.first()
        if not row or None in row:
            return {"status": "empty", "message": "No bathymetry rasters ingested yet"}

        xmin, ymin, xmax, ymax = float(row[0]), float(row[1]), float(row[2]), float(row[3])
        
        sample_tiles = {}
        for z in [6, 8, 10, 12, 14]:
            tx, ty = bbox_to_tile(xmin, ymin, xmax, ymax, z)
            sample_tiles[f"z{z}"] = f"/bathymetry/{z}/{tx}/{ty}.png"

        return {
            "status": "available",
            "bbox_3857": {"xmin": xmin, "ymin": ymin, "xmax": xmax, "ymax": ymax},
            "recommended_test_tiles": sample_tiles
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}


@router.get("/{z}/{x}/{y}.png", response_class=Response)
async def get_bathymetry_tile(
    z: int,
    x: int,
    y: int,
    db: AsyncSession = Depends(get_db_session)
):
    """
    Serves bathymetry elevation tiles in Mapbox Terrain-RGB PNG format.
    Dynamically selects the PostGIS raster pyramid level based on zoom level z.
    """
    max_tiles = 1 << z
    if x < 0 or x >= max_tiles or y < 0 or y >= max_tiles or z < 0 or z > 24:
        raise HTTPException(status_code=400, detail="Invalid tile coordinates for zoom level")

    xmin, ymin, xmax, ymax = tile_to_bbox_3857(z, x, y)
    target_table = select_pyramid_table(z)

    # Check if target table exists in DB, fallback to base table bathymetry_raster if overview not found
    try:
        table_check = await db.execute(
            text("SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = :tname)"),
            {"tname": target_table}
        )
        if not table_check.scalar():
            target_table = "bathymetry_raster"
    except Exception:
        target_table = "bathymetry_raster"

    tile_buf = (xmax - xmin) / 128.0

    sql = text(f"""
        WITH envelope AS (
            SELECT ST_MakeEnvelope(:xmin, :ymin, :xmax, :ymax, 3857) AS geom
        ),
        envelope_buffered AS (
            SELECT ST_Expand(geom, :buf) AS geom FROM envelope
        ),
        united AS (
            SELECT ST_Union(rast) AS rast
            FROM {target_table}, envelope_buffered env_buf
            WHERE ST_Intersects(rast, env_buf.geom)
        ),
        clipped AS (
            SELECT ST_Resample(
                ST_Clip(u.rast, env_buf.geom),
                256, 256,
                CAST(:xmin AS double precision), CAST(:ymax AS double precision),
                0.0, 0.0,
                'Bilinear',
                0.125
            ) AS tile_rast
            FROM united u, envelope_buffered env_buf
            WHERE u.rast IS NOT NULL
        )
        SELECT ST_DumpValues(tile_rast, 1) FROM clipped WHERE tile_rast IS NOT NULL;
    """)

    elevation_grid = None
    try:
        res = await db.execute(sql, {"xmin": xmin, "ymin": ymin, "xmax": xmax, "ymax": ymax, "buf": tile_buf})
        row = res.first()
        if row and row[0]:
            raw_values = row[0]
            if raw_values and isinstance(raw_values, list):
                processed_rows = []
                for r in raw_values:
                    processed_rows.append([float(val) if val is not None else 0.0 for val in r])
                elevation_grid = np.array(processed_rows, dtype=np.float32)
    except Exception as e:
        logger.warning(f"Error querying PostGIS raster for tile ({z}/{x}/{y}): {e}")

    if elevation_grid is None or elevation_grid.size == 0:
        elevation_grid = np.zeros((256, 256), dtype=np.float32)
    elif elevation_grid.shape != (256, 256):
        h, w = elevation_grid.shape
        padded = np.zeros((256, 256), dtype=np.float32)
        dh = min(h, 256)
        dw = min(w, 256)
        padded[:dh, :dw] = elevation_grid[:dh, :dw]
        elevation_grid = padded

    png_bytes = encode_terrain_rgb(elevation_grid)

    return Response(
        content=png_bytes,
        media_type="image/png",
        headers={
            "Cache-Control": "public, max-age=86400",
            "Content-Type": "image/png"
        }
    )


@router.post("/upload-emodnet-csv", status_code=201)
async def upload_emodnet_csv(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db_session)
):
    """
    Upload an EMODnet Bathymetry CSV file, save it in backend/uploads,
    and dispatch a background processing job using process_emodnet_csv.
    """
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only .csv files are supported.")

    uploads_dir = os.path.abspath(settings.upload_dir)
    os.makedirs(uploads_dir, exist_ok=True)

    file_uuid_str = str(uuid.uuid4())
    safe_filename = f"{file_uuid_str}_{file.filename}"
    file_path = os.path.join(uploads_dir, safe_filename)

    # Save uploaded CSV file to backend/uploads
    async with aiofiles.open(file_path, "wb") as out_file:
        while content := await file.read(1024 * 1024):
            await out_file.write(content)

    # Create job record in database
    job_record = Job(
        name=f"Process EMODnet CSV {file.filename}",
        payload={
            "task_type": "emodnet_csv_ingest",
            "filename": file.filename,
            "safe_filename": safe_filename,
            "file_id": file_uuid_str,
            "file_path": file_path,
            "total_bytes": os.path.getsize(file_path)
        },
        status="PENDING",
        progress=0.0
    )
    db.add(job_record)
    await db.commit()
    await db.refresh(job_record)

    # Enqueue job to Redis Queue for worker execution
    try:
        redis_conn = Redis.from_url(settings.redis_url)
        q = Queue("pointcloud_tasks", connection=redis_conn)
        q.enqueue(
            "app.services.worker.tasks.run_background_job",
            str(job_record.id),
            job_id=str(job_record.id)
        )
    except Exception as e:
        print(f"Warning: Could not enqueue job {job_record.id} to Redis Queue: {e}")

    return {
        "message": "EMODnet CSV uploaded successfully and processing job enqueued.",
        "job_id": str(job_record.id),
        "file_id": file_uuid_str,
        "saved_path": file_path,
        "status": job_record.status
    }
