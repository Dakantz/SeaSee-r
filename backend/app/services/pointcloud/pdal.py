import os
import csv
import json
import shutil
import asyncio
import tempfile
from typing import Dict, Any, Tuple, Optional
from urllib.parse import urlparse


from sqlalchemy import text
from app.core.config import settings
from app.services.pointcloud.entwine import build_ept

EMODNET_ELEVATION_MULTIPLICATION = 100.0

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


async def process_emodnet_csv(
    csv_path: str,
    output_dir: str,
    out_srs: str = "EPSG:3857",
    storage_type: Optional[str] = None,
    file_id: Optional[str] = None
) -> Tuple[Dict[str, float], int, Optional[int]]:
    """
    Processes an EMODnet Bathymetry CSV file:
    1. Pre-processes the CSV by removing the unit row (2nd line) and renaming spatial
       columns (longitude -> X, latitude -> Y, elevation -> Z).
    2. Runs PDAL (readers.text -> filters.reprojection -> writers.las/laz) to generate a temporary reprojected .laz file.
    3. Extracts point cloud statistics (bbox and point count).
    4. Ingests point cloud into PostgreSQL pgPointcloud table if database storage is enabled.
    5. Uses Entwine (build_ept) to convert the .laz file into an EPT dataset.
    Returns (bbox_dict, number_of_points, pcid).
    """
    csv_abs = os.path.abspath(csv_path)
    output_abs = os.path.abspath(output_dir)
    os.makedirs(output_abs, exist_ok=True)

    with tempfile.TemporaryDirectory() as tmp_dir:
        cleaned_csv_path = os.path.join(tmp_dir, "cleaned_emodnet.csv")
        temp_laz_path = os.path.join(tmp_dir, "reprojected.laz")

        # 1. Pre-processing: Clean CSV header and rename spatial columns
        with open(csv_abs, mode="r", newline="", encoding="utf-8") as infile, \
             open(cleaned_csv_path, mode="w", newline="", encoding="utf-8") as outfile:
            reader = csv.reader(infile)
            writer = csv.writer(outfile)

            header = next(reader, None)
            if header is not None:
                # Strip out second header line (units row)
                next(reader, None)

                # Rename columns longitude -> X, latitude -> Y, elevation -> Z
                header_mapped = []
                elevation_idx = -1
                for idx, col in enumerate(header):
                    col_name = col.strip()
                    if col_name == "longitude":
                        header_mapped.append("X")
                    elif col_name == "latitude":
                        header_mapped.append("Y")
                    elif col_name == "elevation":
                        header_mapped.append("Z")
                        elevation_idx = idx
                    else:
                        header_mapped.append(col_name)

                # Append Red, Green, Blue columns for bright blue color
                header_mapped.extend(["Red", "Green", "Blue"])

                writer.writerow(header_mapped)

                for row in reader:
                    if row:
                        # Multiply elevation by 100
                        if elevation_idx != -1 and elevation_idx < len(row):
                            raw_val = row[elevation_idx].strip()
                            if raw_val and raw_val.lower() != "nan":
                                try:
                                    z_val = float(raw_val)
                                    row[elevation_idx] = str(z_val * EMODNET_ELEVATION_MULTIPLICATION)
                                except (ValueError, TypeError):
                                    pass

                        # Append 8-bit bright blue RGB values (Red: 0, Green: 191, Blue: 255)
                        row.extend(["0", "191", "255"])
                        writer.writerow(row)

        # 2. Native PDAL pipeline execution
        pdal_pipeline = {
            "pipeline": [
                {
                    "type": "readers.text",
                    "filename": cleaned_csv_path,
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

        try:
            proc = await asyncio.create_subprocess_exec(
                "pdal", "pipeline", "--stdin",
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            stdout, stderr = await proc.communicate(input=pipeline_json.encode("utf-8"))

            if proc.returncode != 0:
                err_msg = stderr.decode("utf-8", errors="replace") or stdout.decode("utf-8", errors="replace")
                raise RuntimeError(f"Native PDAL pipeline failed: {err_msg}")

        except (FileNotFoundError, RuntimeError) as native_err:
            # Fall back to Docker pdal/pdal if native pdal binary is missing or fails
            docker_bin = get_docker_cmd()

            docker_pipeline_path = os.path.join(tmp_dir, "pipeline.json")
            docker_pdal_pipeline = {
                "pipeline": [
                    {
                        "type": "readers.text",
                        "filename": "/config/cleaned_emodnet.csv",
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
                    err_msg = stderr.decode("utf-8", errors="replace") or stdout.decode("utf-8", errors="replace")
                    raise RuntimeError(f"PDAL Docker pipeline failed: {err_msg}") from native_err
            except FileNotFoundError:
                raise RuntimeError(
                    f"Neither native 'pdal' command nor '{docker_bin}' binary was found."
                ) from native_err

        # 3. Extract stats (bbox & number of points) from reprojected LAZ file
        bbox, number_of_points, _ = await get_pointcloud_srs_and_stats(temp_laz_path)

        # 4. Ingest points into pgPointcloud database
        pcid = None
        if file_id:
            connection_str = format_libpq_connection_string(settings.database_url)

            print(f"[EMODnet CSV Ingest] Ingesting pointcloud {file_id} to database pointcloud_patches table for LOD levels 0..3...")
            # Execute PDAL pgPointcloud ingestion for LOD levels: lod0, lod1, lod2, lod3
            for lod in range(4):
                step = 2 ** lod
                ingested_pcid = await ingest_pgpointcloud(
                    file_path=temp_laz_path,
                    connection_str=connection_str,
                    pointcloud_id=file_id,
                    lod=lod,
                    capacity=400,
                    srid=3857,
                    overwrite=True,
                    pcid=pcid,
                    step=step
                )
                if lod == 0 and pcid is None and ingested_pcid is not None:
                    pcid = ingested_pcid

            if pcid is None:
                pcid = 1

        # 5. Build EPT dataset using Entwine
        await build_ept(
            file_path=temp_laz_path,
            output_dir=output_abs,
            scale="0.001"
        )

        return bbox, number_of_points, pcid


async def get_pointcloud_stats(file_path: str) -> Tuple[Dict[str, float], int]:

    """
    Runs `pdal info --stats` to extract bounding box coordinates (min_x, min_y, min_z, max_x, max_y, max_z)
    and total point count from a point cloud file.
    """
    bbox_dict, number_of_points, _ = await get_pointcloud_srs_and_stats(file_path)
    return bbox_dict, number_of_points


async def get_pointcloud_dimensions(file_path: str) -> list:
    """
    Extracts dimension names from a point cloud or raster file using `pdal info --stats`.
    """
    file_abs = os.path.abspath(file_path)
    ext = os.path.splitext(file_abs)[1].lower()

    cmd_args = ["pdal", "info", "--stats"]
    if ext in ('.geotif', '.tif', '.tiff', '.geotiff', '.asc', '.nc'):
        cmd_args.extend(["--driver", "readers.gdal"])
    cmd_args.append(file_abs)

    info_stdout = None
    try:
        info_proc = await asyncio.create_subprocess_exec(
            *cmd_args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        info_stdout, _ = await info_proc.communicate()
        if info_proc.returncode != 0 and "--driver" not in cmd_args:
            retry_cmd = ["pdal", "info", "--driver", "readers.gdal", "--stats", file_abs]
            info_proc2 = await asyncio.create_subprocess_exec(
                *retry_cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            info_stdout, _ = await info_proc2.communicate()
    except Exception:
        docker_bin = get_docker_cmd()
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
                info_stdout, _ = await info_proc.communicate()
            except Exception:
                pass

    if info_stdout:
        try:
            info_data = json.loads(info_stdout.decode('utf-8'))
            stats = info_data.get("stats", {}).get("statistic", [])
            dims = [dim.get("name") for dim in stats if dim.get("name")]
            if dims:
                return dims
        except Exception:
            pass
    return []



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
    table_name: Optional[str] = None,
    pointcloud_id: Optional[str] = None,
    lod: int = 0,
    srid: int = 4326,
    capacity: int = 400,
    overwrite: bool = True,
    pcid: Optional[int] = None,
    target_dimensions: Optional[list] = None,
    step: int = 1
) -> Optional[int]:
    """
    Executes a PDAL pipeline to chip and ingest points into PostgreSQL pgPointcloud database.
    If pointcloud_id is provided, ingests into a temporary staging table and transfers patches
    into the unified `pointcloud_patches` table with (pointcloud_id, lod).
    Returns the pcid detected/generated during ingestion.
    """
    file_abs = os.path.abspath(file_path)
    ext = os.path.splitext(file_abs)[1].lower()

    if pointcloud_id:
        clean_uuid = pointcloud_id.replace("-", "")
        target_table = f"pc_staging_{clean_uuid}_lod{lod}"
    else:
        target_table = table_name or "pointcloud_patches"

    source_dims = await get_pointcloud_dimensions(file_abs)
    target_dims = target_dimensions or ["X", "Y", "Z", "Red", "Green", "Blue"]

    print(f"[PDAL Ingest] Source file dimensions: {source_dims if source_dims else 'unknown'}")
    print(f"[PDAL Ingest] Target schema dimensions: {target_dims}")
    print(f"[PDAL Ingest] Staging table: {target_table}")

    if ext in ('.geotif', '.tif', '.tiff', '.geotiff', '.asc', '.nc'):
        raster_band_dims = [d for d in source_dims if str(d).lower() not in ('x', 'y')]
        num_bands = len(raster_band_dims) if raster_band_dims else 1

        if num_bands == 1:
            header_val = "Z"
        else:
            header_val = "Z," + ",".join([f"band_{i+2}" for i in range(num_bands - 1)])

        reader_stage = {
            "type": "readers.gdal",
            "filename": file_abs,
            "header": header_val
        }
    else:
        reader_stage = file_abs

    pipeline_stages = [reader_stage]

    # Map color dimensions if source uses alternative cases (e.g. red, green, blue or r, g, b)
    s_dims_lower = [str(d).lower() for d in source_dims]
    ferry_pairs = []
    if "red" in s_dims_lower and "Red" not in source_dims:
        orig = source_dims[s_dims_lower.index("red")]
        ferry_pairs.append(f"{orig}=>Red")
    elif "r" in s_dims_lower and "Red" not in source_dims and "r" in source_dims:
        ferry_pairs.append("r=>Red")

    if "green" in s_dims_lower and "Green" not in source_dims:
        orig = source_dims[s_dims_lower.index("green")]
        ferry_pairs.append(f"{orig}=>Green")
    elif "g" in s_dims_lower and "Green" not in source_dims and "g" in source_dims:
        ferry_pairs.append("g=>Green")

    if "blue" in s_dims_lower and "Blue" not in source_dims:
        orig = source_dims[s_dims_lower.index("blue")]
        ferry_pairs.append(f"{orig}=>Blue")
    elif "b" in s_dims_lower and "Blue" not in source_dims and "b" in source_dims:
        ferry_pairs.append("b=>Blue")

    if ferry_pairs:
        pipeline_stages.append({
            "type": "filters.ferry",
            "dimensions": ", ".join(ferry_pairs)
        })

    if srid == 3857:
        pipeline_stages.append({
            "type": "filters.reprojection",
            "out_srs": "EPSG:3857"
        })

    if step > 1:
        pipeline_stages.append({
            "type": "filters.decimation",
            "step": step
        })

    writer_stage = {
        "type": "writers.pgpointcloud",
        "connection": connection_str,
        "table": target_table,
        "column": "patch",
        "srid": srid,
        "compression": "dimensional",
        "overwrite": True
    }
    if target_dims:
        writer_stage["output_dims"] = target_dims
    if pcid is not None:
        writer_stage["pcid"] = pcid

    pipeline_stages.extend([
        {
            "type": "filters.chipper",
            "capacity": capacity
        },
        writer_stage
    ])

    pdal_write_pipeline = {"pipeline": pipeline_stages}

    pipeline_json = json.dumps(pdal_write_pipeline)
    local_err = None
    try:
        write_proc = await asyncio.create_subprocess_exec(
            "pdal", "pipeline", "--stdin",
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        write_stdout, write_stderr = await write_proc.communicate(input=pipeline_json.encode('utf-8'))
        if write_proc.returncode != 0:
            err = write_stderr.decode('utf-8', errors='replace')
            print(f"[PDAL Ingest] Ingestion failed for {file_abs}.")
            print(f"[PDAL Ingest] Source file dimensions: {source_dims if source_dims else 'unknown'}")
            print(f"[PDAL Ingest] Target schema dimensions: {target_dims}")
            raise RuntimeError(f"PDAL pgpointcloud ingestion failed: {err}")
    except (FileNotFoundError, RuntimeError) as e:
        local_err = e
        docker_bin = get_docker_cmd()
        if shutil.which("docker") or (os.path.exists(docker_bin) and os.access(docker_bin, os.X_OK)):
            file_dir = os.path.dirname(file_abs)
            file_name = os.path.basename(file_abs)

            with tempfile.TemporaryDirectory() as tmp_dir:
                docker_pipeline_path = os.path.join(tmp_dir, "pipeline.json")

                docker_stages = []
                for stage in pipeline_stages:
                    stage_copy = dict(stage) if isinstance(stage, dict) else stage
                    if isinstance(stage_copy, dict) and stage_copy.get("type") == "readers.gdal":
                        stage_copy["filename"] = f"/data/{file_name}"
                        docker_stages.append(stage_copy)
                    elif isinstance(stage_copy, str) and stage_copy == file_abs:
                        docker_stages.append(f"/data/{file_name}")
                    else:
                        docker_stages.append(stage_copy)

                with open(docker_pipeline_path, "w") as f:
                    json.dump({"pipeline": docker_stages}, f)

                docker_cmd = [
                    docker_bin, "run", "--rm",
                    "-v", f"{file_dir}:/data:ro",
                    "-v", f"{tmp_dir}:/config:ro",
                    "pdal/pdal",
                    "pdal", "pipeline", "/config/pipeline.json"
                ]

                try:
                    docker_proc = await asyncio.create_subprocess_exec(
                        *docker_cmd,
                        stdout=asyncio.subprocess.PIPE,
                        stderr=asyncio.subprocess.PIPE
                    )
                    d_stdout, d_stderr = await docker_proc.communicate()
                    if docker_proc.returncode != 0:
                        d_err = d_stderr.decode('utf-8', errors='replace')
                        print(f"[PDAL Ingest] Docker ingestion failed for {file_abs}.")
                        print(f"[PDAL Ingest] Source file dimensions: {source_dims if source_dims else 'unknown'}")
                        print(f"[PDAL Ingest] Target schema dimensions: {target_dims}")
                        raise RuntimeError(f"PDAL pgpointcloud ingestion via Docker failed: {d_err}") from local_err
                except Exception as docker_err:
                    print(f"[PDAL Ingest] Docker ingestion exception for {file_abs}.")
                    print(f"[PDAL Ingest] Source file dimensions: {source_dims if source_dims else 'unknown'}")
                    print(f"[PDAL Ingest] Target schema dimensions: {target_dims}")
                    raise local_err from docker_err
        else:
            print(f"[PDAL Ingest] Ingestion failed for {file_abs}.")
            print(f"[PDAL Ingest] Source file dimensions: {source_dims if source_dims else 'unknown'}")
            print(f"[PDAL Ingest] Target schema dimensions: {target_dims}")
            raise local_err

    found_pcid = None
    if pointcloud_id:
        async with async_session() as session:
            try:
                res = await session.execute(text(f"SELECT PC_PCId(patch) FROM {target_table} LIMIT 1"))
                row = res.first()
                if row and row[0] is not None:
                    found_pcid = int(row[0])

                await session.execute(text("""
                    CREATE TABLE IF NOT EXISTS pointcloud_patches (
                        id BIGSERIAL PRIMARY KEY,
                        pointcloud_id UUID NOT NULL REFERENCES pointclouds(id) ON DELETE CASCADE,
                        lod INTEGER NOT NULL DEFAULT 0,
                        patch PCPATCH
                    );
                """))
                await session.execute(text("""
                    CREATE INDEX IF NOT EXISTS idx_pointcloud_patches_pc_lod 
                    ON pointcloud_patches (pointcloud_id, lod);
                """))

                # Ensure parent record exists in pointclouds table to satisfy foreign key constraint
                await session.execute(
                    text("""
                        INSERT INTO pointclouds (id, orig_filename, number_of_points, pcid, created_at)
                        VALUES (:id, :filename, 0, 1, NOW())
                        ON CONFLICT (id) DO NOTHING
                    """),
                    {"id": pointcloud_id, "filename": os.path.basename(file_abs)}
                )

                if overwrite:
                    await session.execute(
                        text("DELETE FROM pointcloud_patches WHERE pointcloud_id = :id AND lod = :lod"),
                        {"id": pointcloud_id, "lod": lod}
                    )

                await session.execute(
                    text(f"""
                        INSERT INTO pointcloud_patches (pointcloud_id, lod, patch)
                        SELECT :pointcloud_id, :lod, patch FROM {target_table}
                    """),
                    {"pointcloud_id": pointcloud_id, "lod": lod}
                )

                await session.execute(text(f"DROP TABLE IF EXISTS {target_table}"))
                await session.commit()
            except Exception as transfer_err:
                await session.rollback()
                print(f"[PDAL Ingest] Error transferring patches from {target_table} to pointcloud_patches: {transfer_err}")
                raise transfer_err

    return found_pcid




