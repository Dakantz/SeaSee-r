import { useState } from "react";
import * as THREE from "three";

export interface PositionSample {
    relativeTime: number;
    x: number;
    y: number;
    z: number;
}

/**
 * Hook to find the closest trajectory point (vertex) based on 2D screen-space pixel distance.
 */
export function useTrajectoryClosestPoint(
    samples: PositionSample[],
    size: { width: number; height: number },
    thresholdPx: number = 30
) {
    const [hoveredPoint, setHoveredPoint] = useState<[number, number, number] | null>(null);

    const onPointerMove = (event: any) => {
        event.stopPropagation();
        if (event.point && samples && samples.length > 0) {
            const camera = event.camera;
            const { width, height } = size; // Viewport size passed from useThree()
            const mouseNDC = event.pointer || event.mouse; // Mouse position in NDC space (-1 to 1)

            const tempV = new THREE.Vector3();
            const objectWorldMatrix = event.object.matrixWorld;

            let closestSample = samples[0];
            let minPixelDist = Infinity;

            for (const sample of samples) {
                // 1. Convert local coordinate to world space
                tempV.set(sample.x, sample.y, sample.z);
                tempV.applyMatrix4(objectWorldMatrix);

                // 2. Project world space coordinate to camera NDC space (-1 to 1)
                tempV.project(camera);

                // 3. Compute 2D pixel distance on screen
                const dx = (tempV.x - mouseNDC.x) * (width / 2);
                const dy = (tempV.y - mouseNDC.y) * (height / 2);
                const dist = Math.sqrt(dx * dx + dy * dy);

                if (dist < minPixelDist) {
                    minPixelDist = dist;
                    closestSample = sample;
                }
            }

            // Highlight the point if the mouse is within the screen pixel threshold
            if (minPixelDist <= thresholdPx) {
                setHoveredPoint([closestSample.x, closestSample.y, closestSample.z]);
            } else {
                setHoveredPoint(null);
            }
        }
    };

    const onPointerOut = (event: any) => {
        event.stopPropagation();
        setHoveredPoint(null);
    };

    return {
        hoveredPoint,
        pointerMoveProps: {
            onPointerMove,
            onPointerOut,
        },
    };
}
