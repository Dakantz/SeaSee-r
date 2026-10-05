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
    batch_id?: string | null;
    reconstruction_index?: number | null;
}

export interface LogDataPayload {
    depth?: number;
    temperature?: number;
    yaw?: number;
    pitch?: number;
    roll?: number;
    altitude?: number;
    distance?: number;
    left?: number;
    right?: number;
    [key: string]: any;
}

export interface LogDataItem {
    id: string;
    timestamp: number;
    time_recorded?: string | null;
    payload: LogDataPayload;
    batch_id?: string | null;
}


export interface ComputedTelemetryPoint {
    index: number;
    id: string;
    timestamp: number;
    relativeTime: number; // Flight segment elapsed time (starts at 0.0s)
    videoTime?: number; // Time position within the source video recording (seconds)
    videoIndex?: number; // Video playlist index if multiple videos exist
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
    pointCloudId?: string;
    reconstructionIndex?: number;
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
    duration?: number | null;
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

export function getVideoDuration(v: VideoItem): number {
    if (typeof v.duration === "number" && v.duration > 0) {
        return v.duration;
    }
    const s = new Date(v.video_start_at).getTime();
    const e = new Date(v.video_stop_at).getTime();
    if (!isNaN(s) && !isNaN(e) && e > s) {
        return (e - s) / 1000.0;
    }
    return 180.0; // Standard fallback duration
}

export function getCumulativeTime(videos: VideoItem[] | undefined, videoIndex: number, timeSec: number): number {
    if (!videos || videos.length === 0) return timeSec;
    let offset = 0;
    for (let i = 0; i < videoIndex && i < videos.length; i++) {
        offset += getVideoDuration(videos[i]);
    }
    return offset + timeSec;
}

export function findClosestPointIndex(
    points: ComputedTelemetryPoint[],
    t: number,
    currentVideoIndex?: number,
    maxTimeDiff: number = 0.15
): number {
    if (!points || points.length === 0) return -1;

    const hasVideoIndices = points.some((p) => p.videoIndex !== undefined);
    let candidateIndices: number[] = [];
    if (hasVideoIndices && currentVideoIndex !== undefined) {
        for (let i = 0; i < points.length; i++) {
            if (points[i].videoIndex === currentVideoIndex) {
                candidateIndices.push(i);
            }
        }
        // If current video has no camera positions, never fall back to other video parts
        if (candidateIndices.length === 0) {
            return -1;
        }
    } else {
        candidateIndices = points.map((_, i) => i);
    }

    const getTime = (p: ComputedTelemetryPoint) =>
        p.videoTime !== undefined ? p.videoTime : p.relativeTime;

    let bestIdx = -1;
    let minDiff = Infinity;
    for (const idx of candidateIndices) {
        const ptTime = getTime(points[idx]);
        const diff = Math.abs(ptTime - t);
        if (diff < minDiff) {
            minDiff = diff;
            bestIdx = idx;
        }
    }

    if (minDiff <= maxTimeDiff) {
        return bestIdx;
    }

    return -1;
}

