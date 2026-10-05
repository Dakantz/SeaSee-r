#!/usr/bin/env python3
"""
End-to-End Pipeline Ingestion Script for Video, ROV Telemetry, and OpenSfM 3D Point Clouds.

Usage:
  python scratch/ingest_video.py [options] [video_path]

Examples:
  python scratch/ingest_video.py --clean
  python scratch/ingest_video.py /app/public/test_data/20260505_121047_180_N001.MP4
  python scratch/ingest_video.py --opensfm-folder video_1 --log /app/public/test_data/ROV-Log-2026-05-02-2026-05-05-0505205315.json
"""

import argparse
import asyncio
import os
import shutil
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, List

# Ensure backend root is on sys.path for app module imports
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from redis import Redis
from rq import Queue
from sqlalchemy import select, update, text

from app.core.config import settings
from app.core.database import async_session
from app.models.camera import CameraFrame, CameraHeader
from app.models.job import Job
from app.models.log_data import LogData
from app.models.pointcloud import PointCloudMetadata
from app.models.video import UploadMetadata, Video, VideoStatus
from app.services.worker.handlers.opensfm import _find_opensfm_pointcloud


TEST_DATA_SEARCH_DIRS = [
    "/app/public/test_data",
    "/app/test_data",
    "public/test_data",
    "test_data",
    "../seaseer-dashboard/public/test_data",
    "seaseer-dashboard/public/test_data",
]


def _find_file_in_dirs(directories: List[str], extensions: list) -> Optional[str]:
    """Find the first matching file across a list of directories by extension."""
    for directory in directories:
        if not os.path.exists(directory):
            continue
        for entry in os.listdir(directory):
            full_path = os.path.join(directory, entry)
            if os.path.isfile(full_path):
                if any(entry.lower().endswith(ext.lower()) for ext in extensions):
                    return full_path
    return None


def _find_folder_in_dirs(directories: List[str], folder_name: str) -> Optional[str]:
    """Find a folder across a list of search roots."""
    for root in directories:
        if not os.path.exists(root):
            continue
        # Check root/folder_name and root/datasets/folder_name
        candidates = [
            os.path.join(root, folder_name),
            os.path.join(root, "datasets", folder_name),
            os.path.join(root, "opensfm_ingestion", folder_name),
        ]
        for c in candidates:
            if os.path.exists(c) and os.path.isdir(c):
                return c
    return None


