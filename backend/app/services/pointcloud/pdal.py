import os
import csv
import json
import asyncio
import tempfile
from typing import Dict, Any, Tuple, Optional
from urllib.parse import urlparse

from sqlalchemy import text
from app.core.config import settings
from app.core.database import async_session
from app.services.pointcloud.entwine import build_ept
from app.services.pointcloud.postgis_raster import (
    PostGISRaster,
    ingest_postgis_raster_pyramids,
    format_libpq_connection_string
)

EMODNET_ELEVATION_MULTIPLICATION = 5.0


async def run_pdal_subprocess(
    cmd: list,
    stdin_data: Optional[bytes] = None,
    docker_fallback_cmd: Optional[list] = None,
    raise_on_error: bool = True,
    error_prefix: str = "PDAL execution failed"
) -> Tuple[int, str, str]:
    """
    Executes a PDAL subprocess command natively via asyncio.create_subprocess_exec.
    Returns (returncode, stdout, stderr).
    If raise_on_error is True and returncode != 0, raises RuntimeError.
    """
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdin=asyncio.subprocess.PIPE if stdin_data is not None else None,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        stdout_b, stderr_b = await proc.communicate(input=stdin_data)
        stdout_str = stdout_b.decode('utf-8', errors='replace')
        stderr_str = stderr_b.decode('utf-8', errors='replace')

        if proc.returncode == 0:
            return proc.returncode, stdout_str, stderr_str

        err_msg = stderr_str or stdout_str
        err = RuntimeError(f"{error_prefix}: {err_msg}")
        if raise_on_error:
            raise err
        return proc.returncode, stdout_str, stderr_str
    except Exception as e:
        if raise_on_error:
            if not isinstance(e, RuntimeError):
                raise RuntimeError(f"{error_prefix}: {e}") from e
            raise e
        return 1, "", str(e)


async def run_pdal_pipeline(
    pipeline: dict,
    docker_pipeline: Optional[dict] = None,
    docker_mounts: Optional[list] = None,
    tmp_dir: Optional[str] = None,
    raise_on_error: bool = True,
    error_prefix: str = "PDAL pipeline failed"
) -> Tuple[int, str, str]:
    """
    Executes a PDAL pipeline dictionary asynchronously natively via `pdal pipeline --stdin`.
    """
    cmd = ["pdal", "pipeline", "--stdin"]
    stdin_data = json.dumps(pipeline).encode("utf-8")

    return await run_pdal_subprocess(
        cmd=cmd,
        stdin_data=stdin_data,
        raise_on_error=raise_on_error,
        error_prefix=error_prefix
    )


