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

try:
    import opensfm
    import opensfm.dataset
    import opensfm.actions.extract_metadata
    import opensfm.actions.detect_features
    import opensfm.actions.match_features
    import opensfm.actions.create_tracks
    import opensfm.actions.reconstruct
    import opensfm.actions.mesh
    import opensfm.actions.undistort
    import opensfm.actions.dense_clustering
    import opensfm.actions.compute_depthmaps
    import opensfm.actions.fuse_depthmaps
    import opensfm.actions.dense_merging
    import opensfm.actions.compute_statistics
    import opensfm.actions.export_report
    from opensfm import actions, reconstruction
    from opensfm.dataset import DataSet
    HAS_OPENSFM = True
except ImportError:
    HAS_OPENSFM = False


class OpenSfMReconstructTaskHandler(BaseTaskHandler):
    """
    Worker task handler for running OpenSfM 3D reconstruction
    directly via Python API on a dataset directory containing extracted images.
    Targeted to execute inside the dedicated OpenSfM worker container.
    """
    task_types = ["opensfm_reconstruct"]

    def _run_opensfm_pipeline(self, dataset_dir: str, loop: asyncio.AbstractEventLoop, job_id: str) -> None:
        """
        Executes all OpenSfM pipeline steps sequentially via Python API.
        Progress updates are dispatched back to the main event loop.
        """
        dataset = DataSet(dataset_dir)

        def update_progress(pct: float, step_name: str) -> None:
            logger.info(f"OpenSfM step: {step_name} ({pct}%)")
            asyncio.run_coroutine_threadsafe(
                self.update_job_status(job_id, "RUNNING", pct),
                loop
            )

        # 1. Extraction, Detection, Matching, Tracks
        update_progress(30.0, "extract_metadata")
        actions.extract_metadata.run_dataset(dataset)

        update_progress(35.0, "detect_features")
        actions.detect_features.run_dataset(dataset)

        update_progress(40.0, "match_features")
        actions.match_features.run_dataset(dataset)

        update_progress(45.0, "create_tracks")
        actions.create_tracks.run_dataset(dataset)

        # 2. Incremental SfM Reconstruction & Mesh
        update_progress(50.0, "reconstruct")
        actions.reconstruct.run_dataset(dataset, algorithm=reconstruction.ReconstructionAlgorithm.INCREMENTAL)

        update_progress(65.0, "mesh")
        actions.mesh.run_dataset(dataset)

        # 3. Dense reconstruction for primary reconstruction component (index 0)
        update_progress(70.0, "undistort (component 0)")
        actions.undistort.run_dataset(dataset, reconstruction_index=0, output="undistorted")

        update_progress(75.0, "dense_clustering (component 0)")
        actions.dense_clustering.run_dataset(dataset, subfolder="undistorted")

        update_progress(80.0, "compute_depthmaps (component 0)")
        actions.compute_depthmaps.run_dataset(dataset, subfolder="undistorted", interactive=False)

        update_progress(85.0, "fuse_depthmaps (component 0)")
        actions.fuse_depthmaps.run_dataset(dataset, subfolder="undistorted")

        update_progress(88.0, "dense_merging (component 0)")
        actions.dense_merging.run_dataset(dataset, subfolder="undistorted")

        # Process additional reconstruction components if present
        if dataset.reconstruction_exists():
            reconstructions = dataset.load_reconstruction()
            num_recs = len(reconstructions)
            if num_recs > 1:
                logger.info(f"OpenSfM found {num_recs} reconstruction component(s).")
            for i in range(1, num_recs):
                subfolder = f"undistorted_{i}"
                logger.info(f"Processing Reconstruction Component {i} -> Folder: {subfolder}")
                actions.undistort.run_dataset(dataset, reconstruction_index=i, output=subfolder)
                actions.dense_clustering.run_dataset(dataset, subfolder=subfolder)
                actions.compute_depthmaps.run_dataset(dataset, subfolder=subfolder, interactive=False)
                actions.fuse_depthmaps.run_dataset(dataset, subfolder=subfolder)
                actions.dense_merging.run_dataset(dataset, subfolder=subfolder)

        # 4. Statistics and Report
        update_progress(92.0, "compute_statistics")
        actions.compute_statistics.run_dataset(dataset)

        update_progress(96.0, "export_report")
        actions.export_report.run_dataset(dataset)

    async def execute(self, job_id: str, payload: Dict[str, Any], name: str = "", task_type: str = "") -> Dict[str, Any]:
        await self.update_job_status(job_id, "RUNNING", 10.0)

        dataset_dir = payload.get("dataset_dir") or payload.get("folder_path")
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

        if not HAS_OPENSFM:
            err_msg = "OpenSfM Python library is not available in current Python environment. Ensure task is running inside OpenSfM worker container."
            logger.error(err_msg)
            await self.update_job_status(job_id, "FAILED", 0.0, error_message=err_msg)
            raise RuntimeError(err_msg)

        logger.info(f"Executing OpenSfM reconstruction via Python API on dataset: {dataset_dir}")
        loop = asyncio.get_running_loop()

        try:
            await asyncio.to_thread(self._run_opensfm_pipeline, dataset_dir, loop, job_id)
        except Exception as proc_err:
            err_msg = f"OpenSfM reconstruction failed: {proc_err}"
            logger.error(err_msg, exc_info=True)
            await self.update_job_status(job_id, "FAILED", 0.0, error_message=err_msg)
            raise RuntimeError(err_msg) from proc_err

        logger.info(f"OpenSfM reconstruction completed successfully for {dataset_dir}")
        res_data = {
            "status": "success",
            "job_id": job_id,
            "dataset_dir": dataset_dir,
            "message": "OpenSfM reconstruction completed successfully."
        }

        await self.update_job_status(job_id, "COMPLETED", 100.0, result=res_data)
        return res_data

