import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AniRunResult, AnimeAvailability, AnimeAvailabilityTarget, AnimeImportResponse, AnimeMigrationResponse, AnimeScheduleResponse, AnimeSearchResult, AnimeSubtitleCheckResponse, AnimeSubtitleImportResponse, AnimeSubtitleTrack, LibraryAnime } from '@shared/anime';
import type { ResolvedStream } from '@main/services/aniStream';
import { IPC } from '@shared/constants';
import { MAX_AVAILABILITY_TARGETS, MAX_EPISODES_PER_REQUEST, MAX_SCHEDULE_SPAN_SECONDS, MAX_TEXT_LENGTH, parseAvailabilityTargets, parseDownloadRequest, parseHistoryRequest, parseProgress, parseScheduleRequest, registerAnimeHandlers, type AnimeHandlerDependencies } from '@main/ipc/registerAnimeHandlers';
import type { IpcMainLike } from '@main/ipc/registerHandlers';
import { AnimeDb } from '@main/services/animeDb';
import { cleanTempDirs, makeTempDir } from '../../helpers/tempDir';

afterEach(() => {
    cleanTempDirs();
});

type Handler = (event: unknown, ...args: unknown[]) => unknown;

function makeIpc(): { ipcMain: IpcMainLike; call: (channel: string, ...args: unknown[]) => unknown; channels: () => string[] } {
    const handlers = new Map<string, Handler>();
    return {
        ipcMain: {
            handle: (channel, listener) => {
                handlers.set(channel, listener);
            }
        },
        call: (channel, ...args) => {
            const handler = handlers.get(channel);
            if (!handler) {
                throw new Error(`No handler for ${channel}`);
            }
            return handler({}, ...args);
        },
        channels: () => {
            return [...handlers.keys()].sort();
        }
    };
}

const ANIME_CHANNELS = [
    IPC.animeAddToLibrary,
    IPC.animeAvailability,
    IPC.animeCancel,
    IPC.animeClearFinished,
    IPC.animeCover,
    IPC.animePause,
    IPC.animeResume,
    IPC.animeDownload,
    IPC.animeDownloadMissing,
    IPC.animeEpisodes,
    IPC.animeHistoryClear,
    IPC.animeHistoryList,
    IPC.animeHistoryRecord,
    IPC.animeHistoryRemove,
    IPC.animeImportLibrary,
    IPC.animeJobs,
    IPC.animeLibrary,
    IPC.animeMigrateFolder,
    IPC.animeOpenFolder,
    IPC.animeOpenSeriesFolder,
    IPC.animeProgress,
    IPC.animeRemoveAnime,
    IPC.animeRemoveEpisode,
    IPC.animeRenameSeries,
    IPC.animeRetry,
    IPC.animeSchedule,
    IPC.animeSearch,
    IPC.animeSetSeries,
    IPC.animeStatus,
    IPC.animeStreamClose,
    IPC.animeStreamOpen,
    IPC.animeSubtitleImport,
    IPC.animeSubtitles,
    IPC.animeSubtitlesCheck,
    IPC.animeResetCli,
    IPC.animeUpdateCli
].sort();

function setup(available = true) {
    const ipc = makeIpc();
    const db = new AnimeDb(':memory:', () => {
        return 5;
    });
    const search = vi.fn(async (): Promise<AniRunResult<AnimeSearchResult[]>> => {
        return { status: 'done', value: [{ index: 1, title: 'Naruto' }] };
    });
    const episodes = vi.fn(async (): Promise<AniRunResult<string[]>> => {
        return { status: 'done', value: ['1', '2'] };
    });
    const schedule = {
        list: vi.fn(async (): Promise<AnimeScheduleResponse> => {
            return { ok: true, entries: [] };
        })
    };
    const availability = {
        request: vi.fn((): AnimeAvailability[] => {
            return [];
        })
    };
    const covers = {
        find: vi.fn(async (): Promise<string | null> => {
            return 'https://s4.anilist.co/cover.jpg';
        })
    };
    const updateAniCli = vi.fn(async () => {
        return { ok: true, output: 'Updated ani-cli 5.1.4 → 5.2.0.' };
    });
    const resetAniCli = vi.fn(() => {
        return { ok: true, output: 'Using the ani-cli that ships with the app again.' };
    });
    const aniCliInfo = { found: true, path: '/app/resources/bin/ani/ani-cli', version: '5.1.4', source: 'bundled' as const };
    const resolveStream = vi.fn(async (): Promise<AniRunResult<ResolvedStream>> => {
        return { status: 'done', value: { url: 'https://cdn.example/master.m3u8', subtitleUrl: null, referer: 'https://embed.example/', subtitles: [] } };
    });
    const streams = {
        create: vi.fn(() => {
            return { sessionId: 's1', url: 'pullwave-stream://p/s1/abc', subtitleUrl: null };
        }),
        close: vi.fn()
    };
    const queue = {
        enqueue: vi.fn((request: { title: string }): LibraryAnime | null => {
            const anime = db.upsertAnime({ title: request.title, query: 'naruto', searchIndex: 1, audio: 'sub' });
            return db.getLibraryAnime(anime.id);
        }),
        addToLibrary: vi.fn((request: { title: string; query: string; index: number; audio: 'sub' | 'dub'; episodes: string[]; series: string | null; season: number | null; seasonName: string | null }) => {
            const anime = db.upsertAnime({ title: request.title, query: request.query, searchIndex: request.index, audio: request.audio });
            db.registerEpisodes(anime.id, request.episodes);
            return { ok: true as const, anime: db.getLibraryAnime(anime.id) as LibraryAnime };
        }),
        downloadMissing: vi.fn(),
        list: vi.fn(() => {
            return [];
        }),
        pendingCount: vi.fn(() => {
            return 0;
        }),
        cancel: vi.fn(),
        retry: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
        clearFinished: vi.fn(),
        forget: vi.fn()
    };
    const removeFiles = vi.fn();
    const removeFolders = vi.fn();
    const removeEmptyFolders = vi.fn();
    const openFolder = vi.fn();
    const refreshMetadata = vi.fn();
    const importLibrary = vi.fn(async (): Promise<AnimeImportResponse> => {
        return { ok: false, reason: 'cancelled' };
    });
    const migrateFolder = vi.fn(async (): Promise<AnimeMigrationResponse> => {
        return { ok: false, reason: 'cancelled' };
    });
    const missing = new Set<string>();
    const onLibraryChanged = vi.fn();
    const subtitles = {
        list: vi.fn((): AnimeSubtitleTrack[] => {
            return [{ id: 'subtitle-Japanese', label: 'Japanese', kind: 'source' }];
        }),
        import: vi.fn(async (): Promise<AnimeSubtitleImportResponse> => {
            return { ok: false, reason: 'cancelled' };
        }),
        check: vi.fn(async (): Promise<AnimeSubtitleCheckResponse> => {
            return { ok: true, added: [], tracks: [] };
        })
    };
    const deps = {
        service: { isAvailable: vi.fn(() => { return available; }), info: vi.fn(() => { return aniCliInfo; }), search, episodes, resolveStream },
        schedule,
        covers,
        availability,
        updateAniCli,
        resetAniCli,
        streams,
        streamQuality: () => {
            return '720p';
        },
        queue,
        db,
        removeFiles,
        removeFolders,
        removeEmptyFolders,
        openFolder,
        refreshMetadata,
        importLibrary,
        migrateFolder,
        fileExists: (path: string) => {
            return !missing.has(path);
        },
        baseDirectory: () => {
            return '/lib';
        },
        platform: 'linux',
        onLibraryChanged,
        subtitles
    } as unknown as AnimeHandlerDependencies;
    registerAnimeHandlers(ipc.ipcMain, deps);
    return { ...ipc, db, search, episodes, resolveStream, schedule, covers, availability, updateAniCli, resetAniCli, aniCliInfo, streams, queue, removeFiles, removeFolders, removeEmptyFolders, openFolder, refreshMetadata, importLibrary, migrateFolder, missing, onLibraryChanged, subtitles, deps };
}

