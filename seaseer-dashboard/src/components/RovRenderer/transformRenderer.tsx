import {
    useEffect,
    useMemo,
} from "react";

import { useGLTF } from "@react-three/drei";
import * as THREE from "three";

import { useRoverStore } from "../../store/roverStore";

import {
    TelemetryAttitudeReader,
} from "../TelemetoryPanel/TelemetryRotationReader";

import {
    TelemetryPositionReader,
} from "../TelemetoryPanel/TelemetryPositionReader";

import {
    slerpAttitude,
} from "../../utils/slerp_interpolation";

import {
    lerpPosition,
} from "../../utils/lerp_interpolation";

import { useTelemetryInterpolationLoop } from "../../hooks/useTelemetryInterpolationLoop";

const MODEL_URL =
    "/model-assets/fifishModel.glb";

function toVector3(
    values: [number, number, number]
): [number, number, number] {
    return [
        values[0],
        values[1],
        values[2],
    ];
}

interface TransformRendererProps {
    roverId: string;
    rotationUrl: string;
    positionUrl: string;
    rotationOffset?: [number, number, number];
    positionOffset?: [number, number, number];
}

export function TransformRenderer({
    roverId,
    rotationUrl,
    positionUrl,
    rotationOffset = [0, 0, 0],
    positionOffset = [0, 0, 0],
}: TransformRendererProps) {
    const rover = useRoverStore(
        (state) => state.rovers[roverId]
    );

    const setOrientation = useRoverStore(
        (state) => state.setOrientation
    );

    const setPosition = useRoverStore(
        (state) => state.setPosition
    );

    const { scene } =
        useGLTF(MODEL_URL);

    const roverScene = useMemo(
        () => scene.clone(true),
        [scene]
    );

    const hasRotationTelemetry =
        rotationUrl.trim().length > 0;

    const hasPositionTelemetry =
        positionUrl.trim().length > 0;

    const defaultPosition =
        useMemo(
            () => toVector3(positionOffset),
            [positionOffset]
        );

    const defaultOrientation =
        useMemo(
            () => toVector3(rotationOffset),
            [rotationOffset]
        );

    // Instantiate telemetry attitude reader for this rover.
    const attitudeReader = useMemo(
        () =>
            hasRotationTelemetry
                ? new TelemetryAttitudeReader(
                      rotationUrl
                  )
                : null,
        [
            hasRotationTelemetry,
            rotationUrl,
        ]
    );

    // Instantiate telemetry position reader for this rover.
    const positionReader = useMemo(
        () =>
            hasPositionTelemetry
                ? new TelemetryPositionReader(
                      positionUrl
                  )
                : null,
        [
            hasPositionTelemetry,
            positionUrl,
        ]
    );

    // If rotation telemetry is disabled, keep rover at default orientation.
    useEffect(() => {
        if (hasRotationTelemetry) {
            return;
        }

        setOrientation(
            roverId,
            defaultOrientation[0],
            defaultOrientation[1],
            defaultOrientation[2]
        );
    }, [
        hasRotationTelemetry,
        roverId,
        defaultOrientation,
        setOrientation,
    ]);

    // If position telemetry is disabled, keep rover at default position.
    useEffect(() => {
        if (hasPositionTelemetry) {
            return;
        }

        setPosition(
            roverId,
            defaultPosition
        );
    }, [
        hasPositionTelemetry,
        roverId,
        defaultPosition,
        setPosition,
    ]);


    useTelemetryInterpolationLoop({
        enabled: hasRotationTelemetry,
        reader: attitudeReader,
        interpolationName: "attitude",
        interpolate: slerpAttitude,
        applySample: (attitude) => {
            setOrientation(
                roverId,
                attitude.yaw +
                    rotationOffset[0],
                attitude.pitch +
                    rotationOffset[1],
                attitude.roll +
                    rotationOffset[2]
            );
        },
    });

    useTelemetryInterpolationLoop({
        enabled: hasPositionTelemetry,
        reader: positionReader,
        interpolationName: "position",
        interpolate: lerpPosition,
        applySample: (position) => {
            setPosition(roverId, [
                position.x +
                    positionOffset[0],
                position.y +
                    positionOffset[1],
                position.z +
                    positionOffset[2],
            ]);
        },
    });

    if (!rover) {
        return null;
    }

    return (
        <primitive
            object={roverScene}
            position={rover.position}
            rotation={[
                THREE.MathUtils.degToRad(
                    rover.pitch
                ),
                THREE.MathUtils.degToRad(
                    rover.yaw
                ),
                THREE.MathUtils.degToRad(
                    rover.roll
                ),
            ]}
        />
    );
}

useGLTF.preload(MODEL_URL);