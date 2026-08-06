import Delaunator from "delaunator";
import * as THREE from "three";

/**
 * Generates a Delaunay triangulation index for 2.5D terrain point cloud data.
 * Auto-detects the horizontal 2D projection plane (X-Z, X-Y, or Y-Z) based on coordinate ranges.
 */
export function generateDelaunayTerrainMesh(geometry: THREE.BufferGeometry, force: boolean = false): void {
    if (!geometry) return;
    if (geometry.index && !force) return; // Geometry already has face indices and force is false

    // Clear all previous triangulation data (index buffer and vertex normals) before recalculating
    geometry.setIndex(null);
    if (geometry.attributes.normal) {
        geometry.deleteAttribute("normal");
    }

    const pos = geometry.attributes.position;
    if (!pos || pos.count < 3) return;

    const count = pos.count;

    // Find bounding box ranges to identify the height (vertical) axis
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;

    for (let i = 0; i < count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = pos.getZ(i);

        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
    }

    const rangeX = maxX - minX;
    const rangeY = maxY - minY;
    const rangeZ = maxZ - minZ;

    // Project points onto 2D plane.
    // Z is the primary vertical height/depth axis for 2.5D bathymetry/terrain point clouds.
    const coords = new Float64Array(count * 2);
    if (rangeZ <= rangeX || rangeZ <= rangeY) {
        // Z is height axis -> project onto horizontal X-Y plane
        for (let i = 0; i < count; i++) {
            coords[2 * i] = pos.getX(i);
            coords[2 * i + 1] = pos.getY(i);
        }
    } else if (rangeY <= rangeX && rangeY < rangeZ) {
        // Y is height axis -> project onto X-Z plane
        for (let i = 0; i < count; i++) {
            coords[2 * i] = pos.getX(i);
            coords[2 * i + 1] = pos.getZ(i);
        }
    } else {
        // X is height axis -> project onto Y-Z plane
        for (let i = 0; i < count; i++) {
            coords[2 * i] = pos.getY(i);
            coords[2 * i + 1] = pos.getZ(i);
        }
    }

    // Run 2D Delaunay Triangulation
    const delaunay = new Delaunator(coords);
    const triangles = delaunay.triangles; // Uint32Array of vertex indices

    if (triangles.length === 0) return;

    // Filter out huge exterior convex hull triangles (long edge artifact filtering)
    const totalTriangles = Math.floor(triangles.length / 3);
    const sampleCount = Math.min(1000, totalTriangles);
    const step = Math.max(1, Math.floor(totalTriangles / sampleCount));
    const sampledLengths: number[] = [];

    for (let s = 0; s < sampleCount; s++) {
        const t = s * step;
        const i0 = triangles[t * 3];
        const i1 = triangles[t * 3 + 1];
        const i2 = triangles[t * 3 + 2];

        const x0 = pos.getX(i0), y0 = pos.getY(i0), z0 = pos.getZ(i0);
        const x1 = pos.getX(i1), y1 = pos.getY(i1), z1 = pos.getZ(i1);
        const x2 = pos.getX(i2), y2 = pos.getY(i2), z2 = pos.getZ(i2);

        sampledLengths.push(
            Math.hypot(x0 - x1, y0 - y1, z0 - z1),
            Math.hypot(x1 - x2, y1 - y2, z1 - z2),
            Math.hypot(x2 - x0, y2 - y0, z2 - z0)
        );
    }

    sampledLengths.sort((a, b) => a - b);
    const medianDist = sampledLengths.length > 0 ? sampledLengths[Math.floor(sampledLengths.length / 2)] : 0;
    const maxEdgeLen = medianDist > 0 ? medianDist * 8 : Infinity;

    const validIndices: number[] = [];
    for (let i = 0; i < triangles.length; i += 3) {
        const i0 = triangles[i];
        const i1 = triangles[i + 1];
        const i2 = triangles[i + 2];

        const x0 = pos.getX(i0), y0 = pos.getY(i0), z0 = pos.getZ(i0);
        const x1 = pos.getX(i1), y1 = pos.getY(i1), z1 = pos.getZ(i1);
        const x2 = pos.getX(i2), y2 = pos.getY(i2), z2 = pos.getZ(i2);

        const d12 = Math.hypot(x0 - x1, y0 - y1, z0 - z1);
        const d23 = Math.hypot(x1 - x2, y1 - y2, z1 - z2);
        const d31 = Math.hypot(x2 - x0, y2 - y0, z2 - z0);

        if (d12 <= maxEdgeLen && d23 <= maxEdgeLen && d31 <= maxEdgeLen) {
            validIndices.push(i0, i1, i2);
        }
    }

    const useValid = validIndices.length > 0 && validIndices.length >= Math.floor(triangles.length * 0.05);
    const indexArray = new Uint32Array(useValid ? validIndices : triangles);
    geometry.setIndex(new THREE.BufferAttribute(indexArray, 1));
    if (geometry.index) {
        geometry.index.needsUpdate = true;
    }
    geometry.computeVertexNormals();
    if (geometry.attributes.normal) {
        geometry.attributes.normal.needsUpdate = true;
    }
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
}
