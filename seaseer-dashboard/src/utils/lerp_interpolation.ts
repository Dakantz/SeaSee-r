import * as THREE from "three";

import type { 
    PositionSample 
} from "../components/TelemetoryPanel/TelemetryPositionReader";

export function lerpPosition(
    previous: PositionSample,
    next: PositionSample,
    currentTime: number
): PositionSample {
    const timeRange =
        next.relativeTime - previous.relativeTime;

    if (timeRange <= 0) {
        return previous;
    }

    const alpha = THREE.MathUtils.clamp(
        (currentTime - previous.relativeTime) /
            timeRange,
        0,
        1
    );

    return {
        relativeTime: currentTime,

        x: THREE.MathUtils.lerp(
            previous.x,
            next.x,
            alpha
        ),

        y: THREE.MathUtils.lerp(
            previous.y,
            next.y,
            alpha
        ),

        z: THREE.MathUtils.lerp(
            previous.z,
            next.z,
            alpha
        ),
    };
}

export function inverseLerpPosition(
    previous: PositionSample,
    next: PositionSample,
    current: PositionSample | { x: number; y: number; z: number }
): number {
    const abX = next.x - previous.x;
    const abY = next.y - previous.y;
    const abZ = next.z - previous.z;

    const apX = current.x - previous.x;
    const apY = current.y - previous.y;
    const apZ = current.z - previous.z;

    const dotProduct = abX * apX + abY * apY + abZ * apZ;
    const abSquaredLength = abX * abX + abY * abY + abZ * abZ;

    if (abSquaredLength <= 0) {
        return 0;
    }

    return THREE.MathUtils.clamp(dotProduct / abSquaredLength, 0, 1);
}