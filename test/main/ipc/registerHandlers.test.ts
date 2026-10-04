import { join } from 'node:path';
import { DEFAULT_SETTINGS, IPC } from '@shared/constants';
import type { DownloadJob, HistoryEntry } from '@shared/types';
import { registerHandlers, type IpcMainLike } from '@main/ipc/registerHandlers';
import { applyLanguage } from '@main/services/language';
import { checkBinaries } from '@main/services/binaryLocator';
import { BinaryResolver } from '@main/services/binaryResolver';
import { discardOutdatedUpdate, resetYtdlp, updateYtdlp } from '@main/services/updater';
import { HistoryStore } from '@main/services/historyStore';
import type { AppUpdateService } from '@main/services/appUpdateService';
import type { QueueManager } from '@main/services/queueManager';
import type { BrowserCatalog } from '@main/services/browserCatalog';
import type { StreamFinder } from '@main/services/streamFinder';
import { SettingsStore } from '@main/services/settingsStore';
import { cleanTempDirs, makeTempDir } from '../../helpers/tempDir';

vi.mock('@main/services/binaryLocator', () => {
    return {
        checkBinaries: vi.fn(async () => {
            return {
                ytdlp: { found: true, path: 'yt-dlp', version: '1', source: 'system' },
                ffmpeg: { found: false, path: 'ffmpeg', version: null, source: 'system' }
            };
        })
    };
});
vi.mock('@main/services/updater', () => {
    return {
        updateYtdlp: vi.fn(async () => {
            return { ok: true, output: 'updated' };
        }),
        resetYtdlp: vi.fn(() => {
            return { ok: true, output: 'reset' };
        }),
        discardOutdatedUpdate: vi.fn(async () => {
            return false;
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
    const sendStreamProgress = vi.fn();
    const streamFinder = {
        find: vi.fn<StreamFinder['find']>(async () => {
            return { ok: true, candidates: [], message: null, usedBrowser: false };
        }),
        cancel: vi.fn(),
        getCandidate: vi.fn()
    };
    const resolver = new BinaryResolver({ bundledDir: '/b', userBinDir: '/u' });
    registerHandlers({ ipcMain, settingsStore, historyStore, queue: queue as unknown as QueueManager, resolver, appUpdates: appUpdates as unknown as AppUpdateService, refreshTraySupport, browserCatalog: browserCatalog as unknown as BrowserCatalog, onSettingsSaved, streamFinder: streamFinder as unknown as StreamFinder, sendStreamProgress, chooseDirectory, showItemInFolder, animeFolderLocked });
    const call = (channel: string, ...args: unknown[]): unknown => {
        const handler = handlers.get(channel);
        if (!handler) {
            throw new Error(`no handler for ${channel}`);
        }
        return handler({}, ...args);
    };
    return { handlers, call, browserCatalog, streamFinder, sendStreamProgress, refreshTraySupport, onSettingsSaved, appUpdates, resolver, settingsStore, historyStore, queue, chooseDirectory, showItemInFolder };
}

describe('registerHandlers', () => {
    it('registers every invoke channel', () => {
        const { handlers } = setup();
        expect([...handlers.keys()].sort()).toEqual(
            [
                IPC.settingsGet, IPC.settingsSave, IPC.queueAdd, IPC.queueList, IPC.queueCancel, IPC.queuePause, IPC.queueResume, IPC.queueStop, IPC.queueRetry, IPC.queueClearPartials, IPC.queueRemove,
                IPC.queueClearFinished, IPC.historyList, IPC.historyClear, IPC.binariesCheck, IPC.ytdlpUpdate, IPC.ytdlpReset, IPC.appUpdateGet, IPC.appUpdateCheck, IPC.appUpdateDownload, IPC.appUpdateInstall, IPC.traySupport, IPC.browsersList, IPC.streamFind, IPC.streamCancel, IPC.streamDownload, IPC.dialogChooseDir,
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

    describe('stream finder', () => {
        const TARGET = { id: 'j1', url: 'https://site.test/ep-1' };

        it('searches the page of an existing job and reports the stage to the screen', async () => {
            const { call, queue, streamFinder, sendStreamProgress } = setup();
            queue.getJob.mockReturnValue(TARGET);
            streamFinder.find.mockImplementationOnce(async (_jobId, _url, _deep, onStage) => {
                onStage('scanning');
                onStage('watching');
                return { ok: true, candidates: [], message: null, usedBrowser: true };
            });
            await expect(call(IPC.streamFind, 'j1', true)).resolves.toEqual({ ok: true, candidates: [], message: null, usedBrowser: true });
            expect(queue.getJob).toHaveBeenCalledWith('j1');
            expect(streamFinder.find).toHaveBeenCalledWith('j1', 'https://site.test/ep-1', true, expect.any(Function));
            expect(sendStreamProgress.mock.calls).toEqual([[{ jobId: 'j1', stage: 'scanning' }], [{ jobId: 'j1', stage: 'watching' }]]);
        });

        it('only searches deeper when asked with exactly true', async () => {
            const { call, queue, streamFinder } = setup();
            queue.getJob.mockReturnValue(TARGET);
            await call(IPC.streamFind, 'j1', 'yes');
            expect(streamFinder.find).toHaveBeenCalledWith('j1', TARGET.url, false, expect.any(Function));
        });

        it('searches again on the page a stream came from when the job has one', async () => {
            const { call, queue, streamFinder } = setup();
            queue.getJob.mockReturnValue({ id: 'j9', url: 'https://cdn.test/videoplayback?sig=old', pageUrl: 'https://site.test/ep-1' });
            await call(IPC.streamFind, 'j9', false);
            expect(streamFinder.find).toHaveBeenCalledWith('j9', 'https://site.test/ep-1', false, expect.any(Function));
        });

        it('refuses in the saved language to search for a job that does not exist', () => {
            applyLanguage('es', 'en-US');
            const { call, queue } = setup();
            queue.getJob.mockReturnValue(undefined);
            expect(call(IPC.streamFind, 'gone', false)).toEqual({ ok: false, candidates: [], message: 'Esa descarga ya no existe.', usedBrowser: false });
            applyLanguage('en', 'en-US');
        });

        it('refuses to search for a job that does not exist', () => {
            const { call, queue, streamFinder } = setup();
            queue.getJob.mockReturnValue(undefined);
            expect(call(IPC.streamFind, 'gone', false)).toEqual({ ok: false, candidates: [], message: 'That download no longer exists.', usedBrowser: false });
            expect(streamFinder.find).not.toHaveBeenCalled();
        });

        it('cancels a search by job id', () => {
            const { call, streamFinder } = setup();
            call(IPC.streamCancel, 'j1');
            call(IPC.streamCancel, 7);
            expect(streamFinder.cancel.mock.calls).toEqual([['j1'], ['']]);
        });

        it('downloads the chosen stream with the referer, user agent, cookie and title the finder kept', () => {
            const { call, queue, streamFinder } = setup();
            streamFinder.getCandidate.mockReturnValue({ url: 'https://cdn.test/a.m3u8', referer: 'https://site.test/ep-1', userAgent: 'UA', cookie: 'sid=1', title: 'Episode 1', ipFamily: null, pageUrl: 'https://site.test/ep-1' });
            expect(call(IPC.streamDownload, 'c1')).toEqual({ ok: true, job: JOB, message: null });
            expect(streamFinder.getCandidate).toHaveBeenCalledWith('c1');
            expect(queue.add).toHaveBeenCalledWith('https://cdn.test/a.m3u8', { referer: 'https://site.test/ep-1', userAgent: 'UA', cookie: 'sid=1', title: 'Episode 1', ipFamily: undefined, pageUrl: 'https://site.test/ep-1' });
        });

        it('leaves the cookie and title out when the stream has none', () => {
            const { call, queue, streamFinder } = setup();
            streamFinder.getCandidate.mockReturnValue({ url: 'https://cdn.test/a.mp4', referer: 'https://site.test/ep-1', userAgent: 'UA', cookie: null, title: null, ipFamily: 6, pageUrl: 'https://origin.test/p' });
            call(IPC.streamDownload, 'c2');
            expect(queue.add).toHaveBeenCalledWith('https://cdn.test/a.mp4', { referer: 'https://site.test/ep-1', userAgent: 'UA', cookie: undefined, title: undefined, ipFamily: 6, pageUrl: 'https://origin.test/p' });
        });

        it('explains in the saved language when the stream is no longer known', () => {
            applyLanguage('pt', 'en-US');
            const { call, streamFinder } = setup();
            streamFinder.getCandidate.mockReturnValue(undefined);
            expect(call(IPC.streamDownload, 'old')).toEqual({ ok: false, job: null, message: 'Esse stream não está mais disponível. Busque novamente.' });
            applyLanguage('en', 'en-US');
        });

        it('explains when the stream is no longer known', () => {
            const { call, queue, streamFinder } = setup();
            streamFinder.getCandidate.mockReturnValue(undefined);
            expect(call(IPC.streamDownload, 'old')).toEqual({ ok: false, job: null, message: 'That stream is no longer available. Search again.' });
            expect(queue.add).not.toHaveBeenCalled();
        });
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
            ytdlp: { found: true, path: 'yt-dlp', version: '1', source: 'system' },
            ffmpeg: { found: false, path: 'ffmpeg', version: null, source: 'system' }
        });
        expect(checkBinaries).toHaveBeenCalledWith(DEFAULT_SETTINGS, resolver);
    });

    it('updates yt-dlp with the current settings and the resolver', async () => {
        const { call, resolver } = setup();
        await expect(call(IPC.ytdlpUpdate)).resolves.toEqual({ ok: true, output: 'updated' });
        expect(updateYtdlp).toHaveBeenCalledWith(DEFAULT_SETTINGS, resolver);
    });

    it('goes back to the yt-dlp that ships with the app with the resolver', () => {
        vi.mocked(resetYtdlp).mockClear();
        const { call, resolver } = setup();
        expect(call(IPC.ytdlpReset)).toEqual({ ok: true, output: 'reset' });
        expect(resetYtdlp).toHaveBeenCalledTimes(1);
        expect(resetYtdlp).toHaveBeenCalledWith(resolver);
    });

    it('drops an outdated updated yt-dlp once, before the binaries are looked at for the first time', async () => {
        vi.mocked(discardOutdatedUpdate).mockClear();
        const order: string[] = [];
        vi.mocked(discardOutdatedUpdate).mockImplementationOnce(async () => {
            order.push('discard');
            return true;
        });
        const check = async (): Promise<Awaited<ReturnType<typeof checkBinaries>>> => {
            order.push('check');
            return { ytdlp: { found: true, path: 'yt-dlp', version: '1', source: 'bundled' }, ffmpeg: { found: false, path: 'ffmpeg', version: null, source: 'system' } };
        };
        vi.mocked(checkBinaries).mockImplementationOnce(check).mockImplementationOnce(check);
        const { call, resolver } = setup();

        await call(IPC.binariesCheck);
        await call(IPC.binariesCheck);

        expect(order).toEqual(['discard', 'check', 'check']);
        expect(discardOutdatedUpdate).toHaveBeenCalledTimes(1);
        expect(discardOutdatedUpdate).toHaveBeenCalledWith(DEFAULT_SETTINGS, resolver);
    });

    it('looks at the binaries even when dropping the outdated one fails', async () => {
        vi.mocked(discardOutdatedUpdate).mockRejectedValueOnce(new Error('cannot run'));
        vi.mocked(checkBinaries).mockClear();
        const { call } = setup();
        await expect(call(IPC.binariesCheck)).resolves.toMatchObject({ ytdlp: { found: true } });
        expect(checkBinaries).toHaveBeenCalledTimes(1);
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
