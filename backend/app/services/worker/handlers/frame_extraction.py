import os
import shutil
import glob
import logging
import asyncio
from typing import Dict, Any, List, Optional

from app.core.config import settings
from app.services.worker.handlers.base import BaseTaskHandler

logger = logging.getLogger(__name__)

OPENSFM_DEFAULT_BIN = "/home/tastegger/Documents/SeaSee-r/openSfM/openSfM_core/bin/opensfm_run_all"


class FrameExtractionTaskHandler(BaseTaskHandler):
    """
    Worker task handler for extracting fixed-number image frames from videos using ffmpeg
    and saving output into settings.opensfm_ingestion_dir.
    """
    task_types = ["frame_extraction", "video_frame_extraction"]

    async def _get_video_duration(self, video_path: str) -> float:
        """Returns video duration in seconds using ffprobe or OpenCV fallback."""
        try:
            cmd = [
                "ffprobe",
                "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                video_path
            ]
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            stdout, _ = await proc.communicate()
            if proc.returncode == 0 and stdout:
                try:
                    return float(stdout.decode().strip())
                except ValueError:
                    pass
        except Exception as e:
            logger.warning(f"ffprobe execution failed: {e}")

        try:
            import cv2
            cap = cv2.VideoCapture(video_path)
            fps = cap.get(cv2.CAP_PROP_FPS)
            frame_count = cap.get(cv2.CAP_PROP_FRAME_COUNT)
            cap.release()
            if fps > 0 and frame_count > 0:
                return float(frame_count / fps)
        except Exception as cv_err:
            logger.warning(f"OpenCV duration fallback failed: {cv_err}")

        return 0.0


    async def execute(self, job_id: str, payload: Dict[str, Any], name: str = "", task_type: str = "") -> Dict[str, Any]:
        await self.update_job_status(job_id, "RUNNING", 5.0)

        num_frames = int(payload.get("num_frames", 50))
        video_dir = settings.video_dir
        output_dir = settings.opensfm_ingestion_dir
        opensfm_bin = payload.get("opensfm_bin", OPENSFM_DEFAULT_BIN)
        opensfm_config = payload.get("opensfm_config") or settings.opensfm_config

        if not os.path.exists(video_dir):
            os.makedirs(video_dir, exist_ok=True)
        if not os.path.exists(output_dir):
            os.makedirs(output_dir, exist_ok=True)

        # Collect all video files (.mp4 and .MP4) directly inside settings.video_dir and sort ascending
        video_files: List[str] = []
        for ext in ("*.mp4", "*.MP4"):
            video_files.extend(glob.glob(os.path.join(video_dir, ext)))
        video_files = sorted(list(set(video_files)))

        # Filter by payload video files if provided
        target_files = payload.get("video_files")
        if target_files and isinstance(target_files, list):
            filtered = []
            for vf in video_files:
                if os.path.basename(vf) in target_files:
                    filtered.append(vf)
            if filtered:
                video_files = filtered

        if not video_files:
            err_msg = f"No .mp4 or .MP4 video files found in '{video_dir}'."
            logger.error(err_msg)
            await self.update_job_status(job_id, "FAILED", 0.0, error_message=err_msg)
            raise RuntimeError(err_msg)

        logger.info(f"Job {job_id}: Found {len(video_files)} video files in {video_dir}")
        await self.update_job_status(job_id, "RUNNING", 15.0)

        # Calculate total duration
        total_duration = 0.0
        for vf in video_files:
            dur = await self._get_video_duration(vf)
            total_duration += dur

        if total_duration <= 0.0:
            err_msg = f"Could not determine total duration of videos in '{video_dir}'."
            logger.error(err_msg)
            await self.update_job_status(job_id, "FAILED", 0.0, error_message=err_msg)
            raise RuntimeError(err_msg)

        fps = num_frames / total_duration
        await self.update_job_status(job_id, "RUNNING", 25.0)

        # Target dataset directory inside opensfm_ingestion_dir
        dataset_name = payload.get("dataset_name") or f"video_dataset_fixed_{num_frames}_frames_entire_video"
        dataset_dir = os.path.join(output_dir, dataset_name)
        images_dir = os.path.join(dataset_dir, "images")
        os.makedirs(images_dir, exist_ok=True)

        # Extract frames using ffmpeg
        start_num = 1
        total_extracted = 0

        for idx, vf in enumerate(video_files):
            if total_extracted >= num_frames:
                break

            remaining = num_frames - total_extracted
            cmd = [
                "ffmpeg",
                "-loglevel", "error",
                "-i", vf,
                "-vf", f"fps={fps:.8f}",
                "-vframes", str(remaining),
                "-start_number", str(start_num),
                os.path.join(images_dir, "image_%05d.png")
            ]
            
            logger.info(f"Executing ffmpeg command for {os.path.basename(vf)}")
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            _, stderr = await proc.communicate()

            if proc.returncode != 0:
                logger.warning(f"ffmpeg returned non-zero code {proc.returncode}: {stderr.decode()}")

            # Count total extracted pngs
            png_files = glob.glob(os.path.join(images_dir, "image_*.png"))
            total_extracted = len(png_files)
            start_num = total_extracted + 1

            step_progress = 25.0 + (50.0 * (idx + 1) / len(video_files))
            await self.update_job_status(job_id, "RUNNING", step_progress)

        if total_extracted == 0:
            err_msg = "No images were extracted from video files."
            logger.error(err_msg)
            await self.update_job_status(job_id, "FAILED", 0.0, error_message=err_msg)
            raise RuntimeError(err_msg)

        logger.info(f"Job {job_id}: Total images saved to {images_dir}: {total_extracted}")
        await self.update_job_status(job_id, "RUNNING", 80.0)

        # Copy OpenSfM config if present
        if os.path.exists(opensfm_config):
            target_config = os.path.join(dataset_dir, "config.yaml")
            if not os.path.exists(target_config):
                shutil.copy(opensfm_config, target_config)


        res_data = {
            "status": "success",
            "job_id": job_id,
            "dataset_name": dataset_name,
            "dataset_dir": dataset_dir,
            "images_dir": images_dir,
            "total_extracted": total_extracted,
            "num_frames_requested": num_frames
        }

        await self.update_job_status(job_id, "COMPLETED", 100.0, result=res_data)
        return res_data
