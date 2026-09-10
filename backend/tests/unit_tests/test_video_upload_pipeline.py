import pytest
import uuid
from unittest.mock import patch, MagicMock

from app.models.job import JobStatus, PipelineStatus
from app.schemas.job import PipelineCreate, PipelineJobCreate
from app.services.worker.pipeline_service import build_pipeline_and_jobs
from app.services.worker.queue_utils import get_queue_name_for_task_type

def test_video_upload_pipeline_dag_building():
    file_name = "test_rov_video.mp4"
    file_id = str(uuid.uuid4())
    dataset_name = f"dataset_{file_id.replace('-', '_')}"

    pipeline_payload = PipelineCreate(
        name=f"Video OpenSfM Pipeline: {file_name}",
        jobs=[
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
                id_key="opensfm_reconstruct",
                name=f"OpenSfM Reconstruction: {file_name}",
                task_type="opensfm_reconstruct",
                payload={
                    "dataset_name": dataset_name,
                    "file_id": file_id
                },
                depends_on=["frame_extraction"]
            ),
            PipelineJobCreate(
                id_key="opensfm_ingest",
                name=f"OpenSfM Pointcloud Ingestion: {file_name}",
                task_type="opensfm_ingest",
                payload={
                    "dataset_name": dataset_name,
                    "file_id": file_id
                },
                depends_on=["opensfm_reconstruct"]
            )
        ]
    )

    pipeline, jobs = build_pipeline_and_jobs(pipeline_payload)

    assert pipeline.name == f"Video OpenSfM Pipeline: {file_name}"
    assert len(jobs) == 3

    job1, job2, job3 = jobs[0], jobs[1], jobs[2]

    # Verify Job 1 (frame_extraction)
    assert job1.task_type == "frame_extraction"
    assert job1.status == JobStatus.PENDING
    assert job1.depends_on == []
    assert get_queue_name_for_task_type(job1.task_type) == "pointcloud_tasks"

    # Verify Job 2 (opensfm_reconstruct)
    assert job2.task_type == "opensfm_reconstruct"
    assert job2.status == JobStatus.BLOCKED
    assert job2.depends_on == [str(job1.id)]
    assert get_queue_name_for_task_type(job2.task_type) == "opensfm_tasks"

    # Verify Job 3 (opensfm_ingest)
    assert job3.task_type == "opensfm_ingest"
    assert job3.status == JobStatus.BLOCKED
    assert job3.depends_on == [str(job2.id)]
    assert get_queue_name_for_task_type(job3.task_type) == "opensfm_tasks"
