import { useState, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { PositionSample } from "../../TelemetoryPanel/TelemetryPositionReader";

/**
 * Hook to find the closest trajectory point (vertex) based on 2D screen-space pixel distance.
 */
export function useTrajectoryClosestPoint(
    samples: PositionSample[],
    size: { width: number; height: number },
    thresholdPx: number = 30,
    enabled: boolean = true,
    group: THREE.Group | null = null
) {
    const [hoveredPoint, setHoveredPoint] = useState<[number, number, number] | null>(null);
    const [hoveredSample, setHoveredSample] = useState<PositionSample | null>(null);

    useEffect(() => {
        if (hoveredPoint) {
            document.body.style.cursor = "pointer";
        } else {
            document.body.style.cursor = "auto";
        }
        return () => {
            document.body.style.cursor = "auto";
        };
    }, [hoveredPoint]);

    useFrame((state) => {
        if (!enabled || !group || !samples || samples.length === 0) {
            if (hoveredPoint !== null) {
                setHoveredPoint(null);
                setHoveredSample(null);
            }
            return;
        }

        const camera = state.camera;
        const pointer = state.pointer; // Mouse position in NDC space (-1 to 1)
        const { width, height } = size;

        const tempV = new THREE.Vector3();
        const objectWorldMatrix = group.matrixWorld;

        let closestSample = samples[0];
        let minPixelDist = Infinity;

        for (const sample of samples) {
            // 1. Convert local coordinate to world space
            tempV.set(sample.x, sample.y, sample.z);
            tempV.applyMatrix4(objectWorldMatrix);

            // 2. Project world space coordinate to camera NDC space (-1 to 1)
            tempV.project(camera);

            // 3. Compute 2D pixel distance on screen
            const dx = (tempV.x - pointer.x) * (width / 2);
            const dy = (tempV.y - pointer.y) * (height / 2);
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < minPixelDist) {
                minPixelDist = dist;
                closestSample = sample;
            }
        }

        // Highlight the point if the mouse is within the screen pixel threshold
        if (minPixelDist <= thresholdPx) {
            // Only trigger state updates if the hovered point changed to prevent infinite loops
            if (!hoveredPoint ||
                hoveredPoint[0] !== closestSample.x ||
                hoveredPoint[1] !== closestSample.y ||
                hoveredPoint[2] !== closestSample.z) {
                setHoveredPoint([closestSample.x, closestSample.y, closestSample.z]);
                setHoveredSample(closestSample);
            }
        } else {
            if (hoveredPoint !== null) {
                setHoveredPoint(null);
                setHoveredSample(null);
            }
        }
    });

    return {
        hoveredPoint,
        hoveredSample,
    };
}

