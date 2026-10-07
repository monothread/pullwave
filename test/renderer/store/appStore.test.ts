// @vitest-environment jsdom
import { DEFAULT_SETTINGS } from '@shared/constants';
import type { HistoryEntry } from '@shared/types';
import { INITIAL_APP_UPDATE, upsertJob, useAppStore } from '@renderer/store/appStore';
import { APP_UPDATE_IDLE, installMockApi, makeJob, type MockApiHandle } from '../../helpers/mockApi';

let mock: MockApiHandle;
const initial = useAppStore.getState();

beforeEach(() => {
    mock = installMockApi();
    useAppStore.setState({ ...initial, jobs: [], history: [], settings: DEFAULT_SETTINGS, settingsLoaded: false, binaries: null, notice: null, toasts: [], updating: false, appUpdate: INITIAL_APP_UPDATE, traySupport: null, streamSearches: {}, tab: 'downloads', downloadsView: 'queue' });
});

const HISTORY_ENTRY: HistoryEntry = { id: 'h1', url: 'https://x.com', title: 'T', filePath: '/d/T.mp4', status: 'done', errorTitle: null, finishedAt: 5 };

describe('upsertJob', () => {
    it('appends a job that does not exist', () => {
        expect(upsertJob([makeJob({ id: 'a' })], makeJob({ id: 'b' }))).toEqual([makeJob({ id: 'a' }), makeJob({ id: 'b' })]);
    });

    it('replaces a job with the same id preserving order', () => {
        const result = upsertJob([makeJob({ id: 'a' }), makeJob({ id: 'b' })], makeJob({ id: 'a', percent: 99 }));
        expect(result).toEqual([makeJob({ id: 'a', percent: 99 }), makeJob({ id: 'b' })]);
    });
});

describe('useAppStore basics', () => {
    it('has the expected initial state', () => {
        expect(initial.tab).toBe('downloads');
        expect(initial.downloadsView).toBe('queue');
        expect(initial.jobs).toEqual([]);
        expect(initial.binaries).toBeNull();
        expect(initial.settingsLoaded).toBe(false);
        expect(initial.notice).toBeNull();
    });

    it('sets the screen of the video downloader', () => {
        useAppStore.getState().setDownloadsView('history');
        expect(useAppStore.getState().downloadsView).toBe('history');
        expect(useAppStore.getState().tab).toBe('downloads');
        useAppStore.getState().setDownloadsView('queue');
        expect(useAppStore.getState().downloadsView).toBe('queue');
    });

    it('sets the tab and the notice', () => {
        useAppStore.getState().setTab('settings');
        useAppStore.getState().setNotice({ kind: 'info', message: 'hi' });
        expect(useAppStore.getState().tab).toBe('settings');
        expect(useAppStore.getState().notice).toEqual({ kind: 'info', message: 'hi' });
        useAppStore.getState().setNotice(null);
        expect(useAppStore.getState().notice).toBeNull();
    });
});

function toastMessages(): string[] {
    return useAppStore.getState().toasts.map((toast) => {
        return toast.message;
    });
}