describe('registerAnimeHandlers', () => {
    it('registers every channel of the section', () => {
        expect(setup().channels()).toEqual(ANIME_CHANNELS);
    });

    it('reports whether ani-cli is in place and which one is used', () => {
        const info = { found: true, path: '/app/resources/bin/ani/ani-cli', version: '5.1.4', source: 'bundled' };
        expect(setup(true).call(IPC.animeStatus)).toEqual({ supported: true, available: true, aniCli: info });
        expect(setup(false).call(IPC.animeStatus)).toEqual({ supported: true, available: false, aniCli: info });
    });

    it('updates ani-cli and gives the result as it is', async () => {
        const { call, updateAniCli } = setup();
        expect(await call(IPC.animeUpdateCli)).toEqual({ ok: true, output: 'Updated ani-cli 5.1.4 → 5.2.0.' });
        expect(updateAniCli).toHaveBeenCalledTimes(1);
        expect(updateAniCli).toHaveBeenCalledWith();
    });

    it('goes back to the ani-cli that ships with the app and gives the result as it is', () => {
        const { call, resetAniCli, updateAniCli } = setup();
        expect(call(IPC.animeResetCli)).toEqual({ ok: true, output: 'Using the ani-cli that ships with the app again.' });
        expect(resetAniCli).toHaveBeenCalledTimes(1);
        expect(resetAniCli).toHaveBeenCalledWith();
        expect(updateAniCli).not.toHaveBeenCalled();
    });

    describe('search', () => {
        it('cleans the query and returns the results', async () => {
            const { call, search } = setup();
            expect(await call(IPC.animeSearch, ' -d naruto &', 'dub')).toEqual({ ok: true, results: [{ index: 1, title: 'Naruto' }] });
            expect(search).toHaveBeenCalledWith('d naruto', 'dub');
        });

        it('cuts a very long query', async () => {
            const { call, search } = setup();
            await call(IPC.animeSearch, 'a'.repeat(MAX_TEXT_LENGTH + 50), 'sub');
            expect(search).toHaveBeenCalledWith('a'.repeat(MAX_TEXT_LENGTH), 'sub');
        });

        it('refuses an empty query or an unknown audio without searching', async () => {
            const { call, search } = setup();
            const refusal = { ok: false, error: { code: 'INVALID_SELECTION', raw: 'The search is empty or the audio is invalid.' } };
            expect(await call(IPC.animeSearch, '  &&& ', 'sub')).toEqual(refusal);
            expect(await call(IPC.animeSearch, 'naruto', 'both')).toEqual(refusal);
            expect(await call(IPC.animeSearch, 42, 'sub')).toEqual(refusal);
            expect(search).not.toHaveBeenCalled();
        });

        it('passes on an error', async () => {
            const { call, search } = setup();
            search.mockResolvedValueOnce({ status: 'error', error: { code: 'NO_RESULTS', raw: 'No results found!' } });
            expect(await call(IPC.animeSearch, 'zzz', 'sub')).toEqual({ ok: false, error: { code: 'NO_RESULTS', raw: 'No results found!' } });
        });

        it('reports a cancelled search as an error', async () => {
            const { call, search } = setup();
            search.mockResolvedValueOnce({ status: 'cancelled' });
            expect(await call(IPC.animeSearch, 'zzz', 'sub')).toEqual({ ok: false, error: { code: 'UNKNOWN', raw: 'The search was cancelled.' } });
        });
    });

    describe('episodes', () => {
        it('returns the episodes of the chosen result', async () => {
            const { call, episodes } = setup();
            expect(await call(IPC.animeEpisodes, 'naruto', 2, 'sub')).toEqual({ ok: true, episodes: ['1', '2'] });
            expect(episodes).toHaveBeenCalledWith('naruto', 2, 'sub');
        });

        it('refuses a bad query, position or audio without asking ani-cli', async () => {
            const { call, episodes } = setup();
            const refusal = { ok: false, error: { code: 'INVALID_SELECTION', raw: 'The search, the position or the audio is invalid.' } };
            expect(await call(IPC.animeEpisodes, '', 1, 'sub')).toEqual(refusal);
            expect(await call(IPC.animeEpisodes, 'naruto', 0, 'sub')).toEqual(refusal);
            expect(await call(IPC.animeEpisodes, 'naruto', '1', 'sub')).toEqual(refusal);
            expect(await call(IPC.animeEpisodes, 'naruto', 1, 'x')).toEqual(refusal);
            expect(episodes).not.toHaveBeenCalled();
        });

        it('passes on an error and a cancellation', async () => {
            const { call, episodes } = setup();
            episodes.mockResolvedValueOnce({ status: 'error', error: { code: 'BLOCKED', raw: 'Blocked by cloudflare.' } });
            expect(await call(IPC.animeEpisodes, 'naruto', 1, 'sub')).toEqual({ ok: false, error: { code: 'BLOCKED', raw: 'Blocked by cloudflare.' } });
            episodes.mockResolvedValueOnce({ status: 'cancelled' });
            expect(await call(IPC.animeEpisodes, 'naruto', 1, 'sub')).toEqual({ ok: false, error: { code: 'UNKNOWN', raw: 'The search was cancelled.' } });
        });
    });

    describe('download', () => {
        it('queues the episodes and returns the anime', () => {
            const { call, queue } = setup();
            const response = call(IPC.animeDownload, { title: ' Naruto ', query: '-U naruto', index: 2, audio: 'dub', episodes: ['1', '2', '2'] });

            expect(queue.enqueue).toHaveBeenCalledWith({ title: 'Naruto', query: 'U naruto', index: 2, audio: 'dub', episodes: ['1', '2'] });
            expect(response).toMatchObject({ ok: true, anime: { title: 'Naruto', episodes: [] } });
        });

        it('queues the episodes under a series and a season', () => {
            const { call, queue } = setup();
            call(IPC.animeDownload, { title: 'Frieren 2', query: 'frieren', index: 2, audio: 'sub', episodes: ['1'], series: '  Frieren  ', season: 2 });
            expect(queue.enqueue).toHaveBeenCalledWith({ title: 'Frieren 2', query: 'frieren', index: 2, audio: 'sub', episodes: ['1'], series: 'Frieren', season: 2 });
        });

        it('queues the episodes with the name the anime is shown with in its series', () => {
            const { call, queue } = setup();
            call(IPC.animeDownload, { title: 'Bleach 4', query: 'bleach', index: 4, audio: 'sub', episodes: ['1'], series: 'Bleach', season: 4, seasonName: '  The   Conflict ' });
            call(IPC.animeDownload, { title: 'Bleach 5', query: 'bleach', index: 5, audio: 'sub', episodes: ['1'], series: 'Bleach', season: 5, seasonName: '   ' });
            call(IPC.animeDownload, { title: 'Bleach 6', query: 'bleach', index: 6, audio: 'sub', episodes: ['1'], series: 'Bleach', season: 6, seasonName: null });
            expect(queue.enqueue.mock.calls.map((call) => { return (call[0] as { seasonName?: string | null }).seasonName; })).toEqual(['The Conflict', null, null]);
        });

        it('refuses a name that is too long or is not text, without queueing anything', () => {
            const { call, queue } = setup();
            const base = { title: 'Naruto', query: 'naruto', index: 1, audio: 'sub', episodes: ['1'], series: 'Naruto', season: 1 };
            expect(call(IPC.animeDownload, { ...base, seasonName: 'a'.repeat(61) })).toEqual({ ok: false, message: 'The series, the order or the name is invalid.' });
            expect(queue.enqueue).not.toHaveBeenCalled();
        });

        it('refuses a season that another anime of the series already has, without queueing anything', () => {
            const { call, db, queue } = setup();
            db.setSeries(db.upsertAnime({ title: 'Frieren', query: 'frieren', searchIndex: 1, audio: 'sub' }).id, 'Frieren', 2);
            const request = { title: 'Frieren 2', query: 'frieren', index: 2, audio: 'sub', episodes: ['1'], series: 'frieren', season: 2 };
            expect(call(IPC.animeDownload, request)).toEqual({ ok: false, message: 'Order 2 of "frieren" is already used by another anime.' });
            expect(queue.enqueue).not.toHaveBeenCalled();
        });

        it('accepts the season the anime already has', () => {
            const { call, db, queue } = setup();
            db.setSeries(db.upsertAnime({ title: 'Frieren 2', query: 'frieren', searchIndex: 2, audio: 'sub' }).id, 'Frieren', 2);
            call(IPC.animeDownload, { title: 'Frieren 2', query: 'frieren', index: 2, audio: 'sub', episodes: ['1'], series: 'Frieren', season: 2 });
            expect(queue.enqueue).toHaveBeenCalledTimes(1);
        });

        it('refuses an invalid series or season without queueing anything', () => {
            const { call, queue } = setup();
            const base = { title: 'Naruto', query: 'naruto', index: 1, audio: 'sub', episodes: ['1'] };
            const message = { ok: false, message: 'The series, the order or the name is invalid.' };
            expect(call(IPC.animeDownload, { ...base, series: 'Naruto' })).toEqual(message);
            expect(call(IPC.animeDownload, { ...base, season: 2 })).toEqual(message);
            expect(call(IPC.animeDownload, { ...base, series: 'a'.repeat(101), season: 2 })).toEqual(message);
            expect(call(IPC.animeDownload, { ...base, series: 'Naruto', season: 0 })).toEqual(message);
            expect(call(IPC.animeDownload, { ...base, series: 'Naruto', season: '2' })).toEqual(message);
            expect(call(IPC.animeDownload, { ...base, series: 4, season: 2 })).toEqual(message);
            expect(queue.enqueue).not.toHaveBeenCalled();
        });

        it('treats an empty series with no season as none', () => {
            const { call, queue } = setup();
            call(IPC.animeDownload, { title: 'Naruto', query: 'naruto', index: 1, audio: 'sub', episodes: ['1'], series: '', season: null });
            expect(queue.enqueue).toHaveBeenCalledWith({ title: 'Naruto', query: 'naruto', index: 1, audio: 'sub', episodes: ['1'] });
        });

        it('refuses an invalid request without queueing anything', () => {
            const { call, queue } = setup();
            expect(call(IPC.animeDownload, { title: '', query: 'x', index: 1, audio: 'sub', episodes: ['1'] })).toEqual({ ok: false, message: 'The anime name is missing.' });
            expect(call(IPC.animeDownload, null)).toEqual({ ok: false, message: 'The anime name is missing.' });
            expect(queue.enqueue).not.toHaveBeenCalled();
        });

        it('says so when the library could not return the anime', () => {
            const { call, queue } = setup();
            queue.enqueue.mockReturnValueOnce(null);
            expect(call(IPC.animeDownload, { title: 'Naruto', query: 'naruto', index: 1, audio: 'sub', episodes: ['1'] })).toEqual({
                ok: false,
                message: 'The anime could not be saved.'
            });
        });
    });

    it('lists the library and the jobs', () => {
        const { call, db, queue } = setup();
        const anime = db.upsertAnime({ title: 'Bleach', query: 'bleach', searchIndex: 1, audio: 'sub' });
        db.ensureEpisode(anime.id, '1');
        expect(call(IPC.animeLibrary)).toEqual(db.list());
        expect((call(IPC.animeLibrary) as LibraryAnime[])[0]?.episodes).toHaveLength(1);
        expect(call(IPC.animeJobs)).toEqual([]);
        expect(queue.list).toHaveBeenCalledTimes(1);
    });

    it('cancels, retries and clears through the queue', () => {
        const { call, queue } = setup();
        call(IPC.animeCancel, 4);
        call(IPC.animeRetry, 5);
        call(IPC.animeClearFinished);
        expect(queue.cancel).toHaveBeenCalledWith(4);
        expect(queue.retry).toHaveBeenCalledWith(5);
        expect(queue.clearFinished).toHaveBeenCalledTimes(1);
    });

    it('pauses and resumes through the queue', () => {
        const { call, queue } = setup();
        call(IPC.animePause, 6);
        call(IPC.animeResume, 7);
        expect(queue.pause).toHaveBeenCalledTimes(1);
        expect(queue.pause).toHaveBeenCalledWith(6);
        expect(queue.resume).toHaveBeenCalledTimes(1);
        expect(queue.resume).toHaveBeenCalledWith(7);
    });

    it('ignores an id that is not a positive whole number', () => {
        const { call, queue, db } = setup();
        ['4', 0, -1, 1.5, null, undefined, {}].forEach((id) => {
            call(IPC.animeCancel, id);
            call(IPC.animeRetry, id);
            call(IPC.animePause, id);
            call(IPC.animeResume, id);
            call(IPC.animeRemoveEpisode, id);
            call(IPC.animeRemoveAnime, id);
        });
        expect(queue.cancel).not.toHaveBeenCalled();
        expect(queue.retry).not.toHaveBeenCalled();
        expect(queue.pause).not.toHaveBeenCalled();
        expect(queue.resume).not.toHaveBeenCalled();
        expect(queue.forget).not.toHaveBeenCalled();
        expect(db.list()).toEqual([]);
    });

    describe('subtitles', () => {
        it('lists the subtitles of an episode', () => {
            const { call, subtitles } = setup();
            expect(call(IPC.animeSubtitles, 4)).toEqual([{ id: 'subtitle-Japanese', label: 'Japanese', kind: 'source' }]);
            expect(subtitles.list).toHaveBeenCalledWith(4);
        });

        it.each([['4'], [0], [-1], [1.5], [null], [undefined]])('lists nothing for the invalid episode %s', (episodeId) => {
            const { call, subtitles } = setup();
            expect(call(IPC.animeSubtitles, episodeId)).toEqual([]);
            expect(subtitles.list).not.toHaveBeenCalled();
        });

        it('loads a subtitle for an episode and gives the answer as it is', async () => {
            const { call, subtitles } = setup();
            const loaded: AnimeSubtitleImportResponse = {
                ok: true,
                tracks: [{ id: 'import-ja', label: 'ja', kind: 'imported' }],
                imported: { id: 'import-ja', label: 'ja', kind: 'imported' }
            };
            subtitles.import.mockResolvedValueOnce(loaded);
            expect(await call(IPC.animeSubtitleImport, 4)).toEqual(loaded);
            expect(subtitles.import).toHaveBeenCalledWith(4);
            expect(await call(IPC.animeSubtitleImport, 4)).toEqual({ ok: false, reason: 'cancelled' });
        });

        it.each([['4'], [0], [-1], [1.5], [null], [undefined]])('does not load a subtitle for the invalid episode %s', async (episodeId) => {
            const { call, subtitles } = setup();
            expect(await call(IPC.animeSubtitleImport, episodeId)).toEqual({ ok: false, reason: 'missing' });
            expect(subtitles.import).not.toHaveBeenCalled();
        });

        describe('checking for the ones the source offers', () => {
            const added: AnimeSubtitleCheckResponse = {
                ok: true,
                added: ['Portuguese'],
                tracks: [
                    { id: 'subtitle-English', label: 'English', kind: 'source' },
                    { id: 'subtitle-Portuguese', label: 'Portuguese', kind: 'source' }
                ]
            };

            it('asks for the episode and gives the answer as it is', async () => {
                const { call, subtitles } = setup();
                subtitles.check.mockResolvedValueOnce(added);
                expect(await call(IPC.animeSubtitlesCheck, 4)).toEqual(added);
                expect(subtitles.check).toHaveBeenCalledTimes(1);
                expect(subtitles.check).toHaveBeenCalledWith(4);
            });

            it('writes again what is kept beside the video when subtitles were added', async () => {
                const { call, subtitles, refreshMetadata } = setup();
                subtitles.check.mockResolvedValueOnce(added);
                await call(IPC.animeSubtitlesCheck, 4);
                expect(refreshMetadata).toHaveBeenCalledTimes(1);
                expect(refreshMetadata).toHaveBeenCalledWith(4);
            });

            it.each([
                ['none were added', { ok: true, added: [], tracks: [] } as AnimeSubtitleCheckResponse],
                ['the episode is missing', { ok: false, reason: 'missing' } as AnimeSubtitleCheckResponse],
                ['the check failed', { ok: false, reason: 'failed', error: { code: 'NETWORK', raw: 'timeout' } } as AnimeSubtitleCheckResponse]
            ])('leaves what is kept beside the video alone when %s', async (_name, answer) => {
                const { call, subtitles, refreshMetadata } = setup();
                subtitles.check.mockResolvedValueOnce(answer);
                expect(await call(IPC.animeSubtitlesCheck, 4)).toEqual(answer);
                expect(refreshMetadata).not.toHaveBeenCalled();
            });

            it.each([['4'], [0], [-1], [1.5], [null], [undefined]])('does not check the invalid episode %s', async (episodeId) => {
                const { call, subtitles } = setup();
                expect(await call(IPC.animeSubtitlesCheck, episodeId)).toEqual({ ok: false, reason: 'missing' });
                expect(subtitles.check).not.toHaveBeenCalled();
            });
        });
    });

    describe('setSeries', () => {
        // Two seasons of one series and a third one on its own: the series of an anime is fixed once it is in the library.
        function withSeries() {
            const context = setup();
            const first = context.db.upsertAnime({ title: 'Frieren', query: 'frieren', searchIndex: 1, audio: 'sub' });
            const second = context.db.upsertAnime({ title: 'Frieren 2', query: 'frieren', searchIndex: 2, audio: 'sub' });
            const alone = context.db.upsertAnime({ title: 'Bleach', query: 'bleach', searchIndex: 3, audio: 'sub' });
            context.db.setSeries(first.id, 'Frieren', 1);
            context.db.setSeries(second.id, 'Frieren', 2);
            return { ...context, first, second, alone };
        }

        it('changes the season of an anime inside its series and tells the screen', () => {
            const { call, db, second, onLibraryChanged } = withSeries();
            expect(call(IPC.animeSetSeries, second.id, 'Frieren', 3)).toEqual({ ok: true });
            expect(db.getAnime(second.id)).toMatchObject({ series: 'Frieren', season: 3 });
            expect(onLibraryChanged).toHaveBeenCalledTimes(1);
        });

        it('keeps the spelling the series has, whatever the case, the accents or the spaces the screen sends', () => {
            const { call, db, second } = withSeries();
            expect(call(IPC.animeSetSeries, second.id, '  FRIEREN ', 4)).toEqual({ ok: true });
            expect(db.getAnime(second.id)).toMatchObject({ series: 'Frieren', season: 4 });
        });

        it('saves the name the anime is shown with, cleaned, and none when it is empty or null', () => {
            const { call, db, first } = withSeries();
            call(IPC.animeSetSeries, first.id, 'Frieren', 1, '  Beyond   the End ');
            expect(db.getAnime(first.id)).toMatchObject({ series: 'Frieren', season: 1, seasonName: 'Beyond the End' });
            call(IPC.animeSetSeries, first.id, 'Frieren', 1, '   ');
            expect(db.getAnime(first.id)?.seasonName).toBeNull();
            call(IPC.animeSetSeries, first.id, 'Frieren', 1, 'Named');
            call(IPC.animeSetSeries, first.id, 'Frieren', 1, null);
            expect(db.getAnime(first.id)?.seasonName).toBeNull();
            call(IPC.animeSetSeries, first.id, 'Frieren', 1, 'Named');
            call(IPC.animeSetSeries, first.id, 'Frieren', 1);
            expect(db.getAnime(first.id)?.seasonName).toBeNull();
        });

        it.each([['a name that is too long', 'a'.repeat(61)], ['a name that is not text', 5]])('refuses %s', (_name, seasonName) => {
            const { call, db, first, onLibraryChanged } = withSeries();
            expect(call(IPC.animeSetSeries, first.id, 'Frieren', 1, seasonName)).toEqual({ ok: false, reason: 'invalid' });
            expect(db.getAnime(first.id)).toMatchObject({ series: 'Frieren', season: 1, seasonName: null });
            expect(onLibraryChanged).not.toHaveBeenCalled();
        });

        it('refuses to take an anime out of its series: leaving it is removing the anime', () => {
            const { call, db, first, onLibraryChanged } = withSeries();
            expect(call(IPC.animeSetSeries, first.id, null, null)).toEqual({ ok: false, reason: 'invalid' });
            expect(db.getAnime(first.id)).toMatchObject({ series: 'Frieren', season: 1 });
            expect(onLibraryChanged).not.toHaveBeenCalled();
        });

        it.each([['another series', 'Sousou no Frieren'], ['a series that only looks like it', 'Frieren 2']])('refuses to change the series to %s', (_name, series) => {
            const { call, db, first, onLibraryChanged } = withSeries();
            expect(call(IPC.animeSetSeries, first.id, series, 1)).toEqual({ ok: false, reason: 'invalid' });
            expect(db.getAnime(first.id)).toMatchObject({ series: 'Frieren', season: 1 });
            expect(onLibraryChanged).not.toHaveBeenCalled();
        });

        it('refuses to give a series to an anime that has none', () => {
            const { call, db, alone, onLibraryChanged } = withSeries();
            expect(call(IPC.animeSetSeries, alone.id, 'Frieren', 3)).toEqual({ ok: false, reason: 'invalid' });
            expect(call(IPC.animeSetSeries, alone.id, 'Bleach', 1)).toEqual({ ok: false, reason: 'invalid' });
            expect(db.getAnime(alone.id)).toMatchObject({ series: null, season: null });
            expect(onLibraryChanged).not.toHaveBeenCalled();
        });

        it('refuses a season that is already taken in the series, and says the next one that is free', () => {
            const { call, db, first, second, onLibraryChanged } = withSeries();
            const third = db.upsertAnime({ title: 'Frieren 3', query: 'frieren', searchIndex: 4, audio: 'sub' });
            db.setSeries(third.id, 'Frieren', 5);
            expect(call(IPC.animeSetSeries, second.id, 'frieren', 1)).toEqual({ ok: false, reason: 'season-taken', suggested: 6 });
            expect(db.getAnime(second.id)).toMatchObject({ series: 'Frieren', season: 2 });
            expect(db.getAnime(first.id)).toMatchObject({ season: 1 });
            expect(onLibraryChanged).not.toHaveBeenCalled();
        });

        it('does not refuse the season the anime itself has', () => {
            const { call, first } = withSeries();
            expect(call(IPC.animeSetSeries, first.id, 'Frieren', 1, 'The Start')).toEqual({ ok: true });
        });

        it.each([
            ['an empty series', ['   ', 2]],
            ['a series that is not text', [5, 2]],
            ['no season', ['Frieren', null]],
            ['a season of zero', ['Frieren', 0]],
            ['a season over 99', ['Frieren', 100]],
            ['a season that is not a whole number', ['Frieren', 1.5]],
            ['a season that is text', ['Frieren', '2']]
        ])('refuses %s', (_name, [series, season]) => {
            const { call, db, second, onLibraryChanged } = withSeries();
            expect(call(IPC.animeSetSeries, second.id, series, season)).toEqual({ ok: false, reason: 'invalid' });
            expect(db.getAnime(second.id)).toMatchObject({ series: 'Frieren', season: 2 });
            expect(onLibraryChanged).not.toHaveBeenCalled();
        });

        it.each([['1'], [0], [-1], [1.5], [null], [undefined], [999]])('refuses the anime %s', (animeId) => {
            const { call } = withSeries();
            expect(call(IPC.animeSetSeries, animeId, 'Frieren', 1)).toEqual({ ok: false, reason: 'invalid' });
        });

        it('writes again what is kept beside the downloaded episodes, and only theirs', () => {
            const { call, db, first, refreshMetadata } = withSeries();
            const done = db.ensureEpisode(first.id, '1');
            db.markDone(done.id, '/lib/Frieren/Episode 1/a.mp4', 1);
            db.ensureEpisode(first.id, '2');
            call(IPC.animeSetSeries, first.id, 'Frieren', 1, 'Named');
            expect(refreshMetadata.mock.calls).toEqual([[done.id]]);
        });
    });

    describe('addToLibrary', () => {
        const REQUEST = { title: ' Naruto ', query: '-U naruto', index: 2, audio: 'dub', episodes: ['1', '2', '2', '3'] };

        it('puts the anime in the library with every episode, and gives it back', () => {
            const { call, queue } = setup();
            const response = call(IPC.animeAddToLibrary, REQUEST);

            expect(queue.addToLibrary).toHaveBeenCalledTimes(1);
            expect(queue.addToLibrary).toHaveBeenCalledWith({ title: 'Naruto', query: 'U naruto', index: 2, audio: 'dub', episodes: ['1', '2', '3'], series: null, season: null, seasonName: null });
            expect(response).toMatchObject({ ok: true, anime: { title: 'Naruto', audio: 'dub', episodes: [{ number: '1', status: 'idle' }, { number: '2', status: 'idle' }, { number: '3', status: 'idle' }] } });
            expect(queue.enqueue).not.toHaveBeenCalled();
        });

        it('sends the series, the season and the name shown, cleaned, and null for what was not given', () => {
            const { call, queue } = setup();
            call(IPC.animeAddToLibrary, { ...REQUEST, series: '  Naruto   Series ', season: 2, seasonName: '  The   Second ' });
            call(IPC.animeAddToLibrary, { ...REQUEST, series: 'Naruto Series', season: 3 });
            call(IPC.animeAddToLibrary, { ...REQUEST, series: 'Naruto Series', season: 4, seasonName: '   ' });
            expect(queue.addToLibrary.mock.calls.map(([request]) => {
                return [request.series, request.season, request.seasonName];
            })).toEqual([
                ['Naruto Series', 2, 'The Second'],
                ['Naruto Series', 3, null],
                ['Naruto Series', 4, null]
            ]);
        });

        it('gives back what the queue answers when the season is taken, without changing it', () => {
            const { call, queue } = setup();
            queue.addToLibrary.mockReturnValueOnce({ ok: false, reason: 'season-taken', suggested: 4 } as never);
            expect(call(IPC.animeAddToLibrary, { ...REQUEST, series: 'Naruto', season: 1 })).toEqual({ ok: false, reason: 'season-taken', suggested: 4 });
        });

        it.each([
            ['no name', { ...REQUEST, title: '   ' }],
            ['a search that is not valid', { ...REQUEST, query: '' }],
            ['an audio that is not sub or dub', { ...REQUEST, audio: 'raw' }],
            ['a position that is not valid', { ...REQUEST, index: 0 }],
            ['a position that is text', { ...REQUEST, index: '2' }],
            ['no episodes', { ...REQUEST, episodes: [] }],
            ['episodes that are not valid', { ...REQUEST, episodes: ['1', '../2'] }],
            ['too many episodes', { ...REQUEST, episodes: Array.from({ length: 2001 }, (_unused, index) => { return String(index + 1); }) }],
            ['a series without a season', { ...REQUEST, series: 'Naruto' }],
            ['a season without a series', { ...REQUEST, season: 2 }],
            ['a season that is not valid', { ...REQUEST, series: 'Naruto', season: 100 }],
            ['a name that is too long', { ...REQUEST, series: 'Naruto', season: 1, seasonName: 'a'.repeat(61) }],
            ['something that is not an object', 'Naruto'],
            ['nothing', undefined]
        ])('refuses %s, and adds nothing', (_name, input) => {
            const { call, queue, onLibraryChanged } = setup();
            expect(call(IPC.animeAddToLibrary, input)).toEqual({ ok: false, reason: 'invalid' });
            expect(queue.addToLibrary).not.toHaveBeenCalled();
            expect(onLibraryChanged).not.toHaveBeenCalled();
        });

        it('accepts every episode of a long anime in one request', () => {
            const { call, queue } = setup();
            const episodes = Array.from({ length: 2000 }, (_unused, index) => {
                return String(index + 1);
            });
            expect(call(IPC.animeAddToLibrary, { ...REQUEST, episodes })).toMatchObject({ ok: true });
            expect(queue.addToLibrary.mock.calls[0]?.[0].episodes).toHaveLength(2000);
        });

        it('does not add anything while the folder is being migrated, and adds again after', async () => {
            const { call, migrateFolder, queue } = setup();
            let finish: (response: AnimeMigrationResponse) => void = () => {
                return;
            };
            migrateFolder.mockReturnValueOnce(
                new Promise((resolve) => {
                    finish = resolve;
                })
            );
            const running = call(IPC.animeMigrateFolder);
            expect(call(IPC.animeAddToLibrary, REQUEST)).toEqual({ ok: false, reason: 'busy' });
            expect(queue.addToLibrary).not.toHaveBeenCalled();

            finish({ ok: false, reason: 'cancelled' });
            await running;
            expect(call(IPC.animeAddToLibrary, REQUEST)).toMatchObject({ ok: true });
            expect(queue.addToLibrary).toHaveBeenCalledTimes(1);
        });
    });

    describe('downloadMissing', () => {
        it('asks the queue for what is missing of the anime, once each', () => {
            const { call, queue } = setup();
            call(IPC.animeDownloadMissing, [3, 4, 4, 5]);
            expect(queue.downloadMissing).toHaveBeenCalledTimes(1);
            expect(queue.downloadMissing).toHaveBeenCalledWith([3, 4, 5]);
        });

        it('leaves out what is not an id of an anime', () => {
            const { call, queue } = setup();
            call(IPC.animeDownloadMissing, [1, '2', 0, -1, 1.5, null, undefined, {}, 6]);
            expect(queue.downloadMissing).toHaveBeenCalledWith([1, 6]);
        });

        it.each([[undefined], [null], ['1,2'], [7], [{}]])('asks for nothing when it is given %s', (ids) => {
            const { call, queue } = setup();
            call(IPC.animeDownloadMissing, ids);
            expect(queue.downloadMissing).toHaveBeenCalledWith([]);
        });

        it('does not queue anything while the folder is being migrated, and queues again after', async () => {
            const { call, migrateFolder, queue } = setup();
            let finish: (response: AnimeMigrationResponse) => void = () => {
                return;
            };
            migrateFolder.mockReturnValueOnce(
                new Promise((resolve) => {
                    finish = resolve;
                })
            );
            const running = call(IPC.animeMigrateFolder);
            call(IPC.animeDownloadMissing, [1]);
            expect(queue.downloadMissing).not.toHaveBeenCalled();

            finish({ ok: false, reason: 'cancelled' });
            await running;
            call(IPC.animeDownloadMissing, [1]);
            expect(queue.downloadMissing).toHaveBeenCalledTimes(1);
        });
    });

    describe('renameSeries', () => {
        function withSeries() {
            const context = setup();
            const one = context.db.upsertAnime({ title: 'Frieren', query: 'frieren', searchIndex: 1, audio: 'sub' });
            const two = context.db.upsertAnime({ title: 'Frieren 2', query: 'frieren', searchIndex: 2, audio: 'sub' });
            const other = context.db.upsertAnime({ title: 'Pokemon', query: 'pokemon', searchIndex: 3, audio: 'sub' });
            context.db.setSeries(one.id, 'Frieren', 1);
            context.db.setSeries(two.id, 'Frieren', 2);
            context.db.setSeries(other.id, 'Journeys', 1);
            return { ...context, one, two, other };
        }

        it('renames the series of all the anime of the list, keeps their seasons and tells the screen once', () => {
            const { call, db, one, two, onLibraryChanged } = withSeries();
            expect(call(IPC.animeRenameSeries, [one.id, two.id], '  Sousou   no Frieren ')).toEqual({ ok: true });
            expect(db.getAnime(one.id)).toMatchObject({ series: 'Sousou no Frieren', season: 1 });
            expect(db.getAnime(two.id)).toMatchObject({ series: 'Sousou no Frieren', season: 2 });
            expect(onLibraryChanged).toHaveBeenCalledTimes(1);
        });

        it('refuses a season the other series has, saying which anime, which season and the next free one, and changes nothing', () => {
            const { call, db, one, two, onLibraryChanged } = withSeries();
            expect(call(IPC.animeRenameSeries, [one.id, two.id], 'journeys')).toEqual({ ok: false, reason: 'season-taken', anime: 'Frieren', season: 1, suggested: 2 });
            expect(db.getAnime(one.id)).toMatchObject({ series: 'Frieren', season: 1 });
            expect(db.getAnime(two.id)).toMatchObject({ series: 'Frieren', season: 2 });
            expect(onLibraryChanged).not.toHaveBeenCalled();
        });

        it('joins the other series when no season clashes, with the spelling it has', () => {
            const { call, db, one, two } = withSeries();
            db.setSeries(one.id, 'Frieren', 8);
            db.setSeries(two.id, 'Frieren', 9);
            expect(call(IPC.animeRenameSeries, [one.id, two.id], 'JOURNEYS')).toEqual({ ok: true });
            expect(db.getAnime(one.id)?.series).toBe('Journeys');
            expect(db.getAnime(two.id)?.series).toBe('Journeys');
        });

        it('gives the name to an anime that was on its own, as its first season', () => {
            const { call, db } = withSeries();
            const alone = db.upsertAnime({ title: 'Bleach', query: 'bleach', searchIndex: 4, audio: 'sub' });
            expect(call(IPC.animeRenameSeries, [alone.id], 'Bleach Classic')).toEqual({ ok: true });
            expect(db.getAnime(alone.id)).toMatchObject({ series: 'Bleach Classic', season: 1 });
        });

        it('writes again what is kept beside the downloaded episodes of every anime renamed, and only theirs', () => {
            const { call, db, one, two, refreshMetadata } = withSeries();
            const done = db.ensureEpisode(one.id, '1');
            db.markDone(done.id, '/lib/Frieren/Season 1/Episode 1/a.mp4', 1);
            const second = db.ensureEpisode(two.id, '1');
            db.markDone(second.id, '/lib/Frieren/Season 2/Episode 1/a.mp4', 1);
            db.ensureEpisode(two.id, '2');
            call(IPC.animeRenameSeries, [one.id, two.id], 'Renamed');
            expect(refreshMetadata.mock.calls).toEqual([[done.id], [second.id]]);
        });

        it.each([
            ['an empty name', '   '],
            ['a name that is too long', 'a'.repeat(101)],
            ['a name that is not text', 5],
            ['no name', undefined]
        ])('refuses %s, and changes nothing', (_name, name) => {
            const { call, db, one, onLibraryChanged } = withSeries();
            expect(call(IPC.animeRenameSeries, [one.id], name)).toEqual({ ok: false, reason: 'invalid' });
            expect(db.getAnime(one.id)).toMatchObject({ series: 'Frieren', season: 1 });
            expect(onLibraryChanged).not.toHaveBeenCalled();
        });

        it.each([[[]], [[999]], [['1']], [[0, -1, 1.5]], [null], [undefined], ['1,2']])('refuses the list %j, because it has no anime of the library', (ids) => {
            const { call, onLibraryChanged } = withSeries();
            expect(call(IPC.animeRenameSeries, ids, 'Renamed')).toEqual({ ok: false, reason: 'invalid' });
            expect(onLibraryChanged).not.toHaveBeenCalled();
        });

        it('ignores the ids that are not anime of the library and renames the others', () => {
            const { call, db, one } = withSeries();
            expect(call(IPC.animeRenameSeries, [999, '5', one.id, one.id], 'Renamed')).toEqual({ ok: true });
            expect(db.getAnime(one.id)?.series).toBe('Renamed');
        });
    });

    describe('openSeriesFolder', () => {
        function withSeasons(files: Array<[string, string]>) {
            const context = setup();
            const anime = context.db.upsertAnime({ title: 'Frieren', query: 'frieren', searchIndex: 1, audio: 'sub' });
            files.forEach(([number, path]) => {
                context.db.markDone(context.db.ensureEpisode(anime.id, number).id, path, 10);
            });
            return { ...context, anime };
        }

        it('opens the folder that holds the folders of the seasons of the series', () => {
            const { call, anime, openFolder } = withSeasons([['1', '/lib/Frieren/Season 1/Episode 1/Frieren Episode 1.mp4']]);
            call(IPC.animeOpenSeriesFolder, anime.id);
            expect(openFolder).toHaveBeenCalledTimes(1);
            expect(openFolder).toHaveBeenCalledWith('/lib/Frieren');
        });

        it('opens the folder of the anime itself when it is not in a folder of a season', () => {
            const { call, anime, openFolder } = withSeasons([['1', '/lib/Naruto/Episode 1/Naruto Episode 1.mp4']]);
            call(IPC.animeOpenSeriesFolder, anime.id);
            expect(openFolder).toHaveBeenCalledTimes(1);
            expect(openFolder).toHaveBeenCalledWith('/lib/Naruto');
        });

        it('does not open the folder of a season, which is what the folder of the anime is', () => {
            const { call, anime, openFolder } = withSeasons([['1', '/lib/Frieren/Season 2/Episode 1/Frieren Episode 1.mp4']]);
            call(IPC.animeOpenSeriesFolder, anime.id);
            expect(openFolder).not.toHaveBeenCalledWith('/lib/Frieren/Season 2');
            expect(openFolder).toHaveBeenCalledWith('/lib/Frieren');
        });

        it('skips an episode that is not downloaded to find a video', () => {
            const { call, db, anime, openFolder } = withSeasons([['2', '/lib/Frieren/Season 1/Episode 2/Frieren Episode 2.mp4']]);
            db.registerEpisodes(anime.id, ['1', '3']);
            call(IPC.animeOpenSeriesFolder, anime.id);
            expect(openFolder).toHaveBeenCalledWith('/lib/Frieren');
        });

        it('opens nothing for an anime with nothing downloaded, one that is not in the library or an invalid id', () => {
            const { call, db, anime, openFolder } = withSeasons([]);
            db.registerEpisodes(anime.id, ['1']);
            call(IPC.animeOpenSeriesFolder, anime.id);
            call(IPC.animeOpenSeriesFolder, 999);
            ['1', 0, -1, 1.5, null, undefined].forEach((id) => {
                call(IPC.animeOpenSeriesFolder, id);
            });
            expect(openFolder).not.toHaveBeenCalled();
        });
    });

    describe('openFolder', () => {
        function withAnime(files: Array<[string, string]>) {
            const context = setup();
            const anime = context.db.upsertAnime({ title: 'Naruto', query: 'naruto', searchIndex: 1, audio: 'sub' });
            files.forEach(([number, path]) => {
                context.db.markDone(context.db.ensureEpisode(anime.id, number).id, path, 10);
            });
            return { ...context, anime };
        }

        it('opens the folder that holds the folders of the episodes', () => {
            const { call, anime, openFolder } = withAnime([['1', '/lib/Naruto/Episode 1/Naruto Episode 1.mp4'], ['2', '/lib/Naruto/Episode 2/Naruto Episode 2.mp4']]);
            call(IPC.animeOpenFolder, anime.id);
            expect(openFolder).toHaveBeenCalledTimes(1);
            expect(openFolder).toHaveBeenCalledWith('/lib/Naruto');
        });

        it('opens the folder of the videos downloaded before each episode had its own', () => {
            const { call, anime, openFolder } = withAnime([['1', '/lib/Naruto/Naruto Episode 1.mp4']]);
            call(IPC.animeOpenFolder, anime.id);
            expect(openFolder).toHaveBeenCalledWith('/lib/Naruto');
        });

        it('skips an episode that is not downloaded to find a video', () => {
            const { call, db, anime, openFolder } = withAnime([['2', '/lib/Naruto/Episode 2/Naruto Episode 2.mp4']]);
            db.ensureEpisode(anime.id, '1');
            call(IPC.animeOpenFolder, anime.id);
            expect(openFolder).toHaveBeenCalledWith('/lib/Naruto');
        });

        it('opens nothing for an anime with nothing downloaded, one that is not in the library or an invalid id', () => {
            const { call, db, anime, openFolder } = withAnime([]);
            db.ensureEpisode(anime.id, '1');
            call(IPC.animeOpenFolder, anime.id);
            call(IPC.animeOpenFolder, 999);
            ['1', 0, -1, 1.5, null, undefined].forEach((id) => {
                call(IPC.animeOpenFolder, id);
            });
            expect(openFolder).not.toHaveBeenCalled();
        });
    });

    describe('removeEpisode', () => {
        function withEpisode() {
            const context = setup();
            const anime = context.db.upsertAnime({ title: 'Naruto', query: 'naruto', searchIndex: 1, audio: 'sub' });
            const episode = context.db.ensureEpisode(anime.id, '1');
            context.db.markDone(episode.id, '/lib/Naruto/Naruto Episode 1.mp4', 10);
            return { ...context, episode };
        }

        it('forgets the job, removes the record and always deletes the video and its subtitles', () => {
            const { call, db, episode, queue, removeFiles, removeFolders, onLibraryChanged } = withEpisode();
            call(IPC.animeRemoveEpisode, episode.id);

            expect(queue.forget).toHaveBeenCalledWith([episode.id]);
            expect(db.getEpisode(episode.id)).toBeNull();
            expect(removeFiles).toHaveBeenCalledWith([
                '/lib/Naruto/Naruto Episode 1.mp4',
                '/lib/Naruto/Naruto Episode 1.vtt',
                join('/lib/Naruto', 'pullwave.json')
            ]);
            expect(removeFolders).not.toHaveBeenCalled();
            expect(onLibraryChanged).toHaveBeenCalledTimes(1);
        });

        it('deletes every subtitle of the episode that is on the disk', () => {
            const folder = makeTempDir();
            ['a.mp4', 'a.vtt', 'a.subtitle-Japanese.vtt', 'a.import-mine.vtt', 'b.vtt'].forEach((name) => {
                writeFileSync(join(folder, name), 'x');
            });
            const { call, db, removeFiles } = setup();
            const episode = db.ensureEpisode(db.upsertAnime({ title: 'Naruto', query: 'naruto', searchIndex: 1, audio: 'sub' }).id, '1');
            db.markDone(episode.id, join(folder, 'a.mp4'), 10);
            call(IPC.animeRemoveEpisode, episode.id);
            const removed = (removeFiles.mock.calls[0]?.[0] as string[]).sort();
            expect(removed).toEqual([join(folder, 'a.mp4'), join(folder, 'a.vtt'), join(folder, 'a.subtitle-Japanese.vtt'), join(folder, 'a.import-mine.vtt'), join(folder, 'pullwave.json')].sort());
        });

        it('also removes the folder of the episode, once it is empty, when the video is in one', () => {
            const { call, db, removeFiles, removeFolders, removeEmptyFolders } = setup();
            const anime = db.upsertAnime({ title: 'Naruto', query: 'naruto', searchIndex: 1, audio: 'sub' });
            const episode = db.ensureEpisode(anime.id, '1');
            db.markDone(episode.id, '/lib/Naruto/Episode 1/Naruto Episode 1.mp4', 10);
            call(IPC.animeRemoveEpisode, episode.id);

            expect(removeFiles).toHaveBeenCalledWith([
                '/lib/Naruto/Episode 1/Naruto Episode 1.mp4',
                '/lib/Naruto/Episode 1/Naruto Episode 1.vtt',
                join('/lib/Naruto/Episode 1', 'pullwave.json')
            ]);
            expect(removeEmptyFolders).toHaveBeenCalledTimes(1);
            expect(removeEmptyFolders).toHaveBeenCalledWith(['/lib/Naruto/Episode 1']);
            expect(removeFolders).not.toHaveBeenCalled();
        });

        it('leaves the folder alone when the video is not in a folder of its episode', () => {
            const { call, episode, removeEmptyFolders } = withEpisode();
            call(IPC.animeRemoveEpisode, episode.id);
            expect(removeEmptyFolders).not.toHaveBeenCalled();
        });

        it('has no file to delete for an episode that was never downloaded', () => {
            const { call, db, removeFiles, removeEmptyFolders } = setup();
            const episode = db.ensureEpisode(db.upsertAnime({ title: 'Naruto', query: 'naruto', searchIndex: 1, audio: 'sub' }).id, '1');
            call(IPC.animeRemoveEpisode, episode.id);
            expect(db.getEpisode(episode.id)).toBeNull();
            expect(removeFiles).not.toHaveBeenCalled();
            expect(removeEmptyFolders).not.toHaveBeenCalled();
        });
    });

    describe('removeAnime', () => {
        it('forgets the jobs, removes the anime, deletes every video and subtitle and then its folder', () => {
            const { call, db, queue, removeFiles, removeFolders, onLibraryChanged } = setup();
            const anime = db.upsertAnime({ title: 'Naruto', query: 'naruto', searchIndex: 1, audio: 'sub' });
            const first = db.ensureEpisode(anime.id, '1');
            const second = db.ensureEpisode(anime.id, '2');
            db.ensureEpisode(anime.id, '3');
            db.markDone(first.id, '/lib/Naruto/1.mp4', 1);
            db.markDone(second.id, '/lib/Naruto/2.mkv', 1);

            call(IPC.animeRemoveAnime, anime.id);

            expect(queue.forget).toHaveBeenCalledWith([first.id, second.id, 3]);
            expect(db.getAnime(anime.id)).toBeNull();
            expect(removeFiles).toHaveBeenCalledWith([
                '/lib/Naruto/1.mp4',
                '/lib/Naruto/1.vtt',
                join('/lib/Naruto', 'pullwave.json'),
                '/lib/Naruto/2.mkv',
                '/lib/Naruto/2.vtt',
                join('/lib/Naruto', 'pullwave.json')
            ]);
            expect(removeFolders).toHaveBeenCalledWith(['/lib/Naruto']);
            expect(onLibraryChanged).toHaveBeenCalledTimes(1);
        });

        it('removes the empty folders that are left, also when the folder of the anime was renamed', () => {
            const { call, db, removeEmptyFolders } = setup();
            const anime = db.upsertAnime({ title: 'Naruto', query: 'naruto', searchIndex: 1, audio: 'sub' });
            db.markDone(db.ensureEpisode(anime.id, '1').id, '/media/My Naruto/Episode 1/Naruto Episode 1.mp4', 1);
            db.markDone(db.ensureEpisode(anime.id, '2').id, '/media/My Naruto/Episode 2/Naruto Episode 2.mp4', 1);
            db.markDone(db.ensureEpisode(anime.id, '3').id, '/media/Old/Naruto Episode 3.mp4', 1);
            call(IPC.animeRemoveAnime, anime.id);
            expect(removeEmptyFolders).toHaveBeenCalledTimes(1);
            expect(removeEmptyFolders).toHaveBeenCalledWith(['/media/My Naruto/Episode 1', '/media/My Naruto/Episode 2', '/media/My Naruto']);
        });

        it('has no empty folder to remove for an anime that has nothing downloaded', () => {
            const { call, db, removeEmptyFolders } = setup();
            const anime = db.upsertAnime({ title: 'Naruto', query: 'naruto', searchIndex: 1, audio: 'sub' });
            db.ensureEpisode(anime.id, '1');
            call(IPC.animeRemoveAnime, anime.id);
            expect(removeEmptyFolders).toHaveBeenCalledWith([]);
        });

        it('never removes whole the folder that holds the seasons of the other anime of the series', () => {
            const { call, db, removeFolders, removeEmptyFolders, removeFiles } = setup();
            const first = db.upsertAnime({ title: 'Bleach', query: 'bleach', searchIndex: 1, audio: 'sub' });
            const second = db.upsertAnime({ title: 'Bleach Season 2', query: 'bleach', searchIndex: 2, audio: 'sub' });
            db.markDone(db.ensureEpisode(first.id, '1').id, '/lib/Bleach/Season 1/Episode 1/Bleach Episode 1.mp4', 1);
            db.markDone(db.ensureEpisode(second.id, '1').id, '/lib/Bleach/Season 2/Episode 1/Bleach Season 2 Episode 1.mp4', 1);
            db.setSeries(first.id, 'Bleach', 1);
            db.setSeries(second.id, 'Bleach', 2);

            call(IPC.animeRemoveAnime, first.id);

            expect(removeFiles).toHaveBeenCalledWith([
                '/lib/Bleach/Season 1/Episode 1/Bleach Episode 1.mp4',
                '/lib/Bleach/Season 1/Episode 1/Bleach Episode 1.vtt',
                join('/lib/Bleach/Season 1/Episode 1', 'pullwave.json')
            ]);
            expect(removeFolders).toHaveBeenCalledWith([]);
            expect(removeEmptyFolders).toHaveBeenCalledWith(['/lib/Bleach/Season 1/Episode 1', '/lib/Bleach/Season 1', '/lib/Bleach']);
            expect(db.getAnime(second.id)).not.toBeNull();
        });

        it('removes the folder of an anime on its own that has the name of a series only when no other anime has files in it', () => {
            const { call, db, removeFolders } = setup();
            const alone = db.upsertAnime({ title: 'Bleach', query: 'bleach', searchIndex: 1, audio: 'sub' });
            db.markDone(db.ensureEpisode(alone.id, '1').id, '/lib/Bleach/Naruto Episode 1.mp4', 1);
            call(IPC.animeRemoveAnime, alone.id);
            expect(removeFolders).toHaveBeenCalledWith(['/lib/Bleach']);
        });

        it('keeps the folder with the name of the anime when a season of another anime has files in it', () => {
            const { call, db, removeFolders } = setup();
            const alone = db.upsertAnime({ title: 'Bleach', query: 'bleach', searchIndex: 1, audio: 'sub' });
            const season = db.upsertAnime({ title: 'Bleach Season 2', query: 'bleach', searchIndex: 2, audio: 'sub' });
            db.markDone(db.ensureEpisode(alone.id, '1').id, '/lib/Bleach/Episode 1/Bleach Episode 1.mp4', 1);
            db.markDone(db.ensureEpisode(season.id, '1').id, '/lib/Bleach/Season 2/Episode 1/Bleach Season 2 Episode 1.mp4', 1);
            db.setSeries(season.id, 'Bleach', 2);
            call(IPC.animeRemoveAnime, alone.id);
            expect(removeFolders).toHaveBeenCalledWith([]);
        });

        it('also removes the folder of an anime that has nothing downloaded', () => {
            const { call, db, removeFiles, removeFolders } = setup();
            const anime = db.upsertAnime({ title: 'Naruto', query: 'naruto', searchIndex: 1, audio: 'sub' });
            db.ensureEpisode(anime.id, '1');
            call(IPC.animeRemoveAnime, anime.id);
            expect(removeFiles).toHaveBeenCalledWith([]);
            expect(removeFolders).toHaveBeenCalledWith(['/lib/Naruto']);
        });

        it('never removes a folder that is not named after the anime', () => {
            const { call, db, removeFolders } = setup();
            const anime = db.upsertAnime({ title: 'Naruto', query: 'naruto', searchIndex: 1, audio: 'sub' });
            db.markDone(db.ensureEpisode(anime.id, '1').id, '/home/me/Videos/1.mp4', 1);
            call(IPC.animeRemoveAnime, anime.id);
            expect(removeFolders).toHaveBeenCalledWith(['/lib/Naruto']);
        });

        it('does nothing for an anime that does not exist', () => {
            const { call, queue, removeFiles, removeFolders, onLibraryChanged } = setup();
            call(IPC.animeRemoveAnime, 99);
            expect(queue.forget).not.toHaveBeenCalled();
            expect(removeFiles).not.toHaveBeenCalled();
            expect(removeFolders).not.toHaveBeenCalled();
            expect(onLibraryChanged).not.toHaveBeenCalled();
        });
    });

    describe('watching without downloading', () => {
        const request = { query: ' -d naruto ', index: 2, audio: 'dub', episode: '4' };

        it('finds the video with the quality of the settings and opens a stream for it', async () => {
            const { call, resolveStream, streams } = setup();
            expect(await call(IPC.animeStreamOpen, request)).toEqual({ ok: true, stream: { sessionId: 's1', url: 'pullwave-stream://p/s1/abc', subtitleUrl: null } });
            expect(resolveStream).toHaveBeenCalledWith({ query: 'd naruto', index: 2, audio: 'dub', episode: '4', quality: '720p' });
            expect(streams.create).toHaveBeenCalledWith({ url: 'https://cdn.example/master.m3u8', subtitleUrl: null, referer: 'https://embed.example/', subtitles: [] });
        });

        it('refuses an invalid request without asking ani-cli', async () => {
            const { call, resolveStream } = setup();
            const refusal = { ok: false, error: { code: 'INVALID_SELECTION', raw: 'The search, the position, the audio or the episode is invalid.' } };
            expect(await call(IPC.animeStreamOpen, { ...request, query: '&&&' })).toEqual(refusal);
            expect(await call(IPC.animeStreamOpen, { ...request, audio: 'both' })).toEqual(refusal);
            expect(await call(IPC.animeStreamOpen, { ...request, index: 0 })).toEqual(refusal);
            expect(await call(IPC.animeStreamOpen, { ...request, index: '2' })).toEqual(refusal);
            expect(await call(IPC.animeStreamOpen, { ...request, episode: '1-3' })).toEqual(refusal);
            expect(await call(IPC.animeStreamOpen, null)).toEqual(refusal);
            expect(resolveStream).not.toHaveBeenCalled();
        });

        it('passes on an error and treats a cancellation as one', async () => {
            const { call, resolveStream, streams } = setup();
            resolveStream.mockResolvedValueOnce({ status: 'error', error: { code: 'NO_SOURCES', raw: 'No sources found for dub!' } });
            expect(await call(IPC.animeStreamOpen, request)).toEqual({ ok: false, error: { code: 'NO_SOURCES', raw: 'No sources found for dub!' } });
            resolveStream.mockResolvedValueOnce({ status: 'cancelled' });
            expect(await call(IPC.animeStreamOpen, request)).toEqual({ ok: false, error: { code: 'UNKNOWN', raw: 'The request was cancelled.' } });
            expect(streams.create).not.toHaveBeenCalled();
        });

        it('closes the stream of a session', () => {
            const { call, streams } = setup();
            call(IPC.animeStreamClose, 's1');
            expect(streams.close).toHaveBeenCalledWith('s1');
        });

        it('ignores a session id that is not text or is empty', () => {
            const { call, streams } = setup();
            call(IPC.animeStreamClose, 5);
            call(IPC.animeStreamClose, '');
            call(IPC.animeStreamClose, undefined);
            expect(streams.close).not.toHaveBeenCalled();
        });
    });

    describe('the library', () => {
        it('says which downloaded episodes have lost their file', () => {
            const { call, db, missing } = setup();
            const anime = db.upsertAnime({ title: 'Naruto', query: 'naruto', searchIndex: 1, audio: 'sub' });
            db.markDone(db.ensureEpisode(anime.id, '1').id, '/lib/Naruto/a.mp4', 1);
            db.markDone(db.ensureEpisode(anime.id, '2').id, '/lib/Naruto/b.mp4', 1);
            db.ensureEpisode(anime.id, '3');
            db.markFailed(db.ensureEpisode(anime.id, '4').id, 'error', null);
            missing.add('/lib/Naruto/b.mp4');
            missing.add('/lib/Naruto/never-recorded.mp4');

            const [listed] = call(IPC.animeLibrary) as Array<{ episodes: Array<{ number: string; fileMissing: boolean }> }>;
            expect(
                listed?.episodes.map((episode) => {
                    return [episode.number, episode.fileMissing];
                })
            ).toEqual([
                ['1', false],
                ['2', true],
                ['3', false],
                ['4', false]
            ]);
        });
    });

    describe('importLibrary', () => {
        it('puts the folder into the library and tells the screen the library changed', async () => {
            const { call, importLibrary, onLibraryChanged } = setup();
            const result: AnimeImportResponse = { ok: true, added: 3, relinked: 1, skipped: 2, ignored: 4 };
            importLibrary.mockResolvedValueOnce(result);
            expect(await call(IPC.animeImportLibrary)).toEqual(result);
            expect(importLibrary).toHaveBeenCalledTimes(1);
            expect(onLibraryChanged).toHaveBeenCalledTimes(1);
        });

        it('does not tell the screen when the user gave up', async () => {
            const { call, onLibraryChanged } = setup();
            expect(await call(IPC.animeImportLibrary)).toEqual({ ok: false, reason: 'cancelled' });
            expect(onLibraryChanged).not.toHaveBeenCalled();
        });
    });

    describe('migrateFolder', () => {
        const MOVED: AnimeMigrationResponse = { ok: true, episodes: 3, files: 6, destination: '/new/anime' };

        it('migrates and tells the screen the library changed', async () => {
            const { call, migrateFolder, onLibraryChanged } = setup();
            migrateFolder.mockResolvedValueOnce(MOVED);
            expect(await call(IPC.animeMigrateFolder)).toEqual(MOVED);
            expect(migrateFolder).toHaveBeenCalledTimes(1);
            expect(onLibraryChanged).toHaveBeenCalledTimes(1);
        });

        it.each(['cancelled', 'same', 'inside', 'conflict', 'failed'] as const)('does not tell the screen when it answers %s', async (reason) => {
            const { call, migrateFolder, onLibraryChanged } = setup();
            migrateFolder.mockResolvedValueOnce({ ok: false, reason });
            expect(await call(IPC.animeMigrateFolder)).toEqual({ ok: false, reason });
            expect(onLibraryChanged).not.toHaveBeenCalled();
        });

        it('refuses while an episode is being downloaded, without asking for a folder', async () => {
            const { call, queue, migrateFolder, onLibraryChanged } = setup();
            queue.pendingCount.mockReturnValue(1);
            expect(await call(IPC.animeMigrateFolder)).toEqual({ ok: false, reason: 'busy' });
            expect(migrateFolder).not.toHaveBeenCalled();
            expect(onLibraryChanged).not.toHaveBeenCalled();
        });

        it('refuses a second migration while one is running, and accepts one again after it', async () => {
            const { call, migrateFolder } = setup();
            let finish: (response: AnimeMigrationResponse) => void = () => {
                return;
            };
            migrateFolder.mockReturnValueOnce(
                new Promise((resolve) => {
                    finish = resolve;
                })
            );
            const running = call(IPC.animeMigrateFolder);
            expect(await call(IPC.animeMigrateFolder)).toEqual({ ok: false, reason: 'busy' });
            expect(migrateFolder).toHaveBeenCalledTimes(1);

            finish(MOVED);
            expect(await running).toEqual(MOVED);

            migrateFolder.mockResolvedValueOnce(MOVED);
            expect(await call(IPC.animeMigrateFolder)).toEqual(MOVED);
            expect(migrateFolder).toHaveBeenCalledTimes(2);
        });

        it('accepts another migration after one that failed with an error', async () => {
            const { call, migrateFolder } = setup();
            migrateFolder.mockRejectedValueOnce(new Error('boom'));
            await expect(call(IPC.animeMigrateFolder)).rejects.toThrow('boom');
            migrateFolder.mockResolvedValueOnce(MOVED);
            expect(await call(IPC.animeMigrateFolder)).toEqual(MOVED);
        });

        it('does not queue downloads while it runs, and queues them again after', async () => {
            const { call, migrateFolder, queue } = setup();
            let finish: (response: AnimeMigrationResponse) => void = () => {
                return;
            };
            migrateFolder.mockReturnValueOnce(
                new Promise((resolve) => {
                    finish = resolve;
                })
            );
            const running = call(IPC.animeMigrateFolder);
            const request = { title: 'Naruto', query: 'naruto', index: 1, audio: 'sub', episodes: ['1'] };
            expect(call(IPC.animeDownload, request)).toEqual({ ok: false, message: 'The anime folder is being migrated. Try again when it is done.' });
            expect(queue.enqueue).not.toHaveBeenCalled();

            finish(MOVED);
            await running;
            expect(call(IPC.animeDownload, request)).toMatchObject({ ok: true });
            expect(queue.enqueue).toHaveBeenCalledTimes(1);
        });
    });

    it('saves the progress of an episode and ignores an invalid update', () => {
        const { call, db, refreshMetadata } = setup();
        const episode = db.ensureEpisode(db.upsertAnime({ title: 'Naruto', query: 'naruto', searchIndex: 1, audio: 'sub' }).id, '1');
        call(IPC.animeProgress, { episodeId: episode.id, positionSeconds: 30, durationSeconds: 1400, watched: false });
        expect(db.getEpisode(episode.id)).toMatchObject({ positionSeconds: 30, durationSeconds: 1400, watched: false });
        expect(refreshMetadata).toHaveBeenCalledTimes(1);
        expect(refreshMetadata).toHaveBeenCalledWith(episode.id);

        call(IPC.animeProgress, { episodeId: episode.id, positionSeconds: -1, durationSeconds: 1400, watched: true });
        expect(db.getEpisode(episode.id)).toMatchObject({ positionSeconds: 30, watched: false });
        expect(refreshMetadata).toHaveBeenCalledTimes(1);
    });
});

