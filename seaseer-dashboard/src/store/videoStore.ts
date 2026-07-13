import { create } from "zustand";

interface VideoState {
    duration: number;
    currentTime: number;

    playing: boolean;

    fps: number;

    width: number;
    height: number;

    setDuration: (duration: number) => void;
    setCurrentTime: (time: number) => void;
    setPlaying: (playing: boolean) => void;
    setFPS: (fps: number) => void;
    setResolution: (width: number, height: number) => void;
}

export const useVideoStore = create<VideoState>((set) => ({
    duration: 0,
    currentTime: 0,

    playing: false,

    fps: 30,
    currentFrame: 0,

    width: 0,
    height: 0,

    setDuration: (duration) =>
        set({ duration }),

    setCurrentTime: (currentTime) =>
        set({ currentTime }),

    setPlaying: (playing) =>
        set({ playing }),

    setFPS: (fps) =>
        set({ fps }),

    setResolution: (width, height) =>
        set({
            width,
            height,
        }),
}));

export const useCurrentFrame = () =>
    useVideoStore((state) =>
        Math.floor(state.currentTime * state.fps)
    );