describe('the toasts', () => {
    it('starts with none', () => {
        expect(useAppStore.getState().toasts).toEqual([]);
    });

    it('adds a toast with its message, and says which one it is', () => {
        const id = useAppStore.getState().pushToast('first');
        expect(useAppStore.getState().toasts).toEqual([{ id, message: 'first' }]);
    });

    it('stacks the toasts in the order they come, each one with an id of its own', () => {
        const first = useAppStore.getState().pushToast('first');
        const second = useAppStore.getState().pushToast('second');
        const third = useAppStore.getState().pushToast('third');
        expect(new Set([first, second, third]).size).toBe(3);
        expect(useAppStore.getState().toasts).toEqual([
            { id: first, message: 'first' },
            { id: second, message: 'second' },
            { id: third, message: 'third' }
        ]);
    });

    it('keeps two toasts with the same message apart', () => {
        const first = useAppStore.getState().pushToast('same');
        const second = useAppStore.getState().pushToast('same');
        expect(first).not.toBe(second);
        useAppStore.getState().dismissToast(first);
        expect(useAppStore.getState().toasts).toEqual([{ id: second, message: 'same' }]);
    });

    it('takes away only the toast that was dismissed', () => {
        const first = useAppStore.getState().pushToast('first');
        const second = useAppStore.getState().pushToast('second');
        const third = useAppStore.getState().pushToast('third');
        useAppStore.getState().dismissToast(second);
        expect(useAppStore.getState().toasts).toEqual([
            { id: first, message: 'first' },
            { id: third, message: 'third' }
        ]);
        useAppStore.getState().dismissToast(first);
        useAppStore.getState().dismissToast(third);
        expect(useAppStore.getState().toasts).toEqual([]);
    });

    it('does nothing when the toast is not there any more', () => {
        const id = useAppStore.getState().pushToast('first');
        useAppStore.getState().dismissToast(id);
        useAppStore.getState().dismissToast(id);
        useAppStore.getState().dismissToast(-1);
        expect(useAppStore.getState().toasts).toEqual([]);
    });

    it('does not touch the notice of an action, and the notice does not touch the toasts', () => {
        const id = useAppStore.getState().pushToast('done');
        useAppStore.getState().setNotice({ kind: 'error', message: 'boom' });
        expect(useAppStore.getState().notice).toEqual({ kind: 'error', message: 'boom' });
        expect(useAppStore.getState().toasts).toEqual([{ id, message: 'done' }]);
        useAppStore.getState().setNotice({ kind: 'info', message: 'saved' });
        expect(useAppStore.getState().notice).toEqual({ kind: 'info', message: 'saved' });
        useAppStore.getState().setNotice(null);
        expect(useAppStore.getState().notice).toBeNull();
        expect(useAppStore.getState().toasts).toEqual([{ id, message: 'done' }]);
    });
});

describe('the tab the app opens on', () => {
    it('is the video downloader when the settings do not say another', async () => {
        await useAppStore.getState().init();
        expect(useAppStore.getState().tab).toBe('downloads');
    });

    it('is the one of the settings once they are loaded', async () => {
        mock.api.getSettings.mockResolvedValue({ ...DEFAULT_SETTINGS, startTab: 'anime' });
        await useAppStore.getState().init();
        expect(useAppStore.getState().tab).toBe('anime');
    });
});

describe('the settings being loaded', () => {
    it('are not loaded until init has read them', () => {
        expect(useAppStore.getState().settingsLoaded).toBe(false);
    });

    it('are marked as loaded, with their values, once init has read them', async () => {
        mock.api.getSettings.mockResolvedValue({ ...DEFAULT_SETTINGS, theme: 'nord' });
        await useAppStore.getState().init();
        expect(useAppStore.getState().settingsLoaded).toBe(true);
        expect(useAppStore.getState().settings).toEqual({ ...DEFAULT_SETTINGS, theme: 'nord' });
    });
});

