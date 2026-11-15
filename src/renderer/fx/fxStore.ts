import { create } from 'zustand';

export interface FxState {
    celebrations: number;
    failures: number;
    dances: number;
    rainbow: boolean;
    celebrate: () => void;
    fail: () => void;
    dance: () => void;
    toggleRainbow: () => boolean;
}

export const useFxStore = create<FxState>((set, get) => {
    return {
        celebrations: 0,
        failures: 0,
        dances: 0,
        rainbow: false,
        celebrate: () => {
            set((state) => {
                return { celebrations: state.celebrations + 1, dances: state.dances + 1 };
            });
        },
        fail: () => {
            set((state) => {
                return { failures: state.failures + 1 };
            });
        },
        dance: () => {
            set((state) => {
                return { dances: state.dances + 1 };
            });
        },
        toggleRainbow: () => {
            const next = !get().rainbow;
            set({ rainbow: next });
            return next;
        }
    };
});
