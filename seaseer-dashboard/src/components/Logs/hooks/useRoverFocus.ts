import { useCallback } from "react";
import * as THREE from "three";
import { usePLYPointCloudContext } from "../../PointCloudPanel/PLYPointCloudContext";
import type { ComputedTelemetryPoint } from "../types";

const TARGET_X = 50.0;
const TARGET_Y = 50.0;

/**
 * Custom hook to focus the 3D scene camera directly on the ROV position & viewpoint.
 * Hooks into the existing setCameraView inside PLYPointCloudContext and CameraFocusController
 * in PLYPointCloud.tsx from the outside, without requiring any edits to PLYPointCloudContext or PLYPointCloud.
 */
export function useRoverFocus() {
    const { setCameraView, summaryMap, mode } = usePLYPointCloudContext();

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

            // Route offset matching DBCameraTrajectoryDisplay
            const routeOffset = new THREE.Vector3(
                mode === "plyUrl" ? TARGET_X : 0,
                mode === "plyUrl" ? TARGET_Y : 0,
                0
            );

            // 1. Compute 3D camera position in world coordinates
            const localPos = new THREE.Vector3(point.x, point.y, point.z);
            const worldPos = localPos.clone().add(routeOffset);

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

            // 3. Compute camera vertical FOV (in degrees) from camera header focal length
            let fovDeg: number | undefined = undefined;
            if (point.cameraHeaderId && summaryMap) {
                for (const summary of Object.values(summaryMap)) {
                    const header = summary?.connected_camera_headers?.find(
                        (h) => h.id === point.cameraHeaderId
                    );
                    if (
                        header &&
                        typeof header.focal === "number" &&
                        header.width &&
                        header.height
                    ) {
                        const maxDim = Math.max(header.width, header.height);
                        const focalPixels = header.focal * maxDim;
                        if (focalPixels > 0) {
                            const fovRad = 2 * Math.atan(header.height / 2 / focalPixels);
                            fovDeg = fovRad * (180 / Math.PI);
                            break;
                        }
                    }
                }
            }

            // Call the built-in focus hook that already exists inside PLYPointCloudContext!
            setCameraView({
                position: [worldPos.x, worldPos.y, worldPos.z],
                quaternion: [worldQuat.x, worldQuat.y, worldQuat.z, worldQuat.w],
                fov: fovDeg,
            });
        },
        [setCameraView, summaryMap, mode]
    );

    return { focusOnRover };
}
