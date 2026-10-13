import { join } from 'node:path';
import { DEFAULT_SETTINGS, IPC } from '@shared/constants';
import type { DownloadJob, HistoryEntry } from '@shared/types';
import { registerHandlers, type IpcMainLike } from '@main/ipc/registerHandlers';
import { checkBinaries } from '@main/services/binaryLocator';
import { BinaryResolver } from '@main/services/binaryResolver';
import { HistoryStore } from '@main/services/historyStore';
import type { AppUpdateService } from '@main/services/appUpdateService';
import type { QueueManager } from '@main/services/queueManager';
import type { BrowserCatalog } from '@main/services/browserCatalog';
import { SettingsStore } from '@main/services/settingsStore';
import { cleanTempDirs, makeTempDir } from '../../helpers/tempDir';

vi.mock('@main/services/binaryLocator', () => {
    return {
        checkBinaries: vi.fn(async () => {
            return {
                ytdlp: { found: true, path: '/t/yt-dlp', version: '1', source: 'installed' },
                ffmpeg: { found: false, path: '/t/ffmpeg', version: null, source: 'installed' }
            };
        })
    };
});

afterEach(() => {
    cleanTempDirs();
});

const JOB: DownloadJob = {
    id: 'j1', url: 'https://x.com/a', status: 'queued', title: null, percent: 0, speed: '', eta: '', filePath: null, error: null, createdAt: 1, pageUrl: null, live: false, elapsedSeconds: 0, downloadedBytes: 0, hasPartial: false, customized: false, waitingForLive: false, endCheck: null, merging: false, saving: false, postProcess: null
};

function setup(animeFolderLocked?: () => boolean) {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const ipcMain: IpcMainLike = {
        handle: (channel, listener) => {
            handlers.set(channel, listener);
        }
    };
    const dir = makeTempDir();
    const settingsStore = new SettingsStore(join(dir, 's.json'));
    const historyStore = new HistoryStore(join(dir, 'h.json'));
    const queue = {
        add: vi.fn(() => {
            return { ok: true, job: JOB, message: null };
        }),
        list: vi.fn(() => {
            return [JOB];
        }),
        getJob: vi.fn(),
        cancel: vi.fn(),
        stop: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
        retry: vi.fn(),
        remove: vi.fn(),
        clearPartials: vi.fn(),
        clearFinished: vi.fn()
    };
    const appUpdates = {
        getState: vi.fn(() => {
            return { status: 'idle', currentVersion: '0.1.0', version: null, percent: 0, message: null };
        }),
        check: vi.fn(async () => {
            return undefined;
        }),
        download: vi.fn(async () => {
            return undefined;
        }),
        install: vi.fn()
    };
    const chooseDirectory = vi.fn(async () => {
        return '/chosen';
    });
    const showItemInFolder = vi.fn();
    const refreshTraySupport = vi.fn(async () => {
        return { available: false, reason: 'no tray here' };
    });
    const onSettingsSaved = vi.fn();
    const browserCatalog = {
        list: vi.fn(async () => {
            return [{ label: 'Brave Origin', engine: 'brave', dataDir: '/home/a/.config/BraveSoftware/Brave-Origin', profiles: [{ id: 'Default', name: 'Personal' }] }];
        })
    };
    const resolver = new BinaryResolver({
        pathOf: () => {
            return null;
        },
        expectedPathOf: () => {
            return null;
        }
    });
    registerHandlers({ ipcMain, settingsStore, historyStore, queue: queue as unknown as QueueManager, resolver, appUpdates: appUpdates as unknown as AppUpdateService, refreshTraySupport, browserCatalog: browserCatalog as unknown as BrowserCatalog, onSettingsSaved, chooseDirectory, showItemInFolder, animeFolderLocked });
    const call = (channel: string, ...args: unknown[]): unknown => {
        const handler = handlers.get(channel);
        if (!handler) {
            throw new Error(`no handler for ${channel}`);
        }
        return handler({}, ...args);
    };
    return { handlers, call, browserCatalog, refreshTraySupport, onSettingsSaved, appUpdates, resolver, settingsStore, historyStore, queue, chooseDirectory, showItemInFolder };
}

