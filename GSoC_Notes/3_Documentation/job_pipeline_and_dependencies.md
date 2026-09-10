# Job Pipeline and Inter-job Dependency System

## Overview
The Job Pipeline and Dependency system allows batch creation of tasks, defining parent-child dependencies between jobs, and automatic task execution scheduling based on Directed Acyclic Graphs (DAGs).

## Features & Architecture

### 1. Job Models & Pipeline Schema
- **`Pipeline`**: Represents a collection of jobs executed as part of a larger workflow (e.g. video preprocessing -> PySLAM reconstruction -> point cloud mesh generation).
- **`JobStatus`**:
  - `PENDING`: Ready to be processed by background worker (enqueued into Redis RQ).
  - `BLOCKED`: Waiting on one or more parent dependencies to reach `COMPLETED` status.
  - `RUNNING`: Currently being processed by worker.
  - `COMPLETED`: Successfully executed.
  - `FAILED`: Execution failed or upstream dependency failed.
  - `CANCELLED`: Execution cancelled.

### 2. Directed Acyclic Graph (DAG) Validation
- Submitting a pipeline via `POST /jobs/pipeline` triggers DAG validation (`pipeline_service.py`) using Kahn's topological sort.
- If a circular dependency is detected (e.g. Task A depends on Task B and Task B depends on Task A), the request is rejected with `400 Bad Request`.

### 3. Automatic Dependency Resolution & Dispatching
- Jobs without parent dependencies start in `PENDING` status and are auto-enqueued into Redis Queue immediately upon creation.
- Jobs with unsatisfied parent dependencies start in `BLOCKED` status and are withheld from Redis Queue.
- When a parent job completes (`COMPLETED`), `_update_job_status` in worker tasks checks all dependent `BLOCKED` jobs. Any job whose dependencies are now all satisfied transitions to `PENDING` and is automatically enqueued.
- When a parent job fails (`FAILED`), dependent jobs automatically transition to `FAILED` with a dependency error message.

## API Endpoints

- `POST /jobs`: Create a single job with optional `depends_on` parent UUID list.
- `POST /jobs/pipeline`: Create a multi-job pipeline with dependency resolution.
- `GET /jobs/pipelines`: List all job pipelines.
- `GET /jobs/pipelines/{pipeline_id}`: Retrieve a specific pipeline and its constituent jobs.
- `DELETE /jobs/pipelines/{pipeline_id}`: Delete a pipeline and all associated jobs.
- `POST /jobs/pipelines/{pipeline_id}/retry`: Retry failed/cancelled jobs in a pipeline.