describe('parseAvailabilityTargets', () => {
    it('keeps the id and the two names of each anime', () => {
        expect(parseAvailabilityTargets([{ anilistId: 7, english: 'Dandadan', romaji: 'Dan Da Dan' }])).toEqual([{ anilistId: 7, english: 'Dandadan', romaji: 'Dan Da Dan' }]);
    });

    it('trims the names and turns an empty or missing one into null', () => {
        expect(
            parseAvailabilityTargets([
                { anilistId: 1, english: '  Bleach ', romaji: '   ' },
                { anilistId: 2, english: 'Naruto' },
                { anilistId: 3, english: 5, romaji: 'Kimetsu no Yaiba' }
            ])
        ).toEqual([
            { anilistId: 1, english: 'Bleach', romaji: null },
            { anilistId: 2, english: 'Naruto', romaji: null },
            { anilistId: 3, english: null, romaji: 'Kimetsu no Yaiba' }
        ]);
    });

    it('cuts a name that is too long', () => {
        expect(parseAvailabilityTargets([{ anilistId: 1, english: 'x'.repeat(MAX_TEXT_LENGTH + 50), romaji: null }])[0]?.english).toHaveLength(MAX_TEXT_LENGTH);
    });

    it.each([
        ['an id that is not a number', { anilistId: '7', english: 'A', romaji: 'B' }],
        ['an id that is not an integer', { anilistId: 7.5, english: 'A', romaji: 'B' }],
        ['an id below 1', { anilistId: 0, english: 'A', romaji: 'B' }],
        ['an anime with no name', { anilistId: 7, english: null, romaji: '' }],
        ['something that is not an object', 'Dandadan'],
        ['null', null]
    ])('leaves out %s', (_label, item) => {
        expect(parseAvailabilityTargets([item, { anilistId: 1, english: 'Kept', romaji: null }])).toEqual([{ anilistId: 1, english: 'Kept', romaji: null }]);
    });

    it('gives none when what came is not a list', () => {
        expect(parseAvailabilityTargets(undefined)).toEqual([]);
        expect(parseAvailabilityTargets({ anilistId: 1, english: 'A' })).toEqual([]);
        expect(parseAvailabilityTargets('x')).toEqual([]);
    });

    it('takes no more anime than the limit', () => {
        const many = Array.from({ length: MAX_AVAILABILITY_TARGETS + 20 }, (_value, position) => {
            return { anilistId: position + 1, english: `Anime ${position + 1}`, romaji: null };
        });
        expect(parseAvailabilityTargets(many)).toHaveLength(MAX_AVAILABILITY_TARGETS);
    });
});

