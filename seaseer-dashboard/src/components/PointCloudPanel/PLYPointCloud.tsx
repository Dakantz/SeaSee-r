import { useEffect } from "react";
import { usePLYPointCloudContext } from "./PLYPointCloudContext";

export default function PLYPointCloud() {
    const {
        geometry,
        mode,
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

    return (
        <group>
            {geometry && (
                <points geometry={geometry} rotation={[-Math.PI / 2, 0, 0]}>
                    <pointsMaterial
                        vertexColors={!!geometry.attributes.color}
                        size={0.1}
                        sizeAttenuation
                    />
                </points>
            )}
        </group>
    );
}