async def run_pipeline(
    video_input_path: Optional[str] = None,
    log_input_path: Optional[str] = None,
    opensfm_folder_name: str = "video_1",
    clean: bool = False,
    wait: bool = True,
    poll_interval: float = 2.0,
    timeout: float = 600.0,
):
    print("=" * 70)
    print("🚀 SeaSee-r Full Ingestion Pipeline")
    print("=" * 70)

    # ---------------------------------------------------------
    # 0. Clean database & data folders if requested
    # ---------------------------------------------------------
    if clean:
        print("🧹 Cleaning existing dataset records from database...")
        async with async_session() as session:
            await session.execute(text("TRUNCATE TABLE camera_frames CASCADE;"))
            await session.execute(text("TRUNCATE TABLE camera_headers CASCADE;"))
            await session.execute(text("TRUNCATE TABLE log_data CASCADE;"))
            await session.execute(text("TRUNCATE TABLE video_metadata CASCADE;"))
            await session.execute(text("TRUNCATE TABLE pointcloud_metadata CASCADE;"))
            await session.execute(text("TRUNCATE TABLE upload_metadata CASCADE;"))
            await session.execute(text("TRUNCATE TABLE jobs CASCADE;"))
            await session.commit()
        if os.path.exists(settings.ept_dir):
            for item in os.listdir(settings.ept_dir):
                item_path = os.path.join(settings.ept_dir, item)
                if os.path.isdir(item_path):
                    shutil.rmtree(item_path, ignore_errors=True)
        print("✅ Database and EPT directory scrubbed cleanly.\n")

    # ---------------------------------------------------------
    # 1. Video File Resolution & Copy to settings.video_dir
    # ---------------------------------------------------------
    os.makedirs(settings.video_dir, exist_ok=True)
    os.makedirs(settings.metadata_dir, exist_ok=True)
    os.makedirs(settings.opensfm_ingestion_dir, exist_ok=True)

    src_video = None
    if video_input_path:
        if os.path.exists(video_input_path):
            src_video = os.path.abspath(video_input_path)
        else:
            # Check relative to test data dirs
            for t_dir in TEST_DATA_SEARCH_DIRS:
                cand = os.path.join(t_dir, video_input_path)
                if os.path.exists(cand):
                    src_video = os.path.abspath(cand)
                    break
            if not src_video:
                print(f"❌ Error: Video file '{video_input_path}' does not exist.")
                sys.exit(1)
    else:
        # Search video_dir first, then test_data search dirs
        src_video = _find_file_in_dirs([settings.video_dir] + TEST_DATA_SEARCH_DIRS, [".mp4", ".MP4", ".mov", ".MOV", ".avi"])
        if not src_video:
            print(f"❌ Error: No video file found. Please specify a video path.")
            sys.exit(1)

    video_filename = os.path.basename(src_video)
    dest_video = os.path.join(settings.video_dir, video_filename)

    if os.path.abspath(src_video) != os.path.abspath(dest_video):
        print(f"📦 Copying video to destination: {dest_video}")
        shutil.copy2(src_video, dest_video)

    video_size = os.path.getsize(dest_video)
    print(f"📹 Video: {video_filename} ({video_size / (1024*1024):.2f} MB)")
    print(f"   Path:  {dest_video}")

    # ---------------------------------------------------------
    # 2. ROV Metadata Log Resolution & Copy to settings.metadata_dir
    # ---------------------------------------------------------
    src_log = None
    if log_input_path:
        if os.path.exists(log_input_path):
            src_log = os.path.abspath(log_input_path)
        else:
            for t_dir in TEST_DATA_SEARCH_DIRS:
                cand = os.path.join(t_dir, log_input_path)
                if os.path.exists(cand):
                    src_log = os.path.abspath(cand)
                    break
            if not src_log:
                print(f"❌ Error: Log file '{log_input_path}' does not exist.")
                sys.exit(1)
    else:
        src_log = _find_file_in_dirs([settings.metadata_dir] + TEST_DATA_SEARCH_DIRS, [".json"])

    dest_log = None
    log_filename = None
    if src_log:
        log_filename = os.path.basename(src_log)
        dest_log = os.path.join(settings.metadata_dir, log_filename)
        if os.path.abspath(src_log) != os.path.abspath(dest_log):
            print(f"📦 Copying ROV log to destination: {dest_log}")
            shutil.copy2(src_log, dest_log)

        log_size = os.path.getsize(dest_log)
        print(f"📊 Telemetry Log: {log_filename} ({log_size / (1024*1024):.2f} MB)")
        print(f"   Path:          {dest_log}")
    else:
        print(f"⚠️ Warning: No ROV log JSON found. Telemetry ingestion will be skipped.")

    # ---------------------------------------------------------
    # 3. OpenSfM Dataset Resolution
    # ---------------------------------------------------------
    opensfm_dest_folder = os.path.join(settings.opensfm_ingestion_dir, opensfm_folder_name)
    
    if not os.path.exists(opensfm_dest_folder) or not _find_opensfm_pointcloud(opensfm_dest_folder):
        # Look in test_data search directories
        found_sfm = _find_folder_in_dirs(TEST_DATA_SEARCH_DIRS, opensfm_folder_name)
        if found_sfm and os.path.exists(found_sfm):
            print(f"📦 Copying OpenSfM dataset from {found_sfm} to {opensfm_dest_folder}...")
            shutil.copytree(found_sfm, opensfm_dest_folder, dirs_exist_ok=True)
        elif os.path.exists(opensfm_folder_name) and os.path.isdir(opensfm_folder_name):
            print(f"📦 Copying OpenSfM dataset from {opensfm_folder_name} to {opensfm_dest_folder}...")
            shutil.copytree(opensfm_folder_name, opensfm_dest_folder, dirs_exist_ok=True)

    folder_path = opensfm_dest_folder
    pc_file_path = _find_opensfm_pointcloud(folder_path)
    if not pc_file_path:
        print(f"❌ Error: No point cloud file (.laz, .ply) found in {folder_path}")
        sys.exit(1)

    pc_size = os.path.getsize(pc_file_path)
    print(f"☁️  OpenSfM Dataset: {opensfm_folder_name}")
    print(f"   Point Cloud:     {os.path.basename(pc_file_path)} ({pc_size / (1024*1024):.2f} MB)")

    # ---------------------------------------------------------
    # 4. Create Video, Upload Metadata, and Job Records in DB
    # ---------------------------------------------------------
    batch_id = uuid.uuid4()
    video_upload_id = uuid.uuid4()
    meta_upload_id = uuid.uuid4()
    video_id = uuid.uuid4()
    video_job_id = uuid.uuid4()
    pc_job_id = uuid.uuid4()
    pc_file_id = str(uuid.uuid4())

    async with async_session() as session:
        # Video upload metadata
        video_upload_meta = UploadMetadata(
            id=video_upload_id,
            batch_id=batch_id,
            orig_filename=video_filename,
            safe_filename=video_filename,
            content_type="video/mp4",
            status=VideoStatus.COMPLETED,
        )
        session.add(video_upload_meta)

        # Log upload metadata (if available)
        if dest_log and log_filename:
            log_upload_meta = UploadMetadata(
                id=meta_upload_id,
                batch_id=batch_id,
                orig_filename=log_filename,
                safe_filename=log_filename,
                content_type="application/json",
                status=VideoStatus.COMPLETED,
            )
            session.add(log_upload_meta)

        # Video metadata record
        video_rec = Video(
            id=video_id,
            upload_metadata_id=video_upload_id,
            content_type="video/mp4",
            total_bytes=video_size,
            video_start_at=datetime(2026, 5, 5, 12, 10, 47, tzinfo=timezone.utc),
            video_stop_at=datetime(2026, 5, 5, 12, 13, 47, tzinfo=timezone.utc),
        )
        session.add(video_rec)

        # Video Processing Job
        video_job = Job(
            id=video_job_id,
            name=f"Process Video {video_filename}",
            task_type="video_upload",
            payload={
                "file_id": str(video_id),
                "batch_id": str(batch_id),
                "log_file_path": dest_log,
                "video_path": dest_video,
            },
            status="PENDING",
            progress=0.0,
        )
        session.add(video_job)

        # OpenSfM Point Cloud Job
        pc_job = Job(
            id=pc_job_id,
            name=f"Ingest OpenSfM {opensfm_folder_name}",
            task_type="opensfm_ingest",
            payload={
                "filename": opensfm_folder_name,
                "safe_filename": f"{pc_file_id}.laz",
                "total_bytes": pc_size,
                "file_id": pc_file_id,
                "folder_path": folder_path,
                "file_path": pc_file_path,
                "offset_x": 0.0,
                "offset_y": 0.0,
                "grid_x": 0,
                "grid_y": 0,
            },
            status="PENDING",
            progress=0.0,
        )
        session.add(pc_job)
        await session.commit()

    print("\n✅ Database records initialized.")
    print(f"   Video ID:        {video_id}")
    print(f"   Point Cloud ID:  {pc_file_id}")
    print(f"   Video Job ID:    {video_job_id}")
    print(f"   SfM Job ID:      {pc_job_id}")

    # ---------------------------------------------------------
    # 5. Enqueue Jobs to Redis RQ
    # ---------------------------------------------------------
    redis_conn = Redis.from_url(settings.redis_url)
    q_jobs = Queue("job_tasks", connection=redis_conn)
    q_pc = Queue("pointcloud_tasks", connection=redis_conn)

    q_jobs.enqueue("app.services.worker.tasks.run_background_job", str(video_job_id), job_id=str(video_job_id))
    q_pc.enqueue("app.services.worker.tasks.run_background_job", str(pc_job_id), job_id=str(pc_job_id))

    print("\n🔄 Tasks enqueued to worker queues ('job_tasks', 'pointcloud_tasks').")

    if not wait:
        print("\n🚀 Pipeline started asynchronously. Exiting (--no-wait).")
        return

    # ---------------------------------------------------------
    # 6. Monitor Execution
    # ---------------------------------------------------------
    print("\n⏳ Processing pipeline (converting EPT, computing LOD pyramids, extracting camera trajectory)...")
    start_time = time.time()
    v_status, pc_status = "PENDING", "PENDING"

    while time.time() - start_time < timeout:
        async with async_session() as session:
            v_res = await session.execute(select(Job).where(Job.id == video_job_id))
            v_job = v_res.scalar_one_or_none()
            v_status = v_job.status.value if (v_job and hasattr(v_job.status, "value")) else (str(v_job.status) if v_job else "UNKNOWN")
            v_prog = v_job.progress if v_job else 0.0

            pc_res = await session.execute(select(Job).where(Job.id == pc_job_id))
            pc_job_rec = pc_res.scalar_one_or_none()
            pc_status = pc_job_rec.status.value if (pc_job_rec and hasattr(pc_job_rec.status, "value")) else (str(pc_job_rec.status) if pc_job_rec else "UNKNOWN")
            pc_prog = pc_job_rec.progress if pc_job_rec else 0.0

        elapsed = time.time() - start_time
        print(f"\r⏱️  [{elapsed:4.1f}s] Video Job: {v_status} ({v_prog:.0f}%) | SfM Job: {pc_status} ({pc_prog:.0f}%)", end="", flush=True)

        if v_status in ["COMPLETED", "FAILED"] and pc_status in ["COMPLETED", "FAILED"]:
            break

        time.sleep(poll_interval)

    print("\n")
    if v_status != "COMPLETED" or pc_status != "COMPLETED":
        print(f"❌ Error: Pipeline completed with errors: Video={v_status}, PointCloud={pc_status}")
        sys.exit(1)

    # ---------------------------------------------------------
    # 7. Post-Processing: Link Point Cloud to Video in DB
    # ---------------------------------------------------------
    async with async_session() as session:
        await session.execute(
            update(PointCloudMetadata)
            .where(PointCloudMetadata.id == uuid.UUID(pc_file_id))
            .values(video_metadata_id=video_id)
        )
        await session.commit()

        # Query summary stats
        pc_row = (await session.execute(select(PointCloudMetadata).where(PointCloudMetadata.id == uuid.UUID(pc_file_id)))).scalar_one_or_none()
        log_count = (await session.execute(select(LogData).where(LogData.video_metadata_id == video_id))).scalars().all()
        header_row = (await session.execute(select(CameraHeader).where(CameraHeader.pointcloud_id == uuid.UUID(pc_file_id)))).scalar_one_or_none()
        frames_count = 0
        if header_row:
            frames = (await session.execute(select(CameraFrame).where(CameraFrame.camera_header_id == header_row.id))).scalars().all()
            frames_count = len(frames)

    # ---------------------------------------------------------
    # 8. Final Report
    # ---------------------------------------------------------
    print("=" * 70)
    print("🎉 Pipeline Execution Complete!")
    print("=" * 70)
    print(f"📹 Video ID:            {video_id}")
    print(f"   Stream URL:          http://localhost:8000/videos/{video_id}/stream")
    print(f"   Download URL:        http://localhost:8000/videos/{video_id}/file")
    print(f"📊 Telemetry Logs:      {len(log_count)} records ingested")
    print(f"☁️  Point Cloud ID:      {pc_file_id}")
    if pc_row:
        print(f"   Total Points:        {pc_row.number_of_points:,}")
        print(f"   Bounding Box X:      [{pc_row.min_x:.2f}, {pc_row.max_x:.2f}]")
        print(f"   Bounding Box Y:      [{pc_row.min_y:.2f}, {pc_row.max_y:.2f}]")
        print(f"   Bounding Box Z:      [{pc_row.min_z:.2f}, {pc_row.max_z:.2f}]")
    print(f"📸 Camera Trajectory:   {frames_count} frames (continuous Euclidean poses)")
    print("=" * 70)


def cli():
    parser = argparse.ArgumentParser(description="Ingest video, telemetry logs, and OpenSfM point clouds into SeaSee-r.")
    parser.add_argument("video_path", nargs="?", default=None, help="Path to MP4 video file")
    parser.add_argument("--video", dest="video_opt", default=None, help="Path to MP4 video file")
    parser.add_argument("--log", "--metadata", dest="log_path", default=None, help="Path to ROV log JSON")
    parser.add_argument("--opensfm-folder", dest="opensfm_folder", default="video_1", help="OpenSfM folder name (default: video_1)")
    parser.add_argument("--clean", dest="clean", action="store_true", help="Scrub existing database and EPT data before running")
    parser.add_argument("--no-wait", dest="no_wait", action="store_true", help="Do not wait for background tasks to finish")
    args = parser.parse_args()

    v_path = args.video_opt or args.video_path
    asyncio.run(
        run_pipeline(
            video_input_path=v_path,
            log_input_path=args.log_path,
            opensfm_folder_name=args.opensfm_folder,
            clean=args.clean,
            wait=not args.no_wait,
        )
    )


if __name__ == "__main__":
    cli()
