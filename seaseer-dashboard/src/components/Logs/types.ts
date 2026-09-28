export interface PointCloudOption {
    id: string;
    name: string;
    safe_filename?: string | null;
    number_of_points: number;
    created_at: string;
    min_x?: number | null;
    max_x?: number | null;
    min_y?: number | null;
    max_y?: number | null;
    min_z?: number | null;
    max_z?: number | null;
    center?: [number, number, number] | null;
}

export interface ComputedTelemetryPoint {
    index: number;
    id: string;
    timestamp: number;
    relativeTime: number; // Flight segment elapsed time (starts at 0.0s)
    videoTime?: number; // Time position within the source video recording (seconds)
    frameNumber?: number; // Video frame sequence number (e.g. 545)
    wallClockTime?: string; // Formatted HH:mm:ss.SSS
    x: number;
    y: number;
    z: number;
    depth: number; // in meters (positive downward or relative depth)
    distanceTravelled: number; // cumulative meters
    speed: number; // meters per second
    direction?: [number, number, number];
    rotation?: [number, number, number, number];
    filename?: string | null;
    cameraHeaderId?: string;
}

export interface MissionSummary {
    mapId: string;
    mapName: string;
    totalPoints: number;
    totalFrames: number;
    durationSeconds: number;
    startFrame?: number;
    endFrame?: number;
    startVideoTime?: number;
    endVideoTime?: number;
    startTimeIso?: string;
    endTimeIso?: string;
    totalDistanceMeters: number;
    minDepth: number;
    maxDepth: number;
    avgDepth: number;
    avgSpeed: number;
    maxSpeed: number;
    extentX: number;
    extentY: number;
    extentZ: number;
    boundingVolumeM3: number;
    netDisplacementMeters: number;
}

export interface VideoItem {
    id: string;
    upload_metadata_id: string;
    content_type?: string | null;
    total_bytes?: number | null;
    video_start_at: string;
    video_stop_at: string;
    stream_url?: string | null;
    download_url?: string | null;
    upload_metadata?: {
        id: string;
        batch_id?: string | null;
        orig_filename: string;
        safe_filename?: string | null;
        content_type?: string | null;
        status: string;
        created_at: string;
        completed_at?: string | null;
    } | null;
}
