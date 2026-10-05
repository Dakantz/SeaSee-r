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
    reconstructionIndex?: number;
    timestamp?: number;
}

export interface ActiveTabValues {
    logDepth: number | null;
    logTemp: number | null;
    sonarAltitude: number | null;
    sonarFront: number | null;
    distance: number | null;
}

interface TrajectoryLogSyncStore {
    // Current active / selected waypoint across 3D, Chart, and Video
    activePoint: TrajectorySyncPoint | null;
    activePointIndex: number | null;
    focusedTrajectoryId: string | null; // e.g. pointcloud ID or header ID
    syncSource: "3d" | "chart" | "video" | null;
    seekTimestamp: number | null; // Trigger to seek video player
    requestOpenLogsPanel: number;
    activeTabValues: ActiveTabValues | null;
    isVideoPlaying: boolean;
    requestPauseVideo: number;

    // Actions
    selectPoint: (point: TrajectorySyncPoint | null, source?: "3d" | "chart" | "video") => void;
    focusTrajectory: (trajectoryId: string | null, openPanel?: boolean) => void;
    openLogsPanel: () => void;
    setSeekTimestamp: (timestamp: number | null) => void;
    setActiveTabValues: (values: ActiveTabValues | null) => void;
    clearSync: () => void;
    pauseVideo: () => void;
    setVideoPlaying: (playing: boolean) => void;
}

export const useTrajectoryLogSync = create<TrajectoryLogSyncStore>((set) => ({
    activePoint: null,
    activePointIndex: null,
    focusedTrajectoryId: null,
    syncSource: null,
    seekTimestamp: null,
    requestOpenLogsPanel: 0,
    activeTabValues: null,
    isVideoPlaying: false,
    requestPauseVideo: 0,

    selectPoint: (point, source = "3d") => {
        set((state) => ({
            activePoint: point,
            activePointIndex: point?.index ?? null,
            syncSource: source,
            ...(source === "3d"
                ? {
                      isVideoPlaying: false,
                      requestPauseVideo: state.requestPauseVideo + 1,
                  }
                : {}),
            // If the point provides a videoTime or relativeTime, update seekTimestamp
            seekTimestamp:
                point?.videoTime !== undefined
                    ? point.videoTime
                    : point?.relativeTime !== undefined
                    ? point.relativeTime
                    : null,
        }));
    },

    pauseVideo: () => {
        set((state) => ({
            isVideoPlaying: false,
            requestPauseVideo: state.requestPauseVideo + 1,
        }));
    },

    setVideoPlaying: (playing: boolean) => {
        set({ isVideoPlaying: playing });
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

    setActiveTabValues: (values) => {
        set({ activeTabValues: values });
    },

    clearSync: () => {
        set({
            activePoint: null,
            activePointIndex: null,
            focusedTrajectoryId: null,
            syncSource: null,
            seekTimestamp: null,
            activeTabValues: null,
        });
    },
}));
