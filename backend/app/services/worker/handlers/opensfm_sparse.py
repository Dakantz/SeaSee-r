import os
import shutil
import logging
import asyncio
import uuid
import json
from pathlib import Path
from typing import Dict, Any, Optional

from sqlalchemy import select

from app.core.config import settings
from app.core.database import async_session
from app.models.job import Job, JobStatus
from app.services.worker.handlers.base import BaseTaskHandler
from app.services.worker.handlers.opensfm_health import check_opensfm_gpu_health

logger = logging.getLogger(__name__)


def get_reconstruction_views_count(rec: Any) -> int:
    """Returns the number of views/shots in an OpenSfM reconstruction."""
    if isinstance(rec, dict):
        shots = rec.get("shots", {})
    elif hasattr(rec, "shots"):
        shots = rec.shots
    else:
        shots = {}
    return len(shots) if shots else 0


def resolve_opensfm_config_path(config_path: str) -> Optional[str]:
    if not config_path:
        return None
    p = Path(config_path)
    if p.is_absolute() and p.exists():
        return str(p)
    if p.exists():
        return str(p.resolve())

    current_file = Path(__file__).resolve()
    backend_dir = current_file.parents[4]
    project_root = current_file.parents[5]

    candidates = [
        project_root / config_path,
        backend_dir / config_path,
    ]
    if config_path.startswith("backend/"):
        rel_no_backend = config_path[len("backend/"):]
        candidates.extend([
            backend_dir / rel_no_backend,
            project_root / rel_no_backend,
        ])

    for cand in candidates:
        if cand.exists():
            return str(cand.resolve())

    return None


try:
    import opensfm
    import opensfm.dataset
    import opensfm.actions.extract_metadata
    import opensfm.actions.detect_features
    import opensfm.actions.match_features
    import opensfm.actions.create_tracks
    import opensfm.actions.reconstruct
    import opensfm.actions.mesh
    from opensfm import actions, reconstruction
    from opensfm.dataset import DataSet
    HAS_OPENSFM = True
except ImportError:
    DataSet = None
    actions = None
    reconstruction = None
    HAS_OPENSFM = False


