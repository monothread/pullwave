import { create } from 'zustand';

// The cover behind the whole screen: the one of the tile that has the focus or the mouse, blurred, as on the screen of a console. It is
// only a picture: null leaves the aurora of the theme alone.
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
