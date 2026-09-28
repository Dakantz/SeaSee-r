import type { CustomQuery, QuerySummaryData } from "../../PointCloudPanel/CustomQueryManager";
import type { PointCloudMetadataResponse } from "../../../client";
import type { PerfTestMetric, PerfTestSummary } from "../../PointCloudPanel/PLYPointCloudContext";

export type { PerfTestMetric, PerfTestSummary };

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

export interface EngineConfig {
    // Heightmap / Terrain
    showHeightmap?: boolean;
    experimentalBathymetry?: boolean;
    heightmapMode?: string;
    heightmapMapProvider?: MapProviderChoice;
    heightmapHeightProvider?: HeightProviderChoice;

    // Outlines / Debug
    showOutlines?: boolean;

    // Point Cloud & Queries
    queries?: CustomQuery[];
    summaryMap?: Record<string, QuerySummaryData>;
    catalog?: PointCloudMetadataResponse[];

    // Transform Gizmo
    editingPointcloudId?: string | null;
    gizmoMode?: "translate" | "rotate" | "scale" | null;

    // Camera view targets
    cameraTarget?: { x: number; y: number; z: number; offset?: [number, number, number] | number; timestamp?: number } | null;
    cameraViewTarget?: CameraViewTarget | null;
    isCameraUpFixed?: boolean;

    // Performance Testing
    perfTestTrigger?: number;
    isPerfTestRunning?: boolean;
}

export interface EngineCallbacks {
    onSelectPointcloud?: (id: string) => void;
    onHoverPointcloud?: (id: string | null) => void;
    onFocusCameraTarget?: (center: [number, number, number], offset?: [number, number, number] | number) => void;
    onPreviewPointcloudTransform?: (id: string, matrixArray: number[]) => void;
    onUpdatePointcloudTransform?: (id: string, matrixArray: number[]) => void;
    onCameraViewChange?: (view: { position?: [number, number, number]; quaternion?: [number, number, number, number]; fov?: number; target?: [number, number, number] }) => void;
    onSetIsGizmoDragging?: (dragging: boolean) => void;
    onToggleCameraUpFixed?: () => void;
    onSetIsCameraUpFixed?: (fixed: boolean) => void;
    onPointCountChange?: (count: number) => void;

    // Performance Testing
    onPerfTestProgress?: (fps: number, frameTimeMs: number, metric: PerfTestMetric) => void;
    onPerfTestComplete?: (summary: PerfTestSummary) => void;
    onPerfTestCancel?: () => void;
}

