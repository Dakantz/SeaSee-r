# SeaSee-r Ingestion Pipeline CLI (`ingest_video.py`)

A standalone CLI script to ingest raw underwater video, ROV sensor telemetry logs, and OpenSfM 3D point cloud models into SeaSee-r in a single end-to-end execution without modifying Docker Compose.

---

## What It Does

1. **Video Ingestion & Storage**: Registers the video file, calculates byte size, records start/end timestamps, and exposes HTTP 206 partial content byte-range streaming at `/videos/{id}/stream`.
2. **ROV Telemetry Synchronization**: Parses and ingests high-frequency timestamped ROV sensor logs (depth, orientation, temperature, battery, etc.) into PostgreSQL `log_data`.
3. **OpenSfM 3D Point Cloud Conversion**: Locates point cloud outputs (`.laz` / `.ply`), executes Untwine/PDAL octree LOD indexing, and publishes Potree/Cesium-compatible EPT files at `/ept/{id}/ept.json`.
4. **Camera Trajectory Extraction**: Parses continuous Euclidean camera positions ($C = -R^T t$) and quaternion rotations for 3D route alignment in the Three.js viewport.
5. **Entity Linking**: Automatically associates `PointCloudMetadata.video_metadata_id` so the frontend UI seamlessly syncs 3D navigation with video playback.

---

## Prerequisites

Ensure the SeaSee-r stack is running:
```bash
docker compose up -d
```

---

## Usage

Run the script inside the `seasee-r-backend` container:

```bash
docker exec -it seasee-r-backend python scratch/ingest_video.py [options] [video_path]
```

### Options

| Flag | Description | Default |
|---|---|---|
| `[video_path]` / `--video <path>` | Path to MP4 video file | Searches `./data/videos/` |
| `--log <path>` | Path to ROV JSON telemetry log | Searches `./data/metadata/` |
| `--opensfm-folder <name>` | OpenSfM dataset folder name | `video_1` |
| `--clean` | Scrub previous database records and EPT directories before ingestion | `False` |
| `--no-wait` | Dispatch jobs to worker queue asynchronously without waiting for completion | `False` |

---

## Examples

### 1. Ingest Default Test Dataset (Clean Database)
```bash
docker exec -it seasee-r-backend python scratch/ingest_video.py \
  ./data/videos/20260505_121047_180_N001.MP4 \
  --opensfm-folder video_1 \
  --log ./data/metadata/ROV-Log-2026-05-02-2026-05-05-0505205315.json \
  --clean
```

### 2. Ingest a Custom External Video
1. Place your video and telemetry log into the shared `backend/data/` volume:
   ```bash
   cp /path/to/my_custom_video.MP4 backend/data/videos/
   cp /path/to/my_rov_log.json backend/data/metadata/
   ```

2. Run the ingestion command:
   ```bash
   docker exec -it seasee-r-backend python scratch/ingest_video.py \
     ./data/videos/my_custom_video.MP4 \
     --log ./data/metadata/my_rov_log.json \
     --opensfm-folder video_1
   ```

### 3. Asynchronous Execution (Non-blocking)
```bash
docker exec -it seasee-r-backend python scratch/ingest_video.py \
  ./data/videos/my_custom_video.MP4 \
  --no-wait
```

---

## Verifying Ingestion Results

Once execution completes, you can verify all endpoints:

- **List Point Clouds**:
  ```bash
  curl -s http://localhost:8000/pointclouds/ | jq .
  ```
- **Fetch EPT Point Cloud Root**:
  ```bash
  curl -s http://localhost:8000/ept/<pointcloud_id>/ept.json | jq .
  ```
- **Fetch Camera Trajectory (187 poses)**:
  ```bash
  curl -s http://localhost:8000/pointclouds/<pointcloud_id>/camera-routes | jq .
  ```
- **Fetch Video Details by Point Cloud**:
  ```bash
  curl -s http://localhost:8000/videos/by-pointcloud/<pointcloud_id> | jq .
  ```
- **Test Video Stream Seeking (HTTP 206)**:
  ```bash
  curl -i -X GET -H "Range: bytes=0-1024" http://localhost:8000/videos/<video_id>/stream
  ```