describe('a download that is complete', () => {
    it('says so, with its title, and leaves the queue', async () => {
        await useAppStore.getState().init();
        mock.emitJobUpdate(makeJob({ id: 'a', title: 'My video', status: 'running', percent: 50 }));
        expect(toastMessages()).toEqual([]);
        expect(mock.api.removeJob).not.toHaveBeenCalled();

        mock.emitJobUpdate(makeJob({ id: 'a', title: 'My video', status: 'done', percent: 100 }));

        expect(toastMessages()).toEqual(['Download complete: My video']);
        expect(useAppStore.getState().notice).toBeNull();
        expect(mock.api.removeJob).toHaveBeenCalledTimes(1);
        expect(mock.api.removeJob).toHaveBeenCalledWith('a');
    });

    it('uses the link when the download has no title', async () => {
        await useAppStore.getState().init();
        mock.emitJobUpdate(makeJob({ id: 'a', title: null, url: 'https://x.com/v', status: 'done' }));
        expect(toastMessages()).toEqual(['Download complete: https://x.com/v']);
    });

    it('says it in the language of the settings', async () => {
        mock.api.getSettings.mockResolvedValueOnce({ ...DEFAULT_SETTINGS, language: 'pt' });
        await useAppStore.getState().init();
        mock.emitJobUpdate(makeJob({ id: 'a', title: 'Meu vídeo', status: 'done' }));
        expect(toastMessages()).toEqual(['Download concluído: Meu vídeo']);
    });

    it('stacks the notices when several finish together, each with its own card removed', async () => {
        await useAppStore.getState().init();
        mock.emitJobUpdate(makeJob({ id: 'a', title: 'One', status: 'done' }));
        mock.emitJobUpdate(makeJob({ id: 'b', title: 'Two', status: 'done' }));

        expect(toastMessages()).toEqual(['Download complete: One', 'Download complete: Two']);
        expect(useAppStore.getState().notice).toBeNull();
        expect(mock.api.removeJob).toHaveBeenCalledTimes(2);
        expect(mock.api.removeJob).toHaveBeenNthCalledWith(1, 'a');
        expect(mock.api.removeJob).toHaveBeenNthCalledWith(2, 'b');
    });

    it('does not say it again for an update of a job that was already complete', async () => {
        mock.api.listJobs.mockResolvedValueOnce([makeJob({ id: 'a', status: 'done' })]);
        await useAppStore.getState().init();
        mock.emitJobUpdate(makeJob({ id: 'a', status: 'done', filePath: '/d/a.mp4' }));
        expect(useAppStore.getState().notice).toBeNull();
        expect(toastMessages()).toEqual([]);
        expect(mock.api.removeJob).not.toHaveBeenCalled();
    });

    it.each(['error', 'cancelled', 'running', 'queued'] as const)('does not say it, nor remove the card, for a %s download', async (status) => {
        await useAppStore.getState().init();
        mock.emitJobUpdate(makeJob({ id: 'a', status }));
        expect(useAppStore.getState().notice).toBeNull();
        expect(toastMessages()).toEqual([]);
        expect(mock.api.removeJob).not.toHaveBeenCalled();
        expect(useAppStore.getState().jobs).toEqual([makeJob({ id: 'a', status })]);
    });
});

describe('useAppStore.init', () => {
    it('loads settings, jobs, history and binaries', async () => {
        const job = makeJob();
        mock.api.listJobs.mockResolvedValueOnce([job]);
        mock.api.listHistory.mockResolvedValueOnce([HISTORY_ENTRY]);
        mock.api.getSettings.mockResolvedValueOnce({ ...DEFAULT_SETTINGS, downloadDir: '/x' });
        await useAppStore.getState().init();
        const state = useAppStore.getState();
        expect(state.jobs).toEqual([job]);
        expect(state.history).toEqual([HISTORY_ENTRY]);
        expect(state.settings).toEqual({ ...DEFAULT_SETTINGS, downloadDir: '/x' });
        expect(state.binaries?.ytdlp.version).toBe('2026.08.19');
    });

    it('applies job updates and removals pushed from the main process', async () => {
        await useAppStore.getState().init();
        mock.emitJobUpdate(makeJob({ id: 'a' }));
        mock.emitJobUpdate(makeJob({ id: 'b' }));
        mock.emitJobUpdate(makeJob({ id: 'a', percent: 80 }));
        expect(useAppStore.getState().jobs).toEqual([makeJob({ id: 'a', percent: 80 }), makeJob({ id: 'b' })]);
        mock.emitJobRemoved('a');
        expect(useAppStore.getState().jobs).toEqual([makeJob({ id: 'b' })]);
    });

    it('refreshes the history when it changes', async () => {
        await useAppStore.getState().init();
        mock.api.listHistory.mockResolvedValueOnce([HISTORY_ENTRY]);
        mock.emitHistoryChanged();
        await vi.waitFor(() => {
            expect(useAppStore.getState().history).toEqual([HISTORY_ENTRY]);
        });
    });

    it('loads the app update state and applies pushed changes', async () => {
        mock.api.getAppUpdateState.mockResolvedValueOnce({ ...APP_UPDATE_IDLE, currentVersion: '0.3.0' });
        await useAppStore.getState().init();
        expect(useAppStore.getState().appUpdate).toEqual({ ...APP_UPDATE_IDLE, currentVersion: '0.3.0' });
        const available = { ...APP_UPDATE_IDLE, status: 'available' as const, version: '0.4.0' };
        mock.emitAppUpdateState(available);
        expect(useAppStore.getState().appUpdate).toEqual(available);
    });

    it('returns a cleanup that unsubscribes every listener', async () => {
        const cleanup = await useAppStore.getState().init();
        expect(mock.unsubscribers).toHaveLength(5);
        cleanup();
        mock.unsubscribers.forEach((unsubscribe) => {
            expect(unsubscribe).toHaveBeenCalledTimes(1);
        });
    });
});

