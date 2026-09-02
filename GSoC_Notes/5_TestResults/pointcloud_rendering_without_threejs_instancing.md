# Performance Test: Point Cloud Rendering Without Three.js Instancing

## Overview
This document records the performance benchmark for rendering 3D point clouds without Three.js instancing in `PLYPointCloud.tsx`.

## Test Parameters
- **Test Target:** Point cloud rendering without Three.js instancing
- **Component File:** `PLYPointCloud.tsx`
- **Total Pointcloud pointcount\*:** `98,441,860 pts`
- **Target Duration:** 30 seconds

\* Not all points are rendered. Based on distance to camera different LODs are used.

## Benchmark Results

### Summary Metrics
| Metric | Value |
| :--- | :--- |
| **Average FPS** | **15.36** |
| **Total Frames** | **461** |
| **Total Duration** | **30.01s** |

### Per-Second Log Data

| Second | FPS | Camera Position (x, y, z) |
| :---: | :---: | :--- |
| 1s | 16.83 | (10, -93.513, 9.351) |
| 2s | 17.98 | (10, -86.747, 8.675) |
| 3s | 13.99 | (10, -80.2, 8.02) |
| 4s | 15.89 | (10, -73.493, 7.349) |
| 5s | 18.89 | (10, -66.873, 6.687) |
| 6s | 15.98 | (10, -60.207, 6.021) |
| 7s | 15.27 | (10, -53.227, 5.323) |
| 8s | 13.97 | (10, -46.747, 4.675) |
| 9s | 14.48 | (10, -39.98, 3.998) |
| 10s | 13.36 | (10, -33.227, 3.323) |
| 11s | 12.83 | (10, -26.793, 2.679) |
| 12s | 13.41 | (10, -19.787, 1.979) |
| 13s | 16.14 | (10, -13.227, 1.323) |
| 14s | 16.68 | (10, -6.553, 0.655) |
| 15s | 14.61 | (10, 0.1, -0.01) |
| 16s | 14.69 | (10, 6.593, -0.659) |
| 17s | 16.70 | (10, 13.207, -1.321) |
| 18s | 18.45 | (10, 20.673, -2.067) |
| 19s | 14.94 | (10, 26.473, -2.647) |
| 20s | 16.19 | (10, 33.46, -3.346) |
| 21s | 17.65 | (10, 40.1, -4.01) |
| 22s | 15.41 | (10, 46.673, -4.667) |
| 23s | 13.05 | (10, 53.607, -5.361) |
| 24s | 13.36 | (10, 60.107, -6.011) |
| 25s | 12.51 | (10, 67, -6.7) |
| 26s | 13.23 | (10, 73.5, -7.35) |
| 27s | 12.83 | (10, 80.027, -8.003) |
| 28s | 12.73 | (10, 86.72, -8.672) |
| 29s | 11.89 | (10, 93.327, -9.333) |
| 30s | 13.71 | (10, 100, -10) |