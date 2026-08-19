import os
import asyncio
import time
from typing import Callable, Awaitable, Optional

async def build_ept(
    file_path: str,
    output_dir: str,
    scale: str = "0.001",
    progress_callback: Optional[Callable[[float], Awaitable[None]]] = None,
    min_progress_delta: float = 1.0,
    min_time_interval: float = 0.5,
    deep: bool = True
) -> None:
    """
    Executes 'entwine build' to convert a point cloud (.las, .laz, .ply, .csv) into EPT format.
    Optionally reports progress percentage via an async callback, throttled by delta % and time.
    """
    os.makedirs(output_dir, exist_ok=True)
    
    cmd = ['entwine', 'build', '-i', file_path, '-o', output_dir, '--scale', scale, '--progress', '1']
    if deep:
        cmd.append('--deep')

    process = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE
    )
    
    stdout_bytes = bytearray()
    stderr_bytes = bytearray()
    
    last_reported_pct = -1.0
    last_reported_time = 0.0

    async def read_stdout():
        nonlocal last_reported_pct, last_reported_time
        while True:
            line = await process.stdout.readline()
            if not line:
                break
            stdout_bytes.extend(line)
            line_str = line.decode('utf-8', errors='replace').strip()
            
            if progress_callback and "%" in line_str and "-" in line_str:
                parts = line_str.split('-')
                if len(parts) >= 2:
                    pct_str = parts[1].strip()
                    if pct_str.endswith('%'):
                        try:
                            progress_val = float(pct_str[:-1].strip())
                            now = time.time()
                            # Throttle updates to avoid flooding DB / status calls
                            if (
                                abs(progress_val - last_reported_pct) >= min_progress_delta
                                or (now - last_reported_time) >= min_time_interval
                                or progress_val >= 100.0
                            ):
                                last_reported_pct = progress_val
                                last_reported_time = now
                                await progress_callback(progress_val)
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
        err_text = stderr_bytes.decode('utf-8', errors='replace').strip() or stdout_bytes.decode('utf-8', errors='replace').strip()
        if err_text:
            error_msg = f"Entwine build failed: {err_text}"
        else:
            error_msg = f"Entwine point cloud conversion failed for file '{os.path.basename(file_path)}' with exit code {process.returncode}."
        raise RuntimeError(error_msg)
