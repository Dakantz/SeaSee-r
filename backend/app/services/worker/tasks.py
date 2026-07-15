import os
import asyncio
from rq import get_current_job
from sqlalchemy import update
from app.core.config import settings
from app.core.database import async_session
from app.models.job import Job

async def _update_job_status(job_id_str: str, status: str, progress: float = 0.0, error_message: str = None):
    async with async_session() as session:
        stmt = update(Job).where(Job.id == job_id_str).values(
            status=status,
            progress=progress,
            error_message=error_message
        )
        await session.execute(stmt)
        await session.commit()

async def _convert_to_ept_async(file_path: str, file_id: str, job_id: str):
    if job_id:
        await _update_job_status(job_id, "RUNNING", 0.0)

    output_dir = os.path.join(settings.ept_dir, file_id)
    os.makedirs(output_dir, exist_ok=True)
    
    try:
        # Run entwine as a subprocess with progress logging
        process = await asyncio.create_subprocess_exec(
            'entwine', 'build', '-i', file_path, '-o', output_dir, '--progress', '1',
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
        if job_id:
            await _update_job_status(job_id, "COMPLETED", 100.0)
        return {"status": "success", "file_id": file_id, "ept_dir": output_dir}
    except Exception as e:
        error_msg = str(e)
        print(f"Exception converting {file_path} to EPT: {error_msg}")
        if job_id:
            await _update_job_status(job_id, "FAILED", 0.0, error_msg)
        raise e

def convert_to_ept(file_path: str, file_id: str):
    """
    Background task to convert a .las/.laz/.ply file to EPT format using entwine.
    """
    current_job = get_current_job()
    job_id = current_job.id if current_job else None

    return asyncio.run(_convert_to_ept_async(file_path, file_id, job_id))
