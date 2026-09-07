import type { CustomQuery, QuerySummaryData } from "../../PointCloudPanel/CustomQueryManager";
import type { PointCloudMetadataResponse } from "../../../client";

export type MapProviderChoice =
    | "OpenStreetMaps"
    | "Bing"
    | "Bathymetry"
    | "EmodnetWMS"
    | "EmodnetWCSBilinear"
    | "EmodnetWCSNearestNeighbour"
    | "Debug"
    | "MapTilerBasic"
    | "MapTilerOutdoor"
    | "MapTilerSatellite";

export type HeightProviderChoice =
    | "None"
    | "Bathymetry"
    | "EmodnetWCSBilinear"
    | "EmodnetWCSNearestNeighbour"
    | "Debug"
    | "MapTiler"
    | "Bing";

export interface CameraViewTarget {
    position?: [number, number, number];
    quaternion?: [number, number, number, number];
    fov?: number;
    target?: [number, number, number];
    timestamp?: number;
}

export interface PerfTestMetric {
    second: number;
    fps: number;
    frameTimeMs: number;
    pointsCount: number;
    position: {
        x: number;
        y: number;
        z: number;
    };
}

export interface PerfTestSummary {
    averageFps: number;
    averageFrameTimeMs: number;
    totalFrames: number;
    totalDurationSec: number;
    metrics: PerfTestMetric[];
}

export interface EngineConfig {
    // Lighting
    keyLightIntensity?: number;
    fillLightIntensity?: number;
    hemisphereLightIntensity?: number;
    ambientLightIntensity?: number;

    // Heightmap / Terrain
    showHeightmap?: boolean;
    heightmapMode?: string;
    heightmapMapProvider?: MapProviderChoice;
    heightmapHeightProvider?: HeightProviderChoice;

    // Queries & Summaries
    queries?: CustomQuery[];
    summaryMap?: Record<string, QuerySummaryData>;
    catalog?: PointCloudMetadataResponse[];
    hoveredId?: string | null;

    // Trajectory
    showCameraTrajectories?: boolean;

    // Transform Gizmo
    editingPointcloudId?: string | null;
    gizmoMode?: "translate" | "rotate" | "scale" | null;

    // Camera view targets / movement
    cameraViewTarget?: CameraViewTarget | null;
    isCameraUpFixed?: boolean;

    // Point count metric
    pointCount?: number | null;
}

export interface EngineCallbacks {
    onSelectPointcloud?: (id: string) => void;
    onHoverPointcloud?: (id: string | null) => void;
    onFocusCameraTarget?: (center: [number, number, number]) => void;
    onUpdatePointcloudTransform?: (id: string, matrixArray: number[]) => void;
    onCameraViewChange?: (view: { position?: [number, number, number]; quaternion?: [number, number, number, number]; fov?: number; target?: [number, number, number] }) => void;
    onSetIsCameraUpFixed?: (fixed: boolean) => void;
    onSetIsGizmoDragging?: (dragging: boolean) => void;
    onBenchmarkComplete?: (summary: PerfTestSummary) => void;
}
