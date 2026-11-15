import { create } from 'zustand';

export interface BackdropState {
    url: string | null;
    show: (url: string | null) => void;
    clear: () => void;
}

export const useBackdropStore = create<BackdropState>((set) => {
    return {
        url: null,
        show: (url) => {
            set({ url });
        },
        clear: () => {
            set({ url: null });
        }
    };
});
