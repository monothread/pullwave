import type { AniError, AniRunResult, AnimeAudio, AnimeCheckState, AnimeNewEpisodes, AnimeSearchResult } from '@shared/anime';
import { IDLE_CHECK_STATE, MAX_AUTO_DOWNLOAD_EPISODES } from '@shared/anime';
import { AnimeDb } from '@main/services/animeDb';
import {
    AnimeUpdateChecker,
    BACKOFF_LIMIT_MS,
    CHECK_INTERVAL_MS,
    DELAY_BETWEEN_ANIME_MS,
    DELAY_JITTER_MS,
    FIRST_CHECK_DELAY_MS,
    type AnimeUpdateCheckerDependencies
} from '@main/services/animeUpdateChecker';

const NOW = 1_700_000_000_000;
const NO_RESULTS: AniError = { code: 'NO_RESULTS', raw: 'No results found!' };
const NETWORK: AniError = { code: 'NETWORK', raw: 'curl: (6) Could not resolve host' };
const BLOCKED: AniError = { code: 'BLOCKED', raw: 'Blocked by cloudflare.' };

function numbers(first: number, last: number): string[] {
    return Array.from({ length: last - first + 1 }, (_value, position) => {
        return String(first + position);
    });
}

function done<T>(value: T): AniRunResult<T> {
    return { status: 'done', value };
}

function failed<T>(error: AniError): AniRunResult<T> {
    return { status: 'error', error };
}

interface Setup {
    db: AnimeDb;
    checker: AnimeUpdateChecker;
    // What the source lists: the results of a search by its text, and the episodes of a result by "<text>:<place>".
    results: Record<string, AnimeSearchResult[]>;
    lists: Record<string, string[]>;
    search: ReturnType<typeof vi.fn<AnimeUpdateCheckerDependencies['search']>>;
    episodes: ReturnType<typeof vi.fn<AnimeUpdateCheckerDependencies['episodes']>>;
    download: ReturnType<typeof vi.fn<NonNullable<AnimeUpdateCheckerDependencies['download']>>>;
    onNewEpisodes: ReturnType<typeof vi.fn<(news: AnimeNewEpisodes) => void>>;
    onLibraryChanged: ReturnType<typeof vi.fn<() => void>>;
    sleep: ReturnType<typeof vi.fn<(milliseconds: number) => Promise<void>>>;
    flags: { enabled: boolean; autoDownload: boolean };
    addAnime: (title: string, query: string, searchIndex: number, audio?: AnimeAudio) => number;
}

function setup(overrides: Partial<AnimeUpdateCheckerDependencies> = {}): Setup {
    const db = new AnimeDb(':memory:', () => {
        return NOW;
    });
    const results: Record<string, AnimeSearchResult[]> = {};
    const lists: Record<string, string[]> = {};
    const flags = { enabled: true, autoDownload: false };
    const search = vi.fn<AnimeUpdateCheckerDependencies['search']>(async (query) => {
        const found = results[query];
        return found === undefined ? failed<AnimeSearchResult[]>(NO_RESULTS) : done(found);
    });
    const episodes = vi.fn<AnimeUpdateCheckerDependencies['episodes']>(async (query, index) => {
        const listed = lists[`${query}:${index}`];
        return listed === undefined ? failed<string[]>(NO_RESULTS) : done(listed);
    });
    const download = vi.fn<NonNullable<AnimeUpdateCheckerDependencies['download']>>();
    const onNewEpisodes = vi.fn<(news: AnimeNewEpisodes) => void>();
    const onLibraryChanged = vi.fn<() => void>();
    const sleep = vi.fn<(milliseconds: number) => Promise<void>>(async () => {
        return undefined;
    });
    const checker = new AnimeUpdateChecker({
        db,
        search,
        episodes,
        isEnabled: () => {
            return flags.enabled;
        },
        autoDownload: () => {
            return flags.autoDownload;
        },
        download,
        onNewEpisodes,
        onLibraryChanged,
        sleep,
        random: () => {
            return 0.5;
        },
        ...overrides
    });
    return {
        db,
        checker,
        results,
        lists,
        search,
        episodes,
        download,
        onNewEpisodes,
        onLibraryChanged,
        sleep,
        flags,
        addAnime: (title, query, searchIndex, audio = 'sub') => {
            return db.upsertAnime({ title, query, searchIndex, audio }).id;
        }
    };
}

// An anime of the library whose episodes were read once: `known` are the ones the library has, the source lists `listed`.
function readOnce(context: Setup, title: string, query: string, searchIndex: number, known: string[], listed: string[]): number {
    const id = context.addAnime(title, query, searchIndex);
    context.results[query] = [{ index: searchIndex, title }, { index: searchIndex + 10, title: `${title} Movie` }];
    context.lists[`${query}:${searchIndex}`] = known;
    context.db.registerEpisodesBaseline(id, known);
    context.lists[`${query}:${searchIndex}`] = listed;
    return id;
}

