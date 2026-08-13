# Stream Pointcloud Binary (`/pointclouds/{identifier}/stream-binary`)

## Overview
The `/pointclouds/{identifier}/stream-binary` endpoint provides high-performance binary streaming of 3D point cloud data directly from PostgreSQL / PostGIS (`pgPointCloud`) storage to frontend WebGL visualizers (such as Three.js).

Instead of transferring bloated JSON structures or generating intermediate `.ply` files on disk, this endpoint streams raw point attribute buffers asynchronously. This minimizes network overhead, eliminates server-side disk I/O bottlenecks, and allows frontend clients to directly map incoming binary buffers into WebGL vertex attribute buffers (`BufferGeometry`).

---

## Endpoint Specification

- **HTTP Method**: `GET`
- **Path**: `/pointclouds/{identifier}/stream-binary`
- **Response Content-Type**: `application/octet-stream`
- **Headers**:
  - `Content-Disposition`: `attachment; filename="{pointcloud_uuid}_lod{lod}.bin"`

### Parameters

| Parameter | Type | Location | Required | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `identifier` | `string` | Path | Yes | — | UUID of the point cloud metadata entry (e.g., `550e8400-e29b-41d4-a716-446655440000`). Trailing query string parameters attached to the identifier are safely parsed and stripped. |
| `lod` | `integer` | Query | No | `0` | Level of Detail (LOD) pyramid level to stream (`0` represents full resolution / base LOD; selectable up to `10`). |

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
            ▼ GET /pointclouds/{id}/stream-binary?lod=0
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
5. **Frontend Client Parsing**: [`PLYPointCloudContext.tsx`](file:///home/tastegger/Documents/SeaSee-r/seaseer-dashboard/src/components/PointCloudPanel/PLYPointCloudContext.tsx#L153-L203)

---

## Response & Error Handling

- **`200 OK`**: Successfully returns an octet-stream chunked payload of 15-byte vertex records.
- **`400 Bad Request`**: Returned if the `identifier` cannot be parsed into a valid UUID string format.
- **`404 Not Found`**: Returned if no point cloud metadata record exists for the provided UUID.
- **`500 Internal Server Error`**: Database streaming or query failure.
