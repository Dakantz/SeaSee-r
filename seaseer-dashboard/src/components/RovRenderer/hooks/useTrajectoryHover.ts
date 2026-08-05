import { useState } from "react";

/**
 * Hook to capture hover state and event handlers for a trajectory.
 * Logs the hovered trajectory URL to the console.
 */
export function useTrajectoryHover(url: string) {
    const [isHovered, setIsHovered] = useState(false);

    const onPointerOver = (event: any) => {
        event.stopPropagation();
        setIsHovered(true);
        console.log(`Hovered trajectory: ${url}`);
    };

    const onPointerOut = (event: any) => {
        event.stopPropagation();
        setIsHovered(false);
    };

    return {
        isHovered,
        hoverProps: {
            onPointerOver,
            onPointerOut,
        },
    };
}