describe('AnimeUpdateChecker.checkNow', () => {
    describe('the first reading of the episodes of an anime', () => {
        it('only puts them in the library, as idle, and announces and downloads nothing', async () => {
            const context = setup();
            context.flags.autoDownload = true;
            const id = context.addAnime('Naruto', 'naruto', 2);
            context.results.naruto = [{ index: 1, title: 'Naruto Shippuden' }, { index: 2, title: 'Naruto (220 episodes)' }];
            context.lists['naruto:2'] = ['1', '2', '3'];

            const response = await context.checker.checkNow('auto');

            expect(response).toEqual({ ok: true, count: 0, titles: [], notDownloaded: [], failed: 0, skipped: 0 });
            expect(
                context.db.getLibraryAnime(id)?.episodes.map((episode) => {
                    return [episode.number, episode.status, episode.addedAt];
                })
            ).toEqual([
                ['1', 'idle', null],
                ['2', 'idle', null],
                ['3', 'idle', null]
            ]);
            expect(context.db.hasEpisodesBaseline(id)).toBe(true);
            expect(context.db.updates()).toEqual([]);
            expect(context.download).not.toHaveBeenCalled();
            expect(context.onNewEpisodes).not.toHaveBeenCalled();
            expect(context.onLibraryChanged).not.toHaveBeenCalled();
        });

        it('asks ani-cli for the search and the audio of the anime, and for the episodes of the place it has in the results', async () => {
            const context = setup();
            context.addAnime('Naruto', 'naruto', 2, 'dub');
            context.results.naruto = [{ index: 1, title: 'Naruto Shippuden' }, { index: 2, title: 'Naruto (220 episodes)' }];
            context.lists['naruto:2'] = ['1'];

            await context.checker.checkNow('auto');

            expect(context.search).toHaveBeenCalledTimes(1);
            expect(context.search).toHaveBeenCalledWith('naruto', 'dub');
            expect(context.episodes).toHaveBeenCalledTimes(1);
            expect(context.episodes).toHaveBeenCalledWith('naruto', 2, 'dub');
        });

        it('leaves the episodes the library already has as they are', async () => {
            const context = setup();
            const id = context.addAnime('Naruto', 'naruto', 1);
            const episode = context.db.ensureEpisode(id, '1');
            context.db.markDone(episode.id, '/lib/Naruto/Naruto Episode 1.mp4', 1024);
            context.results.naruto = [{ index: 1, title: 'Naruto' }, { index: 2, title: 'Naruto Movie' }];
            context.lists['naruto:1'] = ['1', '2'];

            await context.checker.checkNow('auto');

            expect(context.db.getEpisode(episode.id)).toMatchObject({ status: 'done', filePath: '/lib/Naruto/Naruto Episode 1.mp4' });
            expect(context.db.getEpisodeByNumber(id, '2')).toMatchObject({ status: 'idle', addedAt: null });
        });
    });

    describe('the episodes that came after', () => {
        it('puts the new ones in the library as idle with the time they arrived, lists them as updates and tells the screen', async () => {
            const context = setup();
            const id = readOnce(context, 'Naruto', 'naruto', 1, ['1', '2'], ['1', '2', '3', '4']);

            const response = await context.checker.checkNow('auto');

            expect(response).toEqual({ ok: true, count: 2, titles: ['Naruto'], notDownloaded: [], failed: 0, skipped: 0 });
            expect(
                context.db.getLibraryAnime(id)?.episodes.map((episode) => {
                    return [episode.number, episode.status, episode.addedAt];
                })
            ).toEqual([
                ['1', 'idle', null],
                ['2', 'idle', null],
                ['3', 'idle', NOW],
                ['4', 'idle', NOW]
            ]);
            expect(
                context.db.updates().map((entry) => {
                    return [entry.animeTitle, entry.episodeNumber, entry.origin];
                })
            ).toEqual([
                ['Naruto', '4', 'auto'],
                ['Naruto', '3', 'auto']
            ]);
            expect(context.onNewEpisodes).toHaveBeenCalledTimes(1);
            expect(context.onNewEpisodes).toHaveBeenCalledWith({ count: 2, titles: ['Naruto'], notDownloaded: [] });
            expect(context.onLibraryChanged).toHaveBeenCalledTimes(1);
        });

        it('keeps the origin of a check the user asked for', async () => {
            const context = setup();
            readOnce(context, 'Naruto', 'naruto', 1, ['1'], ['1', '2']);

            await context.checker.checkNow('manual');

            expect(context.db.updates()[0]).toMatchObject({ episodeNumber: '2', origin: 'manual' });
        });

        it('says nothing and writes nothing when the source lists no episode the library lacks', async () => {
            const context = setup();
            readOnce(context, 'Naruto', 'naruto', 1, ['1', '2'], ['1', '2']);

            const response = await context.checker.checkNow('auto');

            expect(response).toEqual({ ok: true, count: 0, titles: [], notDownloaded: [], failed: 0, skipped: 0 });
            expect(context.db.updates()).toEqual([]);
            expect(context.onNewEpisodes).not.toHaveBeenCalled();
            expect(context.onLibraryChanged).not.toHaveBeenCalled();
        });

        it('does not find the same episode new a second time', async () => {
            const context = setup();
            readOnce(context, 'Naruto', 'naruto', 1, ['1'], ['1', '2']);

            await context.checker.checkNow('auto');
            const second = await context.checker.checkNow('auto');

            expect(second).toMatchObject({ count: 0, titles: [] });
            expect(context.db.updates()).toHaveLength(1);
            expect(context.onNewEpisodes).toHaveBeenCalledTimes(1);
        });

        it('adds the new episodes of every anime together, and tells the screen once', async () => {
            const context = setup();
            readOnce(context, 'Naruto', 'naruto', 1, ['1'], ['1', '2']);
            readOnce(context, 'Bleach', 'bleach', 2, ['1', '2'], ['1', '2', '3', '4']);
            readOnce(context, 'Gintama', 'gintama', 3, ['1'], ['1']);

            const response = await context.checker.checkNow('auto');

            expect(response).toEqual({ ok: true, count: 3, titles: ['Bleach', 'Naruto'], notDownloaded: [], failed: 0, skipped: 0 });
            expect(context.onNewEpisodes).toHaveBeenCalledTimes(1);
            expect(context.onNewEpisodes).toHaveBeenCalledWith({ count: 3, titles: ['Bleach', 'Naruto'], notDownloaded: [] });
            expect(context.onLibraryChanged).toHaveBeenCalledTimes(1);
        });

        it('puts an episode with a decimal number in the library like any other', async () => {
            const context = setup();
            const id = readOnce(context, 'Naruto', 'naruto', 1, ['1', '2'], ['1', '2', '2.5']);

            await context.checker.checkNow('auto');

            expect(context.db.getEpisodeByNumber(id, '2.5')).toMatchObject({ status: 'idle', addedAt: NOW });
        });
    });

    describe('downloading what is found', () => {
        it('queues the new episodes of the anime, by number, when the setting asks for it', async () => {
            const context = setup();
            context.flags.autoDownload = true;
            const id = readOnce(context, 'Naruto', 'naruto', 1, ['1', '2'], ['1', '2', '3', '4']);

            await context.checker.checkNow('auto');

            expect(context.download).toHaveBeenCalledTimes(1);
            expect(context.download).toHaveBeenCalledWith(id, ['3', '4']);
        });

        it('queues what a check the user asked for finds too', async () => {
            const context = setup();
            context.flags.autoDownload = true;
            const id = readOnce(context, 'Naruto', 'naruto', 1, ['1'], ['1', '2']);

            await context.checker.checkNow('manual');

            expect(context.download).toHaveBeenCalledWith(id, ['2']);
        });

        it('queues nothing when the setting does not ask for it, but the episodes are in the library', async () => {
            const context = setup();
            context.flags.autoDownload = false;
            const id = readOnce(context, 'Naruto', 'naruto', 1, ['1'], ['1', '2']);

            await context.checker.checkNow('auto');

            expect(context.download).not.toHaveBeenCalled();
            expect(context.db.getEpisodeByNumber(id, '2')).toMatchObject({ status: 'idle' });
        });

        it('reads the setting at every check', async () => {
            const context = setup();
            const id = readOnce(context, 'Naruto', 'naruto', 1, ['1'], ['1', '2']);
            await context.checker.checkNow('auto');
            expect(context.download).not.toHaveBeenCalled();

            context.flags.autoDownload = true;
            context.lists['naruto:1'] = ['1', '2', '3'];
            await context.checker.checkNow('auto');

            expect(context.download).toHaveBeenCalledTimes(1);
            expect(context.download).toHaveBeenCalledWith(id, ['3']);
        });

        it('does not need a way to download to find episodes', async () => {
            const context = setup({ download: undefined, autoDownload: undefined });
            readOnce(context, 'Naruto', 'naruto', 1, ['1'], ['1', '2']);

            const response = await context.checker.checkNow('auto');

            expect(response).toMatchObject({ count: 1, titles: ['Naruto'] });
        });

        it(`queues them all when there are ${MAX_AUTO_DOWNLOAD_EPISODES} of an anime, a season`, async () => {
            const context = setup();
            context.flags.autoDownload = true;
            const id = readOnce(context, 'Frieren', 'frieren', 1, ['1'], numbers(1, 1 + MAX_AUTO_DOWNLOAD_EPISODES));

            const response = await context.checker.checkNow('auto');

            expect(response).toMatchObject({ count: MAX_AUTO_DOWNLOAD_EPISODES, notDownloaded: [] });
            expect(context.download).toHaveBeenCalledWith(id, numbers(2, 1 + MAX_AUTO_DOWNLOAD_EPISODES));
        });

        it(`queues none, but puts them all in the library, when there are more than ${MAX_AUTO_DOWNLOAD_EPISODES} of an anime`, async () => {
            const context = setup();
            context.flags.autoDownload = true;
            const id = readOnce(context, 'One Piece', 'one piece', 1, ['1'], numbers(1, 2 + MAX_AUTO_DOWNLOAD_EPISODES));

            const response = await context.checker.checkNow('auto');

            expect(response).toEqual({ ok: true, count: MAX_AUTO_DOWNLOAD_EPISODES + 1, titles: ['One Piece'], notDownloaded: ['One Piece'], failed: 0, skipped: 0 });
            expect(context.download).not.toHaveBeenCalled();
            expect(context.db.getLibraryAnime(id)?.episodes).toHaveLength(MAX_AUTO_DOWNLOAD_EPISODES + 2);
            expect(context.db.updates()).toHaveLength(MAX_AUTO_DOWNLOAD_EPISODES + 1);
            expect(context.onNewEpisodes).toHaveBeenCalledWith({ count: MAX_AUTO_DOWNLOAD_EPISODES + 1, titles: ['One Piece'], notDownloaded: ['One Piece'] });
        });

        it('applies the limit to each anime on its own', async () => {
            const context = setup();
            context.flags.autoDownload = true;
            const small = readOnce(context, 'Naruto', 'naruto', 1, ['1'], ['1', '2']);
            readOnce(context, 'One Piece', 'one piece', 2, ['1'], numbers(1, 2 + MAX_AUTO_DOWNLOAD_EPISODES));

            const response = await context.checker.checkNow('auto');

            expect(response).toMatchObject({ titles: ['Naruto', 'One Piece'], notDownloaded: ['One Piece'] });
            expect(context.download).toHaveBeenCalledTimes(1);
            expect(context.download).toHaveBeenCalledWith(small, ['2']);
        });

        it('does not name the anime that has too many when the setting does not ask for downloads', async () => {
            const context = setup();
            readOnce(context, 'One Piece', 'one piece', 1, ['1'], numbers(1, 2 + MAX_AUTO_DOWNLOAD_EPISODES));

            const response = await context.checker.checkNow('auto');

            expect(response).toMatchObject({ count: MAX_AUTO_DOWNLOAD_EPISODES + 1, notDownloaded: [] });
        });
    });

    describe('the setting of the hourly check', () => {
        it('asks about nothing when it is turned off and the check is the hourly one', async () => {
            const context = setup();
            context.flags.enabled = false;
            readOnce(context, 'Naruto', 'naruto', 1, ['1'], ['1', '2']);

            const response = await context.checker.checkNow('auto');

            expect(response).toEqual({ ok: true, count: 0, titles: [], notDownloaded: [], failed: 0, skipped: 0 });
            expect(context.search).not.toHaveBeenCalled();
            expect(context.episodes).not.toHaveBeenCalled();
            expect(context.sleep).not.toHaveBeenCalled();
        });

        it('asks anyway when the user asks for the check, whatever the setting says', async () => {
            const context = setup();
            context.flags.enabled = false;
            readOnce(context, 'Naruto', 'naruto', 1, ['1'], ['1', '2']);

            const response = await context.checker.checkNow('manual');

            expect(response).toMatchObject({ count: 1, titles: ['Naruto'] });
        });

        it('reads the setting at every check', async () => {
            const context = setup();
            readOnce(context, 'Naruto', 'naruto', 1, ['1'], ['1', '2']);
            context.flags.enabled = false;
            await context.checker.checkNow('auto');
            expect(context.search).not.toHaveBeenCalled();

            context.flags.enabled = true;
            const response = await context.checker.checkNow('auto');

            expect(response).toMatchObject({ count: 1 });
        });
    });

    describe('the pause between anime', () => {
        it('waits between one anime and the next, but not before the first nor after the last', async () => {
            const context = setup();
            readOnce(context, 'Naruto', 'naruto', 1, ['1'], ['1']);
            readOnce(context, 'Bleach', 'bleach', 2, ['1'], ['1']);
            readOnce(context, 'Gintama', 'gintama', 3, ['1'], ['1']);
            const order: string[] = [];
            context.sleep.mockImplementation(async () => {
                order.push('pause');
            });
            context.search.mockImplementation(async (query) => {
                order.push(`search ${query}`);
                return done([{ index: ['naruto', 'bleach', 'gintama'].indexOf(query) + 1, title: query }]);
            });

            await context.checker.checkNow('auto');

            expect(context.sleep).toHaveBeenCalledTimes(2);
            expect(order).toEqual(['search bleach', 'pause', 'search gintama', 'pause', 'search naruto']);
        });

        it('waits the usual time when the variation is in the middle', async () => {
            const context = setup();
            readOnce(context, 'Naruto', 'naruto', 1, ['1'], ['1']);
            readOnce(context, 'Bleach', 'bleach', 2, ['1'], ['1']);

            await context.checker.checkNow('auto');

            expect(context.sleep).toHaveBeenCalledTimes(1);
            expect(context.sleep).toHaveBeenCalledWith(DELAY_BETWEEN_ANIME_MS);
        });

        it.each([
            ['the shortest', 0, DELAY_BETWEEN_ANIME_MS - DELAY_JITTER_MS],
            ['a little shorter', 0.25, DELAY_BETWEEN_ANIME_MS - DELAY_JITTER_MS / 2],
            ['a little longer', 0.75, DELAY_BETWEEN_ANIME_MS + DELAY_JITTER_MS / 2],
            ['the longest', 1, DELAY_BETWEEN_ANIME_MS + DELAY_JITTER_MS]
        ])('waits %s when the variation says so', async (_label, random, expected) => {
            const context = setup({
                random: () => {
                    return random;
                }
            });
            readOnce(context, 'Naruto', 'naruto', 1, ['1'], ['1']);
            readOnce(context, 'Bleach', 'bleach', 2, ['1'], ['1']);

            await context.checker.checkNow('auto');

            expect(context.sleep).toHaveBeenCalledWith(expected);
        });

        it('does not wait when there is a single anime or none', async () => {
            const context = setup();
            await context.checker.checkNow('auto');
            readOnce(context, 'Naruto', 'naruto', 1, ['1'], ['1']);
            await context.checker.checkNow('auto');

            expect(context.sleep).not.toHaveBeenCalled();
        });

        it('waits between the anime that could not be asked about too: the source sees the same requests', async () => {
            const context = setup();
            context.addAnime('Naruto', 'naruto', 1);
            context.addAnime('Bleach', 'bleach', 2);

            await context.checker.checkNow('auto');

            expect(context.sleep).toHaveBeenCalledTimes(1);
        });

        it('really waits, with the timers, when no way to wait is given', async () => {
            vi.useFakeTimers();
            try {
                const context = setup({ sleep: undefined, random: () => {
                    return 0.5;
                } });
                readOnce(context, 'Naruto', 'naruto', 1, ['1'], ['1']);
                readOnce(context, 'Bleach', 'bleach', 2, ['1'], ['1']);

                const pending = context.checker.checkNow('auto');
                await vi.advanceTimersByTimeAsync(DELAY_BETWEEN_ANIME_MS - 1);
                expect(context.search).toHaveBeenCalledTimes(1);
                await vi.advanceTimersByTimeAsync(1);
                await pending;

                expect(context.search).toHaveBeenCalledTimes(2);
            } finally {
                vi.useRealTimers();
            }
        });
    });

    describe('where the anime is in the results of its search', () => {
        it('goes on with the place the anime had when its title is still there', async () => {
            const context = setup();
            const id = readOnce(context, 'Naruto', 'naruto', 3, ['1'], ['1', '2']);

            await context.checker.checkNow('auto');

            expect(context.episodes).toHaveBeenCalledWith('naruto', 3, 'sub');
            expect(context.db.getAnime(id)?.searchIndex).toBe(3);
        });

        it('follows the anime to its new place and keeps it, when a new anime was listed before it', async () => {
            const context = setup();
            const id = readOnce(context, 'Naruto', 'naruto', 2, ['1'], ['1']);
            context.results.naruto = [{ index: 1, title: 'Naruto Fan Letter' }, { index: 2, title: 'Naruto Movie' }, { index: 3, title: 'Naruto' }];
            context.lists['naruto:3'] = ['1', '2'];

            const response = await context.checker.checkNow('auto');

            expect(response).toMatchObject({ count: 1, titles: ['Naruto'] });
            expect(context.episodes).toHaveBeenCalledWith('naruto', 3, 'sub');
            expect(context.db.getAnime(id)?.searchIndex).toBe(3);
        });

        it('finds an anime that was put in the library without its place (0) by its title, and keeps the place', async () => {
            const context = setup();
            const id = context.addAnime('Naruto', 'naruto', 0);
            context.results.naruto = [{ index: 1, title: 'Naruto Movie' }, { index: 2, title: 'Naruto (220 episodes)' }];
            context.lists['naruto:2'] = ['1', '2'];

            await context.checker.checkNow('auto');

            expect(context.db.getAnime(id)?.searchIndex).toBe(2);
            expect(context.db.hasEpisodesBaseline(id)).toBe(true);
        });

        it('takes the only result as the anime, as ani-cli gives its search as the title', async () => {
            const context = setup();
            const id = context.addAnime('Dandadan (28 episodes)', 'dandadan', 4);
            context.results.dandadan = [{ index: 1, title: 'dandadan' }];
            context.lists['dandadan:1'] = ['1'];

            await context.checker.checkNow('auto');

            expect(context.episodes).toHaveBeenCalledWith('dandadan', 1, 'sub');
            expect(context.db.getAnime(id)?.searchIndex).toBe(1);
        });

        it('leaves the anime for the user, counted as skipped, when its title is not listed any more, and goes on with the others', async () => {
            const context = setup();
            const lost = context.addAnime('Naruto', 'naruto', 1);
            context.results.naruto = [{ index: 1, title: 'Boruto' }, { index: 2, title: 'Naruto Shippuden' }];
            readOnce(context, 'Bleach', 'bleach', 5, ['1'], ['1', '2']);

            const response = await context.checker.checkNow('auto');

            expect(response).toEqual({ ok: true, count: 1, titles: ['Bleach'], notDownloaded: [], failed: 0, skipped: 1 });
            expect(
                context.episodes.mock.calls.map((call) => {
                    return call[0];
                })
            ).toEqual(['bleach']);
            expect(context.db.getAnime(lost)).toMatchObject({ searchIndex: 1 });
            expect(context.db.hasEpisodesBaseline(lost)).toBe(false);
        });

        it('leaves the anime for the user when more than one result has its title and none is at its place', async () => {
            const context = setup();
            context.addAnime('Bleach', 'bleach', 3);
            context.results.bleach = [{ index: 1, title: 'Bleach (366 episodes)' }, { index: 2, title: 'Bleach (13 episodes)' }, { index: 3, title: 'Bleach: Thousand-Year Blood War' }];

            const response = await context.checker.checkNow('auto');

            expect(response).toMatchObject({ failed: 0, skipped: 1 });
            expect(context.episodes).not.toHaveBeenCalled();
        });

        it('counts an anime the search no longer finds as skipped, not failed', async () => {
            const context = setup();
            context.addAnime('Naruto', 'naruto', 1);

            const response = await context.checker.checkNow('auto');

            expect(response).toMatchObject({ failed: 0, skipped: 1 });
        });

        it('counts an anime whose episodes the source no longer lists as skipped', async () => {
            const context = setup();
            const id = context.addAnime('Naruto', 'naruto', 1);
            context.results.naruto = [{ index: 1, title: 'Naruto' }, { index: 2, title: 'Naruto Movie' }];

            const response = await context.checker.checkNow('auto');

            expect(response).toMatchObject({ failed: 0, skipped: 1 });
            expect(context.db.hasEpisodesBaseline(id)).toBe(false);
        });
    });

    describe('when the source cannot be asked', () => {
        it('counts the anime it could not reach as failed, leaves them for the next time and goes on', async () => {
            const context = setup();
            const unreached = readOnce(context, 'Naruto', 'naruto', 1, ['1'], ['1', '2']);
            readOnce(context, 'Bleach', 'bleach', 2, ['1'], ['1', '2']);
            context.search.mockImplementation(async (query) => {
                return query === 'naruto' ? failed<AnimeSearchResult[]>(NETWORK) : done([{ index: 2, title: 'Bleach' }]);
            });

            const response = await context.checker.checkNow('auto');

            expect(response).toEqual({ ok: true, count: 1, titles: ['Bleach'], notDownloaded: [], failed: 1, skipped: 0 });
            expect(context.db.getEpisodeByNumber(unreached, '2')).toBeNull();
        });

        it('counts a failure to list the episodes as failed too', async () => {
            const context = setup();
            readOnce(context, 'Naruto', 'naruto', 1, ['1'], ['1', '2']);
            context.episodes.mockResolvedValue(failed(NETWORK));

            const response = await context.checker.checkNow('auto');

            expect(response).toMatchObject({ count: 0, failed: 1, skipped: 0 });
        });

        it('counts a look that was cancelled as failed', async () => {
            const context = setup();
            readOnce(context, 'Naruto', 'naruto', 1, ['1'], ['1', '2']);
            context.search.mockResolvedValue({ status: 'cancelled' });

            const response = await context.checker.checkNow('auto');

            expect(response).toMatchObject({ failed: 1, skipped: 0 });
        });

        it('counts ani-cli that throws as failed, and goes on', async () => {
            const context = setup();
            readOnce(context, 'Naruto', 'naruto', 1, ['1'], ['1', '2']);
            readOnce(context, 'Bleach', 'bleach', 2, ['1'], ['1', '2']);
            context.search.mockImplementation(async (query) => {
                if (query === 'naruto') {
                    throw new Error('spawn failed');
                }
                return done([{ index: 2, title: 'Bleach' }]);
            });

            const response = await context.checker.checkNow('auto');

            expect(response).toMatchObject({ count: 1, titles: ['Bleach'], failed: 1 });
        });

        it('counts the library failing to save as failed, and goes on', async () => {
            const context = setup();
            readOnce(context, 'Naruto', 'naruto', 1, ['1'], ['1', '2']);
            readOnce(context, 'Bleach', 'bleach', 2, ['1'], ['1', '2']);
            const original = context.db.registerNewEpisodes.bind(context.db);
            let first = true;
            vi.spyOn(context.db, 'registerNewEpisodes').mockImplementation((animeId, listed, origin) => {
                if (first) {
                    first = false;
                    throw new Error('disk full');
                }
                return original(animeId, listed, origin);
            });

            const response = await context.checker.checkNow('auto');

            expect(response).toMatchObject({ count: 1, failed: 1 });
        });

        it('stops asking at once when the source refuses, and counts the rest as skipped', async () => {
            const context = setup();
            readOnce(context, 'Bleach', 'bleach', 2, ['1'], ['1', '2']);
            readOnce(context, 'Gintama', 'gintama', 3, ['1'], ['1', '2']);
            readOnce(context, 'Naruto', 'naruto', 1, ['1'], ['1', '2']);
            context.search.mockImplementation(async (query) => {
                return query === 'gintama' ? failed<AnimeSearchResult[]>(BLOCKED) : done([{ index: ['bleach', 'gintama', 'naruto'].indexOf(query) + 2, title: query }]);
            });

            const response = await context.checker.checkNow('auto');

            expect(response).toEqual({ ok: true, count: 1, titles: ['Bleach'], notDownloaded: [], failed: 1, skipped: 1 });
            expect(context.search).toHaveBeenCalledTimes(2);
        });

        it('also stops when it is the listing of the episodes that is refused', async () => {
            const context = setup();
            readOnce(context, 'Bleach', 'bleach', 2, ['1'], ['1', '2']);
            readOnce(context, 'Naruto', 'naruto', 1, ['1'], ['1', '2']);
            context.episodes.mockResolvedValue(failed(BLOCKED));

            const response = await context.checker.checkNow('auto');

            expect(response).toEqual({ ok: true, count: 0, titles: [], notDownloaded: [], failed: 1, skipped: 1 });
            expect(context.episodes).toHaveBeenCalledTimes(1);
        });

        it('keeps what it found before the source refused', async () => {
            const context = setup();
            readOnce(context, 'Bleach', 'bleach', 2, ['1'], ['1', '2']);
            readOnce(context, 'Naruto', 'naruto', 1, ['1'], ['1', '2']);
            context.search.mockImplementation(async (query) => {
                return query === 'naruto' ? failed<AnimeSearchResult[]>(BLOCKED) : done([{ index: 2, title: 'Bleach' }]);
            });

            await context.checker.checkNow('auto');

            expect(context.onNewEpisodes).toHaveBeenCalledWith({ count: 1, titles: ['Bleach'], notDownloaded: [] });
            expect(context.db.updates()).toHaveLength(1);
        });
    });

    describe('a check that is going on', () => {
        it('is not started again: the same answer comes to whoever asks meanwhile', async () => {
            const context = setup();
            readOnce(context, 'Naruto', 'naruto', 1, ['1'], ['1', '2']);

            const first = context.checker.checkNow('auto');
            const second = context.checker.checkNow('manual');
            const answers = await Promise.all([first, second]);

            expect(answers[0]).toBe(answers[1]);
            expect(context.search).toHaveBeenCalledTimes(1);
            expect(context.db.updates()).toHaveLength(1);
        });

        it('can be started again once it ended', async () => {
            const context = setup();
            readOnce(context, 'Naruto', 'naruto', 1, ['1'], ['1', '2']);

            await context.checker.checkNow('auto');
            await context.checker.checkNow('auto');

            expect(context.search).toHaveBeenCalledTimes(2);
        });

        it('stops asking about the next anime once the checker is stopped', async () => {
            const context = setup();
            readOnce(context, 'Bleach', 'bleach', 2, ['1'], ['1', '2']);
            readOnce(context, 'Naruto', 'naruto', 1, ['1'], ['1', '2']);
            context.search.mockImplementation(async () => {
                context.checker.stop();
                return done([{ index: 2, title: 'Bleach' }]);
            });

            const response = await context.checker.checkNow('auto');

            expect(context.search).toHaveBeenCalledTimes(1);
            expect(response).toMatchObject({ count: 1, titles: ['Bleach'] });
        });

        it('has nothing to do for an empty library', async () => {
            const context = setup();

            expect(await context.checker.checkNow('auto')).toEqual({ ok: true, count: 0, titles: [], notDownloaded: [], failed: 0, skipped: 0 });
            expect(context.search).not.toHaveBeenCalled();
        });
    });
});

