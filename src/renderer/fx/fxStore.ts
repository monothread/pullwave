import { create } from 'zustand';

// The small events that make the interface play: something finished (confetti, a chord), something failed, the wave of the name dances,
// the secret mode of the Konami code. Components say that it happened; the layers that draw it listen.
export interface FxState {
    // Each of these goes up by one when it happens, so a listener knows it is a new one.
    celebrations: number;
    failures: number;
    dances: number;
    // The secret mode: the wave of the name runs through every colour of the theme.
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
