import uuid
from typing import List, Dict, Set, Tuple, Optional
from app.models.job import Job, JobStatus, Pipeline, PipelineStatus
from app.schemas.job import PipelineCreate, PipelineJobCreate


def validate_pipeline_dag(jobs_data: List[PipelineJobCreate]) -> Dict[str, str]:
    """
    Validates that the pipeline jobs form a Directed Acyclic Graph (DAG) with no cycles.
    Returns a dictionary mapping job identifier (id_key or str index) to generated UUID string.
    """
    key_to_uuid: Dict[str, str] = {}
    graph: Dict[str, List[str]] = {}
    in_degree: Dict[str, int] = {}

    # Step 1: Assign identifiers and initialize graph
    for idx, job_data in enumerate(jobs_data):
        node_id = job_data.id_key if job_data.id_key else str(idx)
        generated_uuid = str(uuid.uuid4())
        
        if node_id in key_to_uuid:
            raise ValueError(f"Duplicate job identifier '{node_id}' in pipeline.")

        key_to_uuid[node_id] = generated_uuid
        key_to_uuid[str(idx)] = generated_uuid  # Also allow indexing by position
        graph[node_id] = []
        in_degree[node_id] = 0

    # Step 2: Build dependency graph and count in-degrees
    for idx, job_data in enumerate(jobs_data):
        node_id = job_data.id_key if job_data.id_key else str(idx)
        deps = job_data.depends_on or []

        for dep in deps:
            dep_str = str(dep)
            if dep_str in key_to_uuid:
                # Local dependency within pipeline
                # In graph: dep -> node_id (dep must finish before node_id can run)
                parent_key = dep_str
                # Normalize parent_key to primary node_id if index was used
                for k, v in key_to_uuid.items():
                    if v == key_to_uuid[dep_str] and not k.isdigit():
                        parent_key = k
                        break
                if parent_key not in graph:
                    graph[parent_key] = []
                graph[parent_key].append(node_id)
                in_degree[node_id] = in_degree.get(node_id, 0) + 1

    # Step 3: Topological sort (Kahn's Algorithm) to detect cycles
    queue = [node for node, count in in_degree.items() if count == 0]
    visited_count = 0

    while queue:
        curr = queue.pop(0)
        visited_count += 1
        for neighbor in graph.get(curr, []):
            in_degree[neighbor] -= 1
            if in_degree[neighbor] == 0:
                queue.append(neighbor)

    if visited_count < len(in_degree):
        raise ValueError("Circular dependency detected in job pipeline.")

    return key_to_uuid


def build_pipeline_and_jobs(pipeline_data: PipelineCreate) -> Tuple[Pipeline, List[Job]]:
    """
    Constructs a Pipeline and list of Job model instances from PipelineCreate payload.
    Resolves local dependencies and assigns initial job statuses (PENDING vs BLOCKED).
    """
    key_to_uuid = validate_pipeline_dag(pipeline_data.jobs)
    
    pipeline_name = (pipeline_data.name or "Pipeline")[:255]
    pipeline = Pipeline(
        id=uuid.uuid4(),
        name=pipeline_name,
        status=PipelineStatus.PENDING
    )

    jobs: List[Job] = []

    for idx, job_data in enumerate(pipeline_data.jobs):
        node_id = job_data.id_key if job_data.id_key else str(idx)
        job_uuid_str = key_to_uuid[node_id]
        
        resolved_depends_on: List[str] = []
        for dep in (job_data.depends_on or []):
            dep_str = str(dep)
            if dep_str in key_to_uuid:
                resolved_depends_on.append(key_to_uuid[dep_str])
            else:
                # Assume external job UUID string
                resolved_depends_on.append(dep_str)

        # Remove duplicate parent UUIDs if any
        resolved_depends_on = list(dict.fromkeys(resolved_depends_on))

        # Initial status: BLOCKED if it has parent dependencies, PENDING otherwise
        initial_status = JobStatus.BLOCKED if resolved_depends_on else JobStatus.PENDING

        job_name = (job_data.name or "Job")[:255]
        job = Job(
            id=uuid.UUID(job_uuid_str),
            name=job_name,
            task_type=job_data.task_type,
            payload=job_data.payload,
            status=initial_status,
            progress=0.0,
            pipeline_id=pipeline.id,
            depends_on=resolved_depends_on
        )
        jobs.append(job)

    return pipeline, jobs
