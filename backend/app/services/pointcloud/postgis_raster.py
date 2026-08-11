import os
import asyncio
from typing import Optional
from urllib.parse import urlparse
from sqlalchemy import text
from app.core.config import settings
from app.core.database import async_session


def format_libpq_connection_string(db_url: str) -> str:
    """
    Converts a SQLAlchemy database URL (e.g. postgresql+asyncpg://...) to a libpq connection string
    used by PostGIS / PDAL (e.g. host=... port=... user=... password=... dbname=...).
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



class PostGISRaster:
    """
    Manages PostGIS raster operations and ingestion into bathymetry_raster and overview pyramid tables.
    """
    RASTER_TABLES = [
        "bathymetry_raster",
        "o_2_bathymetry_raster",
        "o_4_bathymetry_raster",
        "o_8_bathymetry_raster",
        "o_16_bathymetry_raster"
    ]
    DEFAULT_TABLE_NAME = RASTER_TABLES[0]

    @classmethod
    async def ingest_pyramids(
        cls,
        geotiff_path: str,
        table_name: str = DEFAULT_TABLE_NAME,
        srid: int = 3857,
        pyramid_levels: str = "2,4,8,16",
        pointcloud_id: Optional[str] = None,
        scale_z: float = 1.0,
        is_append: bool = False
    ) -> None:
        """
        Ingests a GeoTIFF bathymetry raster into PostgreSQL using raster2pgsql with raster pyramids (-l 2,4,8,16).
        Generates overview tables (e.g. o_2_bathymetry_raster, o_4_bathymetry_raster, o_8_bathymetry_raster, o_16_bathymetry_raster)
        for distance-based Level of Detail (LOD) querying. Optionally scales elevation Z values by scale_z.
        """
        geotiff_abs = os.path.abspath(geotiff_path)
        file_name = os.path.basename(geotiff_abs)

        mode_flag = "-c"
        async with async_session() as session:
            
            tables_exist = False
            try:
                res_main = await session.execute(text(f"""
                    SELECT EXISTS (
                        SELECT 1 FROM information_schema.tables 
                        WHERE table_name = '{cls.RASTER_TABLES[0]}'
                    );
                """))
                res_ov = await session.execute(text(f"""
                    SELECT EXISTS (
                        SELECT 1 FROM information_schema.tables 
                        WHERE table_name = '{cls.RASTER_TABLES[1]}'
                    );
                """))
                tables_exist = bool(res_main.scalar() and res_ov.scalar())
            except Exception:
                tables_exist = False

            if is_append and tables_exist:
                mode_flag = "-a"
            else:
                mode_flag = "-c"
                drop_tables_str = ", ".join(cls.RASTER_TABLES)
                await session.execute(text(f"DROP TABLE IF EXISTS {drop_tables_str} CASCADE;"))

            if pointcloud_id:
                await session.execute(
                    text("""
                        INSERT INTO pointclouds (id, orig_filename, number_of_points, pcid, created_at, transform_matrix)
                        VALUES (:id, :filename, 0, 1, NOW(), '{1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0}')
                        ON CONFLICT (id) DO NOTHING
                    """),
                    {"id": pointcloud_id, "filename": file_name}
                )
            await session.commit()

        cmd_args = [
            "raster2pgsql",
            "-s", str(srid),
            "-I", "-C", "-M", "-Y", "-F",
            "-l", pyramid_levels,
            mode_flag,
            geotiff_abs,
            table_name
        ]

        sql_output = None
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd_args,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            stdout, stderr = await proc.communicate()
            if proc.returncode == 0:
                sql_output = stdout.decode('utf-8')
            else:
                print(f"[PostGIS Raster] Native raster2pgsql error output: {stderr.decode('utf-8')}")
        except (FileNotFoundError, Exception) as e:
            print(f"[PostGIS Raster] Native raster2pgsql failed or not found: {e}")

        if not sql_output:
            err_msg = f"raster2pgsql failed to generate SQL for {file_name}. Ensure 'postgis' / 'raster2pgsql' is installed in the worker container environment."
            print(f"[PostGIS Raster] ERROR: {err_msg}")
            raise RuntimeError(err_msg)

        conn_str = format_libpq_connection_string(settings.database_url)
        psql_proc = await asyncio.create_subprocess_exec(
            "psql", conn_str,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        _, psql_err = await psql_proc.communicate(input=sql_output.encode('utf-8'))
        if psql_proc.returncode != 0:
            err_msg = psql_err.decode('utf-8', errors='replace')
            print(f"[PostGIS Raster] psql import error: {err_msg}")
            raise RuntimeError(f"psql raster import failed: {err_msg}")

        print(f"[PostGIS Raster] Successfully ingested raster pyramids for {file_name} into {table_name}")

        async with async_session() as session:
            try:
                await session.execute(text(f"""
                    ALTER TABLE {cls.DEFAULT_TABLE_NAME} 
                    ADD COLUMN IF NOT EXISTS pointcloud_id UUID REFERENCES pointclouds(id) ON DELETE CASCADE;
                """))
            except Exception as col_err:
                print(f"[PostGIS Raster] Warning adding pointcloud_id column: {col_err}")

            if pointcloud_id:
                try:
                    await session.execute(
                        text(f"UPDATE {cls.DEFAULT_TABLE_NAME} SET pointcloud_id = :pc_id WHERE filename = :fname OR pointcloud_id IS NULL"),
                        {"pc_id": pointcloud_id, "fname": file_name}
                    )
                except Exception as e:
                    print(f"[PostGIS Raster] Failed to update pointcloud_id: {e}")

            if scale_z != 1.0:
                for tbl in cls.RASTER_TABLES:
                    try:
                        await session.execute(
                            text(f"UPDATE {tbl} SET rast = ST_MapAlgebra(rast, 1, NULL, '[rast] * :scale') WHERE filename = :fname OR pointcloud_id = :pc_id"),
                            {"scale": scale_z, "fname": file_name, "pc_id": pointcloud_id}
                        )
                    except Exception as e:
                        print(f"[PostGIS Raster] Failed to scale Z by {scale_z} for table {tbl}: {e}")

            await session.commit()


async def ingest_postgis_raster_pyramids(
    geotiff_path: str,
    table_name: str = PostGISRaster.DEFAULT_TABLE_NAME,
    srid: int = 3857,
    pyramid_levels: str = "2,4,8,16",
    pointcloud_id: Optional[str] = None,
    scale_z: float = 1.0,
    is_append: bool = False
) -> None:
    """Helper function wrapping PostGISRaster.ingest_pyramids for backward compatibility."""
    await PostGISRaster.ingest_pyramids(
        geotiff_path=geotiff_path,
        table_name=table_name,
        srid=srid,
        pyramid_levels=pyramid_levels,
        pointcloud_id=pointcloud_id,
        scale_z=scale_z,
        is_append=is_append
    )