describe('AnimeUpdateChecker.checkAnime', () => {
    it('says the anime is not in the library when it is not', async () => {
        const context = setup();

        expect(await context.checker.checkAnime(99)).toEqual({ ok: false, error: { code: 'NOT_FOUND', message: 'The anime is not in the library.' } });
        expect(context.search).not.toHaveBeenCalled();
    });

    it('asks about that anime only, without waiting, as the user asking for it, and tells what was found', async () => {
        const context = setup();
        context.flags.autoDownload = true;
        const id = readOnce(context, 'Naruto', 'naruto', 1, ['1'], ['1', '2']);
        readOnce(context, 'Bleach', 'bleach', 2, ['1'], ['1', '2']);

        const response = await context.checker.checkAnime(id);

        expect(response).toEqual({ ok: true, count: 1, titles: ['Naruto'], notDownloaded: [], failed: 0, skipped: 0 });
        expect(context.search).toHaveBeenCalledTimes(1);
        expect(context.search).toHaveBeenCalledWith('naruto', 'sub');
        expect(context.sleep).not.toHaveBeenCalled();
        expect(context.db.updates()[0]).toMatchObject({ episodeNumber: '2', origin: 'manual' });
        expect(context.download).toHaveBeenCalledWith(id, ['2']);
        expect(context.onNewEpisodes).toHaveBeenCalledWith({ count: 1, titles: ['Naruto'], notDownloaded: [] });
        expect(context.onLibraryChanged).toHaveBeenCalledTimes(1);
    });

    it('asks even when the hourly check is turned off', async () => {
        const context = setup();
        context.flags.enabled = false;
        const id = readOnce(context, 'Naruto', 'naruto', 1, ['1'], ['1', '2']);

        expect(await context.checker.checkAnime(id)).toMatchObject({ ok: true, count: 1 });
    });

    it('says nothing when there is nothing new', async () => {
        const context = setup();
        const id = readOnce(context, 'Naruto', 'naruto', 1, ['1'], ['1']);

        expect(await context.checker.checkAnime(id)).toEqual({ ok: true, count: 0, titles: [], notDownloaded: [], failed: 0, skipped: 0 });
        expect(context.onNewEpisodes).not.toHaveBeenCalled();
        expect(context.onLibraryChanged).not.toHaveBeenCalled();
    });

    it('only registers the episodes of an anime that is read for the first time', async () => {
        const context = setup();
        context.flags.autoDownload = true;
        const id = context.addAnime('Naruto', 'naruto', 1);
        context.results.naruto = [{ index: 1, title: 'Naruto' }, { index: 2, title: 'Naruto Movie' }];
        context.lists['naruto:1'] = ['1', '2'];

        expect(await context.checker.checkAnime(id)).toMatchObject({ ok: true, count: 0 });
        expect(context.db.getLibraryAnime(id)?.episodes).toHaveLength(2);
        expect(context.download).not.toHaveBeenCalled();
    });

    it('counts an anime that is not listed any more as skipped', async () => {
        const context = setup();
        const id = context.addAnime('Naruto', 'naruto', 1);

        expect(await context.checker.checkAnime(id)).toEqual({ ok: true, count: 0, titles: [], notDownloaded: [], failed: 0, skipped: 1 });
    });

    it('says why the source could not be asked', async () => {
        const context = setup();
        const id = readOnce(context, 'Naruto', 'naruto', 1, ['1'], ['1', '2']);
        context.search.mockResolvedValue(failed(NETWORK));

        expect(await context.checker.checkAnime(id)).toEqual({ ok: false, error: { code: 'UNKNOWN', message: 'curl: (6) Could not resolve host' } });
    });

    it('says why when ani-cli throws, or the library cannot save', async () => {
        const context = setup();
        const id = readOnce(context, 'Naruto', 'naruto', 1, ['1'], ['1', '2']);
        context.search.mockRejectedValue(new Error('spawn failed'));

        expect(await context.checker.checkAnime(id)).toEqual({ ok: false, error: { code: 'UNKNOWN', message: 'spawn failed' } });
        context.search.mockRejectedValue('not an error');
        expect(await context.checker.checkAnime(id)).toEqual({ ok: false, error: { code: 'UNKNOWN', message: 'not an error' } });
    });
});

