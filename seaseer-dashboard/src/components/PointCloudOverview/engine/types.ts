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

export interface EngineConfig {
    // Heightmap / Terrain
    showHeightmap?: boolean;
    heightmapMode?: string;
    heightmapMapProvider?: MapProviderChoice;
    heightmapHeightProvider?: HeightProviderChoice;

    // Point Cloud & Queries
    queries?: CustomQuery[];
    summaryMap?: Record<string, QuerySummaryData>;
    catalog?: PointCloudMetadataResponse[];

    // Transform Gizmo
    editingPointcloudId?: string | null;
    gizmoMode?: "translate" | "rotate" | "scale" | null;

    // Camera view targets
    cameraViewTarget?: CameraViewTarget | null;
}

export interface EngineCallbacks {
    onSelectPointcloud?: (id: string) => void;
    onHoverPointcloud?: (id: string | null) => void;
    onFocusCameraTarget?: (center: [number, number, number]) => void;
    onUpdatePointcloudTransform?: (id: string, matrixArray: number[]) => void;
    onCameraViewChange?: (view: { position?: [number, number, number]; quaternion?: [number, number, number, number]; fov?: number; target?: [number, number, number] }) => void;
    onSetIsGizmoDragging?: (dragging: boolean) => void;
    onPointCountChange?: (count: number) => void;
}
