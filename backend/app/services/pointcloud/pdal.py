import os
import json
import shutil
import asyncio
import tempfile
from typing import Dict, Any, Tuple
from urllib.parse import urlparse


from app.services.pointcloud.entwine import build_ept


def get_docker_cmd() -> str:
    """Finds the absolute path to docker executable, checking PATH and common system locations."""
    docker_bin = shutil.which("docker")
    if docker_bin:
        return docker_bin
    for candidate in ["/usr/local/bin/docker", "/usr/bin/docker", "/bin/docker"]:
        if os.path.exists(candidate) and os.access(candidate, os.X_OK):
            return candidate
    return "docker"


async def build_ept_pdal_docker(
    geotiff_path: str,
    output_dir: str,
    out_srs: str = "EPSG:3857"
) -> None:
    """
    Converts a GeoTIFF bathymetry raster into an EPT dataset reprojected to specified SRS (default: EPSG:3857).
    1. Uses PDAL (readers.gdal -> filters.reprojection -> writers.las/laz) to generate a temporary .laz file.
    2. Uses Entwine (build_ept) to convert the .laz file into an EPT dataset.
    """
    geotiff_abs = os.path.abspath(geotiff_path)
    output_abs = os.path.abspath(output_dir)
    os.makedirs(output_abs, exist_ok=True)

    with tempfile.TemporaryDirectory() as tmp_dir:
        temp_laz_path = os.path.join(tmp_dir, "reprojected.laz")

        pdal_pipeline = {
            "pipeline": [
                {
                    "type": "readers.gdal",
                    "filename": geotiff_abs,
                    "spatialreference": "EPSG:4326"
                },
                {
                    "type": "filters.reprojection",
                    "out_srs": out_srs
                },
                temp_laz_path
            ]
        }

        pipeline_json = json.dumps(pdal_pipeline)

        # 1. Convert GeoTIFF to reprojected LAZ via native PDAL
        try:
            proc = await asyncio.create_subprocess_exec(
                "pdal", "pipeline", "--stdin",
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            stdout, stderr = await proc.communicate(input=pipeline_json.encode('utf-8'))

            if proc.returncode != 0:
                err_msg = stderr.decode('utf-8', errors='replace') or stdout.decode('utf-8', errors='replace')
                raise RuntimeError(f"Native PDAL pipeline failed: {err_msg}")

        except (FileNotFoundError, RuntimeError) as native_err:
            # Fall back to Docker pdal/pdal if native pdal binary is missing or fails
            docker_bin = get_docker_cmd()

            input_dir = os.path.dirname(geotiff_abs)
            geotiff_filename = os.path.basename(geotiff_abs)

            docker_pipeline_path = os.path.join(tmp_dir, "pipeline.json")
            docker_pdal_pipeline = {
                "pipeline": [
                    {
                        "type": "readers.gdal",
                        "filename": f"/input/{geotiff_filename}",
                        "spatialreference": "EPSG:4326"
                    },
                    {
                        "type": "filters.reprojection",
                        "out_srs": out_srs
                    },
                    "/config/reprojected.laz"
                ]
            }
            with open(docker_pipeline_path, "w") as f:
                json.dump(docker_pdal_pipeline, f)

            cmd = [
                docker_bin, "run", "--rm",
                "-v", f"{input_dir}:/input:ro",
                "-v", f"{tmp_dir}:/config",
                "pdal/pdal",
                "pdal", "pipeline", "/config/pipeline.json"
            ]

            try:
                proc = await asyncio.create_subprocess_exec(
                    *cmd,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )
                stdout, stderr = await proc.communicate()

                if proc.returncode != 0:
                    err_msg = stderr.decode('utf-8', errors='replace') or stdout.decode('utf-8', errors='replace')
                    raise RuntimeError(f"PDAL Docker pipeline failed: {err_msg}") from native_err
            except FileNotFoundError:
                raise RuntimeError(
                    f"Neither native 'pdal' command nor '{docker_bin}' binary was found."
                ) from native_err

        # 2. Build EPT dataset using Entwine
        await build_ept(
            file_path=temp_laz_path,
            output_dir=output_abs,
            scale="0.001"
        )


build_ept_pdal = build_ept_pdal_docker


async def get_pointcloud_stats(file_path: str) -> Tuple[Dict[str, float], int]:
    """
    Runs `pdal info --stats` to extract bounding box coordinates (min_x, min_y, min_z, max_x, max_y, max_z)
    and total point count from a point cloud file.
    """
    bbox_dict, number_of_points, _ = await get_pointcloud_srs_and_stats(file_path)
    return bbox_dict, number_of_points


async def get_pointcloud_srs_and_stats(file_path: str) -> Tuple[Dict[str, float], int, str]:
    """
    Runs `pdal info --stats` to extract bounding box coordinates, point count, and SRS / coordinate system info.
    Supports GeoTIFF / raster formats via readers.gdal driver.
    """
    file_abs = os.path.abspath(file_path)
    ext = os.path.splitext(file_abs)[1].lower()

    # Base pdal info command arguments
    cmd_args = ["pdal", "info", "--stats"]
    if ext in ('.geotif', '.tif', '.tiff', '.asc', '.nc'):
        cmd_args.extend(["--driver", "readers.gdal"])
    cmd_args.append(file_abs)

    info_stdout = None
    info_stderr = None
    local_err = None

    try:
        info_proc = await asyncio.create_subprocess_exec(
            *cmd_args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        info_stdout, info_stderr = await info_proc.communicate()
        if info_proc.returncode != 0:
            err_msg = info_stderr.decode('utf-8', errors='replace')
            # If auto-driver detection failed, retry once with --driver readers.gdal if not already passed
            if "--driver" not in cmd_args:
                retry_cmd = ["pdal", "info", "--driver", "readers.gdal", "--stats", file_abs]
                info_proc2 = await asyncio.create_subprocess_exec(
                    *retry_cmd,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )
                info_stdout2, info_stderr2 = await info_proc2.communicate()
                if info_proc2.returncode == 0:
                    info_stdout = info_stdout2
                else:
                    raise RuntimeError(f"PDAL info failed: {err_msg}")
            else:
                raise RuntimeError(f"PDAL info failed: {err_msg}")
    except (FileNotFoundError, RuntimeError) as e:
        local_err = e
        docker_bin = get_docker_cmd()
        # Only attempt Docker fallback if docker binary actually exists on system
        if shutil.which("docker") or (os.path.exists(docker_bin) and os.access(docker_bin, os.X_OK)):
            file_dir = os.path.dirname(file_abs)
            file_name = os.path.basename(file_abs)
            docker_cmd = [
                docker_bin, "run", "--rm",
                "-v", f"{file_dir}:/data:ro",
                "pdal/pdal",
                "pdal", "info", "--stats"
            ]
            if ext in ('.geotif', '.tif', '.tiff', '.asc', '.nc'):
                docker_cmd.extend(["--driver", "readers.gdal"])
            docker_cmd.append(f"/data/{file_name}")

            try:
                info_proc = await asyncio.create_subprocess_exec(
                    *docker_cmd,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )
                info_stdout, info_stderr = await info_proc.communicate()
                if info_proc.returncode != 0:
                    raise RuntimeError(f"PDAL info via Docker failed: {info_stderr.decode('utf-8', errors='replace')}") from local_err
            except Exception as docker_err:
                raise local_err from docker_err
        else:
            raise local_err

    info_data = json.loads(info_stdout.decode('utf-8'))
    stats = info_data.get("stats", {})
    native_bbox = stats.get("bbox", {}).get("native", {})
    bbox = native_bbox.get("bbox", {})
    
    bbox_dict = {
        "min_x": bbox.get("minx"),
        "min_y": bbox.get("miny"),
        "min_z": bbox.get("minz"),
        "max_x": bbox.get("maxx"),
        "max_y": bbox.get("maxy"),
        "max_z": bbox.get("maxz"),
    }

    # Fallback to stats.statistic for formats like GeoTIFF where stats.bbox is absent
    if bbox_dict["min_x"] is None or bbox_dict["min_y"] is None:
        for dim in stats.get("statistic", []):
            dim_name = str(dim.get("name", "")).strip().lower()
            if dim_name == "x":
                bbox_dict["min_x"] = dim.get("minimum")
                bbox_dict["max_x"] = dim.get("maximum")
            elif dim_name == "y":
                bbox_dict["min_y"] = dim.get("minimum")
                bbox_dict["max_y"] = dim.get("maximum")
            elif dim_name in ("z", "band_1") or (bbox_dict["min_z"] is None and dim_name.startswith("band_")):
                bbox_dict["min_z"] = dim.get("minimum")
                bbox_dict["max_z"] = dim.get("maximum")

    number_of_points = info_data.get("summary", {}).get("num_points", 0)
    if not number_of_points:
        for dim in stats.get("statistic", []):
            if dim.get("name") in ("X", "x", "Z", "z"):
                number_of_points = dim.get("count", 0)
                if number_of_points:
                    break

    srs_info = info_data.get("summary", {}).get("srs", {})
    srs_str = srs_info.get("compoundwkt") or srs_info.get("horizontal") or srs_info.get("proj4") or native_bbox.get("srs", "")
    if isinstance(srs_str, dict):
        srs_str = json.dumps(srs_str)

    return bbox_dict, number_of_points, str(srs_str)


def check_bbox_within_or_overlapping(existing_bbox: Dict[str, Any], candidate_bbox: Dict[str, Any]) -> bool:
    """
    Checks if a candidate bounding box is within or overlaps with an existing bounding box.
    Returns True if bounding boxes intersect/overlap or if existing bounding box coordinates are not yet set.
    """
    ex_min_x, ex_max_x = existing_bbox.get("min_x"), existing_bbox.get("max_x")
    ex_min_y, ex_max_y = existing_bbox.get("min_y"), existing_bbox.get("max_y")
    ex_min_z, ex_max_z = existing_bbox.get("min_z"), existing_bbox.get("max_z")

    # If existing bounding box is not fully initialized, condition is satisfied
    if None in (ex_min_x, ex_max_x, ex_min_y, ex_max_y):
        return True

    cand_min_x, cand_max_x = candidate_bbox.get("min_x"), candidate_bbox.get("max_x")
    cand_min_y, cand_max_y = candidate_bbox.get("min_y"), candidate_bbox.get("max_y")
    cand_min_z, cand_max_z = candidate_bbox.get("min_z"), candidate_bbox.get("max_z")

    if None in (cand_min_x, cand_max_x, cand_min_y, cand_max_y):
        return True

    overlap_x = (cand_min_x <= ex_max_x) and (cand_max_x >= ex_min_x)
    overlap_y = (cand_min_y <= ex_max_y) and (cand_max_y >= ex_min_y)

    overlap_z = True
    if None not in (ex_min_z, ex_max_z, cand_min_z, cand_max_z):
        overlap_z = (cand_min_z <= ex_max_z) and (cand_max_z >= ex_min_z)

    return overlap_x and overlap_y and overlap_z


def check_coordinate_systems_match(existing_srs: str, candidate_srs: str) -> bool:
    """
    Checks if candidate coordinate reference system matches the existing coordinate reference system.
    Returns True if SRS strings match or if either is empty/unspecified.
    """
    if not existing_srs or not candidate_srs:
        return True
    return existing_srs.strip().lower() == candidate_srs.strip().lower()


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
    capacity: int = 400,
    overwrite: bool = True
) -> None:
    """
    Executes a PDAL pipeline to chip and ingest points into PostgreSQL pgPointcloud table.
    Supports GeoTIFF / raster formats via readers.gdal driver.
    """
    file_abs = os.path.abspath(file_path)
    ext = os.path.splitext(file_abs)[1].lower()

    if ext in ('.geotif', '.tif', '.tiff', '.asc', '.nc'):
        reader_stage = {
            "type": "readers.gdal",
            "filename": file_abs
        }
    else:
        reader_stage = file_abs

    pipeline_stages = [reader_stage]

    if srid == 3857:
        pipeline_stages.append({
            "type": "filters.reprojection",
            "out_srs": "EPSG:3857"
        })

    pipeline_stages.extend([
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
            "overwrite": overwrite
        }
    ])

    pdal_write_pipeline = {"pipeline": pipeline_stages}

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

