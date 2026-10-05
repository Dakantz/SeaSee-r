# SeaSee-r: Project Status & Roadmap

This document outlines the current state of **SeaSee-r**, summarizing the core features and architectures implemented to date, as well as planned improvements and future extensions.

---

## 1. Summary of Work Done

### Backend & Data Processing
- **Spatial Database**: Configured a PostgreSQL database with PostGIS and `pgPointCloud` extensions for storing, spatially indexing, and querying 3D point cloud patches, camera trajectories, and ROV video metadata.
- **FastAPI REST API**: Developed a high-performance backend supporting dataset cataloging, spatial filtering queries, and asynchronous pipeline lifecycle control.
- **Binary Streaming Engine**: Engineered an optimized binary streaming endpoint (`/pointclouds/stream-binary`) that streams packed binary attribute buffers directly from PostGIS to the frontend, with SQL-level bounding box and attribute filtering.
- **Asynchronous Ingestion Pipeline**: Built a Directed Acyclic Graph (DAG) job execution system using Redis and RQ to orchestrate video and metadata processing:
  - **Log Ingestion (`video_upload`)**: Ingests and registers uploaded video files and associated telemetry/sensor logs for the dataset batch.
  - **Frame Extraction (`frame_extraction`)**: Extracts video frames at configurable frame rates (FPS) with blur-detection filtering to discard degraded frames, and generates `exif_overrides.json`.
  - **OpenSfM Sparse Reconstruction (`opensfm_sparse`)**: Performs feature detection, matching, and sparse bundle adjustment to estimate camera poses and initial 3D tie points (with multi-component handling when features are sparse).
  - **OpenSfM Dense Reconstruction (`opensfm_dense`)**: Computes depth maps and multi-view stereo to produce dense 3D point clouds (`fused.laz`).
  - **OpenSfM Ingest (`opensfm_ingest`)**: Converts point clouds to Entwine Point Tile (EPT), ingests spatial patches into PostgreSQL (`pgPointCloud`), and registers dataset metadata and camera routes.

### Frontend & 3D Visualization
- **Interactive Web Dashboard**: Built a modern React/Vite interface allowing marine researchers to explore datasets, query point clouds, and manage ingestion pipelines.
- **Three.js 3D Rendering**: Implemented interactive 3D rendering of high-density underwater point clouds and camera routes with smooth orbit controls and spatial helpers.
- **Binary Streaming & Dynamic LOD**: Directly streams binary coordinate and color buffers into WebGL `BufferGeometry`. Implemented dynamic Level of Detail (LOD) loading based on camera distance to optimize rendering performance.
- **Bathymetry Mesh Integration**: Rendered the seafloor as a 3D terrain mesh using `geo-three` integrated with EMODnet Bathymetry elevation data.
- **Point Cloud Logs & Telemetry Synchronization**:
  - **Interactive Telemetry Charts (`LogsCharts`)**: Visualizes time-aligned dive logs across multiple metrics (depth profile, water temperature, forward/altitude sonar, and calculated distance).
  - **Synchronized Video Player (`VideoPlayer`)**: Plays back ingested ROV video feeds synchronized with the telemetry timeline.
  - **Bidirectional 3D Camera & Log Synchronization**: Syncs the 3D camera path with the video and telemetry logs—clicking a point in 3D jumps the video to that moment, and clicking a log entry moves the 3D camera to where it happened.
- **Point Cloud Editing & Spatial Alignment**:
  - Interactive 3D transform gizmo controls (translation and rotation) to spatially align point clouds with previously ingested data and seafloor bathymetry.
  - Transformation matrices are persisted back to the database in the point cloud metadata table.

### Deployment & Infrastructure
- **Docker Compose Orchestration**: Containerized the entire microservices stack for a reproducible, one-command deployment (`docker compose up -d --build`).
- **Containerized Microservices Architecture**: Orchestrates 7 interconnected services:
  - **Database (`seasee-r-db`)**: PostgreSQL with PostGIS and `pgPointCloud` extensions for 3D spatial data.
  - **Message Broker (`seasee-r-redis`)**: Redis in-memory broker managing asynchronous background task queues.
  - **API Server (`seasee-r-backend`)**: FastAPI REST API providing data ingestion, binary point cloud streaming, and pipeline management.
  - **Task Worker (`seasee-r-worker`)**: Background worker handling general ingestion tasks, frame extraction, and database commits.
  - **OpenSfM Worker (`seasee-r-opensfm`)**: Dedicated container with GPU acceleration via the NVIDIA Container Toolkit for sparse and dense photogrammetric 3D reconstructions.
  - **Resumable Upload Server (`seasee-r-tusd`)**: TUSD server enabling chunked, interruptible uploads of large video and telemetry files.
  - **Frontend Dashboard (`seasee-r-frontend`)**: React/Vite web application served via Nginx with SPA routing and multi-device network access.

---

## 2. Future Improvements & Roadmap

1. **Fine-tune OpenSfM Reconstruction Settings**:
   - Refine camera pose estimation and reconstruction parameters for challenging underwater optical conditions (e.g., low light, particulate backscatter, and minimal visual features).
2. **Point Cloud Cleaning & Editing Tools**:
   - Provide interactive tools directly in the 3D viewer to prune unwanted point clusters, water column noise, or sensor artifacts.
3. **Automated Point Cloud Stitching & Registration**:
   - Automatically align, register, and merge point clouds across multiple dives or ROV passes into a unified underwater map.
4. **Live Mission Planning & Re-identification**:
   - Utilize previously mapped 3D point clouds and trajectories to plan future ROV missions, support site re-identification, and enable live registration of incoming video feeds.
5. **Multimodal Sensor Data Integration**:
   - **Sonar**: Ingest multibeam/side-scan sonar measurements for enhanced depth accuracy and wide-area bathymetry modeling.
   - **360° Panoramic Feeds**: Support 360-degree panoramic camera feeds for immersive exploration of underwater survey sites.