describe('useAppStore.addUrls', () => {
    it('adds each URL separately and returns the results in order', async () => {
        mock.api.addDownload.mockResolvedValueOnce({ ok: true, job: null, message: null });
        mock.api.addDownload.mockResolvedValueOnce({ ok: false, job: null, message: 'Invalid URL. Use an http(s) link.' });
        const results = await useAppStore.getState().addUrls([
            { url: 'https://a.com', downloadDir: null, options: {} },
            { url: 'nope', downloadDir: null, options: {} }
        ]);
        expect(mock.api.addDownload.mock.calls).toEqual([['https://a.com'], ['nope']]);
        expect(results).toEqual([
            { ok: true, job: null, message: null },
            { ok: false, job: null, message: 'Invalid URL. Use an http(s) link.' }
        ]);
    });

    it('sends the folder chosen for a link along with its URL', async () => {
        mock.api.addDownload.mockResolvedValue({ ok: true, job: null, message: null });
        await useAppStore.getState().addUrls([
            { url: 'https://a.com', downloadDir: '/media/videos', options: {} },
            { url: 'https://b.com', downloadDir: null, options: {} }
        ]);
        expect(mock.api.addDownload.mock.calls).toEqual([['https://a.com', '/media/videos'], ['https://b.com']]);
    });

    it('sends the options chosen for a link, with an empty folder when it has none', async () => {
        mock.api.addDownload.mockResolvedValue({ ok: true, job: null, message: null });
        await useAppStore.getState().addUrls([
            { url: 'https://a.com', downloadDir: null, options: { maxResolution: '720' } },
            { url: 'https://b.com', downloadDir: '/media/videos', options: { waitForLive: true, verifyLiveEndSeconds: 20 } },
            { url: 'https://c.com', downloadDir: null, options: {} }
        ]);
        expect(mock.api.addDownload.mock.calls).toEqual([
            ['https://a.com', '', { maxResolution: '720' }],
            ['https://b.com', '/media/videos', { waitForLive: true, verifyLiveEndSeconds: 20 }],
            ['https://c.com']
        ]);
    });

    it('does not call the API and returns nothing for an empty list', async () => {
        await expect(useAppStore.getState().addUrls([])).resolves.toEqual([]);
        expect(mock.api.addDownload).not.toHaveBeenCalled();
    });

    it('does not set a notice; feedback is shown by the caller', async () => {
        mock.api.addDownload.mockResolvedValueOnce({ ok: false, job: null, message: 'bad' });
        await useAppStore.getState().addUrls([{ url: 'nope', downloadDir: null, options: {} }]);
        expect(useAppStore.getState().notice).toBeNull();
    });
});

describe('useAppStore queue actions', () => {
    it('forwards cancel, retry, remove and clearFinished', async () => {
        const state = useAppStore.getState();
        await state.cancelJob('a');
        await state.retryJob('b');
        await state.removeJob('c');
        await state.clearPartialFiles('d');
        await state.clearFinished();
        expect(mock.api.cancelJob).toHaveBeenCalledWith('a');
        expect(mock.api.retryJob).toHaveBeenCalledWith('b');
        expect(mock.api.removeJob).toHaveBeenCalledWith('c');
        expect(mock.api.clearPartialFiles).toHaveBeenCalledWith('d');
        expect(mock.api.clearFinished).toHaveBeenCalledTimes(1);
    });
});

