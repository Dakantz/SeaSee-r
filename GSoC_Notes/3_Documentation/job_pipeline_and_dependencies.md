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

The 3D point cloud reconstruction workflow is decoupled into a multi-stage job pipeline with `batch_id` propagation:

1. **`video_upload`** (Queue: `pointcloud_tasks`): Ingests video metadata, subtitles, and telemetry/sensor logs associated with the upload's `batch_id`.
2. **`frame_extraction`** (Queue: `pointcloud_tasks`): Extracts image frames from input video files into `settings.opensfm_ingestion_dir/<dataset_name>/images` via `ffmpeg`, tagged with `batch_id`.
3. **`opensfm_sparse`** (Queue: `opensfm_tasks`): Executes OpenSfM sparse feature matching and track reconstruction inside the dedicated `seasee-r-opensfm` container worker. If multiple reconstruction components are found, it dynamically spawns dense and ingest jobs for each component, forwarding `batch_id`.
4. **`opensfm_dense`** (Queue: `opensfm_tasks`): Computes depth maps and dense point clouds (`fused.laz`) for a reconstruction component, preserving `batch_id`.
5. **`opensfm_ingest`** (Queue: `pointcloud_tasks`): Converts point clouds to EPT, ingests point cloud patches into PostgreSQL/PostGIS/pgPointcloud, and inserts `PointCloudMetadata` recording the reconstruction statistics and the associated `batch_id`. In `PointCloudMetadataResponse`, the `batch_id` is exposed to the frontend and rendered across point cloud sidebar listings and query summaries.


