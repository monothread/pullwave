// @vitest-environment jsdom
import { AUTO_NEXT_STORAGE_KEY, SOUNDS_STORAGE_KEY, readAutoNextPref, readSoundsPref, useUiPrefsStore } from '@renderer/store/uiPrefsStore';

afterEach(() => {
    window.localStorage.removeItem(SOUNDS_STORAGE_KEY);
    window.localStorage.removeItem(AUTO_NEXT_STORAGE_KEY);
    useUiPrefsStore.setState({ sounds: true, autoNext: true });
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

describe('the next episode that starts by itself', () => {
    it('is kept under its own key of the storage of the window', () => {
        expect(AUTO_NEXT_STORAGE_KEY).toBe('pullwave-player-auto-next');
    });

    it('is on unless it was turned off', () => {
        expect(readAutoNextPref()).toBe(true);
        window.localStorage.setItem(AUTO_NEXT_STORAGE_KEY, 'on');
        expect(readAutoNextPref()).toBe(true);
        window.localStorage.setItem(AUTO_NEXT_STORAGE_KEY, 'off');
        expect(readAutoNextPref()).toBe(false);
    });

    it('is on when the storage cannot be read', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('denied');
        });
        expect(readAutoNextPref()).toBe(true);
    });

    it('is turned off and on again, the choice is saved, and the sounds are left alone', () => {
        useUiPrefsStore.getState().toggleAutoNext();
        expect(useUiPrefsStore.getState().autoNext).toBe(false);
        expect(window.localStorage.getItem(AUTO_NEXT_STORAGE_KEY)).toBe('off');
        expect(useUiPrefsStore.getState().sounds).toBe(true);
        expect(window.localStorage.getItem(SOUNDS_STORAGE_KEY)).toBeNull();
        useUiPrefsStore.getState().toggleAutoNext();
        expect(useUiPrefsStore.getState().autoNext).toBe(true);
        expect(window.localStorage.getItem(AUTO_NEXT_STORAGE_KEY)).toBe('on');
    });

    it('is still turned off when the storage cannot be written', () => {
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('full');
        });
        useUiPrefsStore.getState().toggleAutoNext();
        expect(useUiPrefsStore.getState().autoNext).toBe(false);
    });

    it('is read from the storage when the app opens again', async () => {
        window.localStorage.setItem(AUTO_NEXT_STORAGE_KEY, 'off');
        vi.resetModules();
        const reopened = await import('@renderer/store/uiPrefsStore');
        expect(reopened.useUiPrefsStore.getState().autoNext).toBe(false);
    });
});

