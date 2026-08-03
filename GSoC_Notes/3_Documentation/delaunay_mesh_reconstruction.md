# 2.5D Delaunay Triangulation Terrain Mesh Reconstruction

## Overview
Point cloud data (such as bathymetry or terrain scans) obtained from binary streams or point-only `.ply` files lack face index buffers (`geometry.index === null`). When switching the render mode to **Mesh**, a 2.5D Delaunay triangulation is performed to reconstruct a solid terrain surface mesh.

## Implementation Details

1. **Dependency**:
   - `delaunator` (2D Delaunay triangulation library).

2. **Algorithm Workflow (`generateDelaunayTerrainMesh`)**:
   - Located in [`delaunayTriangulation.ts`](file:///home/tastegger/Documents/SeaSee-r/seaseer-dashboard/src/components/PointCloudPanel/utils/delaunayTriangulation.ts).
   - **Plane Auto-Detection**: Inspects min/max ranges across X, Y, and Z axes. The axis with the smallest spatial range is selected as the vertical height axis (e.g. Y or Z), projecting the remaining 2 horizontal spatial dimensions onto a 2D plane for `Delaunator`.
   - **2D Delaunay Triangulation**: Computes Delaunay triangles using `Delaunator`.
   - **Artifact Edge Filtering**: Filters out artificially long boundary triangles (which span outer convex hull gaps) by comparing triangle edge lengths against an adaptive distance threshold.
   - **Normals & Index Buffer**: Populates `geometry.setIndex(...)` and calls `geometry.computeVertexNormals()` to enable realistic lighting and surface shading.

3. **Integration**:
   - Integrated into [`PLYPointCloud.tsx`](file:///home/tastegger/Documents/SeaSee-r/seaseer-dashboard/src/components/PointCloudPanel/PLYPointCloud.tsx).