class OpenSfMSparseTaskHandler(BaseTaskHandler):
    """
    Worker task handler for running OpenSfM 3D sparse reconstruction & mesh generation
    (Extraction, Detection, Matching, Tracks, Incremental SfM Reconstruction & Mesh)
    directly via Python API on a dataset directory containing extracted images.
    Targeted to execute inside the dedicated OpenSfM worker container.
    """
    task_types = ["opensfm_sparse"]

    def _run_opensfm_sparse_pipeline(
        self,
        dataset_dir: str,
        loop: asyncio.AbstractEventLoop,
        job_id: str,
        compute_mesh: Optional[bool] = None,
    ) -> None:
        """
        Executes OpenSfM sparse pipeline steps (extract_metadata, detect_features, match_features, create_tracks, reconstruct, and optionally mesh).
        Progress updates are dispatched back to the main event loop.
        """
        if compute_mesh is None:
            compute_mesh = settings.opensfm_compute_mesh
        dataset = DataSet(dataset_dir)

        def update_progress(pct: float, step_name: str) -> None:
            logger.info(f"OpenSfM Sparse step: {step_name} ({pct}%)")
            fut = asyncio.run_coroutine_threadsafe(
                self.update_job_status(job_id, "RUNNING", pct),
                loop
            )
            try:
                is_active = fut.result()
                if is_active is False:
                    logger.info(f"Job {job_id} was cancelled. Stopping OpenSfM sparse reconstruction immediately.")
                    raise RuntimeError(f"Job {job_id} was cancelled by user.")
            except RuntimeError:
                raise
            except Exception as fut_err:
                logger.warning(f"Failed to check progress status for job {job_id}: {fut_err}")

        # 1. Extraction, Detection, Matching, Tracks
        update_progress(30.0, "extract_metadata")
        actions.extract_metadata.run_dataset(dataset)

        update_progress(45.0, "detect_features")
        actions.detect_features.run_dataset(dataset)

        update_progress(60.0, "match_features")
        actions.match_features.run_dataset(dataset)

        update_progress(75.0, "create_tracks")
        actions.create_tracks.run_dataset(dataset)

        # 2. Incremental SfM Reconstruction & Mesh
        update_progress(85.0, "reconstruct")
        actions.reconstruct.run_dataset(dataset, algorithm=reconstruction.ReconstructionAlgorithm.INCREMENTAL)

        if compute_mesh:
            update_progress(95.0, "mesh")
            actions.mesh.run_dataset(dataset)
        else:
            logger.info(f"Skipping mesh computation (compute_mesh={compute_mesh}).")

    async def _create_dynamic_component_jobs(self, dataset_dir: str, job_id: str, payload: Dict[str, Any]) -> None:
        """
        Evaluates OpenSfM reconstruction components and determines whether dense reconstruction jobs should be started.
        - If a reconstruction component has fewer views than settings.opensfm_min_views_for_dense, its dense reconstruction job is ignored.
        - Component 0: Any pre-existing dependent dense job is cancelled if component 0 has fewer views than required.
        - Components 1..N-1: Dense and ingest jobs are dynamically created only if the component meets the minimum views requirement.
        """
        if not HAS_OPENSFM or not dataset_dir:
            return

        try:
            min_views = int(payload.get("min_views_for_dense", settings.opensfm_min_views_for_dense))
            dataset = DataSet(dataset_dir)
            reconstructions = dataset.load_reconstruction() if dataset.reconstruction_exists() else []
            num_recs = len(reconstructions)

            job_uuid = uuid.UUID(job_id) if job_id else None
            async with async_session() as session:
                pipeline_id = None
                if job_uuid:
                    res = await session.execute(select(Job.pipeline_id).where(Job.id == job_uuid))
                    pipeline_id = res.scalar_one_or_none()

                # Evaluate pre-existing dependent dense jobs (e.g. Component 0)
                if job_id:
                    dep_res = await session.execute(
                        select(Job).where(Job.status.in_([JobStatus.BLOCKED, JobStatus.PENDING]))
                    )
                    candidate_jobs = []
                    if hasattr(dep_res, "scalars"):
                        scalars_obj = dep_res.scalars()
                        if asyncio.iscoroutine(scalars_obj):
                            scalars_obj = await scalars_obj
                        if hasattr(scalars_obj, "all"):
                            all_res = scalars_obj.all()
                            if asyncio.iscoroutine(all_res):
                                all_res = await all_res
                            if isinstance(all_res, (list, tuple)):
                                candidate_jobs = list(all_res)
                            elif hasattr(all_res, "__iter__"):
                                try:
                                    candidate_jobs = list(all_res)
                                except TypeError:
                                    candidate_jobs = []

                    for cand_job in candidate_jobs:
                        deps = cand_job.depends_on or []
                        if (job_id in deps or (job_uuid and str(job_uuid) in deps)) and cand_job.task_type in ("opensfm_dense", "opensfm_dense_reconstruct"):
                            rec_idx = int(cand_job.payload.get("reconstruction_index", 0))
                            views_count = get_reconstruction_views_count(reconstructions[rec_idx]) if (0 <= rec_idx < num_recs) else 0
                            if views_count < min_views:
                                logger.info(
                                    f"Reconstruction component {rec_idx} has {views_count} views, "
                                    f"which is less than the required minimum ({min_views} views). "
                                    f"Dense reconstruction job {cand_job.id} will not be started (ignored)."
                                )
                                cand_job.status = JobStatus.CANCELLED
                                cand_job.error_message = (
                                    f"Reconstruction component {rec_idx} has {views_count} views, "
                                    f"which is less than the required minimum ({min_views} views). "
                                    f"Dense reconstruction job ignored."
                                )
                                # Also cancel child jobs depending on this dense job (e.g. opensfm_ingest)
                                for child_job in candidate_jobs:
                                    child_deps = child_job.depends_on or []
                                    if str(cand_job.id) in child_deps:
                                        child_job.status = JobStatus.CANCELLED
                                        child_job.error_message = (
                                            f"Dense reconstruction for component {rec_idx} was ignored due to insufficient views "
                                            f"({views_count} < {min_views})."
                                        )

                # Dynamically create dense & ingest jobs for additional components (components 1 to num_recs - 1)
                if num_recs > 1:
                    dataset_name = payload.get("dataset_name") or os.path.basename(dataset_dir)
                    batch_id_val = payload.get("batch_id")
                    created_count = 0

                    for i in range(1, num_recs):
                        comp_views = get_reconstruction_views_count(reconstructions[i])
                        if comp_views < min_views:
                            logger.info(
                                f"Reconstruction component {i} has {comp_views} views, "
                                f"which is less than the required minimum ({min_views} views). "
                                f"Dense reconstruction job for component {i} will not be started (ignored)."
                            )
                            continue

                        subfolder = f"undistorted_{i}"
                        comp_file_id = str(uuid.uuid4())
                        dense_job_id = uuid.uuid4()
                        ingest_job_id = uuid.uuid4()

                        dense_job_name = f"OpenSfM Dense Reconstruction Component {i}"
                        if dataset_name:
                            dense_job_name = f"OpenSfM Dense Component {i}: {dataset_name}"

                        ingest_job_name = f"OpenSfM Pointcloud Ingestion Component {i}"
                        if dataset_name:
                            ingest_job_name = f"OpenSfM Ingest Component {i}: {dataset_name}"

                        dense_job = Job(
                            id=dense_job_id,
                            name=dense_job_name,
                            task_type="opensfm_dense",
                            payload={
                                "dataset_dir": dataset_dir,
                                "dataset_name": dataset_name,
                                "file_id": payload.get("file_id"),
                                "batch_id": batch_id_val,
                                "reconstruction_index": i,
                                "subfolder": subfolder,
                            },
                            status=JobStatus.BLOCKED,
                            progress=0.0,
                            pipeline_id=pipeline_id,
                            depends_on=[job_id] if job_id else []
                        )
                        session.add(dense_job)

                        ingest_job = Job(
                            id=ingest_job_id,
                            name=ingest_job_name,
                            task_type="opensfm_ingest",
                            payload={
                                "dataset_name": dataset_name,
                                "file_id": comp_file_id,
                                "batch_id": batch_id_val,
                                "folder_path": dataset_dir,
                                "subfolder": subfolder,
                                "reconstruction_index": i,
                            },
                            status=JobStatus.BLOCKED,
                            progress=0.0,
                            pipeline_id=pipeline_id,
                            depends_on=[str(dense_job_id)]
                        )
                        session.add(ingest_job)
                        created_count += 1

                    if created_count > 0:
                        logger.info(f"Successfully created dynamic dense & ingest jobs for {created_count} component(s).")

                await session.commit()
        except Exception as dyn_err:
            logger.error(f"Failed to process dense reconstruction jobs for reconstruction components: {dyn_err}", exc_info=True)

    async def execute(self, job_id: str, payload: Dict[str, Any], name: str = "", task_type: str = "") -> Dict[str, Any]:
        is_active = await self.update_job_status(job_id, "RUNNING", 10.0)
        if is_active is False:
            logger.info(f"Job {job_id} is cancelled. Aborting OpenSfM reconstruction execution.")
            return {
                "status": "cancelled",
                "job_id": job_id,
                "message": "OpenSfM reconstruction stopped due to job cancellation."
            }

        # Check if the opensfm docker container is healthy before proceeding
        is_healthy, health_msg = check_opensfm_gpu_health()
        if not is_healthy:
            err_msg = f"OpenSfM health check failed: {health_msg}"
            logger.error(err_msg)
            await self.update_job_status(job_id, "FAILED", 0.0, error_message=err_msg)
            raise RuntimeError(err_msg)

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
            err_msg = f"Dataset directory '{dataset_dir}' does not exist for OpenSfM sparse reconstruction."
            logger.error(err_msg)
            await self.update_job_status(job_id, "FAILED", 0.0, error_message=err_msg)
            raise RuntimeError(err_msg)

        images_dir = os.path.join(dataset_dir, "images")
        if not os.path.exists(images_dir) or not os.listdir(images_dir):
            err_msg = f"No images found in '{images_dir}'. Ensure frame extraction completed before running sparse reconstruction."
            logger.error(err_msg)
            await self.update_job_status(job_id, "FAILED", 0.0, error_message=err_msg)
            raise RuntimeError(err_msg)

        await self.update_job_status(job_id, "RUNNING", 25.0)

        # Copy OpenSfM config into dataset working directory at the start of reconstruction job
        target_config = os.path.join(dataset_dir, "config.yaml")
        resolved_config = resolve_opensfm_config_path(opensfm_config)
        if resolved_config:
            try:
                shutil.copy(resolved_config, target_config)
                logger.info(f"Successfully copied OpenSfM config from '{resolved_config}' to '{target_config}'")
            except Exception as copy_err:
                logger.warning(f"Failed to copy OpenSfM config from '{resolved_config}' to '{target_config}': {copy_err}")
        else:
            logger.warning(f"OpenSfM config file '{opensfm_config}' could not be found or resolved.")

        if not HAS_OPENSFM:
            err_msg = "OpenSfM Python library is not available in current Python environment. Ensure task is running inside OpenSfM worker container."
            logger.error(err_msg)
            await self.update_job_status(job_id, "FAILED", 0.0, error_message=err_msg)
            raise RuntimeError(err_msg)

        logger.info(f"Executing OpenSfM sparse reconstruction via Python API on dataset: {dataset_dir}")
        loop = asyncio.get_running_loop()
        compute_mesh = payload.get("compute_mesh", settings.opensfm_compute_mesh)

        try:
            await asyncio.to_thread(self._run_opensfm_sparse_pipeline, dataset_dir, loop, job_id, compute_mesh)
        except Exception as proc_err:
            if "cancelled" in str(proc_err).lower():
                logger.info(f"OpenSfM sparse reconstruction execution stopped for cancelled job {job_id}.")
                return {
                    "status": "cancelled",
                    "job_id": job_id,
                    "message": "OpenSfM sparse reconstruction stopped due to job cancellation."
                }
            try:
                job_uuid = uuid.UUID(job_id)
                async with async_session() as session:
                    res = await session.execute(select(Job.status).where(Job.id == job_uuid))
                    curr_status = res.scalar_one_or_none()
                    if curr_status == JobStatus.CANCELLED:
                        logger.info(f"OpenSfM sparse reconstruction execution stopped for cancelled job {job_id}.")
                        return {
                            "status": "cancelled",
                            "job_id": job_id,
                            "message": "OpenSfM sparse reconstruction stopped due to job cancellation."
                        }
            except Exception as chk_err:
                logger.warning(f"Could not verify cancellation status for {job_id}: {chk_err}")

            err_msg = f"OpenSfM sparse reconstruction failed: {proc_err}"
            logger.error(err_msg, exc_info=True)
            await self.update_job_status(job_id, "FAILED", 0.0, error_message=err_msg)
            raise RuntimeError(err_msg) from proc_err

        # Check for multiple reconstruction components and dynamically add jobs for components 1, 2, ...
        await self._create_dynamic_component_jobs(dataset_dir, job_id, payload)

        logger.info(f"OpenSfM sparse reconstruction completed successfully for {dataset_dir}")
        res_data = {
            "status": "success",
            "job_id": job_id,
            "dataset_dir": dataset_dir,
            "batch_id": payload.get("batch_id"),
            "message": "OpenSfM sparse reconstruction completed successfully."
        }

        await self.update_job_status(job_id, "COMPLETED", 100.0, result=res_data)
        return res_data