describe('registerAnimeHandlers availability', () => {
    const targets: AnimeAvailabilityTarget[] = [
        { anilistId: 7, english: 'Dandadan', romaji: 'Dan Da Dan' },
        { anilistId: 8, english: null, romaji: 'Blue Lock' }
    ];

    it('asks the service about the anime that came and gives back what it already knows', () => {
        const { call, availability } = setup();
        const known: AnimeAvailability[] = [{ anilistId: 7, state: 'available', query: 'Dandadan', index: 1, title: 'Dandadan' }];
        availability.request.mockReturnValueOnce(known);

        expect(call(IPC.animeAvailability, targets)).toEqual(known);
        expect(availability.request).toHaveBeenCalledTimes(1);
        expect(availability.request).toHaveBeenCalledWith(targets);
    });

    it('only passes on what is shaped as an anime of the schedule', () => {
        const { call, availability } = setup();

        call(IPC.animeAvailability, [{ anilistId: 'x', english: 'Bad' }, ...targets]);

        expect(availability.request).toHaveBeenCalledWith(targets);
    });

    it('asks for nothing when the request is not a list', () => {
        const { call, availability } = setup();

        expect(call(IPC.animeAvailability, 'nope')).toEqual([]);

        expect(availability.request).toHaveBeenCalledWith([]);
    });
});

