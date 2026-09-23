import pytest
import uuid
from unittest.mock import patch, MagicMock

from app.models.job import JobStatus, PipelineStatus
from app.schemas.job import PipelineCreate, PipelineJobCreate
from app.services.worker.pipeline_service import build_pipeline_and_jobs
from app.utils.queue_utils import get_queue_name_for_task_type

def test_video_upload_pipeline_dag_building():
    file_name = "test_rov_video.mp4"
    file_id = str(uuid.uuid4())
    dataset_name = f"dataset_{file_id.replace('-', '_')}"

    pipeline_payload = PipelineCreate(
        name=f"Video OpenSfM Pipeline: {file_name}",
        jobs=[
            PipelineJobCreate(
                id_key="video_upload",
                name=f"Log Ingestion: {file_name}",
                task_type="video_upload",
                payload={
                    "file_id": file_id,
                    "batch_id": "test_batch",
                    "filename": file_name,
                    "safe_filename": f"{file_id}.mp4",
                    "video_files": [f"{file_id}.mp4", file_name],
                },
                depends_on=[]
            ),
            PipelineJobCreate(
                id_key="frame_extraction",
                name=f"Frame Extraction: {file_name}",
                task_type="frame_extraction",
                payload={
                    "filename": file_name,
                    "safe_filename": f"{file_id}.mp4",
                    "video_files": [f"{file_id}.mp4", file_name],
                    "num_frames": 500,
                    "dataset_name": dataset_name,
                },
                depends_on=[]
            ),
            PipelineJobCreate(
                id_key="opensfm_sparse",
                name=f"OpenSfM Sparse: {file_name}",
                task_type="opensfm_sparse",
                payload={
                    "dataset_name": dataset_name,
                    "file_id": file_id
                },
                depends_on=["frame_extraction", "video_upload"]
            ),
            PipelineJobCreate(
                id_key="opensfm_dense",
                name=f"OpenSfM Dense Reconstruction: {file_name}",
                task_type="opensfm_dense",
                payload={
                    "dataset_name": dataset_name,
                    "file_id": file_id,
                    "reconstruction_index": 0,
                    "subfolder": "undistorted"
                },
                depends_on=["opensfm_sparse"]
            ),
            PipelineJobCreate(
                id_key="opensfm_ingest",
                name=f"OpenSfM Pointcloud Ingestion: {file_name}",
                task_type="opensfm_ingest",
                payload={
                    "dataset_name": dataset_name,
                    "file_id": file_id,
                    "reconstruction_index": 0,
                    "subfolder": "undistorted"
                },
                depends_on=["opensfm_dense"]
            )
        ]
    )

    pipeline, jobs = build_pipeline_and_jobs(pipeline_payload)

    assert pipeline.name == f"Video OpenSfM Pipeline: {file_name}"
    assert len(jobs) == 5

    job_upload, job_frame, job_reconstruct, job_dense, job_ingest = jobs[0], jobs[1], jobs[2], jobs[3], jobs[4]

    # Verify Job 0 (video_upload)
    assert job_upload.task_type == "video_upload"
    assert job_upload.status == JobStatus.PENDING
    assert job_upload.depends_on == []

    # Verify Job 1 (frame_extraction)
    assert job_frame.task_type == "frame_extraction"
    assert job_frame.status == JobStatus.PENDING
    assert job_frame.depends_on == []
    assert get_queue_name_for_task_type(job_frame.task_type) == "pointcloud_tasks"

    # Verify Job 2 (opensfm_sparse - Sparse)
    assert job_reconstruct.task_type == "opensfm_sparse"
    assert job_reconstruct.status == JobStatus.BLOCKED
    assert set(job_reconstruct.depends_on) == {str(job_frame.id), str(job_upload.id)}
    assert get_queue_name_for_task_type(job_reconstruct.task_type) == "opensfm_tasks"

    # Verify Job 3 (opensfm_dense - Dense Component 0)
    assert job_dense.task_type == "opensfm_dense"
    assert job_dense.status == JobStatus.BLOCKED
    assert job_dense.depends_on == [str(job_reconstruct.id)]
    assert get_queue_name_for_task_type(job_dense.task_type) == "opensfm_tasks"

    # Verify Job 4 (opensfm_ingest - Ingestion Component 0)
    assert job_ingest.task_type == "opensfm_ingest"
    assert job_ingest.status == JobStatus.BLOCKED
    assert job_ingest.depends_on == [str(job_dense.id)]
    assert get_queue_name_for_task_type(job_ingest.task_type) == "pointcloud_tasks"
