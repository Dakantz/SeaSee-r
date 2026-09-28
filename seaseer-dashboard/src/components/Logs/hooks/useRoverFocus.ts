import { useCallback } from "react";
import * as THREE from "three";
import { usePLYPointCloudContext } from "../../PointCloudPanel/PLYPointCloudContext";
import { getPointCloudTransform } from "../../PointCloudPanel/utils/pointCloudTransform";
import type { ComputedTelemetryPoint } from "../types";

/**
 * Custom hook to focus the 3D scene camera directly on the ROV position & viewpoint.
 * Hooks into the existing setCameraView inside PLYPointCloudContext and CameraFocusController
 * in PLYPointCloud.tsx from the outside, matching trajectory point focusing.
 */
export function useRoverFocus() {
    const { setCameraView, setIsCameraUpFixed, summaryMap, catalog } = usePLYPointCloudContext();

    const focusOnRover = useCallback(
        (
            point:
                | ComputedTelemetryPoint
                | {
                      x: number;
                      y: number;
                      z: number;
                      rotation?: [number, number, number, number];
                      direction?: [number, number, number];
                      cameraHeaderId?: string;
                      pointCloudId?: string;
                  }
        ) => {
            if (
                !point ||
                typeof point.x !== "number" ||
                typeof point.y !== "number" ||
                typeof point.z !== "number"
            ) {
                return;
            }

            setIsCameraUpFixed?.(false);

            // 1. Compute 3D camera position in world coordinates
            const worldPos = new THREE.Vector3(point.x, point.y, point.z);

            // 2. Compute 3D camera orientation quaternion in world coordinates
            let worldQuat: THREE.Quaternion;
            if (point.rotation && Array.isArray(point.rotation) && point.rotation.length === 4) {
                worldQuat = new THREE.Quaternion(
                    point.rotation[0],
                    point.rotation[1],
                    point.rotation[2],
                    point.rotation[3]
                );
            } else if (point.direction && Array.isArray(point.direction) && point.direction.length === 3) {
                const worldDir = new THREE.Vector3(
                    point.direction[0],
                    point.direction[1],
                    point.direction[2]
                ).normalize();

                const tempCam = new THREE.PerspectiveCamera();
                tempCam.up.set(0, 0, 1);
                tempCam.position.copy(worldPos);
                tempCam.lookAt(worldPos.clone().add(worldDir));
                worldQuat = tempCam.quaternion.clone();
            } else {
                worldQuat = new THREE.Quaternion();
            }

            // 3. Compute camera vertical FOV (in degrees) from camera header focal length & find associated pointcloud
            let fovDeg: number | undefined = undefined;
            let matchedHeaderPcId: string | undefined = undefined;

            if (point.cameraHeaderId && summaryMap) {
                for (const summary of Object.values(summaryMap)) {
                    const header = summary?.connected_camera_headers?.find(
                        (h) => h.id === point.cameraHeaderId
                    );
                    if (header) {
                        if (header.pointcloud_id) {
                            matchedHeaderPcId = header.pointcloud_id;
                        }
                        if (
                            typeof header.focal === "number" &&
                            header.width &&
                            header.height
                        ) {
                            const maxDim = Math.max(header.width, header.height);
                            const focalPixels = header.focal * maxDim;
                            if (focalPixels > 0) {
                                const fovRad = 2 * Math.atan(header.height / 2 / focalPixels);
                                fovDeg = fovRad * (180 / Math.PI);
                            }
                        }
                        break;
                    }
                }
            }

            // 4. Retrieve point cloud transformation matrix (full world matrix M_world) if applicable
            const targetId =
                ("pointCloudId" in point && typeof (point as { pointCloudId?: string }).pointCloudId === "string" && (point as { pointCloudId?: string }).pointCloudId) ||
                matchedHeaderPcId ||
                "";
            const { matrixArr } = getPointCloudTransform(targetId, summaryMap, catalog);

            if (matrixArr && matrixArr.length === 16) {
                const matWorld = new THREE.Matrix4().fromArray(matrixArr);
                worldPos.applyMatrix4(matWorld);

                const transformPos = new THREE.Vector3();
                const transformQuat = new THREE.Quaternion();
                const transformScale = new THREE.Vector3();
                matWorld.decompose(transformPos, transformQuat, transformScale);

                worldQuat.premultiply(transformQuat);
            }

            // Call the built-in focus hook in PLYPointCloudContext
            setCameraView({
                position: [worldPos.x, worldPos.y, worldPos.z],
                quaternion: [worldQuat.x, worldQuat.y, worldQuat.z, worldQuat.w],
                fov: fovDeg,
            });
        },
        [setCameraView, setIsCameraUpFixed, summaryMap, catalog]
    );

    return { focusOnRover };
}
