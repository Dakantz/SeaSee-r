import { useEffect } from "react";
import * as THREE from "three";
import { usePLYPointCloudContext } from "./PLYPointCloudContext";
import { generateDelaunayTerrainMesh } from "./utils/delaunayTriangulation";

export default function PLYPointCloud() {
    const {
        geometry,
        mode,
        renderMode,
        wireframe,
        pointSize,
        identifier,
        lod,
        plyUrl,
        loadBinaryPointCloud,
        loadPlyUrl,
    } = usePLYPointCloudContext();

    useEffect(() => {
        if (mode === "binary") {
            loadBinaryPointCloud(identifier, lod);
        } else if (mode === "plyUrl") {
            loadPlyUrl(plyUrl);
        }
    }, [mode, identifier, lod, loadBinaryPointCloud, loadPlyUrl]);

    useEffect(() => {
        if (geometry && renderMode === "mesh") {
            generateDelaunayTerrainMesh(geometry, true);
        }
    }, [geometry, renderMode]);

    return (
        <group>
            {geometry && (
                renderMode === "mesh" ? (
                    <mesh geometry={geometry} rotation={[-Math.PI / 2, 0, 0]}>
                        <meshStandardMaterial
                            vertexColors={!!geometry.attributes.color}
                            side={THREE.DoubleSide}
                            wireframe={wireframe}
                            roughness={0.5}
                            metalness={0.1}
                        />
                    </mesh>
                ) : (
                    <points geometry={geometry} rotation={[-Math.PI / 2, 0, 0]}>
                        <pointsMaterial
                            vertexColors={!!geometry.attributes.color}
                            size={pointSize}
                            sizeAttenuation
                        />
                    </points>
                )
            )}
        </group>
    );
}