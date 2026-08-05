import { create } from "zustand";

export interface Video {
    id: string;
    duration: number;
    currentTime: number;
    playing: boolean;
    fps: number;
    width: number;
    height: number;
    videoUrl?: string;
}

export interface SelectedFrame {
    videoId: string;
    relativeTime: number;
    position?: [number, number, number];
}

interface VideoStore {
    videos: Record<string, Video>;
    selectedFrame: SelectedFrame | null;

    addVideo: (video: Video) => void;
    removeVideo: (id: string) => void;

    setDuration: (id: string, duration: number) => void;
    setCurrentTime: (id: string, time: number) => void;
    setPlaying: (id: string, playing: boolean) => void;
    setFPS: (id: string, fps: number) => void;
    setResolution: (id: string, width: number, height: number) => void;
    setSelectedFrame: (frame: SelectedFrame | null) => void;
}

export const useVideoStore = create<VideoStore>((set) => ({
    videos: {},

    addVideo: (video) =>
        set((state) => ({
            videos: {
                ...state.videos,
                [video.id]: video,
            },
        })),

    removeVideo: (id) =>
        set((state) => {
            const { [id]: __, ...restVideos } = state.videos;
            return { videos: restVideos };
        }),

    setDuration: (id, duration) =>
        set((state) => {
            if (!state.videos[id]) {
                console.warn(
                    `Video with id "${id}" does not exist`
                );
                return state;
            }

            return {
                videos: {
                    ...state.videos,
                    [id]: {
                        ...state.videos[id],
                        duration,
                    },
                },
            };
        }),

    setCurrentTime: (id, currentTime) =>
        set((state) => {
            if (!state.videos[id]) {
                console.warn(
                    `Video with id "${id}" does not exist`
                );
                return state;
            }

            return {
                videos: {
                    ...state.videos,
                    [id]: {
                        ...state.videos[id],
                        currentTime,
                    },
                },
            };
        }),

    setPlaying: (id, playing) =>
        set((state) => {
            if (!state.videos[id]) {
                console.warn(
                    `Video with id "${id}" does not exist`
                );
                return state;
            }

            return {
                videos: {
                    ...state.videos,
                    [id]: {
                        ...state.videos[id],
                        playing,
                    },
                },
            };
        }),

    setFPS: (id, fps) =>
        set((state) => {
            if (!state.videos[id]) {
                console.warn(
                    `Video with id "${id}" does not exist`
                );
                return state;
            }

            return {
                videos: {
                    ...state.videos,
                    [id]: {
                        ...state.videos[id],
                        fps,
                    },
                },
            };
        }),

    setResolution: (id, width, height) =>
        set((state) => {
            if (!state.videos[id]) {
                console.warn(
                    `Video with id "${id}" does not exist`
                );
                return state;
            }

            return {
                videos: {
                    ...state.videos,
                    [id]: {
                        ...state.videos[id],
                        width,
                        height,
                    },
                },
            };
        }),

    selectedFrame: null,
    setSelectedFrame: (selectedFrame) => set({ selectedFrame }),
}));

export const useCurrentFrame = (id: string) =>
    useVideoStore((state) => {
        const video = state.videos[id];
        return video ? Math.floor(video.currentTime * video.fps) : 0;
    });