describe('registerHandlers', () => {
    it('registers every invoke channel', () => {
        const { handlers } = setup();
        expect([...handlers.keys()].sort()).toEqual(
            [
                IPC.settingsGet, IPC.settingsSave, IPC.queueAdd, IPC.queueList, IPC.queueCancel, IPC.queuePause, IPC.queueResume, IPC.queueStop, IPC.queueRetry, IPC.queueClearPartials, IPC.queueRemove,
                IPC.queueClearFinished, IPC.historyList, IPC.historyClear, IPC.binariesCheck, IPC.appUpdateGet, IPC.appUpdateCheck, IPC.appUpdateDownload, IPC.appUpdateInstall, IPC.traySupport, IPC.browsersList, IPC.dialogChooseDir,
                IPC.shellShowItem
            ].sort()
        );
    });

    it('gets and saves sanitized settings', () => {
        const { call } = setup();
        expect(call(IPC.settingsGet)).toEqual(DEFAULT_SETTINGS);
        expect(call(IPC.settingsSave, { ...DEFAULT_SETTINGS, maxTitleLength: 5000 })).toEqual({ ...DEFAULT_SETTINGS, maxTitleLength: 200 });
        expect(call(IPC.settingsGet)).toEqual({ ...DEFAULT_SETTINGS, maxTitleLength: 200 });
    });

    describe('the folder of the anime', () => {
        it('changes freely while it is not locked', () => {
            const { call } = setup(() => {
                return false;
            });
            expect((call(IPC.settingsSave, { ...DEFAULT_SETTINGS, animeDownloadDir: '/first' }) as { animeDownloadDir: string }).animeDownloadDir).toBe('/first');
            expect((call(IPC.settingsSave, { ...DEFAULT_SETTINGS, animeDownloadDir: '/second' }) as { animeDownloadDir: string }).animeDownloadDir).toBe('/second');
        });

        it('changes freely where there is no anime section at all', () => {
            const { call } = setup();
            expect((call(IPC.settingsSave, { ...DEFAULT_SETTINGS, animeDownloadDir: '/first' }) as { animeDownloadDir: string }).animeDownloadDir).toBe('/first');
        });

        it('stays as it is while it is locked, and the rest of the settings is saved as usual', () => {
            let locked = false;
            const { call, settingsStore, onSettingsSaved } = setup(() => {
                return locked;
            });
            call(IPC.settingsSave, { ...DEFAULT_SETTINGS, animeDownloadDir: '/library' });
            locked = true;

            const saved = call(IPC.settingsSave, { ...DEFAULT_SETTINGS, animeDownloadDir: '/elsewhere', closeToTray: true, animeQuality: '720p' });

            expect(saved).toEqual({ ...DEFAULT_SETTINGS, animeDownloadDir: '/library', closeToTray: true, animeQuality: '720p' });
            expect(settingsStore.get()).toEqual({ ...DEFAULT_SETTINGS, animeDownloadDir: '/library', closeToTray: true, animeQuality: '720p' });
            expect(onSettingsSaved).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, animeDownloadDir: '/library', closeToTray: true, animeQuality: '720p' });
        });

        it('stays empty (the default folder) while it is locked', () => {
            const { call } = setup(() => {
                return true;
            });
            expect((call(IPC.settingsSave, { ...DEFAULT_SETTINGS, animeDownloadDir: '/elsewhere' }) as { animeDownloadDir: string }).animeDownloadDir).toBe('');
        });

        it('is read again every time, so it is free once the library is empty', () => {
            let locked = true;
            const { call } = setup(() => {
                return locked;
            });
            expect((call(IPC.settingsSave, { ...DEFAULT_SETTINGS, animeDownloadDir: '/a' }) as { animeDownloadDir: string }).animeDownloadDir).toBe('');
            locked = false;
            expect((call(IPC.settingsSave, { ...DEFAULT_SETTINGS, animeDownloadDir: '/a' }) as { animeDownloadDir: string }).animeDownloadDir).toBe('/a');
        });

        it('ignores an input that is not an object, as it always did', () => {
            const { call } = setup(() => {
                return true;
            });
            expect(call(IPC.settingsSave, null)).toEqual(DEFAULT_SETTINGS);
        });
    });

    it('notifies the app with the sanitized settings after saving', () => {
        const { call, onSettingsSaved } = setup();
        call(IPC.settingsSave, { ...DEFAULT_SETTINGS, closeToTray: true, maxTitleLength: 5000 });
        expect(onSettingsSaved).toHaveBeenCalledTimes(1);
        expect(onSettingsSaved).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, closeToTray: true, maxTitleLength: 200 });
    });

    it('does not notify on plain settings reads', () => {
        const { call, onSettingsSaved } = setup();
        call(IPC.settingsGet);
        expect(onSettingsSaved).not.toHaveBeenCalled();
    });

    it('lists the detected browsers without rescanning by default', async () => {
        const { call, browserCatalog } = setup();
        await expect(call(IPC.browsersList)).resolves.toEqual([
            { label: 'Brave Origin', engine: 'brave', dataDir: '/home/a/.config/BraveSoftware/Brave-Origin', profiles: [{ id: 'Default', name: 'Personal' }] }
        ]);
        expect(browserCatalog.list).toHaveBeenCalledTimes(1);
        expect(browserCatalog.list).toHaveBeenCalledWith(false);
    });

    it('rescans the browsers only when asked to refresh', async () => {
        const { call, browserCatalog } = setup();
        await call(IPC.browsersList, true);
        expect(browserCatalog.list).toHaveBeenCalledWith(true);
        await call(IPC.browsersList, 'yes');
        expect(browserCatalog.list).toHaveBeenLastCalledWith(false);
    });

    it('returns a fresh tray support check', async () => {
        const { call, refreshTraySupport } = setup();
        await expect(call(IPC.traySupport)).resolves.toEqual({ available: false, reason: 'no tray here' });
        expect(refreshTraySupport).toHaveBeenCalledTimes(1);
    });

    it('adds a download with the URL string', () => {
        const { call, queue } = setup();
        expect(call(IPC.queueAdd, 'https://x.com/a')).toEqual({ ok: true, job: JOB, message: null });
        expect(queue.add).toHaveBeenCalledWith('https://x.com/a');
    });

    it('adds a download into the folder chosen for it', () => {
        const { call, queue } = setup();
        expect(call(IPC.queueAdd, 'https://x.com/a', '/media/videos')).toEqual({ ok: true, job: JOB, message: null });
        expect(queue.add).toHaveBeenCalledWith('https://x.com/a', { downloadDir: '/media/videos' });
    });

    it.each([['an empty folder', ''], ['a relative folder', 'videos/here'], ['a non-string folder', 42], ['no folder', undefined]])(
        'ignores %s and downloads to the settings folder',
        (_name, folder) => {
            const { call, queue } = setup();
            call(IPC.queueAdd, 'https://x.com/a', folder);
            expect(queue.add).toHaveBeenCalledWith('https://x.com/a');
        }
    );

    it('adds a download with the options chosen for it', () => {
        const { call, queue } = setup();
        call(IPC.queueAdd, 'https://x.com/a', '', { maxResolution: '720', audioOnly: true });
        expect(queue.add).toHaveBeenCalledWith('https://x.com/a', { options: { maxResolution: '720', audioOnly: true } });
    });

    it('adds a download with both the folder and the options', () => {
        const { call, queue } = setup();
        call(IPC.queueAdd, 'https://x.com/a', '/media/videos', { waitForLive: true, verifyLiveEndSeconds: 500 });
        expect(queue.add).toHaveBeenCalledWith('https://x.com/a', { downloadDir: '/media/videos', options: { waitForLive: true, verifyLiveEndSeconds: 120 } });
    });

    it.each([['no options', undefined], ['empty options', {}], ['invalid options', { maxResolution: '99', theme: 'dark' }], ['non-object options', 'text']])(
        'adds the download without extras for %s',
        (_name, options) => {
            const { call, queue } = setup();
            call(IPC.queueAdd, 'https://x.com/a', '', options);
            expect(queue.add).toHaveBeenCalledWith('https://x.com/a');
        }
    );

    it('keeps only the valid options and never lets other settings through', () => {
        const { call, queue } = setup();
        call(IPC.queueAdd, 'https://x.com/a', '', { audioFormat: 'm4a', extraArgs: '--exec x', ytdlpPath: '/bin/sh' });
        expect(queue.add).toHaveBeenCalledWith('https://x.com/a', { options: { audioFormat: 'm4a' } });
    });

    it('coerces non-string URLs to an empty string', () => {
        const { call, queue } = setup();
        call(IPC.queueAdd, 42);
        expect(queue.add).toHaveBeenCalledWith('');
    });

    it('lists jobs', () => {
        expect(setup().call(IPC.queueList)).toEqual([JOB]);
    });

    it('forwards cancel, retry and remove with the id', () => {
        const { call, queue } = setup();
        call(IPC.queueCancel, 'j1');
        call(IPC.queueRetry, 'j2');
        call(IPC.queueRemove, 'j3');
        expect(queue.cancel).toHaveBeenCalledWith('j1');
        expect(queue.retry).toHaveBeenCalledWith('j2');
        expect(queue.remove).toHaveBeenCalledWith('j3');
    });

    it('forwards pause and resume with the id, and an empty id when it is not text', () => {
        const { call, queue } = setup();
        call(IPC.queuePause, 'j1');
        call(IPC.queuePause, 42);
        call(IPC.queueResume, 'j2');
        call(IPC.queueResume, null);
        expect(queue.pause.mock.calls).toEqual([['j1'], ['']]);
        expect(queue.resume.mock.calls).toEqual([['j2'], ['']]);
    });

    it('clears the partial files of a download by id', () => {
        const { call, queue } = setup();
        call(IPC.queueClearPartials, 'j4');
        call(IPC.queueClearPartials, 42);
        expect(queue.clearPartials.mock.calls).toEqual([['j4'], ['']]);
    });

    it('stops a live recording by id, keeping what was recorded', () => {
        const { call, queue } = setup();
        call(IPC.queueStop, 'j1');
        call(IPC.queueStop, 42);
        expect(queue.stop.mock.calls).toEqual([['j1'], ['']]);
    });

    it('clears finished jobs', () => {
        const { call, queue } = setup();
        call(IPC.queueClearFinished);
        expect(queue.clearFinished).toHaveBeenCalledTimes(1);
    });

    it('lists and clears history', () => {
        const { call, historyStore } = setup();
        const entry: HistoryEntry = { id: 'h', url: 'https://x.com', title: 't', filePath: null, status: 'done', errorTitle: null, finishedAt: 1 };
        historyStore.add(entry);
        expect(call(IPC.historyList)).toEqual([entry]);
        call(IPC.historyClear);
        expect(call(IPC.historyList)).toEqual([]);
    });

    it('checks binaries with the current settings and the resolver', async () => {
        const { call, resolver } = setup();
        await expect(call(IPC.binariesCheck)).resolves.toEqual({
            ytdlp: { found: true, path: '/t/yt-dlp', version: '1', source: 'installed' },
            ffmpeg: { found: false, path: '/t/ffmpeg', version: null, source: 'installed' }
        });
        expect(checkBinaries).toHaveBeenCalledWith(DEFAULT_SETTINGS, resolver);
    });

    it('exposes the app update state and actions', async () => {
        const { call, appUpdates } = setup();
        expect(call(IPC.appUpdateGet)).toEqual({ status: 'idle', currentVersion: '0.1.0', version: null, percent: 0, message: null });
        await call(IPC.appUpdateCheck);
        await call(IPC.appUpdateDownload);
        call(IPC.appUpdateInstall);
        expect(appUpdates.check).toHaveBeenCalledTimes(1);
        expect(appUpdates.download).toHaveBeenCalledTimes(1);
        expect(appUpdates.install).toHaveBeenCalledTimes(1);
    });

    it('opens the directory chooser', async () => {
        const { call, chooseDirectory } = setup();
        await expect(call(IPC.dialogChooseDir)).resolves.toBe('/chosen');
        expect(chooseDirectory).toHaveBeenCalledTimes(1);
    });

    it('shows an item in the folder only when the path is a non-empty string', () => {
        const { call, showItemInFolder } = setup();
        call(IPC.shellShowItem, '/dl/a.mp4');
        call(IPC.shellShowItem, '');
        call(IPC.shellShowItem, null);
        expect(showItemInFolder).toHaveBeenCalledTimes(1);
        expect(showItemInFolder).toHaveBeenCalledWith('/dl/a.mp4');
    });
});
