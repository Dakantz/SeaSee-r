import json
import asyncio
from typing import Dict, Any, Tuple
from urllib.parse import urlparse

async def get_pointcloud_stats(file_path: str) -> Tuple[Dict[str, float], int]:
    """
    Runs `pdal info --stats` to extract bounding box coordinates (min_x, min_y, min_z, max_x, max_y, max_z)
    and total point count from a point cloud file.
    """
    info_proc = await asyncio.create_subprocess_exec(
        "pdal", "info", "--stats", file_path,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE
    )
    info_stdout, info_stderr = await info_proc.communicate()
    if info_proc.returncode != 0:
        raise RuntimeError(f"PDAL info failed: {info_stderr.decode('utf-8', errors='replace')}")

    info_data = json.loads(info_stdout.decode('utf-8'))
    stats = info_data.get("stats", {})
    bbox = stats.get("bbox", {}).get("native", {}).get("bbox", {})
    
    bbox_dict = {
        "min_x": bbox.get("minx"),
        "min_y": bbox.get("miny"),
        "min_z": bbox.get("minz"),
        "max_x": bbox.get("maxx"),
        "max_y": bbox.get("maxy"),
        "max_z": bbox.get("maxz"),
    }

    number_of_points = 0
    for dim in stats.get("statistic", []):
        if dim.get("name") == "X":
            number_of_points = dim.get("count", 0)
            break

    return bbox_dict, number_of_points


def format_libpq_connection_string(db_url: str) -> str:
    """
    Converts a SQLAlchemy database URL (e.g. postgresql+asyncpg://...) to a libpq connection string
    used by PDAL writers.pgpointcloud (e.g. host=... port=... user=... password=... dbname=...).
    """
    clean_url = db_url.replace("postgresql+asyncpg://", "postgresql://")
    parsed = urlparse(clean_url)
    conn_parts = []
    if parsed.hostname:
        conn_parts.append(f"host={parsed.hostname}")
    if parsed.port:
        conn_parts.append(f"port={parsed.port}")
    if parsed.username:
        conn_parts.append(f"user={parsed.username}")
    if parsed.password:
        conn_parts.append(f"password={parsed.password}")
    if parsed.path:
        conn_parts.append(f"dbname={parsed.path.lstrip('/')}")
    return " ".join(conn_parts)


async def ingest_pgpointcloud(
    file_path: str,
    connection_str: str,
    table_name: str,
    srid: int = 4326,
    capacity: int = 400
) -> None:
    """
    Executes a PDAL pipeline to chip and ingest points into PostgreSQL pgPointcloud table.
    """
    pdal_write_pipeline = {
        "pipeline": [
            file_path,
            {
                "type": "filters.chipper",
                "capacity": capacity
            },
            {
                "type": "writers.pgpointcloud",
                "connection": connection_str,
                "table": table_name,
                "column": "patch",
                "srid": srid,
                "compression": "dimensional",
                "overwrite": True
            }
        ]
    }

    pipeline_json = json.dumps(pdal_write_pipeline)
    write_proc = await asyncio.create_subprocess_exec(
        "pdal", "pipeline", "--stdin",
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE
    )
    write_stdout, write_stderr = await write_proc.communicate(input=pipeline_json.encode('utf-8'))
    if write_proc.returncode != 0:
        raise RuntimeError(f"PDAL pgpointcloud ingestion failed: {write_stderr.decode('utf-8', errors='replace')}")
