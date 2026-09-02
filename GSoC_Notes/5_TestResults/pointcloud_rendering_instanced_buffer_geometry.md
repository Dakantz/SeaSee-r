# Performance Test: Instanced Buffer Geometry Point Cloud Rendering in Three.js

## Overview
This document records the performance benchmark for rendering 3D point clouds using Instanced Buffer Geometry in Three.js in `PLYPointCloud.tsx`.

## Test Parameters
- **Test Target:** Point cloud rendering with Instanced Buffer Geometry (`InstancedBufferGeometry` / `InstancedMesh`)
- **Component File:** `PLYPointCloud.tsx`
- **Total Pointcloud pointcount\*:** `98,441,860 pts`
- **Target Duration:** 30 seconds

\* Not all points are rendered. Based on distance to camera different LODs are used.

## Benchmark Results

### Summary Metrics
| Metric | Value |
| :--- | :--- |
| **Average FPS** | **~21.18** |
| **Recorded Duration** | **28 seconds** |

### Per-Second Log Data

| Second | FPS | Camera Position (x, y, z) |
| :---: | :---: | :--- |
| 1s | 23.19 | (10, -93.273, 9.327) |
| 2s | 21.89 | (10, -86.807, 8.681) |
| 3s | 21.83 | (10, -80.08, 8.008) |
| 4s | 18.96 | (10, -73.407, 7.341) |
| 5s | 21.07 | (10, -66.54, 6.654) |
| 6s | 19.72 | (10, -60.1, 6.01) |
| 7s | 23.95 | (10, -53.407, 5.341) |
| 8s | 21.16 | (10, -46.253, 4.625) |
| 9s | 22.22 | (10, -39.933, 3.993) |
| 10s | 20.55 | (10, -33.353, 3.335) |
| 11s | 24.98 | (10, -26.753, 2.675) |
| 12s | 28.82 | (10, -19.893, 1.989) |
| 13s | 25.10 | (10, -13.267, 1.327) |
| 14s | 32.87 | (10, -6.84, 0.684) |
| 15s | 27.29 | (10, -0.027, 0.003) |
| 16s | 23.50 | (10, 6.893, -0.689) |
| 17s | 22.77 | (10, 13.247, -1.325) |
| 18s | 20.77 | (10, 19.907, -1.991) |
| 19s | 19.27 | (10, 26.86, -2.686) |
| 20s | 18.81 | (10, 33.313, -3.331) |
| 21s | 17.72 | (10, 39.94, -3.994) |
| 22s | 16.75 | (10, 46.607, -4.661) |
| 23s | 17.68 | (10, 53.3, -5.33) |
| 24s | 18.20 | (10, 60.24, -6.024) |
| 25s | 16.59 | (10, 66.66, -6.666) |
| 26s | 14.59 | (10, 73.467, -7.347) |
| 27s | 16.39 | (10, 80.073, -8.007) |
| 28s | 16.52 | (10, 86.713, -8.671) |
