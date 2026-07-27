import * as THREE from 'three';
import {
    usePotreeTransformRenderer,
    type UsePotreeTransformRendererProps,
} from './usePotreeTransformRenderer';
import {
    usePotreeTrajectoryRenderer,
    type UsePotreeTrajectoryRendererProps,
} from './usePotreeTrajectoryRenderer';

export interface UsePotreeRovRendererProps {
    roverId?: string;
    name?: string;
    rotationUrl?: string;
    positionUrl?: string;
    rotationOffset?: [number, number, number];
    positionOffset?: [number, number, number];
    showRover?: boolean;
    showTrajectory?: boolean;
    trajectoryProps?: Omit<UsePotreeTrajectoryRendererProps, 'url' | 'position'>;
}

const DEFAULT_ROTATION_URL =
    '/test_jsons/rover_3/ROV-Log-2026-05-02-2026-05-05-0505205315.json';
const DEFAULT_POSITION_URL = '/test_jsons/rover_3/shots.geojson';

/**
 * Hook to render both the 3D ROV Model (TransformRenderer) and Trajectory Path (TrajectoryRenderer)
 * inside Potree's Three.js Scene.
 */
export function usePotreeRovRenderer({
    roverId = 'potree-rover',
    rotationUrl = DEFAULT_ROTATION_URL,
    positionUrl = DEFAULT_POSITION_URL,
    rotationOffset = [0, 0, 0],
    positionOffset = [0, 0, 0],
    showRover = true,
    showTrajectory = true,
    trajectoryProps,
}: UsePotreeRovRendererProps = {}) {
    usePotreeTransformRenderer({
        roverId,
        rotationUrl: showRover ? rotationUrl : '',
        positionUrl: showRover ? positionUrl : '',
        rotationOffset,
        positionOffset,
    });

    usePotreeTrajectoryRenderer({
        url: showTrajectory ? positionUrl : '',
        position: positionOffset,
        visible: showTrajectory,
        ...trajectoryProps,
    });
}