describe('registerAnimeHandlers schedule', () => {
    const request = { from: 1_700_000_000, to: 1_700_086_400, refresh: false };

    it('asks the resolver for the day with the request as it came and gives its answer back', async () => {
        const { call, schedule } = setup();
        const entries = [
            {
                anilistId: 154587,
                title: 'Sousou no Frieren',
                english: 'Frieren: Beyond Journey\'s End',
                romaji: 'Sousou no Frieren',
                names: ['Sousou no Frieren', 'Frieren: Beyond Journey\'s End'],
                episode: 12,
                airingAt: 1_700_040_000,
                coverUrl: 'https://img.example/frieren.jpg'
            }
        ];
        schedule.list.mockResolvedValueOnce({ ok: true, entries });

        expect(await call(IPC.animeSchedule, request)).toEqual({ ok: true, entries });
        expect(schedule.list).toHaveBeenCalledTimes(1);
        expect(schedule.list).toHaveBeenCalledWith(request);
    });

    it('gives the error of the resolver back as it is', async () => {
        const { call, schedule } = setup();
        const error = { code: 'NETWORK', raw: 'AniList answered with status 429.' };
        schedule.list.mockResolvedValueOnce({ ok: false, error: { code: 'NETWORK', raw: error.raw } });

        expect(await call(IPC.animeSchedule, request)).toEqual({ ok: false, error });
        expect(schedule.list).toHaveBeenCalledWith(request);
    });

    it.each([
        ['nothing', undefined],
        ['text', 'today'],
        ['a stretch that ends where it starts', { ...request, to: request.from }]
    ])('refuses %s without asking the resolver', async (_name, input) => {
        const { call, schedule } = setup();

        expect(await call(IPC.animeSchedule, input)).toEqual({ ok: false, error: { code: 'INVALID_SELECTION', raw: 'The stretch of time is invalid.' } });
        expect(schedule.list).not.toHaveBeenCalled();
    });
});

