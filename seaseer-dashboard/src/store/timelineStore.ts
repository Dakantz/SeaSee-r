import { create } from "zustand";

type TimelineStore = {
    currentTime: number;
    isPlaying: boolean;

    setCurrentTime: (time: number) => void;
    play: () => void;
    pause: () => void;
    togglePlay: () => void;
    reset: () => void;
};

export const useTimelineStore = create<TimelineStore>((set) => ({
    currentTime: 0,
    isPlaying: false,

    setCurrentTime: (currentTime) => set({ currentTime }),

    play: () => set({ isPlaying: true }),

    pause: () => set({ isPlaying: false }),

    togglePlay: () =>
        set((state) => ({
            isPlaying: !state.isPlaying,
        })),

    reset: () => set({ currentTime: 0 }),
}));