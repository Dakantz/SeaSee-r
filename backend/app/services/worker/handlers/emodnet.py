import os
import logging
from typing import Dict, Any, Optional
from app.core.config import settings
from app.core.database import async_session
from app.services.worker.handlers.base import BaseTaskHandler
from app.services.pointcloud.pdal import (
    get_pointcloud_srs_and_stats,
    get_pointcloud_dimensions,
    build_ept_pdal_docker,
    process_emodnet_csv,
    format_libpq_connection_string,
    ingest_pgpointcloud
)
from app.services.pointcloud.postgis_raster import PostGISRaster
from app.services.pointcloud.db_utils import (
    query_existing_pcid,
    query_target_dimensions_for_pcid,
    upsert_pointcloud_metadata
)

logger = logging.getLogger(__name__)

class EMODnetGeoTIFFTaskHandler(BaseTaskHandler):
    task_types = ["emodnet_ingest", "emodnet_append"]

    async def process_emodnet_geotiff(
        self,
        geotiff_path: str,
        file_id: str,
        job_id: Optional[str] = None,
        is_append: bool = False
    ) -> Dict[str, Any]:
        """
        Pipeline to process EMODnet GeoTIFF bathymetry rasters:
        1. Converts GeoTIFF to EPSG:3857 EPT format using PDAL Docker pipeline.
        2. Extracts bounding box & point count via PDAL stats.
        3. Ingests points into pgPointcloud table.
        4. Writes or updates metadata record in pointcloud_metadata table.
        """
        if job_id:
            await self.update_job_status(job_id, "RUNNING", 10.0)

        output_dir = os.path.join(settings.ept_dir, file_id)

        try:
            # 1. Build EPT from GeoTIFF in EPSG:3857 using PDAL Docker container
            await build_ept_pdal_docker(
                geotiff_path=geotiff_path,
                output_dir=output_dir,
                out_srs="EPSG:3857"
            )
            logger.info(f"Successfully converted EMODnet GeoTIFF {geotiff_path} to EPT at {output_dir}")

            if job_id:
                await self.update_job_status(job_id, "RUNNING", 60.0)

            # 2. Extract stats (bbox & number of points)
            bbox, number_of_points, _ = await get_pointcloud_srs_and_stats(geotiff_path)

            pcid = None
            target_dims = None
            connection_str = format_libpq_connection_string(settings.database_url)

            if is_append:
                async with async_session() as session:
                    pcid = await query_existing_pcid(session, file_id)
                    if pcid:
                        target_dims = await query_target_dimensions_for_pcid(session, pcid)

            source_dims = await get_pointcloud_dimensions(geotiff_path)
            logger.info(f"Source file dimensions: {source_dims}")

            await PostGISRaster.ingest_pyramids(
                geotiff_path=geotiff_path,
                table_name=PostGISRaster.DEFAULT_TABLE_NAME,
                srid=3857,
                pyramid_levels="2,4,8,16",
                pointcloud_id=file_id,
                scale_z=100.0
            )
            pcid = 1

            # 3. Create or update PointCloud metadata record in DB
            async with async_session() as session:
                await upsert_pointcloud_metadata(
                    session=session,
                    file_id=file_id,
                    file_path=geotiff_path,
                    bbox=bbox,
                    number_of_points=number_of_points,
                    pcid=pcid,
                    job_id=job_id,
                    is_append=is_append
                )

            if job_id:
                await self.update_job_status(job_id, "COMPLETED", 100.0)

            return {"status": "success", "file_id": file_id, "ept_dir": output_dir}

        except Exception as e:
            error_msg = str(e)
            logger.error(f"Exception processing EMODnet GeoTIFF {geotiff_path}: {error_msg}")
            if job_id:
                await self.update_job_status(job_id, "FAILED", 0.0, error_msg)
            raise e

    async def execute(self, job_id: str, payload: Dict[str, Any], name: str = "", task_type: str = "") -> Dict[str, Any]:
        geotiff_path = payload.get("geotiff_path")
        is_append = payload.get("is_append", False) or (task_type == "emodnet_append")
        file_id = (payload.get("existing_id") or payload.get("file_id")) if is_append else (payload.get("file_id") or job_id)

        if not geotiff_path or not os.path.exists(geotiff_path):
            error_msg = f"GeoTIFF file not found for job {job_id}: {geotiff_path}"
            await self.update_job_status(job_id, "FAILED", 0.0, error_msg)
            return {"status": "error", "message": error_msg}

        return await self.process_emodnet_geotiff(
            geotiff_path=geotiff_path,
            file_id=file_id,
            job_id=job_id,
            is_append=is_append
        )


class EMODnetCSVTaskHandler(BaseTaskHandler):
    task_types = ["emodnet_csv_ingest", "emodnet_csv_process"]

    async def execute(self, job_id: str, payload: Dict[str, Any], name: str = "", task_type: str = "") -> Dict[str, Any]:
        file_path = payload.get("file_path")
        file_id = payload.get("file_id") or job_id
        output_dir = os.path.join(settings.ept_dir, file_id)

        if not file_path or not os.path.exists(file_path):
            error_msg = f"EMODnet CSV file not found for job {job_id}: {file_path}"
            await self.update_job_status(job_id, "FAILED", 0.0, error_msg)
            return {"status": "error", "message": error_msg}

        try:
            await self.update_job_status(job_id, "RUNNING", 10.0)

            is_append = payload.get("is_append", False) or (task_type == "emodnet_csv_append")

            # Process EMODnet CSV using PDAL pipeline (reproject to EPSG:3857), ingest into pgPointcloud DB, & build EPT
            bbox, number_of_points, pcid = await process_emodnet_csv(
                csv_path=file_path,
                output_dir=output_dir,
                out_srs="EPSG:3857",
                file_id=file_id,
                is_append=is_append
            )
            logger.info(f"Successfully processed EMODnet CSV {file_path} to EPT at {output_dir} (points: {number_of_points})")

            await self.update_job_status(job_id, "RUNNING", 80.0)

            # Store or update pointcloud metadata record in PostgreSQL pointclouds table
            async with async_session() as session:
                await upsert_pointcloud_metadata(
                    session=session,
                    file_id=file_id,
                    file_path=file_path,
                    bbox=bbox,
                    number_of_points=number_of_points,
                    pcid=pcid or 0,
                    job_id=job_id,
                    override_filename=payload.get("filename"),
                    override_safe_filename=payload.get("safe_filename")
                )

            res_data = {
                "status": "success",
                "file_id": file_id,
                "number_of_points": number_of_points,
                "ept_dir": output_dir,
                "ept_url": f"/ept/{file_id}/ept.json"
            }
            await self.update_job_status(job_id, "COMPLETED", 100.0, result=res_data)
            return res_data

        except Exception as e:
            error_msg = str(e)
            logger.error(f"Exception processing EMODnet CSV {file_path}: {error_msg}")
            await self.update_job_status(job_id, "FAILED", 0.0, error_msg)
            raise e
