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
- `POST /jobs/{job_id}/cancel`: Cancel a job. If the job is part of a pipeline, cancels all uncompleted jobs (`PENDING`, `RUNNING`, `BLOCKED`, `FAILED`) in that pipeline. Otherwise, cancels the standalone job and cascades to dependent jobs.
- `POST /jobs/{job_id}/retry`: Retry a job. If the job is part of a pipeline, retries all uncompleted jobs in that pipeline by resetting their progress/error state and re-evaluating DAG dependencies (`PENDING` if dependencies are met, `BLOCKED` otherwise). Otherwise, retries the standalone job.
- `POST /jobs/pipeline`: Create a multi-job pipeline with dependency resolution.
- `GET /jobs/pipelines`: List all job pipelines.
- `GET /jobs/pipelines/{pipeline_id}`: Retrieve a specific pipeline and its constituent jobs.
- `DELETE /jobs/pipelines/{pipeline_id}`: Delete a pipeline and all associated jobs.
- `POST /jobs/pipelines/{pipeline_id}/retry`: Retry failed/cancelled jobs in a pipeline.

## Standard Video to OpenSfM Pipeline Workflow

The 3D point cloud reconstruction workflow is decoupled into a 3-stage job pipeline:

1. **`frame_extraction`** (Queue: `pointcloud_tasks`): Extracts image frames from input video files into `settings.opensfm_ingestion_dir/<dataset_name>/images` via `ffmpeg`.
2. **`opensfm_sparse`** (Queue: `opensfm_tasks`, legacy alias: `opensfm_reconstruct`): Executes OpenSfM sparse reconstruction and mesh generation (`extract_metadata`, `detect_features`, `match_features`, `create_tracks`, `reconstruct`, `mesh`) inside the dedicated `seasee-r-opensfm` Docker container worker.
3. **`opensfm_ingest`** (Queue: `pointcloud_tasks`): Parses the generated `fused.laz` and camera metadata (`shots.geojson` / `reconstruction.json`) and ingests them into the PostGIS database.

