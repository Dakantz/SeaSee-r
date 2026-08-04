import {
    useEffect,
    useMemo,
} from "react";

import { useRoverStore } from "../../store/roverStore";

import {
    TransformRenderer,
} from "./transformRenderer";

import {
    TrajectoryRenderer,
    type TrajectoryRendererProps,
} from "./trajectoryRenderer";

function toVector3(
    values: [number, number, number]
): [number, number, number] {
    return [
        values[0],
        values[1],
        values[2],
    ];
}

interface RovRendererProps {
    roverId: string;
    name?: string;
    rotationUrl: string;
    positionUrl: string;
    videoId?: string;
    rotationOffset?: [number, number, number];
    positionOffset?: [number, number, number];
    showRover?: boolean;
    showTrajectory?: boolean;
    trajectoryProps?: Omit<
        TrajectoryRendererProps,
        "url" | "position"
    >;
}

export function RovRenderer({
    roverId,
    name,
    rotationUrl,
    positionUrl,
    videoId,
    rotationOffset = [0, 0, 0],
    positionOffset = [0, 0, 0],
    showRover = true,
    showTrajectory = true,
    trajectoryProps,
}: RovRendererProps) {
    const addRover = useRoverStore(
        (state) => state.addRover
    );
    const removeRover = useRoverStore(
        (state) => state.removeRover
    );

    const defaultPosition = useMemo(
        () => toVector3(positionOffset),
        [positionOffset]
    );

    const defaultOrientation = useMemo(
        () => toVector3(rotationOffset),
        [rotationOffset]
    );

    useEffect(() => {
        addRover({
            id: roverId,
            name: name ?? roverId,
            position: defaultPosition,
            yaw: defaultOrientation[0],
            pitch: defaultOrientation[1],
            roll: defaultOrientation[2],
            rotationUrl,
            positionUrl,
            videoId,
        });

        return () => {
            removeRover(roverId);
        };
    }, [
        addRover,
        removeRover,
        defaultOrientation,
        defaultPosition,
        name,
        positionUrl,
        rotationUrl,
        roverId,
        videoId,
    ]);

    return (
        <>
            {showRover ? (
                <TransformRenderer
                    roverId={roverId}
                    rotationUrl={rotationUrl}
                    positionUrl={positionUrl}
                    rotationOffset={rotationOffset}
                    positionOffset={positionOffset}
                />
            ) : null}

            {showTrajectory ? (
                <TrajectoryRenderer
                    url={positionUrl}
                    position={positionOffset}
                    {...trajectoryProps}
                />
            ) : null}
        </>
    );
}