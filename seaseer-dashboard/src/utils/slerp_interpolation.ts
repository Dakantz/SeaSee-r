import * as THREE from "three";

import type {
    AttitudeSample,
} from "../components/TelemetoryPanel/TelemetryRotationReader";

export function slerpAttitude(
    previous: AttitudeSample,
    next: AttitudeSample,
    currentTime: number
): AttitudeSample {
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

    const previousEuler = new THREE.Euler(
        THREE.MathUtils.degToRad(previous.pitch),
        THREE.MathUtils.degToRad(previous.yaw),
        THREE.MathUtils.degToRad(previous.roll),
        "YXZ"
    );

    const nextEuler = new THREE.Euler(
        THREE.MathUtils.degToRad(next.pitch),
        THREE.MathUtils.degToRad(next.yaw),
        THREE.MathUtils.degToRad(next.roll),
        "YXZ"
    );

    const previousQuaternion =
        new THREE.Quaternion().setFromEuler(
            previousEuler
        );

    const nextQuaternion =
        new THREE.Quaternion().setFromEuler(
            nextEuler
        );

    const interpolatedQuaternion =
        previousQuaternion.clone().slerp(
            nextQuaternion,
            alpha
        );

    const interpolatedEuler =
        new THREE.Euler().setFromQuaternion(
            interpolatedQuaternion,
            "YXZ"
        );

    return {
        relativeTime: currentTime,

        yaw: THREE.MathUtils.radToDeg(
            interpolatedEuler.y
        ),

        pitch: THREE.MathUtils.radToDeg(
            interpolatedEuler.x
        ),

        roll: THREE.MathUtils.radToDeg(
            interpolatedEuler.z
        ),
    };
}