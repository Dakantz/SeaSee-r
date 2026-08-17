# Stream Pointcloud Binary (`/pointclouds/stream-binary`)

## Overview
The `/pointclouds/stream-binary` endpoint provides high-performance binary streaming of 3D point cloud data directly from PostgreSQL / PostGIS (`pgPointCloud`) storage to frontend WebGL visualizers (such as Three.js).

Instead of transferring bloated JSON structures or generating intermediate `.ply` files on disk, this endpoint streams raw point attribute buffers asynchronously. This minimizes network overhead, eliminates server-side disk I/O bottlenecks, and allows frontend clients to directly map incoming binary buffers into WebGL vertex attribute buffers (`BufferGeometry`).

---

## Endpoint Specification

- **HTTP Method**: `GET`
- **Path**: `/pointclouds/stream-binary`
- **Response Content-Type**: `application/octet-stream`
- **Headers**:
  - `Content-Disposition`: `attachment; filename="pointcloud_lod{lod}.bin"`

### Parameters

| Parameter | Type | Location | Required | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `lod` | `integer` | Query | Yes | — | Level of Detail (LOD) pyramid level to stream (`0` represents full resolution / base LOD; selectable up to `10`). |
| `query` | `string` | Query | Yes | — | SQL selection query. Client formats query string (e.g. replacing `pointcloud_patches` with `pointcloud_patches_lod{lod}`). Example: `SELECT PC_Explode(patch) AS pt FROM pointcloud_patches WHERE pointcloud_id = 'e360394b-a241-49e5-bb66-97fee8bd85ef'` |

---

## Stream Pointcloud Summary (`/pointclouds/stream-summary` & `/stream-summary`)

The `/pointclouds/stream-summary` (also available via `/stream-summary`) endpoint mirrors `/pointclouds/stream-binary` parameters (`lod` and `query`) but instead of streaming binary vertex buffers, it returns a JSON summary containing the total point count, spatial 3D bounding box, connected pointcloud metadata, and connected camera headers selected by the custom query.

### Endpoint Specification

- **HTTP Method**: `GET`
- **Paths**: `/pointclouds/stream-summary`, `/stream-summary`
- **Response Content-Type**: `application/json`

### Query Logic

To optimize performance and avoid memory overhead, the summary query transforms point selection queries (`SELECT PC_Explode(patch) AS pt FROM ...`) into patch selection queries (`SELECT * FROM ...`). It computes point counts and spatial bounding boxes directly using PostGIS `pgPointCloud` patch header aggregate functions (`SUM(PC_NumPoints(patch))`, `PC_PatchMin`, and `PC_PatchMax`):

```sql
-- Transformed stream-summary query:
-- Input query: SELECT PC_Explode(patch) AS pt FROM pointcloud_patches WHERE pointcloud_id = 'e360394b-a241-49e5-bb66-97fee8bd85ef'
-- Converted patch summary query:
SELECT 
    COALESCE(SUM(PC_NumPoints(patch)), 0) AS total_points,
    MIN(PC_PatchMin(patch, 'X')) AS min_x,
    MIN(PC_PatchMin(patch, 'Y')) AS min_y,
    MIN(PC_PatchMin(patch, 'Z')) AS min_z,
    MAX(PC_PatchMax(patch, 'X')) AS max_x,
    MAX(PC_PatchMax(patch, 'Y')) AS max_y,
    MAX(PC_PatchMax(patch, 'Z')) AS max_z
FROM (
    SELECT * FROM pointcloud_patches_lod0 WHERE pointcloud_id = 'e360394b-a241-49e5-bb66-97fee8bd85ef'
) AS points;
```

### Response Example

```json
{
  "total_points": 150000,
  "number_of_points": 150000,
  "bounding_box": {
    "min_x": -10.5,
    "min_y": -5.2,
    "min_z": 0.0,
    "max_x": 20.3,
    "max_y": 15.8,
    "max_z": 12.4
  },
  "connected_pointclouds": [
    {
      "id": "e360394b-a241-49e5-bb66-97fee8bd85ef",
      "orig_filename": "underwater_scan.ply",
      "number_of_points": 150000,
      "created_at": "2026-08-14T10:00:00Z",
      "pcid": 1,
      "transform_matrix": [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]
    }
  ],
  "connected_camera_headers": [
    {
      "id": "c160394b-a241-49e5-bb66-97fee8bd85ef",
      "pointcloud_id": "e360394b-a241-49e5-bb66-97fee8bd85ef",
      "focal": 1000.0,
      "width": 1920,
      "height": 1080,
      "camera": "pinhole",
      "created_at": "2026-08-14T10:00:00Z"
    }
  ]
}
```

