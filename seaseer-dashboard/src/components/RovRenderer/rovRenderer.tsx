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
    type AttitudeSamplePair,
} from "../TelemetoryPanel/TelemetryReader";

import {
    slerpAttitude,
} from "../../utils/slerp_interpolation";

const MODEL_URL =
    "/model-assets/fifishModel.glb";

// How frequently the interpolated orientation is calculated (16ms ≈ 60 FPS).
const SLERP_UPDATE_INTERVAL_MS = 16;

// Seconds before end of current pair to prefetch the next pair.
const PREFETCH_THRESHOLD_SECONDS = 0.1;

interface RoverRendererProps {
    roverId: string;
    name: string;
    rotationUrl: string;
    positionUrl: string;
}

export function RoverRenderer({
    roverId,
    name,
    rotationUrl,
    positionUrl,
}: RoverRendererProps) {
    const rover = useRoverStore(
        (state) => state.rovers[roverId]
    );

    const addRover = useRoverStore(
        (state) => state.addRover
    );

    const setOrientation = useRoverStore(
        (state) => state.setOrientation
    );

    const { scene } =
        useGLTF(MODEL_URL);

    // Instantiate telemetry attitude reader for this rover.
    const attitudeReader = useMemo(
        () =>
            new TelemetryAttitudeReader(
                rotationUrl
            ),
        [rotationUrl]
    );

    // Current sample pair used for interpolation (A -> B).
    const activePairRef =
        useRef<AttitudeSamplePair | null>(
            null
        );

    // Next sample pair preloaded ahead of time (B -> C).
    const prefetchedPairRef =
        useRef<AttitudeSamplePair | null>(
            null
        );

    // Prevent overlapping async prefetches.
    const prefetchingRef =
        useRef(false);

    // Prevent duplicate initializations.
    const initializingRef =
        useRef(false);

    // Set to true when telemetry EOF is hit; allows current pair to finish before restarting.
    const telemetryEndedRef =
        useRef(false);

    // Global timeline time when this rover's current loop started.
    const loopStartTimeRef =
        useRef(0);

    // Track previous global time to detect seeking backwards or timeline resets.
    const previousGlobalTimeRef =
        useRef(0);

    // Register rover info in the global state store.
    useEffect(() => {
        addRover({
            id: roverId,
            name,

            position: [0, 0, 0],

            yaw: 0,
            pitch: 0,
            roll: 0,

            rotationUrl,
            positionUrl,
        });
    }, [
        roverId,
        name,
        rotationUrl,
        positionUrl,
        addRover,
    ]);

    // Reset local telemetry state variables when the rotation URL changes.
    useEffect(() => {
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
    }, [attitudeReader]);

    // Main loop for fetching telemetry pairs and slerping orientation.
    useEffect(() => {
        let cancelled = false;

        // Restart this rover's telemetry stream from 0 without affecting the global timeline.
        const restartTelemetry = async (
            globalTime: number
        ): Promise<boolean> => {
            attitudeReader.reset();

            const initialPair =
                await attitudeReader
                    .getInitialPair(0);

            if (
                cancelled ||
                !initialPair
            ) {
                return false;
            }

            // Reset loop start time reference.
            loopStartTimeRef.current =
                globalTime;

            activePairRef.current =
                initialPair;

            prefetchedPairRef.current =
                null;

            telemetryEndedRef.current =
                false;

            // Instantly apply the first telemetry orientation.
            setOrientation(
                roverId,
                initialPair.previous.yaw,
                initialPair.previous.pitch,
                initialPair.previous.roll
            );

            console.log(
                "[RoverRenderer] Telemetry restarted"
            );

            return true;
        };

        const update = async () => {
            const timeline =
                useTimelineStore.getState();

            const globalTime =
                timeline.currentTime;

            // Reset and restart telemetry stream if timeline moves backward.
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

            // Skip updates if playback is paused.
            if (!timeline.isPlaying) {
                return;
            }

            // Map global timeline time to the rover's local telemetry time.
            const localTime =
                globalTime -
                loopStartTimeRef.current;

            // Initialize telemetry reader and get the first pair.
            if (
                !activePairRef.current &&
                !initializingRef.current
            ) {
                initializingRef.current =
                    true;

                try {
                    const initialPair =
                        await attitudeReader
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
                        "Failed to initialize attitude telemetry:",
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

            // Advance to the next pair when local time passes current pair boundary.
            if (
                localTime >=
                activePair.next.relativeTime
            ) {
                // Restart telemetry if EOF was reached and current pair finished.
                if (
                    telemetryEndedRef.current
                ) {
                    await restartTelemetry(
                        globalTime
                    );

                    return;
                }

                // Switch to the preloaded next pair if available.
                if (
                    prefetchedPairRef.current
                ) {
                    activePairRef.current =
                        prefetchedPairRef.current;

                    prefetchedPairRef.current =
                        null;

                    activePair =
                        activePairRef.current;
                }

                // Fallback: fetch next pair immediately if prefetch wasn't completed.
                else if (
                    !prefetchingRef.current
                ) {
                    prefetchingRef.current =
                        true;

                    try {
                        const nextPair =
                            await attitudeReader
                                .getNextPair();

                        if (cancelled) {
                            return;
                        }

                        // Handle unexpected EOF.
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
                            "Failed to advance attitude telemetry:",
                            error
                        );
                    } finally {
                        prefetchingRef.current =
                            false;
                    }

                    return;
                }
            }

            // Prefetch the next telemetry pair before the current one ends.
            const timeUntilNext =
                activePair.next.relativeTime -
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

                attitudeReader
                    .getNextPair()
                    .then((nextPair) => {
                        if (cancelled) {
                            return;
                        }

                        // Mark telemetry as ended at EOF; let current pair play out.
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
                            "Failed to prefetch attitude telemetry:",
                            error
                        );
                    })
                    .finally(() => {
                        prefetchingRef.current =
                            false;
                    });
            }

            // Perform spherical linear interpolation (slerp) for smooth rotation.
            const attitude =
                slerpAttitude(
                    activePair.previous,
                    activePair.next,
                    localTime
                );

            setOrientation(
                roverId,
                attitude.yaw,
                attitude.pitch,
                attitude.roll
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
        roverId,
        attitudeReader,
        setOrientation,
    ]);

    if (!rover) {
        return null;
    }

    return (
        <primitive
            object={scene}
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