# Camera Metadata & Route Endpoints (`/camera-headers` & `/camera-routes`)

## Overview
Photogrammetry and Structure from Motion (SfM) pipelines (such as OpenSfM) reconstruct 3D point clouds alongside synchronized camera trajectory data. The camera endpoints expose camera intrinsics/headers and ordered 3D trajectory camera frames associated with point cloud datasets.

These endpoints enable the visualizer dashboard to render camera paths, spatial photo locations, and camera viewing directions aligned in 3D space with point cloud models.

---

## Endpoints Summary

1. **`GET /pointclouds/{identifier}/camera-headers`**
   - Retrieves all camera headers (camera models, focal length, pixel resolution) linked to a specific point cloud dataset.
2. **`GET /pointclouds/{identifier}/camera-routes`**
   - Retrieves all ordered 3D camera frames (positions, direction vectors, timestamps, filenames) across all camera headers belonging to a given point cloud dataset.

---

## Endpoint Specifications

### 1. `GET /pointclouds/{identifier}/camera-headers`

Retrieves all camera metadata headers linked to the specified point cloud dataset ID.

- **Path**: `/pointclouds/{identifier}/camera-headers`
- **HTTP Method**: `GET`
- **Response Model**: `List[CameraHeaderResponse]`

#### Path Parameters
| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `identifier` | `string` (UUID) | Yes | Unique ID of the point cloud metadata entry. |

#### JSON Response Example (`200 OK`)
```json
[
  {
    "id": "c1f23a45-e89b-12d3-a456-426614174000",
    "pointcloud_id": "550e8400-e29b-41d4-a716-446655440000",
    "focal": 0.85,
    "width": 1920,
    "height": 1080,
    "camera": "v2 pinhole perspective",
    "created_at": "2026-08-13T10:00:00Z"
  }
]
```

---

### 2. `GET /pointclouds/{identifier}/camera-routes`

Retrieves all camera frames for all camera headers linked to the specified point cloud dataset, ordered by frame `timestamp` ascending.

- **Path**: `/pointclouds/{identifier}/camera-routes`
- **HTTP Method**: `GET`
- **Response Model**: `List[CameraFrameResponse]`

#### Path Parameters
| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `identifier` | `string` (UUID) | Yes | Unique ID of the point cloud metadata entry. |

#### JSON Response Example (`200 OK`)
```json
[
  {
    "id": "d2f34b56-f90c-23e4-b567-537725285111",
    "camera_header_id": "c1f23a45-e89b-12d3-a456-426614174000",
    "timestamp": 1690000000000,
    "position": [-12.34, 5.67, 102.89],
    "direction": [0.0, 0.7071, -0.7071],
    "relative_time": 0.0,
    "filename": "frame_0001.jpg"
  },
  {
    "id": "e3f45c67-001d-34f5-c678-648836396222",
    "camera_header_id": "c1f23a45-e89b-12d3-a456-426614174000",
    "timestamp": 1690000033000,
    "position": [-12.10, 5.80, 102.95],
    "direction": [0.01, 0.7070, -0.7071],
    "relative_time": 0.033,
    "filename": "frame_0002.jpg"
  }
]
```

---

## Database Architecture & PostGIS Integration

The camera data model is split into headers (intrinsics) and frames (extrinsics/spatial points):

```
┌─────────────────────────┐
│   pointcloud_metadata   │
└────────────┬────────────┘
             │ 1
             │
             │ N (CASCADE Delete)
             ▼
┌─────────────────────────┐
│     camera_headers      │
│ ─────────────────────── │
│ • id (UUID)             │
│ • pointcloud_id (UUID)  │
│ • focal, width, height  │
│ • camera (String)       │
└────────────┬────────────┘
             │ 1
             │
             │ N (CASCADE Delete)
             ▼
┌─────────────────────────┐
│      camera_frames      │
│ ─────────────────────── │
│ • id (UUID)             │
│ • camera_header_id(UUID)│
│ • timestamp (BigInt)    │
│ • position (Geometry)   │ ◄── PostGIS POINTZ (3D Position)
│ • direction (Geometry)  │ ◄── PostGIS POINTZ (3D Direction)
│ • relative_time (Float) │
│ • filename (String)     │
└─────────────────────────┘
```

### Spatial Serialization (GeoJSON Extraction)
Spatial columns (`position` and `direction`) are stored as PostGIS 3D Point geometries (`POINTZ`). In SQLAlchemy queries, GeoAlchemy2's `ST_AsGeoJSON` function converts PostGIS geometries into GeoJSON strings, which are parsed to extract array coordinates `[x, y, z]`:

```python
query = select(
    CameraFrame.id,
    CameraFrame.camera_header_id,
    CameraFrame.timestamp,
    ST_AsGeoJSON(CameraFrame.position).label("pos_geojson"),
    ST_AsGeoJSON(CameraFrame.direction).label("dir_geojson"),
    CameraFrame.relative_time,
    CameraFrame.filename
).where(CameraFrame.camera_header_id.in_(header_ids)).order_by(CameraFrame.timestamp.asc())
```

---

## Key Source Code References

- **API Routes**: [`app/api/routes/pointclouds.py`](file:///home/tastegger/Documents/SeaSee-r/backend/app/api/routes/pointclouds.py#L101-L166)
- **Database Models**: [`app/models/camera.py`](file:///home/tastegger/Documents/SeaSee-r/backend/app/models/camera.py#L10-L32) (`CameraHeader`, `CameraFrame`)
- **Pydantic Schemas**: [`app/schemas/pointcloud.py`](file:///home/tastegger/Documents/SeaSee-r/backend/app/schemas/pointcloud.py#L39-L61) (`CameraHeaderResponse`, `CameraFrameResponse`)
- **Frontend Sidebar Sync**: [`PointCloudSidebar.tsx`](file:///home/tastegger/Documents/SeaSee-r/seaseer-dashboard/src/components/PointCloudEditor/PointCloudSidebar.tsx#L95-L124)

---

## Error Handling & Status Codes

- **`200 OK`**: Returns array of headers or frames (returns empty list `[]` if no matching headers/routes exist).
- **`400 Bad Request`**: Returned if `identifier` is not a valid UUID string.
- **`500 Internal Server Error`**: Database or spatial query execution failure.
