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