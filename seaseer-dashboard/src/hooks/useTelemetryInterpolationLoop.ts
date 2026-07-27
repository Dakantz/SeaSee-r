import { useEffect, useRef } from 'react';
import { useTimelineStore } from '../store/timelineStore';

const SLERP_UPDATE_INTERVAL_MS = 16;
const PREFETCH_THRESHOLD_SECONDS = 0.1;

export interface TimedSample {
    relativeTime: number;
}

export interface SamplePair<TSample extends TimedSample> {
    previous: TSample;
    next: TSample;
}

export interface TelemetryPairReader<
    TSample extends TimedSample,
    TPair extends SamplePair<TSample>
> {
    getInitialPair: (startTime?: number) => Promise<TPair | null>;
    getNextPair: () => Promise<TPair | null>;
    reset: () => void;
}

export interface UseTelemetryInterpolationLoopParams<
    TSample extends TimedSample,
    TPair extends SamplePair<TSample>
> {
    enabled: boolean;
    reader: TelemetryPairReader<TSample, TPair> | null;
    interpolationName: string;
    interpolate: (
        previous: TSample,
        next: TSample,
        currentTime: number
    ) => TSample;
    applySample: (sample: TSample) => void;
}

/**
 * Shared, framework-agnostic hook for streaming and interpolating telemetry data
 * synchronized with timelineStore. Works for both R3F and Potree renderers.
 */
export function useTelemetryInterpolationLoop<
    TSample extends TimedSample,
    TPair extends SamplePair<TSample>
>({
    enabled,
    reader,
    interpolationName,
    interpolate,
    applySample,
}: UseTelemetryInterpolationLoopParams<TSample, TPair>) {
    const activePairRef = useRef<TPair | null>(null);
    const prefetchedPairRef = useRef<TPair | null>(null);
    const prefetchingRef = useRef(false);
    const initializingRef = useRef(false);
    const telemetryEndedRef = useRef(false);
    const loopStartTimeRef = useRef(0);
    const previousGlobalTimeRef = useRef(0);

    useEffect(() => {
        if (!enabled || !reader) return;
        const currentTime = useTimelineStore.getState().currentTime;
        activePairRef.current = null;
        prefetchedPairRef.current = null;
        prefetchingRef.current = false;
        initializingRef.current = false;
        telemetryEndedRef.current = false;
        loopStartTimeRef.current = currentTime;
        previousGlobalTimeRef.current = currentTime;
    }, [enabled, reader]);

    useEffect(() => {
        if (!enabled || !reader) return;
        let cancelled = false;

        const restartTelemetry = async (globalTime: number): Promise<boolean> => {
            reader.reset();
            const initialPair = await reader.getInitialPair(0);
            if (cancelled || !initialPair) return false;

            loopStartTimeRef.current = globalTime;
            activePairRef.current = initialPair;
            prefetchedPairRef.current = null;
            telemetryEndedRef.current = false;
            applySample(initialPair.previous);
            return true;
        };

        const update = async () => {
            const timeline = useTimelineStore.getState();
            const globalTime = timeline.currentTime;

            if (globalTime < previousGlobalTimeRef.current) {
                previousGlobalTimeRef.current = globalTime;
                await restartTelemetry(globalTime);
                return;
            }

            previousGlobalTimeRef.current = globalTime;
            const localTime = globalTime - loopStartTimeRef.current;

            // Initialize starting sample immediately on load even when playback is paused
            if (!activePairRef.current && !initializingRef.current) {
                initializingRef.current = true;
                try {
                    const initialPair = await reader.getInitialPair(localTime);
                    if (cancelled || !initialPair) return;
                    activePairRef.current = initialPair;
                    telemetryEndedRef.current = false;
                    applySample(initialPair.previous);
                } catch (error) {
                    console.error(`Failed to initialize ${interpolationName} telemetry:`, error);
                } finally {
                    initializingRef.current = false;
                }
                return;
            }

            if (!timeline.isPlaying) return;

            let activePair = activePairRef.current;
            if (!activePair) return;

            if (localTime >= activePair.next.relativeTime) {
                if (telemetryEndedRef.current) {
                    await restartTelemetry(globalTime);
                    return;
                }

                if (prefetchedPairRef.current) {
                    activePairRef.current = prefetchedPairRef.current;
                    prefetchedPairRef.current = null;
                    activePair = activePairRef.current;
                } else if (!prefetchingRef.current) {
                    prefetchingRef.current = true;
                    try {
                        const nextPair = await reader.getNextPair();
                        if (cancelled) return;
                        if (!nextPair) {
                            await restartTelemetry(globalTime);
                            return;
                        }
                        activePairRef.current = nextPair;
                        activePair = nextPair;
                    } catch (error) {
                        console.error(`Failed to advance ${interpolationName} telemetry:`, error);
                    } finally {
                        prefetchingRef.current = false;
                    }
                    return;
                }
            }

            const timeUntilNext = activePair.next.relativeTime - localTime;
            if (
                timeUntilNext <= PREFETCH_THRESHOLD_SECONDS &&
                timeUntilNext > 0 &&
                !prefetchedPairRef.current &&
                !prefetchingRef.current &&
                !telemetryEndedRef.current
            ) {
                prefetchingRef.current = true;
                reader
                    .getNextPair()
                    .then((nextPair) => {
                        if (cancelled) return;
                        if (!nextPair) {
                            telemetryEndedRef.current = true;
                            return;
                        }
                        prefetchedPairRef.current = nextPair;
                    })
                    .catch((error) => {
                        console.error(`Failed to prefetch ${interpolationName} telemetry:`, error);
                    })
                    .finally(() => {
                        prefetchingRef.current = false;
                    });
            }

            applySample(interpolate(activePair.previous, activePair.next, localTime));
        };

        const interval = setInterval(update, SLERP_UPDATE_INTERVAL_MS);
        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, [enabled, reader, interpolate, applySample, interpolationName]);
}