describe('useAppStore live recordings', () => {
    it('asks the main process to stop a live recording and keep it', async () => {
        await useAppStore.getState().stopJob('live-1');
        expect(mock.api.stopJob).toHaveBeenCalledWith('live-1');
        expect(mock.api.cancelJob).not.toHaveBeenCalled();
    });

    it('shows the elapsed time and size pushed while recording', async () => {
        await useAppStore.getState().init();
        mock.emitJobUpdate(makeJob({ id: 'live-1', live: true, elapsedSeconds: 3, downloadedBytes: 2048 }));
        mock.emitJobUpdate(makeJob({ id: 'live-1', live: true, elapsedSeconds: 4, downloadedBytes: 4096 }));
        expect(useAppStore.getState().jobs).toEqual([makeJob({ id: 'live-1', live: true, elapsedSeconds: 4, downloadedBytes: 4096 })]);
    });
});

describe('useAppStore history', () => {
    it('refreshes the history from the API', async () => {
        mock.api.listHistory.mockResolvedValueOnce([HISTORY_ENTRY]);
        await useAppStore.getState().refreshHistory();
        expect(useAppStore.getState().history).toEqual([HISTORY_ENTRY]);
    });

    it('clears the history', async () => {
        useAppStore.setState({ history: [HISTORY_ENTRY] });
        await useAppStore.getState().clearHistory();
        expect(mock.api.clearHistory).toHaveBeenCalledTimes(1);
        expect(useAppStore.getState().history).toEqual([]);
    });
});

describe('useAppStore settings and binaries', () => {
    it('saves settings and stores the sanitized result', async () => {
        const sanitized = { ...DEFAULT_SETTINGS, maxTitleLength: 200 };
        mock.api.saveSettings.mockResolvedValueOnce(sanitized);
        const result = await useAppStore.getState().saveSettings({ ...DEFAULT_SETTINGS, maxTitleLength: 5000 });
        expect(mock.api.saveSettings).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, maxTitleLength: 5000 });
        expect(result).toEqual(sanitized);
        expect(useAppStore.getState().settings).toEqual(sanitized);
    });

    it('does not re-check the binaries when their paths did not change', async () => {
        await useAppStore.getState().saveSettings({ ...DEFAULT_SETTINGS, audioOnly: true, downloadDir: '/x' });
        expect(mock.api.checkBinaries).not.toHaveBeenCalled();
        expect(useAppStore.getState().binaries).toBeNull();
    });

    it.each([
        ['ytdlpPath', '/opt/yt-dlp'],
        ['ffmpegPath', '/opt/ffmpeg']
    ] as const)('re-checks the binaries when %s changes', async (key, value) => {
        await useAppStore.getState().saveSettings({ ...DEFAULT_SETTINGS, [key]: value });
        expect(mock.api.checkBinaries).toHaveBeenCalledTimes(1);
        expect(useAppStore.getState().binaries).not.toBeNull();
    });

    it('does not re-check again when the same custom path is saved twice', async () => {
        await useAppStore.getState().saveSettings({ ...DEFAULT_SETTINGS, ytdlpPath: '/opt/yt-dlp' });
        await useAppStore.getState().saveSettings({ ...DEFAULT_SETTINGS, ytdlpPath: '/opt/yt-dlp', audioOnly: true });
        expect(mock.api.checkBinaries).toHaveBeenCalledTimes(1);
    });

    it('opens the directory chooser', async () => {
        mock.api.chooseDirectory.mockResolvedValueOnce('/picked');
        await expect(useAppStore.getState().chooseDirectory()).resolves.toBe('/picked');
    });
});

