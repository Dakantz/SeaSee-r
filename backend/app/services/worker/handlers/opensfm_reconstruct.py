import os
import shutil
import logging
import asyncio
import uuid
from typing import Dict, Any, Optional

from sqlalchemy import select

from app.core.config import settings
from app.core.database import async_session
from app.models.job import Job
from app.services.worker.handlers.base import BaseTaskHandler

logger = logging.getLogger(__name__)

OPENSFM_DEFAULT_BIN = "/home/tastegger/Documents/SeaSee-r/openSfM/openSfM_core/bin/opensfm_run_all"


class OpenSfMReconstructTaskHandler(BaseTaskHandler):
    """
    Worker task handler for running OpenSfM 3D reconstruction (opensfm_run_all)
    on a dataset directory containing extracted images.
    Targeted to execute inside the dedicated OpenSfM worker container.
    """
    task_types = ["opensfm_reconstruct"]

    async def execute(self, job_id: str, payload: Dict[str, Any], name: str = "", task_type: str = "") -> Dict[str, Any]:
        await self.update_job_status(job_id, "RUNNING", 10.0)

        dataset_dir = payload.get("dataset_dir") or payload.get("folder_path")
        opensfm_bin = payload.get("opensfm_bin", OPENSFM_DEFAULT_BIN)
        opensfm_config = payload.get("opensfm_config") or settings.opensfm_config

        # If dataset_dir is missing, check parent job results in DB
        if not dataset_dir and job_id:
            try:
                job_uuid = uuid.UUID(job_id)
                async with async_session() as session:
                    j_res = await session.execute(select(Job).where(Job.id == job_uuid))
                    job_rec = j_res.scalar_one_or_none()
                    if job_rec and job_rec.depends_on:
                        parent_uuids = [uuid.UUID(d) for d in job_rec.depends_on if isinstance(d, str)]
                        if parent_uuids:
                            p_res = await session.execute(select(Job).where(Job.id.in_(parent_uuids)))
                            parents = p_res.scalars().all()
                            for p in parents:
                                if p.result and isinstance(p.result, dict):
                                    dataset_dir = p.result.get("dataset_dir") or p.result.get("folder_path")
                                    if dataset_dir:
                                        logger.info(f"Retrieved dataset_dir '{dataset_dir}' from parent job {p.id}")
                                        break
            except Exception as lookup_err:
                logger.warning(f"Could not look up parent job result for job {job_id}: {lookup_err}")

        # Fallback to default ingestion directory if still missing
        if not dataset_dir:
            num_frames = payload.get("num_frames", 500)
            dataset_name = payload.get("dataset_name") or f"video_dataset_fixed_{num_frames}_frames_entire_video"
            dataset_dir = os.path.join(settings.opensfm_ingestion_dir, dataset_name)

        if not os.path.exists(dataset_dir):
            err_msg = f"Dataset directory '{dataset_dir}' does not exist for OpenSfM reconstruction."
            logger.error(err_msg)
            await self.update_job_status(job_id, "FAILED", 0.0, error_message=err_msg)
            raise RuntimeError(err_msg)

        images_dir = os.path.join(dataset_dir, "images")
        if not os.path.exists(images_dir) or not os.listdir(images_dir):
            err_msg = f"No images found in '{images_dir}'. Ensure frame extraction completed before running reconstruction."
            logger.error(err_msg)
            await self.update_job_status(job_id, "FAILED", 0.0, error_message=err_msg)
            raise RuntimeError(err_msg)

        await self.update_job_status(job_id, "RUNNING", 25.0)

        # Copy OpenSfM config if present and target missing
        target_config = os.path.join(dataset_dir, "config.yaml")
        if not os.path.exists(target_config) and os.path.exists(opensfm_config):
            shutil.copy(opensfm_config, target_config)

        # Resolve OpenSfM binary path
        bin_candidates = [
            opensfm_bin,
            "/source/OpenSfM/bin/opensfm_run_all",
            shutil.which("opensfm_run_all"),
            "/opt/conda/envs/opensfm/bin/opensfm_run_all",
            "/home/tastegger/Documents/SeaSee-r/openSfM/openSfM_core/bin/opensfm_run_all"
        ]
        resolved_bin = None
        for b in bin_candidates:
            if b and os.path.exists(b) and os.access(b, os.X_OK):
                resolved_bin = b
                break

        if not resolved_bin:
            err_msg = f"No executable OpenSfM binary found among candidates: {bin_candidates}. Ensure task is running on OpenSfM worker container."
            logger.error(err_msg)
            await self.update_job_status(job_id, "FAILED", 0.0, error_message=err_msg)
            raise RuntimeError(err_msg)

        logger.info(f"Executing OpenSfM binary '{resolved_bin}' on dataset: {dataset_dir}")
        await self.update_job_status(job_id, "RUNNING", 40.0)

        proc = await asyncio.create_subprocess_exec(
            resolved_bin,
            dataset_dir,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        stdout, stderr = await proc.communicate()

        if proc.returncode != 0:
            err_msg = f"OpenSfM reconstruction returned error code {proc.returncode}: {stderr.decode()}"
            logger.error(err_msg)
            await self.update_job_status(job_id, "FAILED", 0.0, error_message=err_msg)
            raise RuntimeError(err_msg)

        logger.info(f"OpenSfM reconstruction completed successfully for {dataset_dir}")
        res_data = {
            "status": "success",
            "job_id": job_id,
            "dataset_dir": dataset_dir,
            "message": "OpenSfM reconstruction completed successfully."
        }

        await self.update_job_status(job_id, "COMPLETED", 100.0, result=res_data)
        return res_data