describe('parseScheduleRequest', () => {
    const valid = { from: 1_700_000_000, to: 1_700_086_400, refresh: false };

    it('accepts a valid request as it is', () => {
        expect(parseScheduleRequest(valid)).toEqual(valid);
    });

    it('keeps the refresh that was asked for', () => {
        expect(parseScheduleRequest({ ...valid, refresh: true })).toEqual({ ...valid, refresh: true });
    });

    it.each([undefined, null, 'true', 1, 0, {}])('does not refresh when the refresh is %s', (refresh) => {
        expect(parseScheduleRequest({ from: valid.from, to: valid.to, refresh })).toEqual({ ...valid, refresh: false });
    });

    it('keeps only the two moments and the refresh', () => {
        expect(parseScheduleRequest({ ...valid, audio: 'sub', other: 1 })).toEqual(valid);
    });

    it('accepts the longest stretch that can still be a week', () => {
        const longest = { from: valid.from, to: valid.from + MAX_SCHEDULE_SPAN_SECONDS, refresh: false };
        expect(parseScheduleRequest(longest)).toEqual(longest);
        expect(MAX_SCHEDULE_SPAN_SECONDS).toBe(8 * 24 * 60 * 60);
    });

    it('does not take a stretch longer than that', () => {
        expect(parseScheduleRequest({ from: valid.from, to: valid.from + MAX_SCHEDULE_SPAN_SECONDS + 1 })).toBeNull();
    });

    it.each([
        ['null', null],
        ['a number', 5],
        ['an empty object', {}],
        ['a start that is not a number', { ...valid, from: '1700000000' }],
        ['an end that is not a number', { ...valid, to: '1700086400' }],
        ['a start with decimals', { ...valid, from: 1_700_000_000.5 }],
        ['an end with decimals', { ...valid, to: 1_700_086_400.5 }],
        ['a start before the epoch', { from: 0, to: 100 }],
        ['an end equal to the start', { ...valid, to: valid.from }],
        ['an end before the start', { ...valid, to: valid.from - 1 }],
        ['no start', { to: valid.to }],
        ['no end', { from: valid.from }]
    ])('does not take %s', (_name, input) => {
        expect(parseScheduleRequest(input)).toBeNull();
    });
});