describe('useAppStore.updateYtdlp', () => {
    it('shows an info notice with the output on success', async () => {
        mock.api.updateYtdlp.mockResolvedValueOnce({ ok: true, output: 'Updated to 2026.09' });
        await useAppStore.getState().updateYtdlp();
        expect(useAppStore.getState().updating).toBe(false);
        expect(useAppStore.getState().notice).toEqual({ kind: 'info', message: 'Updated to 2026.09' });
        expect(mock.api.checkBinaries).toHaveBeenCalledTimes(1);
    });

    it('shows an error notice on failure', async () => {
        mock.api.updateYtdlp.mockResolvedValueOnce({ ok: false, output: 'Permission denied' });
        await useAppStore.getState().updateYtdlp();
        expect(useAppStore.getState().notice).toEqual({ kind: 'error', message: 'Permission denied' });
    });

    it('uses fallback messages when the output is empty', async () => {
        mock.api.updateYtdlp.mockResolvedValueOnce({ ok: true, output: '' });
        await useAppStore.getState().updateYtdlp();
        expect(useAppStore.getState().notice).toEqual({ kind: 'info', message: 'yt-dlp is up to date.' });
        mock.api.updateYtdlp.mockResolvedValueOnce({ ok: false, output: '' });
        await useAppStore.getState().updateYtdlp();
        expect(useAppStore.getState().notice).toEqual({ kind: 'error', message: 'Update failed.' });
    });

    it('marks the store as updating while the request is pending', async () => {
        let release: () => void = () => {
            return undefined;
        };
        mock.api.updateYtdlp.mockReturnValueOnce(
            new Promise((resolve) => {
                release = () => {
                    resolve({ ok: true, output: 'done' });
                };
            })
        );
        const pending = useAppStore.getState().updateYtdlp();
        expect(useAppStore.getState().updating).toBe(true);
        release();
        await pending;
        expect(useAppStore.getState().updating).toBe(false);
    });
});

describe('useAppStore.resetYtdlp', () => {
    it('goes back to the yt-dlp that ships with the app, tells the user and reads the binaries again', async () => {
        mock.api.resetYtdlp.mockResolvedValueOnce({ ok: true, output: 'Using the yt-dlp that ships with the app again.' });
        await useAppStore.getState().resetYtdlp();
        expect(mock.api.resetYtdlp).toHaveBeenCalledTimes(1);
        expect(mock.api.updateYtdlp).not.toHaveBeenCalled();
        expect(useAppStore.getState().updating).toBe(false);
        expect(useAppStore.getState().notice).toEqual({ kind: 'info', message: 'Using the yt-dlp that ships with the app again.' });
        expect(mock.api.checkBinaries).toHaveBeenCalledTimes(1);
    });

    it('shows an error notice when there was nothing to remove', async () => {
        mock.api.resetYtdlp.mockResolvedValueOnce({ ok: false, output: 'There is no updated yt-dlp to remove: the one that ships with the app is already in use.' });
        await useAppStore.getState().resetYtdlp();
        expect(useAppStore.getState().notice).toEqual({ kind: 'error', message: 'There is no updated yt-dlp to remove: the one that ships with the app is already in use.' });
    });

    it('says something even when the result has no text', async () => {
        mock.api.resetYtdlp.mockResolvedValueOnce({ ok: false, output: '' });
        await useAppStore.getState().resetYtdlp();
        expect(useAppStore.getState().notice).toEqual({ kind: 'error', message: 'Update failed.' });
    });

    it('marks the store as updating while the request is pending, so the buttons wait', async () => {
        let release: () => void = () => {
            return undefined;
        };
        mock.api.resetYtdlp.mockReturnValueOnce(
            new Promise((resolve) => {
                release = () => {
                    resolve({ ok: true, output: 'done' });
                };
            })
        );
        const pending = useAppStore.getState().resetYtdlp();
        expect(useAppStore.getState().updating).toBe(true);
        release();
        await pending;
        expect(useAppStore.getState().updating).toBe(false);
    });
});

describe('useAppStore app updates', () => {
    it('starts with the idle placeholder state', () => {
        expect(initial.appUpdate).toEqual({ status: 'idle', currentVersion: '', version: null, percent: 0, message: null });
    });

    it('forwards check, download and install to the API', async () => {
        const state = useAppStore.getState();
        await state.checkAppUpdate();
        await state.downloadAppUpdate();
        await state.installAppUpdate();
        expect(mock.api.checkAppUpdate).toHaveBeenCalledTimes(1);
        expect(mock.api.downloadAppUpdate).toHaveBeenCalledTimes(1);
        expect(mock.api.installAppUpdate).toHaveBeenCalledTimes(1);
    });
});

