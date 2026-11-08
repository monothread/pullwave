// @vitest-environment jsdom
import { setUiSoundVolume } from '@renderer/sound/uiSound';
import { AUTO_NEXT_STORAGE_KEY, DEFAULT_SOUND_VOLUME, SOUNDS_STORAGE_KEY, VOLUME_STORAGE_KEY, readAutoNextPref, readSoundsPref, readVolumePref, useUiPrefsStore } from '@renderer/store/uiPrefsStore';

vi.mock('@renderer/sound/uiSound', () => {
    return { setUiSoundVolume: vi.fn(), playUiSound: vi.fn() };
});

afterEach(() => {
    window.localStorage.removeItem(SOUNDS_STORAGE_KEY);
    window.localStorage.removeItem(AUTO_NEXT_STORAGE_KEY);
    window.localStorage.removeItem(VOLUME_STORAGE_KEY);
    useUiPrefsStore.setState({ sounds: true, autoNext: true, soundVolume: 1 });
    vi.mocked(setUiSoundVolume).mockClear();
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

describe('the volume of the sounds', () => {
    it('is kept under its own key of the storage of the window, and is full by default', () => {
        expect(VOLUME_STORAGE_KEY).toBe('pullwave-ui-volume');
        expect(DEFAULT_SOUND_VOLUME).toBe(1);
        expect(readVolumePref()).toBe(1);
    });

    it('is read from the storage, kept between zero and one', () => {
        window.localStorage.setItem(VOLUME_STORAGE_KEY, '0.4');
        expect(readVolumePref()).toBe(0.4);
        window.localStorage.setItem(VOLUME_STORAGE_KEY, '5');
        expect(readVolumePref()).toBe(1);
        window.localStorage.setItem(VOLUME_STORAGE_KEY, '-2');
        expect(readVolumePref()).toBe(0);
    });

    it('is full when what was kept is not a number or the storage cannot be read', () => {
        window.localStorage.setItem(VOLUME_STORAGE_KEY, 'loud');
        expect(readVolumePref()).toBe(1);
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('denied');
        });
        expect(readVolumePref()).toBe(1);
    });

    it('is changed, saved and given to the sounds', () => {
        useUiPrefsStore.getState().setSoundVolume(0.25);
        expect(useUiPrefsStore.getState().soundVolume).toBe(0.25);
        expect(window.localStorage.getItem(VOLUME_STORAGE_KEY)).toBe('0.25');
        expect(setUiSoundVolume).toHaveBeenCalledWith(0.25);
    });

    it('is kept between zero and one when it is set', () => {
        useUiPrefsStore.getState().setSoundVolume(3);
        expect(useUiPrefsStore.getState().soundVolume).toBe(1);
        useUiPrefsStore.getState().setSoundVolume(-3);
        expect(useUiPrefsStore.getState().soundVolume).toBe(0);
        expect(setUiSoundVolume).toHaveBeenLastCalledWith(0);
    });

    it('is still changed when the storage cannot be written', () => {
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('full');
        });
        useUiPrefsStore.getState().setSoundVolume(0.5);
        expect(useUiPrefsStore.getState().soundVolume).toBe(0.5);
        expect(setUiSoundVolume).toHaveBeenCalledWith(0.5);
    });
});