describe('registerAnimeHandlers covers', () => {
    it('looks the cover up by the title and gives the address back', async () => {
        const { call, covers } = setup();

        expect(await call(IPC.animeCover, "Frieren: Beyond Journey's End")).toBe('https://s4.anilist.co/cover.jpg');
        expect(covers.find).toHaveBeenCalledTimes(1);
        expect(covers.find).toHaveBeenCalledWith("Frieren: Beyond Journey's End");
    });

    it('gives null when there is no cover', async () => {
        const { call, covers } = setup();
        covers.find.mockResolvedValueOnce(null);

        expect(await call(IPC.animeCover, 'Unknown anime')).toBeNull();
    });

    it('cleans the title: the spaces around it go, and it is cut to the size every name has', async () => {
        const { call, covers } = setup();

        await call(IPC.animeCover, '  Naruto  ');
        await call(IPC.animeCover, 'x'.repeat(MAX_TEXT_LENGTH + 50));

        expect(covers.find.mock.calls).toEqual([['Naruto'], ['x'.repeat(MAX_TEXT_LENGTH)]]);
    });

    it.each([['nothing', undefined], ['null', null], ['a number', 5], ['an empty title', ''], ['only spaces', '   '], ['an object', {}]])('does not look up %s', async (_name, title) => {
        const { call, covers } = setup();

        expect(await call(IPC.animeCover, title)).toBeNull();
        expect(covers.find).not.toHaveBeenCalled();
    });

    it('passes on the failure when the cover could not be asked for, so the screen can tell', async () => {
        const { call, covers } = setup();
        covers.find.mockRejectedValueOnce(new Error('AniList answered with status 500.'));

        await expect(call(IPC.animeCover, 'Naruto')).rejects.toThrow('AniList answered with status 500.');
    });
});

