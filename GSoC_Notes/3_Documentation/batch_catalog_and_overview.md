# Processed Batch Catalog & Overview Documentation

This document describes the architecture, API endpoints, database queries, and UI components for the **Batch Catalog** implemented within the `DebugControls` panel.

---

## 1. Overview & Objectives

In the SeaSee-r pipeline, uploads and reconstructions are organized around `batch_id` UUIDs. A single batch can contain:
1. Multiple video files (e.g. video segments from an ROV dive).
2. Sensor/telemetry log files (`.json`).
3. Reconstructed 3D point cloud datasets (`pointcloud_metadata`) produced by OpenSfM components.

The **Batch Catalog** provides users with a high-level summary of processed batches directly in the `DebugControls` sidebar widget. When a user clicks a batch item, a structured custom query is added to the 3D viewer (`CustomQueryManager`), automatically filtering for and streaming the point clouds associated with that specific `batch_id`.

---

## 2. API Endpoints

### `GET /videos/batches` & `GET /videos/batches/overview`

Returns an aggregated list of upload batches with their video metrics and point cloud reconstruction counts.

#### Query Parameters:
- `processed_only` (boolean, default: `true`): When `true`, filters only for batches with at least one reconstructed point cloud (`pointcloud_count > 0`). When `false`, returns all batches (including incomplete or pending uploads).
- `limit` (integer, default: `200`, min: 1, max: 1000): Maximum number of batches to return.

#### Response Schema (`BatchOverviewResponse`):
```json
[
  {
    "batch_id": "25944a43-804d-4676-bfb1-e609e2fa0890",
    "first_video_filename": "20260803_LP01_03_1080p.mp4",
    "video_count": 7,
    "total_video_length": 184.5,
    "pointcloud_count": 53,
    "total_points": 10713433,
    "created_at": "2026-09-22T16:52:57.350184Z"
  }
]
```

#### Fields:
| Field | Type | Description |
| :--- | :--- | :--- |
| `batch_id` | `UUID` | The batch identifier linking upload files and point clouds. |
| `first_video_filename` | `string \| null` | The filename of the earliest video upload in the batch. |
| `video_count` | `integer` | Total count of distinct videos belonging to the batch. |
| `total_video_length` | `float` | Cumulative duration (in seconds) of all videos in the batch. |
| `pointcloud_count` | `integer` | Count of reconstructed `pointcloud_metadata` datasets linked to this batch. |
| `total_points` | `integer` | Cumulative sum of points across all reconstructions for this batch. |
| `created_at` | `datetime \| null` | Earliest creation timestamp of the batch upload or reconstruction. |
| `log_count` | `integer` | Count of JSON telemetry log files uploaded in this batch. |
| `video_filenames` | `string[]` | List of all original video filenames in this batch. |
| `log_filenames` | `string[]` | List of all telemetry / log filenames in this batch. |

---

### `POST /videos/batches/{batch_id}/pipeline`

Triggers an OpenSfM 3D reconstruction pipeline on demand for any uploaded batch (whether previously run or pending).

#### Request Body (`StartBatchPipelineRequest`):
```json
{
  "frame_counts": [200],
  "blur_thresholds": [50.0]
}
```
Accepts arrays of numbers to allow executing a parameter sweep matrix.

---

## 3. Database Aggregation Logic

The endpoint executes an optimized Common Table Expression (CTE) query joining `upload_metadata`, `video_metadata`, and `pointcloud_metadata`:

```sql
WITH batch_ids AS (
    SELECT DISTINCT batch_id FROM pointcloud_metadata WHERE batch_id IS NOT NULL
    UNION
    SELECT DISTINCT batch_id FROM upload_metadata WHERE batch_id IS NOT NULL
),
batch_videos AS (
    SELECT 
        um.batch_id,
        um.orig_filename,
        um.created_at,
        vm.id as video_id,
        COALESCE(EXTRACT(EPOCH FROM (vm.video_stop_at - vm.video_start_at)), 0) as duration,
        ROW_NUMBER() OVER (
            PARTITION BY um.batch_id 
            ORDER BY 
                CASE WHEN um.content_type LIKE 'video/%' THEN 0 ELSE 1 END,
                um.created_at ASC, 
                um.id ASC
        ) as rn
    FROM upload_metadata um
    LEFT JOIN video_metadata vm ON vm.upload_metadata_id = um.id
    WHERE um.batch_id IS NOT NULL AND (um.content_type LIKE 'video/%' OR vm.id IS NOT NULL)
),
batch_video_stats AS (
    SELECT 
        batch_id,
        MAX(CASE WHEN rn = 1 THEN orig_filename END) as first_video_filename,
        COUNT(DISTINCT video_id) as video_count,
        COUNT(DISTINCT orig_filename) as upload_video_count,
        SUM(GREATEST(duration, 0)) as total_video_length
    FROM batch_videos
    GROUP BY batch_id
),
batch_pc_stats AS (
    SELECT 
        batch_id,
        COUNT(*) as pointcloud_count,
        SUM(COALESCE(number_of_points, 0)) as total_points,
        MIN(created_at) as first_pc_created_at
    FROM pointcloud_metadata
    WHERE batch_id IS NOT NULL
    GROUP BY batch_id
),
batch_earliest_upload AS (
    SELECT 
        batch_id,
        MIN(created_at) as first_upload_created_at
    FROM upload_metadata
    WHERE batch_id IS NOT NULL
    GROUP BY batch_id
)
SELECT 
    b.batch_id,
    COALESCE(v.first_video_filename, (SELECT orig_filename FROM pointcloud_metadata WHERE batch_id = b.batch_id LIMIT 1)) as first_video_filename,
    COALESCE(GREATEST(v.video_count, v.upload_video_count), 0) as video_count,
    COALESCE(v.total_video_length, 0.0) as total_video_length,
    COALESCE(p.pointcloud_count, 0) as pointcloud_count,
    COALESCE(p.total_points, 0) as total_points,
    COALESCE(u.first_upload_created_at, p.first_pc_created_at) as created_at
FROM batch_ids b
LEFT JOIN batch_video_stats v ON b.batch_id = v.batch_id
LEFT JOIN batch_pc_stats p ON b.batch_id = p.batch_id
LEFT JOIN batch_earliest_upload u ON b.batch_id = u.batch_id
WHERE (:processed_only = FALSE OR COALESCE(p.pointcloud_count, 0) > 0)
ORDER BY COALESCE(u.first_upload_created_at, p.first_pc_created_at) DESC NULLS LAST, p.pointcloud_count DESC
LIMIT :limit;
```

---

## 4. Frontend Component & Interaction

### `PLYPointCloudSidebar.tsx` (DebugControls)

The `Batch Catalog` section is integrated into `DebugControls`:
1. **Search & Filter**: Allows searching across processed batches by either video filename or batch UUID substring.
2. **Batch Item Cards**:
   - Primary Title: First video filename (e.g. `20260803_LP01_03_1080p.mp4`).
   - Batch ID Badge: Monospace short UUID tag (e.g. `25944a43`).
   - Video Count: `📹 N videos`.
   - Total Video Length: Formatted as `⏱️ Xh Ym Zs` or `⏱️ Ym Zs` or `⏱️ 0s`.
   - Reconstructed Point Clouds: `☁️ M clouds` (with total points badge, e.g. `10.7M pts`).
   - Active Indicator: Highlights with red-accented border when a custom query is actively filtering for that batch.
3. **Click Interaction (`addCustomQuery`)**:
   Clicking on a batch card invokes `contextState.addCustomQuery`:
   ```typescript
   contextState.addCustomQuery({
       name: `Batch: ${displayName}`,
       filters: [
           {
               id: `rule-${Date.now()}`,
               field: "batch_id",
               operator: "eq",
               value: item.batch_id,
           },
       ],
   });
   ```
4. **Deduplication**:
   `addCustomQuery` in `PLYPointCloudContext.tsx` verifies whether a query with `field === "batch_id"` matching the target batch ID already exists before creating a new query card, preventing redundant duplicate entries.

### `UploadedBatchesManager.tsx` (`/video-uploader` Page)

Displays all uploaded batches of videos and telemetry log data with real-time management:
1. **Batch Information**:
   - Monospace batch UUID with one-click clipboard copy.
   - Status badge indicating whether the batch has already been reconstructed (`Reconstructed`) or is pending execution (`Ready for Pipeline`).
   - Video metrics: count of videos, total video duration, and expandable file names list.
   - Telemetry log metrics: count and names of JSON telemetry logs uploaded in the batch.
   - Point cloud metrics: reconstructed dataset count and total points.
2. **On-Demand Pipeline Launcher**:
   - Allows users to specify arbitrary frame counts (e.g., `100, 200`) and blur thresholds (e.g., `30, 50`).
   - Supports 1-click presets: Fast, Standard, Dense, and Sweep Matrix.
   - Users can trigger or re-run the pipeline on any batch regardless of whether a pipeline has previously been run.
   - Seamlessly dispatches `job-system-updated` to notify `JobSystemOverview` to show live DAG progression.

---

## 5. Streaming & Visualizing Batch Point Clouds

When the custom query is executed:
- The backend `/pointclouds/stream-summary?batch_id=<UUID>` returns the aggregated bounding box, centroid, and all connected reconstructed point clouds.
- The binary stream endpoint `/pointclouds/stream-binary?batch_id=<UUID>&lod=<N>` filters patches using `pm.batch_id = :p_0`, streaming all points from all reconstructions belonging to the batch simultaneously into Three.js.
