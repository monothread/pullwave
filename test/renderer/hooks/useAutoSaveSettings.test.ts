// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { DEFAULT_SETTINGS } from '@shared/constants';
import type { Settings } from '@shared/types';
import { AUTOSAVE_DELAY_MS, useAutoSaveSettings } from '@renderer/hooks/useAutoSaveSettings';

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

function makeSave() {
    return vi.fn(async (settings: Settings) => {
        return settings;
    });
}

async function advance(ms: number): Promise<void> {
    await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
    });
}

describe('useAutoSaveSettings', () => {
    it('exposes the stored settings as the draft and starts idle', () => {
        const { result } = renderHook(() => {
            return useAutoSaveSettings(DEFAULT_SETTINGS, makeSave());
        });
        expect(result.current.draft).toEqual(DEFAULT_SETTINGS);
        expect(result.current.status).toBe('idle');
    });

    it('uses a 2 second delay', () => {
        expect(AUTOSAVE_DELAY_MS).toBe(2000);
    });

    describe('changeMany (immediate)', () => {
        it('applies several fields and saves once with all of them', async () => {
            const save = makeSave();
            const { result } = renderHook(() => {
                return useAutoSaveSettings(DEFAULT_SETTINGS, save);
            });
            await act(async () => {
                result.current.changeMany({ cookiesBrowser: 'brave', cookiesBrowserDir: '/home/a/.config/BraveSoftware/Brave-Origin' });
            });
            expect(save).toHaveBeenCalledTimes(1);
            expect(save).toHaveBeenCalledWith({
                ...DEFAULT_SETTINGS,
                cookiesBrowser: 'brave',
                cookiesBrowserDir: '/home/a/.config/BraveSoftware/Brave-Origin'
            });
            expect(result.current.draft.cookiesBrowser).toBe('brave');
            expect(result.current.status).toBe('saved');
        });
    });

    describe('sync (no save)', () => {
        it('puts what the main process saved in the draft without saving it again', async () => {
            const save = makeSave();
            const { result } = renderHook(() => {
                return useAutoSaveSettings({ ...DEFAULT_SETTINGS, animeAutoTranslateNew: true }, save);
            });
            act(() => {
                result.current.sync({ animeAutoTranslateNew: false });
            });
            expect(result.current.draft).toEqual({ ...DEFAULT_SETTINGS, animeAutoTranslateNew: false });
            expect(result.current.status).toBe('idle');
            await advance(AUTOSAVE_DELAY_MS * 2);
            expect(save).not.toHaveBeenCalled();
        });

        it('is kept in what the next change saves', async () => {
            const save = makeSave();
            const { result } = renderHook(() => {
                return useAutoSaveSettings({ ...DEFAULT_SETTINGS, animeAutoTranslateNew: true }, save);
            });
            act(() => {
                result.current.sync({ animeAutoTranslateNew: false });
            });
            await act(async () => {
                result.current.change('animeAutoDownloadNew', true);
            });
            expect(save).toHaveBeenCalledTimes(1);
            expect(save).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, animeAutoTranslateNew: false, animeAutoDownloadNew: true });
        });
    });

    describe('change (immediate)', () => {
        it('updates the draft and saves right away with the full settings', async () => {
            const save = makeSave();
            const { result } = renderHook(() => {
                return useAutoSaveSettings(DEFAULT_SETTINGS, save);
            });
            await act(async () => {
                result.current.change('audioOnly', true);
            });
            expect(save).toHaveBeenCalledTimes(1);
            expect(save).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, audioOnly: true });
            expect(result.current.draft.audioOnly).toBe(true);
            expect(result.current.status).toBe('saved');
        });

        it('reports the saving status while the request is pending', async () => {
            let release: (settings: Settings) => void = () => {
                return undefined;
            };
            const save = vi.fn(() => {
                return new Promise<Settings>((resolve) => {
                    release = resolve;
                });
            });
            const { result } = renderHook(() => {
                return useAutoSaveSettings(DEFAULT_SETTINGS, save);
            });
            act(() => {
                result.current.change('audioOnly', true);
            });
            expect(result.current.status).toBe('saving');
            await act(async () => {
                release({ ...DEFAULT_SETTINGS, audioOnly: true });
            });
            expect(result.current.status).toBe('saved');
        });

        it('saves pending text edits together with the immediate change and cancels the timer', async () => {
            const save = makeSave();
            const { result } = renderHook(() => {
                return useAutoSaveSettings(DEFAULT_SETTINGS, save);
            });
            act(() => {
                result.current.edit('downloadDir', '/media');
            });
            await act(async () => {
                result.current.change('audioOnly', true);
            });
            expect(save).toHaveBeenCalledTimes(1);
            expect(save).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, downloadDir: '/media', audioOnly: true });
            await advance(AUTOSAVE_DELAY_MS * 2);
            expect(save).toHaveBeenCalledTimes(1);
        });
    });

    describe('edit (debounced)', () => {
        it('updates the draft immediately but saves only after the delay', async () => {
            const save = makeSave();
            const { result } = renderHook(() => {
                return useAutoSaveSettings(DEFAULT_SETTINGS, save);
            });
            act(() => {
                result.current.edit('downloadDir', '/media');
            });
            expect(result.current.draft.downloadDir).toBe('/media');
            expect(result.current.status).toBe('pending');
            await advance(AUTOSAVE_DELAY_MS - 1);
            expect(save).not.toHaveBeenCalled();
            await advance(1);
            expect(save).toHaveBeenCalledTimes(1);
            expect(save).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, downloadDir: '/media' });
            expect(result.current.status).toBe('saved');
        });

        it('restarts the delay on every edit and saves only the last value once', async () => {
            const save = makeSave();
            const { result } = renderHook(() => {
                return useAutoSaveSettings(DEFAULT_SETTINGS, save);
            });
            act(() => {
                result.current.edit('downloadDir', '/a');
            });
            await advance(1500);
            act(() => {
                result.current.edit('downloadDir', '/ab');
            });
            await advance(1500);
            expect(save).not.toHaveBeenCalled();
            await advance(500);
            expect(save).toHaveBeenCalledTimes(1);
            expect(save).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, downloadDir: '/ab' });
        });

        it('replaces the draft with the sanitized settings returned by the save', async () => {
            const save = vi.fn(async (settings: Settings) => {
                return { ...settings, maxTitleLength: 200 };
            });
            const { result } = renderHook(() => {
                return useAutoSaveSettings(DEFAULT_SETTINGS, save);
            });
            act(() => {
                result.current.edit('maxTitleLength', 9999);
            });
            expect(result.current.draft.maxTitleLength).toBe(9999);
            await advance(AUTOSAVE_DELAY_MS);
            expect(result.current.draft.maxTitleLength).toBe(200);
        });

        it('does not overwrite what the user typed while a save was in flight', async () => {
            let release: (settings: Settings) => void = () => {
                return undefined;
            };
            const save = vi.fn(() => {
                return new Promise<Settings>((resolve) => {
                    release = resolve;
                });
            });
            const { result } = renderHook(() => {
                return useAutoSaveSettings(DEFAULT_SETTINGS, save);
            });
            act(() => {
                result.current.edit('downloadDir', '/a');
            });
            await advance(AUTOSAVE_DELAY_MS);
            expect(result.current.status).toBe('saving');
            act(() => {
                result.current.edit('downloadDir', '/ab');
            });
            await act(async () => {
                release({ ...DEFAULT_SETTINGS, downloadDir: '/a' });
            });
            expect(result.current.draft.downloadDir).toBe('/ab');
            expect(result.current.status).toBe('pending');
        });
    });

    describe('failures and unmounting', () => {
        it('reports an error status when the save rejects and can recover on the next change', async () => {
            const save = vi.fn(async (settings: Settings) => {
                return settings;
            });
            save.mockRejectedValueOnce(new Error('disk full'));
            const { result } = renderHook(() => {
                return useAutoSaveSettings(DEFAULT_SETTINGS, save);
            });
            await act(async () => {
                result.current.change('audioOnly', true);
            });
            expect(result.current.status).toBe('error');
            await act(async () => {
                result.current.change('audioOnly', false);
            });
            expect(result.current.status).toBe('saved');
        });

        it('flushes a pending edit when unmounted so no change is lost', () => {
            const save = makeSave();
            const { result, unmount } = renderHook(() => {
                return useAutoSaveSettings(DEFAULT_SETTINGS, save);
            });
            act(() => {
                result.current.edit('downloadDir', '/media');
            });
            unmount();
            expect(save).toHaveBeenCalledTimes(1);
            expect(save).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, downloadDir: '/media' });
        });

        it('does not save on unmount when nothing is pending', () => {
            const save = makeSave();
            const { unmount } = renderHook(() => {
                return useAutoSaveSettings(DEFAULT_SETTINGS, save);
            });
            unmount();
            expect(save).not.toHaveBeenCalled();
        });

        it('does not save twice when unmounting after the debounced save already ran', async () => {
            const save = makeSave();
            const { result, unmount } = renderHook(() => {
                return useAutoSaveSettings(DEFAULT_SETTINGS, save);
            });
            act(() => {
                result.current.edit('downloadDir', '/media');
            });
            await advance(AUTOSAVE_DELAY_MS);
            unmount();
            expect(save).toHaveBeenCalledTimes(1);
        });
    });
});