describe('registerAnimeHandlers where the section does not exist', () => {
    it('answers that it is unsupported and does nothing else', async () => {
        const ipc = makeIpc();
        registerAnimeHandlers(ipc.ipcMain, null);
        const unsupported = { code: 'UNKNOWN', raw: 'The anime section is only available on Linux.' };

        expect(ipc.channels()).toEqual(ANIME_CHANNELS);
        expect(ipc.call(IPC.animeStatus)).toEqual({ supported: false, available: false, aniCli: null });
        expect(ipc.call(IPC.animeUpdateCli)).toEqual({ ok: false, output: unsupported.raw });
        expect(ipc.call(IPC.animeResetCli)).toEqual({ ok: false, output: unsupported.raw });
        expect(ipc.call(IPC.animeSearch, 'naruto', 'sub')).toEqual({ ok: false, error: unsupported });
        expect(ipc.call(IPC.animeEpisodes, 'naruto', 1, 'sub')).toEqual({ ok: false, error: unsupported });
        expect(ipc.call(IPC.animeDownload, {})).toEqual({ ok: false, message: unsupported.raw });
        expect(ipc.call(IPC.animeSchedule, { from: 1, to: 2, refresh: false })).toEqual({ ok: false, error: unsupported });
        expect(ipc.call(IPC.animeCover, 'Naruto')).toBeNull();
        expect(ipc.call(IPC.animeAvailability, [{ anilistId: 1, english: 'Naruto', romaji: null }])).toEqual([]);
        expect(ipc.call(IPC.animeLibrary)).toEqual([]);
        expect(ipc.call(IPC.animeJobs)).toEqual([]);
        expect(ipc.call(IPC.animeHistoryList)).toEqual([]);
        expect(ipc.call(IPC.animeStreamOpen, {})).toEqual({ ok: false, error: unsupported });
        expect(ipc.call(IPC.animeImportLibrary)).toEqual({ ok: false, reason: 'cancelled' });
        expect(ipc.call(IPC.animeMigrateFolder)).toEqual({ ok: false, reason: 'failed' });
        expect(ipc.call(IPC.animeSetSeries, 1, 'Frieren', 1)).toEqual({ ok: false, reason: 'invalid' });
        expect(ipc.call(IPC.animeAddToLibrary, {})).toEqual({ ok: false, reason: 'invalid' });
        expect(ipc.call(IPC.animeRenameSeries, [1], 'Frieren')).toEqual({ ok: false, reason: 'invalid' });
        expect(ipc.call(IPC.animeSubtitles, 1)).toEqual([]);
        expect(ipc.call(IPC.animeSubtitleImport, 1)).toEqual({ ok: false, reason: 'missing' });
        expect(ipc.call(IPC.animeSubtitlesCheck, 1)).toEqual({ ok: false, reason: 'missing' });
        [IPC.animeCancel, IPC.animeRetry, IPC.animePause, IPC.animeResume, IPC.animeClearFinished, IPC.animeRemoveEpisode, IPC.animeRemoveAnime, IPC.animeOpenFolder, IPC.animeOpenSeriesFolder, IPC.animeDownloadMissing, IPC.animeProgress, IPC.animeStreamClose, IPC.animeHistoryRecord, IPC.animeHistoryRemove, IPC.animeHistoryClear].forEach((channel) => {
            expect(ipc.call(channel, 1)).toBeUndefined();
        });
    });
});

describe('parseDownloadRequest', () => {
    const valid = { title: 'Naruto', query: 'naruto', index: 1, audio: 'sub', episodes: ['1'] };

    it('accepts a valid request and cleans it', () => {
        expect(parseDownloadRequest(valid)).toEqual({ title: 'Naruto', query: 'naruto', index: 1, audio: 'sub', episodes: ['1'] });
        expect(parseDownloadRequest({ ...valid, title: '  Naruto  ', episodes: ['1', '1.5', '1'] })).toEqual({
            title: 'Naruto',
            query: 'naruto',
            index: 1,
            audio: 'sub',
            episodes: ['1', '1.5']
        });
    });

    it('carries the name the anime is shown with only when it is given, and leaves it out otherwise', () => {
        expect(parseDownloadRequest({ ...valid, series: 'Bleach', season: 4, seasonName: 'The Conflict' })).toMatchObject({ series: 'Bleach', season: 4, seasonName: 'The Conflict' });
        expect(Object.keys(parseDownloadRequest({ ...valid, series: 'Bleach', season: 4 }) as object)).not.toContain('seasonName');
        expect(parseDownloadRequest({ ...valid, series: 'Bleach', season: 4, seasonName: '' })).toMatchObject({ seasonName: null });
        expect(parseDownloadRequest({ ...valid, series: 'Bleach', season: 4, seasonName: 'a'.repeat(61) })).toBe('The series, the order or the name is invalid.');
    });

    it('carries the series and the season, cleaned, when both are given', () => {
        expect(parseDownloadRequest({ ...valid, series: '  Frieren   Beyond ', season: 3 })).toEqual({
            title: 'Naruto',
            query: 'naruto',
            index: 1,
            audio: 'sub',
            episodes: ['1'],
            series: 'Frieren Beyond',
            season: 3
        });
    });

    it('cuts a very long title', () => {
        expect(parseDownloadRequest({ ...valid, title: 'a'.repeat(500) })).toMatchObject({ title: 'a'.repeat(MAX_TEXT_LENGTH) });
    });

    it('needs a title and a usable query', () => {
        const message = 'The anime name is missing.';
        expect(parseDownloadRequest({ ...valid, title: '   ' })).toBe(message);
        expect(parseDownloadRequest({ ...valid, title: 3 })).toBe(message);
        expect(parseDownloadRequest({ ...valid, query: '&&&' })).toBe(message);
        expect(parseDownloadRequest({ ...valid, query: undefined })).toBe(message);
        expect(parseDownloadRequest(undefined)).toBe(message);
        expect(parseDownloadRequest('naruto')).toBe(message);
    });

    it('needs a known audio', () => {
        expect(parseDownloadRequest({ ...valid, audio: 'both' })).toBe('The audio must be sub or dub.');
        expect(parseDownloadRequest({ ...valid, audio: undefined })).toBe('The audio must be sub or dub.');
    });

    it('needs a valid position', () => {
        const message = 'The position of the anime in the search is invalid.';
        expect(parseDownloadRequest({ ...valid, index: 0 })).toBe(message);
        expect(parseDownloadRequest({ ...valid, index: '1' })).toBe(message);
        expect(parseDownloadRequest({ ...valid, index: 1.5 })).toBe(message);
    });

    it('needs valid episodes, and not too many', () => {
        const message = 'The episodes are invalid.';
        expect(parseDownloadRequest({ ...valid, episodes: [] })).toBe(message);
        expect(parseDownloadRequest({ ...valid, episodes: 'all' })).toBe(message);
        expect(parseDownloadRequest({ ...valid, episodes: ['1', '-d'] })).toBe(message);
        expect(parseDownloadRequest({ ...valid, episodes: [1] })).toBe(message);
        const many = Array.from({ length: MAX_EPISODES_PER_REQUEST + 1 }, (_value, position) => {
            return String(position + 1);
        });
        expect(parseDownloadRequest({ ...valid, episodes: many })).toBe(message);
        expect(parseDownloadRequest({ ...valid, episodes: many.slice(0, MAX_EPISODES_PER_REQUEST) })).toMatchObject({ audio: 'sub' });
    });
});

describe('parseProgress', () => {
    const valid = { episodeId: 3, positionSeconds: 12.5, durationSeconds: 1400, watched: true };

    it('accepts a valid update', () => {
        expect(parseProgress(valid)).toEqual(valid);
        expect(parseProgress({ ...valid, positionSeconds: 0, durationSeconds: 0 })).toEqual({ ...valid, positionSeconds: 0, durationSeconds: 0 });
    });

    it('rejects everything else', () => {
        expect(parseProgress(null)).toBeNull();
        expect(parseProgress('x')).toBeNull();
        expect(parseProgress({ ...valid, episodeId: 0 })).toBeNull();
        expect(parseProgress({ ...valid, episodeId: '3' })).toBeNull();
        expect(parseProgress({ ...valid, positionSeconds: '1' })).toBeNull();
        expect(parseProgress({ ...valid, durationSeconds: undefined })).toBeNull();
        expect(parseProgress({ ...valid, watched: 1 })).toBeNull();
        expect(parseProgress({ ...valid, positionSeconds: Number.NaN })).toBeNull();
        expect(parseProgress({ ...valid, durationSeconds: Number.POSITIVE_INFINITY })).toBeNull();
        expect(parseProgress({ ...valid, positionSeconds: -1 })).toBeNull();
        expect(parseProgress({ ...valid, durationSeconds: -1 })).toBeNull();
    });
});

describe('the history of the anime section', () => {
    const opened = { title: 'Naruto', query: 'naruto', index: 2, audio: 'sub', episode: null };

    it('starts empty', () => {
        expect(setup().call(IPC.animeHistoryList)).toEqual([]);
    });

    it('keeps what the screen records, most recent first', () => {
        const { call } = setup();
        call(IPC.animeHistoryRecord, opened);
        call(IPC.animeHistoryRecord, { title: 'Bleach', query: 'bleach', index: 0, audio: 'dub', episode: '12' });

        expect(call(IPC.animeHistoryList)).toEqual([
            { id: 2, title: 'Bleach', query: 'bleach', searchIndex: 0, audio: 'dub', episode: '12', openedAt: 5 },
            { id: 1, title: 'Naruto', query: 'naruto', searchIndex: 2, audio: 'sub', episode: null, openedAt: 5 }
        ]);
    });

    it('does not keep what is invalid', () => {
        const { call, db } = setup();
        [null, 'x', { ...opened, title: '  ' }, { ...opened, query: '--' }, { ...opened, audio: 'raw' }, { ...opened, index: -1 }, { ...opened, index: 1.5 }, { ...opened, index: '2' }, { ...opened, episode: 'abc' }].forEach((input) => {
            call(IPC.animeHistoryRecord, input);
        });
        expect(db.listHistory()).toEqual([]);
    });

    it('removes one entry by its id and ignores an invalid id', () => {
        const { call, db } = setup();
        call(IPC.animeHistoryRecord, opened);
        call(IPC.animeHistoryRecord, { ...opened, title: 'Bleach' });

        call(IPC.animeHistoryRemove, 0);
        call(IPC.animeHistoryRemove, '1');
        expect(db.listHistory()).toHaveLength(2);
        call(IPC.animeHistoryRemove, 1);
        expect(
            db.listHistory().map((entry) => {
                return entry.title;
            })
        ).toEqual(['Bleach']);
    });

    it('clears the history', () => {
        const { call, db } = setup();
        call(IPC.animeHistoryRecord, opened);
        call(IPC.animeHistoryClear);
        expect(db.listHistory()).toEqual([]);
    });
});

describe('parseHistoryRequest', () => {
    const valid = { title: 'Naruto', query: 'naruto', index: 2, audio: 'dub', episode: '3' };

    it('accepts a valid request and cleans it', () => {
        expect(parseHistoryRequest(valid)).toEqual({ title: 'Naruto', query: 'naruto', index: 2, audio: 'dub', episode: '3' });
        expect(parseHistoryRequest({ ...valid, title: '  Naruto  ' })?.title).toBe('Naruto');
        expect(parseHistoryRequest({ ...valid, title: 'N'.repeat(MAX_TEXT_LENGTH + 20) })?.title).toHaveLength(MAX_TEXT_LENGTH);
    });

    it('takes a missing episode as none, and a position of 0 as unknown', () => {
        expect(parseHistoryRequest({ ...valid, episode: null })?.episode).toBeNull();
        expect(parseHistoryRequest({ ...valid, episode: undefined })?.episode).toBeNull();
        expect(parseHistoryRequest({ ...valid, index: 0 })?.index).toBe(0);
    });

    it('rejects everything else', () => {
        expect(parseHistoryRequest(null)).toBeNull();
        expect(parseHistoryRequest('x')).toBeNull();
        expect(parseHistoryRequest({ ...valid, title: '' })).toBeNull();
        expect(parseHistoryRequest({ ...valid, query: '' })).toBeNull();
        expect(parseHistoryRequest({ ...valid, audio: 'raw' })).toBeNull();
        expect(parseHistoryRequest({ ...valid, index: -1 })).toBeNull();
        expect(parseHistoryRequest({ ...valid, index: 1.5 })).toBeNull();
        expect(parseHistoryRequest({ ...valid, index: Number.NaN })).toBeNull();
        expect(parseHistoryRequest({ ...valid, index: '1' })).toBeNull();
        expect(parseHistoryRequest({ ...valid, episode: 'x' })).toBeNull();
        expect(parseHistoryRequest({ ...valid, episode: 3 })).toBeNull();
    });
});
