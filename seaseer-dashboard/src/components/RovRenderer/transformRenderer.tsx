import {
    useEffect,
    useMemo,
    useRef,
} from "react";

import { useGLTF } from "@react-three/drei";
import * as THREE from "three";

import { useRoverStore } from "../../store/roverStore";
import { useTimelineStore } from "../../store/timelineStore";

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

const MODEL_URL =
    "/model-assets/fifishModel.glb";

// How frequently the interpolated orientation is calculated (16ms ≈ 60 FPS).
const SLERP_UPDATE_INTERVAL_MS = 16;

// Seconds before end of current pair to prefetch the next pair.
const PREFETCH_THRESHOLD_SECONDS = 0.1;

function toVector3(
    values: [number, number, number]
): [number, number, number] {
    return [
        values[0],
        values[1],
        values[2],
    ];
}

interface TimedSample {
    relativeTime: number;
}

interface SamplePair<TSample extends TimedSample> {
    previous: TSample;
    next: TSample;
}

interface TelemetryPairReader<
    TSample extends TimedSample,
    TPair extends SamplePair<TSample>
> {
    getInitialPair: (
        startTime?: number
    ) => Promise<TPair | null>;
    getNextPair: () => Promise<TPair | null>;
    reset: () => void;
}

interface UseTelemetryInterpolationLoopParams<
    TSample extends TimedSample,
    TPair extends SamplePair<TSample>
> {
    enabled: boolean;
    reader: TelemetryPairReader<
        TSample,
        TPair
    > | null;
    interpolationName: string;
    interpolate: (
        previous: TSample,
        next: TSample,
        currentTime: number
    ) => TSample;
    applySample: (
        sample: TSample
    ) => void;
}

function useTelemetryInterpolationLoop<
    TSample extends TimedSample,
    TPair extends SamplePair<TSample>
>({
    enabled,
    reader,
    interpolationName,
    interpolate,
    applySample,
}: UseTelemetryInterpolationLoopParams<
    TSample,
    TPair
>) {
    const activePairRef =
        useRef<TPair | null>(null);

    const prefetchedPairRef =
        useRef<TPair | null>(null);

    const prefetchingRef =
        useRef(false);

    const initializingRef =
        useRef(false);

    const telemetryEndedRef =
        useRef(false);

    const loopStartTimeRef =
        useRef(0);

    const previousGlobalTimeRef =
        useRef(0);

    // Reset local state variables when the telemetry source changes.
    useEffect(() => {
        if (!enabled || !reader) {
            return;
        }

        const currentTime =
            useTimelineStore
                .getState()
                .currentTime;

        activePairRef.current =
            null;

        prefetchedPairRef.current =
            null;

        prefetchingRef.current =
            false;

        initializingRef.current =
            false;

        telemetryEndedRef.current =
            false;

        loopStartTimeRef.current =
            currentTime;

        previousGlobalTimeRef.current =
            currentTime;
    }, [enabled, reader]);

    useEffect(() => {
        if (!enabled || !reader) {
            return;
        }

        let cancelled = false;

        const restartTelemetry = async (
            globalTime: number
        ): Promise<boolean> => {
            reader.reset();

            const initialPair =
                await reader
                    .getInitialPair(0);

            if (
                cancelled ||
                !initialPair
            ) {
                return false;
            }

            loopStartTimeRef.current =
                globalTime;

            activePairRef.current =
                initialPair;

            prefetchedPairRef.current =
                null;

            telemetryEndedRef.current =
                false;

            applySample(
                initialPair.previous
            );

            console.log(
                `[TransformRenderer] ${interpolationName} telemetry restarted`
            );

            return true;
        };

        const update = async () => {
            const timeline =
                useTimelineStore.getState();

            const globalTime =
                timeline.currentTime;

            if (
                globalTime <
                previousGlobalTimeRef.current
            ) {
                previousGlobalTimeRef.current =
                    globalTime;

                await restartTelemetry(
                    globalTime
                );

                return;
            }

            previousGlobalTimeRef.current =
                globalTime;

            if (!timeline.isPlaying) {
                return;
            }

            const localTime =
                globalTime -
                loopStartTimeRef.current;

            if (
                !activePairRef.current &&
                !initializingRef.current
            ) {
                initializingRef.current =
                    true;

                try {
                    const initialPair =
                        await reader
                            .getInitialPair(
                                localTime
                            );

                    if (
                        cancelled ||
                        !initialPair
                    ) {
                        return;
                    }

                    activePairRef.current =
                        initialPair;

                    telemetryEndedRef.current =
                        false;
                } catch (error) {
                    console.error(
                        `Failed to initialize ${interpolationName} telemetry:`,
                        error
                    );
                } finally {
                    initializingRef.current =
                        false;
                }

                return;
            }

            let activePair =
                activePairRef.current;

            if (!activePair) {
                return;
            }

            if (
                localTime >=
                activePair.next
                    .relativeTime
            ) {
                if (
                    telemetryEndedRef.current
                ) {
                    await restartTelemetry(
                        globalTime
                    );

                    return;
                }

                if (
                    prefetchedPairRef.current
                ) {
                    activePairRef.current =
                        prefetchedPairRef.current;

                    prefetchedPairRef.current =
                        null;

                    activePair =
                        activePairRef.current;
                } else if (
                    !prefetchingRef.current
                ) {
                    prefetchingRef.current =
                        true;

                    try {
                        const nextPair =
                            await reader
                                .getNextPair();

                        if (cancelled) {
                            return;
                        }

                        if (!nextPair) {
                            await restartTelemetry(
                                globalTime
                            );

                            return;
                        }

                        activePairRef.current =
                            nextPair;

                        activePair =
                            nextPair;
                    } catch (error) {
                        console.error(
                            `Failed to advance ${interpolationName} telemetry:`,
                            error
                        );
                    } finally {
                        prefetchingRef.current =
                            false;
                    }

                    return;
                }
            }

            const timeUntilNext =
                activePair.next
                    .relativeTime -
                localTime;

            if (
                timeUntilNext <=
                PREFETCH_THRESHOLD_SECONDS &&
                timeUntilNext > 0 &&
                !prefetchedPairRef.current &&
                !prefetchingRef.current &&
                !telemetryEndedRef.current
            ) {
                prefetchingRef.current =
                    true;

                reader
                    .getNextPair()
                    .then((nextPair) => {
                        if (cancelled) {
                            return;
                        }

                        if (!nextPair) {
                            telemetryEndedRef.current =
                                true;

                            return;
                        }

                        prefetchedPairRef.current =
                            nextPair;
                    })
                    .catch((error) => {
                        console.error(
                            `Failed to prefetch ${interpolationName} telemetry:`,
                            error
                        );
                    })
                    .finally(() => {
                        prefetchingRef.current =
                            false;
                    });
            }

            applySample(
                interpolate(
                    activePair.previous,
                    activePair.next,
                    localTime
                )
            );
        };

        const interval =
            setInterval(
                update,
                SLERP_UPDATE_INTERVAL_MS
            );

        return () => {
            cancelled = true;

            clearInterval(interval);
        };
    }, [
        enabled,
        reader,
        interpolate,
        applySample,
        interpolationName,
    ]);
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