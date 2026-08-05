import Delaunator from "delaunator";
import * as THREE from "three";

/**
 * Generates a Delaunay triangulation index for 2.5D terrain point cloud data.
 * Auto-detects the horizontal 2D projection plane (X-Z, X-Y, or Y-Z) based on coordinate ranges.
 */
export function generateDelaunayTerrainMesh(geometry: THREE.BufferGeometry): void {
    if (!geometry || geometry.index) return; // Geometry already has face indices

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

    // Project points onto 2D plane by picking the 2 axes with largest spatial extent
    const coords = new Float64Array(count * 2);
    if (rangeY <= rangeX && rangeY <= rangeZ) {
        // Y is height axis -> project onto X-Z plane
        for (let i = 0; i < count; i++) {
            coords[2 * i] = pos.getX(i);
            coords[2 * i + 1] = pos.getZ(i);
        }
    } else if (rangeZ <= rangeX && rangeZ <= rangeY) {
        // Z is height axis -> project onto X-Y plane
        for (let i = 0; i < count; i++) {
            coords[2 * i] = pos.getX(i);
            coords[2 * i + 1] = pos.getY(i);
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
    const posArr = pos.array;
    const sampleCount = Math.min(1000, Math.floor(triangles.length / 3));
    let totalDist = 0;

    for (let t = 0; t < sampleCount; t++) {
        const i0 = triangles[t * 3];
        const i1 = triangles[t * 3 + 1];
        const dx = posArr[i0 * 3] - posArr[i1 * 3];
        const dy = posArr[i0 * 3 + 1] - posArr[i1 * 3 + 1];
        const dz = posArr[i0 * 3 + 2] - posArr[i1 * 3 + 2];
        totalDist += Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    const avgDist = sampleCount > 0 ? totalDist / sampleCount : 0;
    const maxEdgeLen = avgDist > 0 ? avgDist * 8 : Infinity;

    const validIndices: number[] = [];
    for (let i = 0; i < triangles.length; i += 3) {
        const i0 = triangles[i];
        const i1 = triangles[i + 1];
        const i2 = triangles[i + 2];

        const x0 = posArr[i0 * 3], y0 = posArr[i0 * 3 + 1], z0 = posArr[i0 * 3 + 2];
        const x1 = posArr[i1 * 3], y1 = posArr[i1 * 3 + 1], z1 = posArr[i1 * 3 + 2];
        const x2 = posArr[i2 * 3], y2 = posArr[i2 * 3 + 1], z2 = posArr[i2 * 3 + 2];

        const d12 = Math.hypot(x0 - x1, y0 - y1, z0 - z1);
        const d23 = Math.hypot(x1 - x2, y1 - y2, z1 - z2);
        const d31 = Math.hypot(x2 - x0, y2 - y0, z2 - z0);

        if (d12 <= maxEdgeLen && d23 <= maxEdgeLen && d31 <= maxEdgeLen) {
            validIndices.push(i0, i1, i2);
        }
    }

    const indexArray = new Uint32Array(validIndices.length > 0 ? validIndices : triangles);
    geometry.setIndex(new THREE.BufferAttribute(indexArray, 1));
    geometry.computeVertexNormals();
}