async def run_pdal_info(
    file_path: str,
    driver: Optional[str] = None,
    stats: bool = True,
    raise_on_error: bool = True
) -> dict:
    """
    Runs `pdal info` on a point cloud or raster file natively.
    Supports auto-retry with `--driver readers.gdal` if initial attempt fails.
    Returns parsed JSON dict.
    """
    file_abs = os.path.abspath(file_path)

    def build_args(use_driver: Optional[str]):
        args = ["pdal", "info"]
        if stats:
            args.append("--stats")
        if use_driver:
            args.extend(["--driver", use_driver])
        args.append(file_abs)
        return args

    cmd_args = build_args(use_driver=driver)

    try:
        retcode, stdout, stderr = await run_pdal_subprocess(
            cmd=cmd_args,
            raise_on_error=True,
            error_prefix="PDAL info failed"
        )
        return json.loads(stdout)
    except Exception as first_err:
        if driver is None:
            try:
                cmd_retry = build_args(use_driver="readers.gdal")
                retcode, stdout, stderr = await run_pdal_subprocess(
                    cmd=cmd_retry,
                    raise_on_error=True,
                    error_prefix="PDAL info retry failed"
                )
                return json.loads(stdout)
            except Exception as retry_err:
                if raise_on_error:
                    raise retry_err from first_err
        if raise_on_error:
            raise first_err
        return {}



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

        await run_pdal_pipeline(
            pipeline=pdal_pipeline,
            error_prefix="pipeline failed"
        )

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
    file_id: Optional[str] = None,
    is_append: bool = False
) -> Tuple[Dict[str, float], int, Optional[int]]:
    """
    Processes an EMODnet Bathymetry CSV file:
    1. Pre-processes the CSV by removing the unit row (2nd line) and renaming spatial
       columns (longitude -> X, latitude -> Y, elevation -> Z).
    2. Runs PDAL (readers.text -> filters.reprojection -> writers.las/laz) to generate a temporary reprojected .laz file.
    3. Extracts point cloud statistics (bbox and point count).
    4. Ingests point cloud into PostgreSQL pgPointcloud table if database storage is enabled.
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
                next(reader, None)

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

                header_mapped.extend(["Red", "Green", "Blue"])
                writer.writerow(header_mapped)

                for row in reader:
                    if row:
                        if elevation_idx != -1 and elevation_idx < len(row):
                            raw_val = row[elevation_idx].strip()
                            if raw_val and raw_val.lower() != "nan":
                                try:
                                    z_val = float(raw_val)
                                    row[elevation_idx] = str(z_val * EMODNET_ELEVATION_MULTIPLICATION)
                                except (ValueError, TypeError):
                                    pass

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

        await run_pdal_pipeline(
            pipeline=pdal_pipeline,
            error_prefix="pipeline failed"
        )

        # 3. Extract stats (bbox & number of points) from reprojected LAZ file
        bbox, number_of_points, _ = await get_pointcloud_srs_and_stats(temp_laz_path)

        # 4. Ingest raster into PostGIS bathymetry_raster table with pyramids (-l 2,4,8,16)
        pcid = 1
        if file_id:
            print(f"[EMODnet CSV Ingest] Ingesting bathymetry raster for dataset {file_id} to database bathymetry_raster table with pyramids...")
            temp_tif_path = os.path.join(tmp_dir, "bathymetry.tif")
            tif_pipeline = {
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
                    {
                        "type": "writers.gdal",
                        "filename": temp_tif_path,
                        "output_type": "mean",
                        "resolution": 100.0,
                        "gdaldriver": "GTiff"
                    }
                ]
            }

            try:
                await run_pdal_pipeline(
                    pipeline=tif_pipeline,
                    raise_on_error=False,
                    error_prefix="TIF generation failed"
                )
            except Exception as e:
                print(f"[EMODnet CSV Ingest] PDAL TIF generation exception: {e}")

            if os.path.exists(temp_tif_path):
                await PostGISRaster.ingest_pyramids(
                    geotiff_path=temp_tif_path,
                    table_name=PostGISRaster.DEFAULT_TABLE_NAME,
                    srid=3857,
                    pyramid_levels="2,4,8,16",
                    pointcloud_id=file_id,
                    is_append=is_append
                )
            else:
                raise RuntimeError(f"Failed to generate bathymetry GeoTIFF raster from CSV for dataset {file_id}")

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
    driver = "readers.gdal" if ext in ('.geotif', '.tif', '.tiff', '.geotiff', '.asc', '.nc') else None

    try:
        info_data = await run_pdal_info(file_abs, driver=driver, stats=True, raise_on_error=False)
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
    driver = "readers.gdal" if ext in ('.geotif', '.tif', '.tiff', '.asc', '.nc') else None

    info_data = await run_pdal_info(file_abs, driver=driver, stats=True, raise_on_error=True)

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
    into the per-LOD `pointcloud_patches_lod{lod}` table with (pointcloud_id, patch).
    Returns the pcid detected/generated during ingestion.
    """
    file_abs = os.path.abspath(file_path)
    ext = os.path.splitext(file_abs)[1].lower()

    if pointcloud_id:
        clean_uuid = pointcloud_id.replace("-", "")
        target_table = f"pc_staging_{clean_uuid}_lod{lod}"
    else:
        target_table = table_name or f"pointcloud_patches_lod{lod}"

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

    await run_pdal_pipeline(
        pipeline=pdal_write_pipeline,
        error_prefix="pgpointcloud ingestion failed"
    )

    found_pcid = None
    if pointcloud_id:
        async with async_session() as session:
            try:
                res = await session.execute(text(f"SELECT PC_PCId(patch) FROM {target_table} LIMIT 1"))
                row = res.first()
                if row and row[0] is not None:
                    found_pcid = int(row[0])

                dest_table = f"pointcloud_patches_lod{lod}"
                await session.execute(text(f"""
                    CREATE TABLE IF NOT EXISTS {dest_table} (
                        id BIGSERIAL PRIMARY KEY,
                        pointcloud_id UUID NOT NULL REFERENCES pointcloud_metadata(id) ON DELETE CASCADE,
                        patch PCPATCH
                    );
                """))
                await session.execute(text(f"""
                    CREATE INDEX IF NOT EXISTS idx_{dest_table}_pc 
                    ON {dest_table} (pointcloud_id);
                """))

                await session.execute(
                    text("""
                        INSERT INTO pointcloud_metadata (id, orig_filename, number_of_points, pcid, created_at, transform_matrix)
                        VALUES (:id, :filename, 0, 1, NOW(), '{1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0}')
                        ON CONFLICT (id) DO NOTHING
                    """),
                    {"id": pointcloud_id, "filename": os.path.basename(file_abs)}
                )

                if overwrite:
                    await session.execute(
                        text(f"DELETE FROM {dest_table} WHERE pointcloud_id = :id"),
                        {"id": pointcloud_id}
                    )

                await session.execute(
                    text(f"""
                        INSERT INTO {dest_table} (pointcloud_id, patch)
                        SELECT :pointcloud_id, patch FROM {target_table}
                    """),
                    {"pointcloud_id": pointcloud_id}
                )

                await session.execute(text(f"DROP TABLE IF EXISTS {target_table}"))
                await session.commit()
            except Exception as transfer_err:
                await session.rollback()
                print(f"[PDAL Ingest] Error transferring patches from {target_table} to {dest_table}: {transfer_err}")
                raise transfer_err

    return found_pcid