---

## Binary Data Layout & Protocol

Each point (vertex) in the binary stream is packed sequentially using a 16-byte aligned struct:

| Field | Data Type | Byte Offset | Size (Bytes) | Endianness | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `X` | `Float32` (`float`) | 0 | 4 | Little-endian | Spatial X coordinate |
| `Y` | `Float32` (`float`) | 4 | 4 | Little-endian | Spatial Y coordinate |
| `Z` | `Float32` (`float`) | 8 | 4 | Little-endian | Spatial Z coordinate |
| `R` | `Uint8` (`unsigned char`) | 12 | 1 | — | Red color channel (`0-255`) |
| `G` | `Uint8` (`unsigned char`) | 13 | 1 | — | Green color channel (`0-255`) |
| `B` | `Uint8` (`unsigned char`) | 14 | 1 | — | Blue color channel (`0-255`) |
| `A / Pad` | `Uint8` (`unsigned char`) | 15 | 1 | — | Alpha / Alignment Padding (`255`) |

- **Total Vertex Stride**: `16 bytes per point`.
- **Chunked Transfer Encoding**: Data is yielded asynchronously in chunk buffers of `524,288 bytes` (512 KB, ~32,768 vertices per chunk) via FastAPI `StreamingResponse`.

---

## Implementation Architecture

```
[ Frontend: WebGL / Three.js ]
            │
            ▼ GET /pointclouds/stream-binary?lod=0&query=...
┌─────────────────────────────────────────────────────────────┐
│ FastApi Router: pointclouds.py                              │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ Service: DatabasePointCloudStorageService (database.py)     │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ Exporter: BinaryStreamExporter (binary_exporter.py)         │
│   • Formats points via NumPy bulk array serialization       │
│     np.array(points_batch, dtype=VERTEX_DTYPE).tobytes()    │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ Repository: PointCloudRepository (pointcloud_repository.py) │
│   • Executes pgPointCloud query: PC_Explode() & PC_Get()    │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
        [ PostgreSQL / PostGIS pgPointCloud Storage ]
```

### Key Source Code References

1. **API Route**: [`app/api/routes/pointclouds.py`](file:///home/tastegger/Documents/SeaSee-r/backend/app/api/routes/pointclouds.py#L43-L50)
2. **Database Storage Service**: [`app/services/pointcloud/database.py`](file:///home/tastegger/Documents/SeaSee-r/backend/app/services/pointcloud/database.py#L24-L56)
3. **Binary Stream Exporter**: [`app/services/pointcloud/exporters/binary_exporter.py`](file:///home/tastegger/Documents/SeaSee-r/backend/app/services/pointcloud/exporters/binary_exporter.py#L9-L34)
4. **PointCloud Repository (SQL Streaming)**: [`app/repositories/pointcloud_repository.py`](file:///home/tastegger/Documents/SeaSee-r/backend/app/repositories/pointcloud_repository.py#L80-L108)
5. **Frontend Client Context & Stream Loader**: [`PLYPointCloudContext.tsx`](file:///home/tastegger/Documents/SeaSee-r/seaseer-dashboard/src/components/PointCloudPanel/PLYPointCloudContext.tsx) & [`pointCloudLoader.ts`](file:///home/tastegger/Documents/SeaSee-r/seaseer-dashboard/src/components/PointCloudPanel/utils/pointCloudLoader.ts)

---

## Response & Error Handling

- **`200 OK`**: Successfully returns an octet-stream chunked payload of 15-byte vertex records.
- **`400 Bad Request`**: Returned if the `identifier` cannot be parsed into a valid UUID string format.
- **`404 Not Found`**: Returned if no point cloud metadata record exists for the provided UUID.
- **`500 Internal Server Error`**: Database streaming or query failure.