describe('AnimeUpdateChecker schedule', () => {
    const HOUR = 60 * 60 * 1000;

    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    function scheduled(overrides: Partial<AnimeUpdateCheckerDependencies> = {}) {
        const context = setup(overrides);
        readOnce(context, 'Naruto', 'naruto', 1, ['1'], ['1']);
        return context;
    }

    // The place where the time of the last look is kept: what it says, and every time it was written.
    function lastCheckAt(read: () => number | null) {
        const written: number[] = [];
        return {
            written,
            lastCheck: {
                read,
                write: (time: number) => {
                    written.push(time);
                }
            }
        };
    }

    it('looks every 6 hours', () => {
        expect(CHECK_INTERVAL_MS).toBe(6 * HOUR);
    });

    it('does nothing by itself until it is started', async () => {
        const context = scheduled();

        await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS * 3);

        expect(context.search).not.toHaveBeenCalled();
    });

    it('makes the first check two minutes after it is started, not before, when no look was made in the last 6 hours', async () => {
        const context = scheduled();
        context.checker.start();

        await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS - 1);
        expect(context.search).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);

        expect(context.search).toHaveBeenCalledTimes(1);
        context.checker.stop();
    });

    it('checks again 6 hours after the first check, not every hour', async () => {
        const context = scheduled();
        context.checker.start();
        await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS);
        expect(context.search).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(5 * HOUR);
        expect(context.search).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(HOUR - 1);
        expect(context.search).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(context.search).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);

        expect(context.search).toHaveBeenCalledTimes(3);
        context.checker.stop();
    });

    it('uses the times it is given', async () => {
        const context = scheduled({ firstDelayMs: 50, intervalMs: 200 });
        context.checker.start();

        await vi.advanceTimersByTimeAsync(50);
        expect(context.search).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(200);
        expect(context.search).toHaveBeenCalledTimes(2);
        context.checker.stop();
    });

    it('does not start twice', async () => {
        const context = scheduled();
        context.checker.start();
        context.checker.start();

        await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS);

        expect(context.search).toHaveBeenCalledTimes(1);
        context.checker.stop();
    });

    it('does not check any more once it is stopped, before the first check or between two', async () => {
        const context = scheduled();
        context.checker.start();
        context.checker.stop();
        await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS * 2);
        expect(context.search).not.toHaveBeenCalled();

        context.checker.start();
        await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS);
        expect(context.search).toHaveBeenCalledTimes(1);
        context.checker.stop();
        await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS * 3);

        expect(context.search).toHaveBeenCalledTimes(1);
    });

    it('can be started again after it was stopped', async () => {
        const context = scheduled();
        context.checker.start();
        context.checker.stop();

        context.checker.start();
        await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS);

        expect(context.search).toHaveBeenCalledTimes(1);
        context.checker.stop();
    });

    it('does not schedule another check when it is stopped during one', async () => {
        const context = scheduled();
        context.search.mockImplementation(async () => {
            context.checker.stop();
            return done([{ index: 1, title: 'Naruto' }]);
        });
        context.checker.start();

        await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS + CHECK_INTERVAL_MS * 3);

        expect(context.search).toHaveBeenCalledTimes(1);
    });

    it('goes on with the timer when the automatic check is turned off, asking about nothing, and reads the setting again every hour', async () => {
        const context = scheduled();
        context.flags.enabled = false;
        context.checker.start();

        await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS + 3 * HOUR);
        expect(context.search).not.toHaveBeenCalled();
        context.flags.enabled = true;
        await vi.advanceTimersByTimeAsync(HOUR - 1);
        expect(context.search).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);

        expect(context.search).toHaveBeenCalledTimes(1);
        context.checker.stop();
    });

    describe('the last look, kept between runs of the app', () => {
        it('is made two minutes after the app opens when none is known', async () => {
            const { lastCheck } = lastCheckAt(() => {
                return null;
            });
            const context = scheduled({ lastCheck });
            context.checker.start();

            await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS - 1);
            expect(context.search).not.toHaveBeenCalled();
            await vi.advanceTimersByTimeAsync(1);

            expect(context.search).toHaveBeenCalledTimes(1);
            context.checker.stop();
        });

        it('waits for what is left of the interval when the last look was made 2 hours ago', async () => {
            const { lastCheck } = lastCheckAt(() => {
                return Date.now() - 2 * HOUR;
            });
            const context = scheduled({ lastCheck });
            context.checker.start();

            await vi.advanceTimersByTimeAsync(4 * HOUR - 1);
            expect(context.search).not.toHaveBeenCalled();
            await vi.advanceTimersByTimeAsync(1);

            expect(context.search).toHaveBeenCalledTimes(1);
            context.checker.stop();
        });

        it('is made two minutes after the app opens when the last look was made 6 hours ago or more', async () => {
            const { lastCheck } = lastCheckAt(() => {
                return Date.now() - 7 * HOUR;
            });
            const context = scheduled({ lastCheck });
            context.checker.start();

            await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS);

            expect(context.search).toHaveBeenCalledTimes(1);
            context.checker.stop();
        });

        it('does not come sooner than two minutes after the app opens, even when the interval ends sooner', async () => {
            const { lastCheck } = lastCheckAt(() => {
                return Date.now() - CHECK_INTERVAL_MS + 30_000;
            });
            const context = scheduled({ lastCheck });
            context.checker.start();

            await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS - 1);
            expect(context.search).not.toHaveBeenCalled();
            await vi.advanceTimersByTimeAsync(1);

            expect(context.search).toHaveBeenCalledTimes(1);
            context.checker.stop();
        });

        it.each([
            ['in the future (the clock went back)', () => {
                return Date.now() + 5 * HOUR;
            }],
            ['not a number', () => {
                return Number.NaN;
            }],
            ['infinite', () => {
                return Number.POSITIVE_INFINITY;
            }]
        ])('is ignored when the time kept is %s', async (_label, read) => {
            const { lastCheck } = lastCheckAt(read);
            const context = scheduled({ lastCheck });
            context.checker.start();

            await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS);

            expect(context.search).toHaveBeenCalledTimes(1);
            context.checker.stop();
        });

        it('counts from the interval it was given', async () => {
            const { lastCheck } = lastCheckAt(() => {
                return Date.now() - 100;
            });
            const context = scheduled({ lastCheck, firstDelayMs: 50, intervalMs: 200 });
            context.checker.start();

            await vi.advanceTimersByTimeAsync(99);
            expect(context.search).not.toHaveBeenCalled();
            await vi.advanceTimersByTimeAsync(1);

            expect(context.search).toHaveBeenCalledTimes(1);
            context.checker.stop();
        });

        it('is kept when a look got answers: the time it ended', async () => {
            const { lastCheck, written } = lastCheckAt(() => {
                return null;
            });
            const context = scheduled({ lastCheck });
            const before = Date.now();

            await context.checker.checkNow('auto');

            expect(written).toEqual([before]);
        });

        it('is kept when only some of the anime answered', async () => {
            const { lastCheck, written } = lastCheckAt(() => {
                return null;
            });
            const context = scheduled({ lastCheck });
            readOnce(context, 'Bleach', 'bleach', 2, ['1'], ['1']);
            context.search.mockImplementation(async (query) => {
                return query === 'naruto' ? failed<AnimeSearchResult[]>(NETWORK) : done([{ index: 2, title: 'Bleach' }]);
            });

            await context.checker.checkNow('auto');

            expect(written).toHaveLength(1);
        });

        it.each([
            [
                'no anime answered',
                () => {
                    return failed<AnimeSearchResult[]>(NETWORK);
                }
            ],
            [
                'the source refused',
                () => {
                    return failed<AnimeSearchResult[]>(BLOCKED);
                }
            ]
        ])('is not kept when %s, so the look is tried again sooner', async (_label, answer) => {
            const { lastCheck, written } = lastCheckAt(() => {
                return null;
            });
            const context = scheduled({ lastCheck });
            context.search.mockResolvedValue(answer());

            await context.checker.checkNow('auto');

            expect(written).toEqual([]);
        });

        it('is not kept for a look the user asked for, for a library with no anime or for a check that is off', async () => {
            const { lastCheck, written } = lastCheckAt(() => {
                return null;
            });
            const empty = setup({ lastCheck });
            await empty.checker.checkNow('auto');
            const context = scheduled({ lastCheck });
            await context.checker.checkNow('manual');
            context.flags.enabled = false;
            await context.checker.checkNow('auto');

            expect(written).toEqual([]);
        });

        it('is not kept when the checker is stopped in the middle of the look', async () => {
            const { lastCheck, written } = lastCheckAt(() => {
                return null;
            });
            const context = scheduled({ lastCheck });
            context.search.mockImplementation(async () => {
                context.checker.stop();
                return done([{ index: 1, title: 'Naruto' }]);
            });

            await context.checker.checkNow('auto');

            expect(written).toEqual([]);
        });

        it('makes the next look 6 hours after the one that was kept', async () => {
            const { lastCheck, written } = lastCheckAt(() => {
                return null;
            });
            const context = scheduled({ lastCheck });
            context.checker.start();
            await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS);
            expect(written).toHaveLength(1);

            await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS - 1);
            expect(context.search).toHaveBeenCalledTimes(1);
            await vi.advanceTimersByTimeAsync(1);

            expect(context.search).toHaveBeenCalledTimes(2);
            expect(written).toHaveLength(2);
            context.checker.stop();
        });
    });

    describe('when the source cannot be reached', () => {
        it('waits the interval while nothing has failed', () => {
            expect(scheduled().checker.nextDelayMs()).toBe(CHECK_INTERVAL_MS);
        });

        it('tries again after an hour, then after twice as long each time, up to six hours', async () => {
            const context = scheduled();
            context.search.mockResolvedValue(failed(NETWORK));
            const waits: number[] = [];

            for (let check = 0; check < 5; check += 1) {
                await context.checker.checkNow('auto');
                waits.push(context.checker.nextDelayMs());
            }

            expect(waits).toEqual([HOUR, 2 * HOUR, 4 * HOUR, BACKOFF_LIMIT_MS, BACKOFF_LIMIT_MS]);
        });

        it('goes back to the interval at the first check where the source answers', async () => {
            const context = scheduled();
            context.search.mockResolvedValueOnce(failed(NETWORK)).mockResolvedValueOnce(failed(NETWORK));
            await context.checker.checkNow('auto');
            await context.checker.checkNow('auto');
            expect(context.checker.nextDelayMs()).toBe(2 * HOUR);

            await context.checker.checkNow('auto');

            expect(context.checker.nextDelayMs()).toBe(CHECK_INTERVAL_MS);
        });

        it('does not try again sooner when only some of the anime failed', async () => {
            const context = scheduled();
            readOnce(context, 'Bleach', 'bleach', 2, ['1'], ['1']);
            context.search.mockImplementation(async (query) => {
                return query === 'naruto' ? failed<AnimeSearchResult[]>(NETWORK) : done([{ index: 2, title: 'Bleach' }]);
            });

            await context.checker.checkNow('auto');

            expect(context.checker.nextDelayMs()).toBe(CHECK_INTERVAL_MS);
        });

        it('tries again sooner when the source refused, even if it had answered for some', async () => {
            const context = scheduled();
            readOnce(context, 'Bleach', 'bleach', 2, ['1'], ['1']);
            context.search.mockImplementation(async (query) => {
                return query === 'naruto' ? failed<AnimeSearchResult[]>(BLOCKED) : done([{ index: 2, title: 'Bleach' }]);
            });

            await context.checker.checkNow('auto');

            expect(context.checker.nextDelayMs()).toBe(HOUR);
        });

        it('does not try again sooner when a check did not ask about anything', async () => {
            const context = setup();

            await context.checker.checkNow('auto');

            expect(context.checker.nextDelayMs()).toBe(CHECK_INTERVAL_MS);
        });

        it('makes the retry an hour after the look that failed, with the timers', async () => {
            const context = scheduled();
            context.search.mockResolvedValue(failed(NETWORK));
            context.checker.start();

            await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS);
            expect(context.search).toHaveBeenCalledTimes(1);
            await vi.advanceTimersByTimeAsync(HOUR - 1);
            expect(context.search).toHaveBeenCalledTimes(1);
            await vi.advanceTimersByTimeAsync(1);

            expect(context.search).toHaveBeenCalledTimes(2);
            context.checker.stop();
        });

        it('never waits longer than the interval, also for a retry', async () => {
            const context = scheduled({ intervalMs: 30 * 60 * 1000 });
            context.search.mockResolvedValue(failed(NETWORK));

            await context.checker.checkNow('auto');

            expect(context.checker.nextDelayMs()).toBe(30 * 60 * 1000);
        });

        it('waits the time it is given for the first retry, and twice as long for the next one', async () => {
            const context = scheduled({ intervalMs: 1000, retryMs: 100 });
            context.search.mockResolvedValue(failed(NETWORK));

            await context.checker.checkNow('auto');
            expect(context.checker.nextDelayMs()).toBe(100);
            await context.checker.checkNow('auto');

            expect(context.checker.nextDelayMs()).toBe(200);
        });

        it('keeps the interval as the limit when it is longer than the limit of the retries', () => {
            const context = scheduled({ intervalMs: BACKOFF_LIMIT_MS * 2 });

            expect(context.checker.nextDelayMs()).toBe(BACKOFF_LIMIT_MS * 2);
        });
    });
});

