import { create } from "zustand";

export interface TrajectorySyncPoint {
    id?: string;
    index?: number;
    relativeTime?: number;
    videoTime?: number;
    videoIndex?: number;
    frameNumber?: number;
    filename?: string | null;
    x?: number;
    y?: number;
    z?: number;
    rotation?: [number, number, number, number];
    direction?: [number, number, number];
    cameraHeaderId?: string;
    pointCloudId?: string;
}

interface TrajectoryLogSyncStore {
    // Current active / selected waypoint across 3D, Chart, and Video
    activePoint: TrajectorySyncPoint | null;
    activePointIndex: number | null;
    focusedTrajectoryId: string | null; // e.g. pointcloud ID or header ID
    syncSource: "3d" | "chart" | "video" | null;
    seekTimestamp: number | null; // Trigger to seek video player
    requestOpenLogsPanel: number;

    // Actions
    selectPoint: (point: TrajectorySyncPoint | null, source?: "3d" | "chart" | "video") => void;
    focusTrajectory: (trajectoryId: string | null, openPanel?: boolean) => void;
    openLogsPanel: () => void;
    setSeekTimestamp: (timestamp: number | null) => void;
    clearSync: () => void;
}

export const useTrajectoryLogSync = create<TrajectoryLogSyncStore>((set) => ({
    activePoint: null,
    activePointIndex: null,
    focusedTrajectoryId: null,
    syncSource: null,
    seekTimestamp: null,
    requestOpenLogsPanel: 0,

    selectPoint: (point, source = "3d") => {
        set({
            activePoint: point,
            activePointIndex: point?.index ?? null,
            syncSource: source,
            // If the point provides a videoTime or relativeTime, update seekTimestamp
            seekTimestamp:
                point?.videoTime !== undefined
                    ? point.videoTime
                    : point?.relativeTime !== undefined
                    ? point.relativeTime
                    : null,
        });
    },

    focusTrajectory: (trajectoryId, openPanel = false) => {
        set((state) => ({
            focusedTrajectoryId: trajectoryId,
            ...(openPanel ? { requestOpenLogsPanel: state.requestOpenLogsPanel + 1 } : {}),
        }));
    },

    openLogsPanel: () => {
        set((state) => ({ requestOpenLogsPanel: state.requestOpenLogsPanel + 1 }));
    },

    setSeekTimestamp: (timestamp) => {
        set({ seekTimestamp: timestamp, syncSource: "video" });
    },

    clearSync: () => {
        set({
            activePoint: null,
            activePointIndex: null,
            focusedTrajectoryId: null,
            syncSource: null,
            seekTimestamp: null,
        });
    },
}));
