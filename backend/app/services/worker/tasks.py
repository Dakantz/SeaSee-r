import os
import asyncio
import json
import uuid
from urllib.parse import urlparse
from rq import get_current_job
from sqlalchemy import update, text, select
from app.core.config import settings, StorageType
from app.core.database import async_session
from app.models.job import Job
from app.models.pointcloud import PointCloud

async def _update_job_status(job_id_str: str, status: str, progress: float = 0.0, error_message: str = None):
    async with async_session() as session:
        stmt = update(Job).where(Job.id == job_id_str).values(
            status=status,
            progress=progress,
            error_message=error_message
        )
        await session.execute(stmt)
        await session.commit()

async def _convert_to_ept_async(file_path: str, file_id: str, job_id: str, storage_type: str = None):
    if job_id:
        await _update_job_status(job_id, "RUNNING", 0.0)

    output_dir = os.path.join(settings.ept_dir, file_id)
    os.makedirs(output_dir, exist_ok=True)
    
    try:
        # Run entwine as a subprocess with progress logging
        process = await asyncio.create_subprocess_exec(
            'entwine', 'build', '-i', file_path, '-o', output_dir, '--scale', '0.001', '--progress', '1',
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        
        stdout_bytes = bytearray()
        stderr_bytes = bytearray()
        
        async def read_stdout():
            while True:
                line = await process.stdout.readline()
                if not line:
                    break
                stdout_bytes.extend(line)
                line_str = line.decode('utf-8', errors='replace').strip()
                
                # Parse progress: e.g. "00:01 - 99% - 98,565 ..."
                if "%" in line_str and "-" in line_str:
                    parts = line_str.split('-')
                    if len(parts) >= 2:
                        pct_str = parts[1].strip()
                        if pct_str.endswith('%'):
                            try:
                                progress_val = float(pct_str[:-1].strip())
                                if job_id:
                                    # We don't await directly if we want to avoid blocking the read loop too much, 
                                    # but it's fast enough. 
                                    await _update_job_status(job_id, "RUNNING", progress_val)
                            except ValueError:
                                pass

        async def read_stderr():
            while True:
                chunk = await process.stderr.read(1024)
                if not chunk:
                    break
                stderr_bytes.extend(chunk)

        await asyncio.gather(read_stdout(), read_stderr())
        await process.wait()
        
        if process.returncode != 0:
            error_msg = stderr_bytes.decode('utf-8', errors='replace') if stderr_bytes else f"Error code {process.returncode}"
            print(f"Error converting {file_path} to EPT: {error_msg}")
            if job_id:
                await _update_job_status(job_id, "FAILED", 0.0, error_msg)
            raise RuntimeError(error_msg)
            
        print(f"Successfully converted {file_path} to EPT at {output_dir}")
        
        # Determine the storage type for this job. Fall back to global settings if not provided.
        current_storage_type = storage_type or settings.pointcloud_storage_type.value
        
        if current_storage_type == StorageType.database.value:
            print(f"Ingesting pointcloud {file_id} to database...")
            # 1. Run pdal info --stats to extract bounding box and point count
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
            min_x = bbox.get("minx")
            min_y = bbox.get("miny")
            min_z = bbox.get("minz")
            max_x = bbox.get("maxx")
            max_y = bbox.get("maxy")
            max_z = bbox.get("maxz")
            
            number_of_points = 0
            for dim in stats.get("statistic", []):
                if dim.get("name") == "X":
                    number_of_points = dim.get("count", 0)
                    break
            
            # 2. Parse connection string for PDAL writer (needs libpq connection string)
            db_url = settings.database_url.replace("postgresql+asyncpg://", "postgresql://")
            parsed = urlparse(db_url)
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
            connection_str = " ".join(conn_parts)
            
            # 3. Setup dynamic pgPointcloud table name
            table_uuid = file_id.replace("-", "")
            dynamic_table_name = f"pc_{table_uuid}_lod0"
            
            # 4. Ingest points into postgres pgPointcloud using pdal pipeline
            pdal_write_pipeline = {
                "pipeline": [
                    file_path,
                    {
                        "type": "filters.chipper",
                        "capacity": 400
                    },
                    {
                        "type": "writers.pgpointcloud",
                        "connection": connection_str,
                        "table": dynamic_table_name,
                        "column": "patch",
                        "srid": 4326,
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
                
            # 5. Query the PCID from the database
            pcid = 1
            async with async_session() as session:
                try:
                    result = await session.execute(
                        text(f"SELECT PC_PCId(patch) FROM {dynamic_table_name} LIMIT 1")
                    )
                    row = result.first()
                    if row and row[0] is not None:
                        pcid = int(row[0])
                except Exception as e:
                    print(f"Failed to query pcid(patch) from {dynamic_table_name}: {e}")
                    try:
                        result = await session.execute(
                            text("SELECT pcid FROM pointcloud_formats ORDER BY pcid DESC LIMIT 1")
                        )
                        row = result.first()
                        if row:
                            pcid = int(row[0])
                    except Exception as e2:
                        print(f"Failed to query pointcloud_formats: {e2}")
                        
                # 6. Fetch job record to get original filename
                orig_filename = os.path.basename(file_path)
                safe_filename = os.path.basename(file_path)
                if job_id:
                    stmt_job = select(Job).where(Job.id == job_id)
                    result_job = await session.execute(stmt_job)
                    job_record = result_job.scalar_one_or_none()
                    if job_record and isinstance(job_record.payload, dict):
                        orig_filename = job_record.payload.get("filename", orig_filename)
                        safe_filename = job_record.payload.get("safe_filename", safe_filename)

                # 7. Insert metadata into pointclouds table
                metadata_record = PointCloud(
                    id=uuid.UUID(file_id),
                    job_id=uuid.UUID(job_id) if job_id else None,
                    orig_filename=orig_filename,
                    safe_filename=safe_filename,
                    number_of_points=number_of_points,
                    min_x=min_x,
                    min_y=min_y,
                    min_z=min_z,
                    max_x=max_x,
                    max_y=max_y,
                    max_z=max_z,
                    pcid=pcid
                )
                session.add(metadata_record)
                await session.commit()
            print(f"Successfully ingested pointcloud {file_id} metadata and data to database.")

        if job_id:
            await _update_job_status(job_id, "COMPLETED", 100.0)
        return {"status": "success", "file_id": file_id, "ept_dir": output_dir}
    except Exception as e:
        error_msg = str(e)
        print(f"Exception converting {file_path} to EPT: {error_msg}")
        if job_id:
            await _update_job_status(job_id, "FAILED", 0.0, error_msg)
        raise e

def convert_to_ept(file_path: str, file_id: str, storage_type: str = None):
    """
    Background task to convert a .las/.laz/.ply file to EPT format using entwine.
    """
    current_job = get_current_job()
    job_id = current_job.id if current_job else None

    return asyncio.run(_convert_to_ept_async(file_path, file_id, job_id, storage_type))

def process_opensfm(file_path: str, file_id: str, storage_type: str = None):
    """
    Background task to process an OpenSfM pointcloud output.
    Delegates to _convert_to_ept_async for .ply processing and db insertion.
    """
    current_job = get_current_job()
    job_id = current_job.id if current_job else None

    return asyncio.run(_convert_to_ept_async(file_path, file_id, job_id, storage_type))

