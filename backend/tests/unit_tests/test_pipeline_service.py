import pytest
from app.schemas.job import PipelineCreate, PipelineJobCreate
from app.services.worker.pipeline_service import validate_pipeline_dag, build_pipeline_and_jobs
from app.models.job import JobStatus, PipelineStatus


def test_validate_pipeline_dag_success():
    jobs = [
        PipelineJobCreate(id_key="step1", name="Task 1", task_type="task1"),
        PipelineJobCreate(id_key="step2", name="Task 2", task_type="task2", depends_on=["step1"]),
        PipelineJobCreate(id_key="step3", name="Task 3", task_type="task3", depends_on=["step2"]),
    ]
    key_to_uuid = validate_pipeline_dag(jobs)
    assert "step1" in key_to_uuid
    assert "step2" in key_to_uuid
    assert "step3" in key_to_uuid
    assert len(set(key_to_uuid.values())) == 3


def test_validate_pipeline_dag_circular_dependency():
    jobs = [
        PipelineJobCreate(id_key="step1", name="Task 1", depends_on=["step2"]),
        PipelineJobCreate(id_key="step2", name="Task 2", depends_on=["step1"]),
    ]
    with pytest.raises(ValueError, match="Circular dependency detected"):
        validate_pipeline_dag(jobs)


def test_build_pipeline_and_jobs():
    pipeline_create = PipelineCreate(
        name="Test Pipeline",
        jobs=[
            PipelineJobCreate(id_key="step1", name="Task 1", task_type="task1"),
            PipelineJobCreate(id_key="step2", name="Task 2", task_type="task2", depends_on=["step1"]),
        ]
    )

    pipeline, jobs = build_pipeline_and_jobs(pipeline_create)
    assert pipeline.name == "Test Pipeline"
    assert len(jobs) == 2

    job1 = jobs[0]
    job2 = jobs[1]

    assert job1.name == "Task 1"
    assert job1.status == JobStatus.PENDING
    assert job1.depends_on == []

    assert job2.name == "Task 2"
    assert job2.status == JobStatus.BLOCKED
    assert len(job2.depends_on) == 1
    assert job2.depends_on[0] == str(job1.id)
