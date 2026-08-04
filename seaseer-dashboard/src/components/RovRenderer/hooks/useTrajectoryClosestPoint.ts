import { useState } from "react";

/**
 * Hook to find the exact point on the trajectory line where the raycaster intersects.
 */
export function useTrajectoryClosestPoint() {
    const [hoveredPoint, setHoveredPoint] = useState<[number, number, number] | null>(null);

    const onPointerMove = (event: any) => {
        event.stopPropagation();
        if (event.point) {
            // Convert world space event.point to local space of the line object
            const localPoint = event.object.worldToLocal(event.point.clone());
            setHoveredPoint([localPoint.x, localPoint.y, localPoint.z]);
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
