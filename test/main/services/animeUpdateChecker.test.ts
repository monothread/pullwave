import type { AniError, AniRunResult, AnimeAudio, AnimeNewEpisodes, AnimeSearchResult } from '@shared/anime';
import { MAX_AUTO_DOWNLOAD_EPISODES } from '@shared/anime';
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

    it('does nothing by itself until it is started', async () => {
        const context = scheduled();

        await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS * 3);

        expect(context.search).not.toHaveBeenCalled();
    });

    it('makes the first check two minutes after it is started, not before', async () => {
        const context = scheduled();
        context.checker.start();

        await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS - 1);
        expect(context.search).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);

        expect(context.search).toHaveBeenCalledTimes(1);
        context.checker.stop();
    });

    it('checks again every hour after the first check', async () => {
        const context = scheduled();
        context.checker.start();
        await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS);
        expect(context.search).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS - 1);
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

    it('goes on with the timer when the hourly check is turned off, asking about nothing', async () => {
        const context = scheduled();
        context.flags.enabled = false;
        context.checker.start();

        await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS + CHECK_INTERVAL_MS);
        expect(context.search).not.toHaveBeenCalled();
        context.flags.enabled = true;
        await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);

        expect(context.search).toHaveBeenCalledTimes(1);
        context.checker.stop();
    });

    describe('when the source cannot be reached', () => {
        it('waits the usual time while nothing has failed', () => {
            expect(scheduled().checker.nextDelayMs()).toBe(CHECK_INTERVAL_MS);
        });

        it('doubles the wait for each check in a row where no anime could be asked about, up to a limit', async () => {
            const context = scheduled();
            context.search.mockResolvedValue(failed(NETWORK));
            const waits: number[] = [];

            for (let check = 0; check < 5; check += 1) {
                await context.checker.checkNow('auto');
                waits.push(context.checker.nextDelayMs());
            }

            expect(waits).toEqual([2 * CHECK_INTERVAL_MS, 4 * CHECK_INTERVAL_MS, BACKOFF_LIMIT_MS, BACKOFF_LIMIT_MS, BACKOFF_LIMIT_MS]);
        });

        it('goes back to the usual time at the first check where the source answers', async () => {
            const context = scheduled();
            context.search.mockResolvedValueOnce(failed(NETWORK)).mockResolvedValueOnce(failed(NETWORK));
            await context.checker.checkNow('auto');
            await context.checker.checkNow('auto');
            expect(context.checker.nextDelayMs()).toBe(4 * CHECK_INTERVAL_MS);

            await context.checker.checkNow('auto');

            expect(context.checker.nextDelayMs()).toBe(CHECK_INTERVAL_MS);
        });

        it('does not wait longer when only some of the anime failed', async () => {
            const context = scheduled();
            readOnce(context, 'Bleach', 'bleach', 2, ['1'], ['1']);
            context.search.mockImplementation(async (query) => {
                return query === 'naruto' ? failed<AnimeSearchResult[]>(NETWORK) : done([{ index: 2, title: 'Bleach' }]);
            });

            await context.checker.checkNow('auto');

            expect(context.checker.nextDelayMs()).toBe(CHECK_INTERVAL_MS);
        });

        it('waits longer when the source refused, even if it had answered for some', async () => {
            const context = scheduled();
            readOnce(context, 'Bleach', 'bleach', 2, ['1'], ['1']);
            context.search.mockImplementation(async (query) => {
                return query === 'naruto' ? failed<AnimeSearchResult[]>(BLOCKED) : done([{ index: 2, title: 'Bleach' }]);
            });

            await context.checker.checkNow('auto');

            expect(context.checker.nextDelayMs()).toBe(2 * CHECK_INTERVAL_MS);
        });

        it('does not wait longer when a check did not ask about anything', async () => {
            const context = setup();

            await context.checker.checkNow('auto');

            expect(context.checker.nextDelayMs()).toBe(CHECK_INTERVAL_MS);
        });

        it('waits the longer time before the next hourly check, with the timers', async () => {
            const context = scheduled();
            context.search.mockResolvedValue(failed(NETWORK));
            context.checker.start();

            await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS);
            expect(context.search).toHaveBeenCalledTimes(1);
            await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);
            expect(context.search).toHaveBeenCalledTimes(1);
            await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);

            expect(context.search).toHaveBeenCalledTimes(2);
            context.checker.stop();
        });

        it('keeps the usual time as the limit when the interval is longer than the limit', () => {
            const context = scheduled({ intervalMs: BACKOFF_LIMIT_MS * 2 });

            expect(context.checker.nextDelayMs()).toBe(BACKOFF_LIMIT_MS * 2);
        });
    });
});