describe('useAppStore tray support', () => {
    it('starts unknown', () => {
        expect(initial.traySupport).toBeNull();
    });

    it('stores the result of the main-process check', async () => {
        mock.api.getTraySupport.mockResolvedValueOnce({ available: false, reason: 'no tray here' });
        await useAppStore.getState().refreshTraySupport();
        expect(mock.api.getTraySupport).toHaveBeenCalledTimes(1);
        expect(useAppStore.getState().traySupport).toEqual({ available: false, reason: 'no tray here' });
    });
});

describe('useAppStore detected browsers', () => {
    const ORIGIN = {
        label: 'Brave Origin',
        engine: 'brave' as const,
        dataDir: '/home/a/.config/BraveSoftware/Brave-Origin',
        profiles: [{ id: 'Default', name: 'Personal' }]
    };

    it('starts unknown', () => {
        expect(initial.browsers).toBeNull();
    });

    it('stores the detected browsers without asking for a rescan by default', async () => {
        mock.api.listBrowsers.mockResolvedValueOnce([ORIGIN]);
        await useAppStore.getState().loadBrowsers();
        expect(mock.api.listBrowsers).toHaveBeenCalledTimes(1);
        expect(mock.api.listBrowsers).toHaveBeenCalledWith(false);
        expect(useAppStore.getState().browsers).toEqual([ORIGIN]);
    });

    it('asks the main process to scan again on refresh', async () => {
        mock.api.listBrowsers.mockResolvedValueOnce([]);
        await useAppStore.getState().loadBrowsers(true);
        expect(mock.api.listBrowsers).toHaveBeenCalledWith(true);
        expect(useAppStore.getState().browsers).toEqual([]);
    });
});