describe('AnimeUpdateChecker progress', () => {
    const IDLE = { running: false, origin: null, done: 0, total: 0, current: null };

    function withProgress() {
        const onProgress = vi.fn<(state: AnimeCheckState) => void>();
        const context = setup({ onProgress });
        return { context, onProgress };
    }

    it('is idle until a check begins', () => {
        const { context, onProgress } = withProgress();

        expect(context.checker.state()).toEqual(IDLE);
        expect(context.checker.state()).toBe(IDLE_CHECK_STATE);
        expect(onProgress).not.toHaveBeenCalled();
    });

    it('tells when the check begins, each time it moves on to another anime, with the title of the one it asks about, and when it ends', async () => {
        const { context, onProgress } = withProgress();
        readOnce(context, 'Bleach', 'bleach', 2, ['1'], ['1']);
        readOnce(context, 'Gintama', 'gintama', 3, ['1'], ['1']);
        readOnce(context, 'Naruto', 'naruto', 1, ['1'], ['1']);

        await context.checker.checkNow('auto');

        expect(onProgress.mock.calls).toEqual([
            [{ running: true, origin: 'auto', done: 0, total: 3, current: 'Bleach' }],
            [{ running: true, origin: 'auto', done: 1, total: 3, current: 'Gintama' }],
            [{ running: true, origin: 'auto', done: 2, total: 3, current: 'Naruto' }],
            [IDLE]
        ]);
        expect(context.checker.state()).toEqual(IDLE);
    });

    it('says the check was asked for by the user when it was', async () => {
        const { context, onProgress } = withProgress();
        context.flags.enabled = false;
        readOnce(context, 'Naruto', 'naruto', 1, ['1'], ['1']);

        await context.checker.checkNow('manual');

        expect(onProgress.mock.calls).toEqual([[{ running: true, origin: 'manual', done: 0, total: 1, current: 'Naruto' }], [IDLE]]);
    });

    it('gives the state of the check that is going on, to who asks meanwhile', async () => {
        const { context } = withProgress();
        readOnce(context, 'Bleach', 'bleach', 2, ['1'], ['1']);
        readOnce(context, 'Naruto', 'naruto', 1, ['1'], ['1']);
        const seen: AnimeCheckState[] = [];
        context.search.mockImplementation(async (query) => {
            seen.push(context.checker.state());
            return done([{ index: query === 'bleach' ? 2 : 1, title: query }]);
        });

        await context.checker.checkNow('auto');

        expect(seen).toEqual([
            { running: true, origin: 'auto', done: 0, total: 2, current: 'Bleach' },
            { running: true, origin: 'auto', done: 1, total: 2, current: 'Naruto' }
        ]);
    });

    it('moves on to the next anime whether the one before failed, was skipped or was read', async () => {
        const { context, onProgress } = withProgress();
        context.addAnime('Gintama', 'gintama', 3);
        context.addAnime('Naruto', 'naruto', 1);
        readOnce(context, 'Bleach', 'bleach', 2, ['1'], ['1']);
        context.search.mockImplementation(async (query) => {
            if (query === 'gintama') {
                return failed<AnimeSearchResult[]>(NETWORK);
            }
            return query === 'naruto' ? failed<AnimeSearchResult[]>(NO_RESULTS) : done([{ index: 2, title: 'Bleach' }]);
        });

        await context.checker.checkNow('auto');

        expect(
            onProgress.mock.calls.map(([state]) => {
                return [state.done, state.current];
            })
        ).toEqual([
            [0, 'Bleach'],
            [1, 'Gintama'],
            [2, 'Naruto'],
            [0, null]
        ]);
    });

    it('ends when the source refuses, and does not name the anime that were not asked about', async () => {
        const { context, onProgress } = withProgress();
        readOnce(context, 'Bleach', 'bleach', 2, ['1'], ['1']);
        readOnce(context, 'Gintama', 'gintama', 3, ['1'], ['1']);
        readOnce(context, 'Naruto', 'naruto', 1, ['1'], ['1']);
        context.search.mockResolvedValue(failed(BLOCKED));

        await context.checker.checkNow('auto');

        expect(onProgress.mock.calls).toEqual([[{ running: true, origin: 'auto', done: 0, total: 3, current: 'Bleach' }], [IDLE]]);
    });

    it('ends when the checker is stopped in the middle of the check', async () => {
        const { context, onProgress } = withProgress();
        readOnce(context, 'Bleach', 'bleach', 2, ['1'], ['1']);
        readOnce(context, 'Naruto', 'naruto', 1, ['1'], ['1']);
        context.search.mockImplementation(async () => {
            context.checker.stop();
            return done([{ index: 2, title: 'Bleach' }]);
        });

        await context.checker.checkNow('auto');

        expect(onProgress.mock.calls.at(-1)).toEqual([IDLE]);
        expect(context.checker.state()).toEqual(IDLE);
    });

    it('ends when the way of waiting between two anime fails, and the failure goes on to who asked', async () => {
        const { context, onProgress } = withProgress();
        readOnce(context, 'Bleach', 'bleach', 2, ['1'], ['1']);
        readOnce(context, 'Naruto', 'naruto', 1, ['1'], ['1']);
        context.sleep.mockRejectedValue(new Error('timer failed'));

        await expect(context.checker.checkNow('auto')).rejects.toThrow('timer failed');

        expect(onProgress.mock.calls.at(-1)).toEqual([IDLE]);
        expect(context.checker.state()).toEqual(IDLE);
    });

    it('tells nothing when the hourly check is off, or when the library is empty', async () => {
        const { context, onProgress } = withProgress();
        await context.checker.checkNow('auto');
        readOnce(context, 'Naruto', 'naruto', 1, ['1'], ['1']);
        context.flags.enabled = false;
        await context.checker.checkNow('auto');

        expect(onProgress).not.toHaveBeenCalled();
        expect(context.checker.state()).toEqual(IDLE);
    });

    it('tells nothing for the check of a single anime', async () => {
        const { context, onProgress } = withProgress();
        const id = readOnce(context, 'Naruto', 'naruto', 1, ['1'], ['1']);

        await context.checker.checkAnime(id);

        expect(onProgress).not.toHaveBeenCalled();
    });

    it('does not need anyone to listen', async () => {
        const context = setup({ onProgress: undefined });
        readOnce(context, 'Naruto', 'naruto', 1, ['1'], ['1']);

        await expect(context.checker.checkNow('auto')).resolves.toMatchObject({ ok: true });
        expect(context.checker.state()).toEqual(IDLE);
    });

    it('does not start a second check while one is going on: who asks meanwhile gets the same answer and no new state', async () => {
        const { context, onProgress } = withProgress();
        readOnce(context, 'Naruto', 'naruto', 1, ['1'], ['1']);

        const first = context.checker.checkNow('auto');
        const second = context.checker.checkNow('manual');
        await Promise.all([first, second]);

        expect(onProgress.mock.calls).toEqual([[{ running: true, origin: 'auto', done: 0, total: 1, current: 'Naruto' }], [IDLE]]);
    });
});

