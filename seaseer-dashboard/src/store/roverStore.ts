import { create } from "zustand";

export interface Rover {
    id: string;
    name: string;

    position: [number, number, number];

    yaw: number;
    pitch: number;
    roll: number;

    rotationUrl: string;
    positionUrl: string;
}

interface RoverStore {
    rovers: Record<string, Rover>;

    addRover: (rover: Rover) => void;
    removeRover: (id: string) => void;

    setPosition: (
        id: string,
        position: [number, number, number]
    ) => void;

    setOrientation: (
        id: string,
        yaw: number,
        pitch: number,
        roll: number
    ) => void;
}

export const useRoverStore = create<RoverStore>((set) => ({
    rovers: {},

    addRover: (rover) =>
        set((state) => ({
            rovers: {
                ...state.rovers,
                [rover.id]: state.rovers[rover.id]
                    ? { ...state.rovers[rover.id], ...rover }
                    : rover,
            },
        })),

    removeRover: (id) =>
        set((state) => {
            const { [id]: _, ...rest } = state.rovers;
            return { rovers: rest };
        }),

    setPosition: (id, position) =>
        set((state) => {
            if (!state.rovers[id]) {
                console.warn(
                    `Rover with id "${id}" does not exist`
                );
                return state;
            }

            return {
                rovers: {
                    ...state.rovers,
                    [id]: {
                        ...state.rovers[id],
                        position,
                    },
                },
            };
        }),

    setOrientation: (id, yaw, pitch, roll) =>
        set((state) => {
            if (!state.rovers[id]) {
                console.warn(
                    `Rover with id "${id}" does not exist`
                );
                return state;
            }

            return {
                rovers: {
                    ...state.rovers,
                    [id]: {
                        ...state.rovers[id],
                        yaw,
                        pitch,
                        roll,
                    },
                },
            };
        }),
}));