describe('useAppStore stream search', () => {
    const FOUND = { id: 'c1', url: 'https://cdn.test/a.m3u8', kind: 'hls' as const, source: 'page' as const, host: 'cdn.test', title: 'Ep', duplicates: 0 };

    it('starts empty', () => {
        expect(initial.streamSearches).toEqual({});
    });

    it('marks the job as searching and stores the result when it ends', async () => {
        mock.api.findStreams.mockResolvedValueOnce({ ok: true, candidates: [FOUND], message: null, usedBrowser: false });
        const search = useAppStore.getState().findStreams('job-1', false);
        expect(useAppStore.getState().streamSearches['job-1']).toEqual({ status: 'searching', stage: 'scanning', candidates: [], message: null, usedBrowser: false });
        await search;
        expect(mock.api.findStreams).toHaveBeenCalledWith('job-1', false);
        expect(useAppStore.getState().streamSearches['job-1']).toEqual({ status: 'done', stage: 'scanning', candidates: [FOUND], message: null, usedBrowser: false });
    });

    it('passes the deep flag and keeps the message of an empty result', async () => {
        mock.api.findStreams.mockResolvedValueOnce({ ok: false, candidates: [], message: 'Nothing here.', usedBrowser: true });
        await useAppStore.getState().findStreams('job-1', true);
        expect(mock.api.findStreams).toHaveBeenCalledWith('job-1', true);
        expect(useAppStore.getState().streamSearches['job-1']).toMatchObject({ status: 'done', candidates: [], message: 'Nothing here.', usedBrowser: true });
    });

    it('follows the stage pushed by the main process while searching', async () => {
        await useAppStore.getState().init();
        let finish: (value: { ok: boolean; candidates: never[]; message: string; usedBrowser: boolean }) => void = () => {
            return undefined;
        };
        mock.api.findStreams.mockReturnValueOnce(
            new Promise((resolve) => {
                finish = resolve;
            })
        );
        const search = useAppStore.getState().findStreams('job-1', false);
        mock.emitStreamProgress({ jobId: 'job-1', stage: 'watching' });
        expect(useAppStore.getState().streamSearches['job-1']?.stage).toBe('watching');
        finish({ ok: false, candidates: [], message: 'none', usedBrowser: true });
        await search;
        expect(useAppStore.getState().streamSearches['job-1']).toMatchObject({ status: 'done', stage: 'watching' });
    });

    it('ignores progress for jobs that are not searching', async () => {
        await useAppStore.getState().init();
        mock.emitStreamProgress({ jobId: 'other', stage: 'watching' });
        expect(useAppStore.getState().streamSearches).toEqual({});
    });

    it('does not bring a closed panel back when a late result arrives', async () => {
        let finish: (value: { ok: boolean; candidates: never[]; message: string; usedBrowser: boolean }) => void = () => {
            return undefined;
        };
        mock.api.findStreams.mockReturnValueOnce(
            new Promise((resolve) => {
                finish = resolve;
            })
        );
        const search = useAppStore.getState().findStreams('job-1', false);
        useAppStore.getState().closeStreamSearch('job-1');
        finish({ ok: false, candidates: [], message: 'late', usedBrowser: false });
        await search;
        expect(useAppStore.getState().streamSearches).toEqual({});
    });

    it('cancels a search through the API', async () => {
        await useAppStore.getState().cancelStreamSearch('job-1');
        expect(mock.api.cancelStreamFind).toHaveBeenCalledWith('job-1');
    });

    it('adds the chosen stream as a download and closes the panel', async () => {
        useAppStore.setState({ streamSearches: { 'job-1': { status: 'done', stage: 'scanning', candidates: [FOUND], message: null, usedBrowser: false } } });
        await useAppStore.getState().downloadStream('job-1', 'c1');
        expect(mock.api.downloadStream).toHaveBeenCalledWith('c1');
        expect(useAppStore.getState().streamSearches).toEqual({});
        expect(useAppStore.getState().notice).toBeNull();
    });

    it('keeps the panel and raises a notice when the stream could not be added', async () => {
        mock.api.downloadStream.mockResolvedValueOnce({ ok: false, job: null, message: null });
        useAppStore.setState({ streamSearches: { 'job-1': { status: 'done', stage: 'scanning', candidates: [FOUND], message: null, usedBrowser: false } } });
        await useAppStore.getState().downloadStream('job-1', 'c1');
        expect(useAppStore.getState().notice).toEqual({ kind: 'error', message: 'Could not add the download.' });
        expect(useAppStore.getState().streamSearches['job-1']).toBeDefined();
    });

    it('closing a panel cancels the search and removes only that job', () => {
        useAppStore.setState({
            streamSearches: {
                'job-1': { status: 'searching', stage: 'scanning', candidates: [], message: null, usedBrowser: false },
                'job-2': { status: 'done', stage: 'scanning', candidates: [], message: 'x', usedBrowser: false }
            }
        });
        useAppStore.getState().closeStreamSearch('job-1');
        expect(mock.api.cancelStreamFind).toHaveBeenCalledWith('job-1');
        expect(Object.keys(useAppStore.getState().streamSearches)).toEqual(['job-2']);
    });

    it('drops the search of a job that was removed', async () => {
        await useAppStore.getState().init();
        useAppStore.setState({ streamSearches: { 'job-1': { status: 'done', stage: 'scanning', candidates: [], message: null, usedBrowser: false } } });
        mock.emitJobRemoved('job-1');
        expect(useAppStore.getState().streamSearches).toEqual({});
    });
});

describe('useAppStore pause and resume', () => {
    it('pauses and resumes a download through the api, by its id', async () => {
        await useAppStore.getState().pauseJob('a');
        await useAppStore.getState().resumeJob('b');

        expect(mock.api.pauseJob).toHaveBeenCalledTimes(1);
        expect(mock.api.pauseJob).toHaveBeenCalledWith('a');
        expect(mock.api.resumeJob).toHaveBeenCalledTimes(1);
        expect(mock.api.resumeJob).toHaveBeenCalledWith('b');
        expect(mock.api.cancelJob).not.toHaveBeenCalled();
    });
});