describe('AnimeUpdateChecker a check that takes longer than the interval', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    // A look whose first search waits until the test lets it go.
    function slow() {
        const context = setup();
        readOnce(context, 'Naruto', 'naruto', 1, ['1'], ['1']);
        let release: () => void = () => {
            return undefined;
        };
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        let first = true;
        context.search.mockImplementation(async () => {
            if (first) {
                first = false;
                await gate;
            }
            return done([{ index: 1, title: 'Naruto' }]);
        });
        return { context, release };
    }

    it('does not start another check over it when the hour passes, not even several hours later', async () => {
        const { context, release } = slow();
        context.checker.start();
        await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS);
        expect(context.search).toHaveBeenCalledTimes(1);
        expect(context.checker.state().running).toBe(true);

        await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS * 3);

        expect(context.search).toHaveBeenCalledTimes(1);
        expect(context.checker.state().running).toBe(true);
        release();
        await vi.advanceTimersByTimeAsync(0);
        context.checker.stop();
    });

    it('answers a check asked for meanwhile with the one that is going on', async () => {
        const { context, release } = slow();
        const first = context.checker.checkNow('auto');
        await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS * 2);

        const second = context.checker.checkNow('manual');
        release();
        const answers = await Promise.all([first, second]);

        expect(answers[0]).toBe(answers[1]);
        expect(context.search).toHaveBeenCalledTimes(1);
    });

    it('waits the whole interval after the long check ends before the next one, counted from its end', async () => {
        const { context, release } = slow();
        context.checker.start();
        await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS + CHECK_INTERVAL_MS * 2);
        expect(context.search).toHaveBeenCalledTimes(1);

        release();
        await vi.advanceTimersByTimeAsync(0);
        expect(context.checker.state().running).toBe(false);
        await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS - 1);
        expect(context.search).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);

        expect(context.search).toHaveBeenCalledTimes(2);
        context.checker.stop();
    });
});
