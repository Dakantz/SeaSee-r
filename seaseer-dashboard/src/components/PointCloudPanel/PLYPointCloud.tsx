import { useLoader } from "@react-three/fiber";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";
import { useEffect } from "react";

export default function PLYPointCloud() {
    const geometry = useLoader(PLYLoader, "/test_data/datasets/video_1/odm_filterpoints/point_cloud.ply");

    useEffect(() => {
        geometry.center();
        geometry.computeBoundingSphere();
    }, [geometry]);

    return (
        <points
            geometry={geometry}
            rotation={[-Math.PI / 2, 0, 0]}
        >
            <pointsMaterial
                vertexColors
                size={0.1}
                sizeAttenuation
            />
        </points>
    );
}