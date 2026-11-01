// @vitest-environment jsdom
import { SOUNDS_STORAGE_KEY, readSoundsPref, useUiPrefsStore } from '@renderer/store/uiPrefsStore';

afterEach(() => {
    window.localStorage.removeItem(SOUNDS_STORAGE_KEY);
    useUiPrefsStore.setState({ sounds: true });
    vi.restoreAllMocks();
});

describe('the sounds of the navigation', () => {
    it('are kept under their own key of the storage of the window', () => {
        expect(SOUNDS_STORAGE_KEY).toBe('pullwave-ui-sounds');
    });

    it('are on unless they were turned off', () => {
        expect(readSoundsPref()).toBe(true);
        window.localStorage.setItem(SOUNDS_STORAGE_KEY, 'on');
        expect(readSoundsPref()).toBe(true);
        window.localStorage.setItem(SOUNDS_STORAGE_KEY, 'off');
        expect(readSoundsPref()).toBe(false);
    });

    it('are on when the storage cannot be read', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('denied');
        });
        expect(readSoundsPref()).toBe(true);
    });

    it('are turned off and on again, and the choice is saved', () => {
        useUiPrefsStore.getState().toggleSounds();
        expect(useUiPrefsStore.getState().sounds).toBe(false);
        expect(window.localStorage.getItem(SOUNDS_STORAGE_KEY)).toBe('off');
        useUiPrefsStore.getState().toggleSounds();
        expect(useUiPrefsStore.getState().sounds).toBe(true);
        expect(window.localStorage.getItem(SOUNDS_STORAGE_KEY)).toBe('on');
    });

    it('are still turned off when the storage cannot be written', () => {
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('full');
        });
        useUiPrefsStore.getState().toggleSounds();
        expect(useUiPrefsStore.getState().sounds).toBe(false);
    });
});
