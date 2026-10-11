import type { MangaChapter, MangaDetails, MangaNewChapters } from '@shared/manga';
import { MangaDb } from '@main/services/manga/mangaDb';
import { CHECK_INTERVAL_MS, FIRST_CHECK_DELAY_MS, MangaUpdateChecker, newChaptersOf } from '@main/services/manga/mangaUpdateChecker';

function chapter(remoteId: number, overrides: Partial<MangaChapter> = {}): MangaChapter {
    return { remoteId, name: `Chapter ${remoteId}`, number: remoteId, dateUploaded: null, scanlator: null, sourceOrder: remoteId, ...overrides };
}

function details(remoteId: number, overrides: Partial<MangaDetails> = {}): MangaDetails {
    return { remoteId, sourceId: 's', title: 'x', thumbnailUrl: null, url: `https://dex.example/${remoteId}`, author: 'Oda', artist: null, description: null, genres: ['Action'], status: 'ongoing', ...overrides };
}

interface Setup {
    db: MangaDb;
    checker: MangaUpdateChecker;
    news: MangaNewChapters[];
    changes: { count: number };
    fetched: number[];
    answers: Map<number, { details: MangaDetails; chapters: MangaChapter[] } | Error>;
    enabled: { value: boolean };
}

function setup(): Setup {
    const db = new MangaDb(':memory:', () => {return 1});
    const news: MangaNewChapters[] = [];
    const changes = { count: 0 };
    const fetched: number[] = [];
    const answers = new Map<number, { details: MangaDetails; chapters: MangaChapter[] } | Error>();
    const enabled = { value: true };
    const checker = new MangaUpdateChecker({
        db,
        fetchManga: (remoteId) => {
            fetched.push(remoteId);
            const answer = answers.get(remoteId);
            if (answer === undefined || answer instanceof Error) {
                return Promise.reject(answer ?? new Error('not reachable'));
            }
            return Promise.resolve(answer);
        },
        isEnabled: () => {
            return enabled.value;
        },
        onNewChapters: (found) => {
            news.push(found);
        },
        onLibraryChanged: () => {
            changes.count += 1;
        }
    });
    return { db, checker, news, changes, fetched, answers, enabled };
}

function addManga(context: Setup, remoteId: number, title: string, chapters: number[]): number {
    const manga = context.db.upsertManga({ remoteId, sourceId: 's', title, thumbnailUrl: null });
    context.db.registerChapters(manga.id, chapters.map((id) => {return chapter(id)}));
    return manga.id;
}

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('newChaptersOf', () => {
    it('gives the chapters of the source that the manga of the library does not have', () => {
        const manga = { chapters: [{ remoteId: 1 }, { remoteId: 2 }] } as Parameters<typeof newChaptersOf>[0];
        expect(newChaptersOf(manga, [chapter(1), chapter(2), chapter(3), chapter(4)])).toEqual([chapter(3), chapter(4)]);
        expect(newChaptersOf(manga, [chapter(1)])).toEqual([]);
        expect(newChaptersOf(manga, [])).toEqual([]);
        expect(newChaptersOf({ chapters: [] }, [chapter(1)])).toEqual([chapter(1)]);
    });
});

describe('MangaUpdateChecker', () => {
    it('registers the new chapters of each manga in the library, without downloading them, and tells how many and in which mangas', async () => {
        const context = setup();
        const one = addManga(context, 7, 'One Piece', [1, 2]);
        const bleach = addManga(context, 8, 'Bleach', [1]);
        addManga(context, 9, 'Naruto', [1]);
        context.answers.set(7, { details: details(7), chapters: [chapter(1), chapter(2), chapter(3)] });
        context.answers.set(8, { details: details(8), chapters: [chapter(1), chapter(2), chapter(3)] });
        context.answers.set(9, { details: details(9), chapters: [chapter(1)] });

        await expect(context.checker.checkNow()).resolves.toEqual({ count: 3, titles: ['Bleach', 'One Piece'] });

        expect(context.db.chaptersOf(one).map((item) => {return [item.remoteId, item.status]}).sort()).toEqual([[1, 'idle'], [2, 'idle'], [3, 'idle']]);
        expect(context.db.chaptersOf(bleach)).toHaveLength(3);
        expect(context.news).toEqual([{ count: 3, titles: ['Bleach', 'One Piece'] }]);
        expect(context.changes.count).toBe(1);
        expect(context.fetched).toEqual([8, 9, 7]);
    });

    it('keeps the state of the chapters it already has', async () => {
        const context = setup();
        const id = addManga(context, 7, 'One Piece', [1]);
        const first = context.db.chaptersOf(id)[0]!;
        context.db.markDone(first.id, '/m/a.cbz', 10, 3);
        context.answers.set(7, { details: details(7), chapters: [chapter(1), chapter(2)] });
        await context.checker.checkNow();
        expect(context.db.getChapter(first.id)).toMatchObject({ status: 'done', filePath: '/m/a.cbz' });
        expect(context.db.chaptersOf(id)).toHaveLength(2);
    });

    it('keeps what the source says about the manga up to date, including its page on the site', async () => {
        const context = setup();
        const id = addManga(context, 7, 'One Piece', [1]);
        context.answers.set(7, { details: details(7, { url: 'https://dex.example/one-piece', author: 'Eiichiro Oda', genres: ['Action', 'Adventure'], status: 'completed' }), chapters: [chapter(1)] });
        await context.checker.checkNow();
        expect(context.db.getManga(id)).toMatchObject({ url: 'https://dex.example/one-piece', author: 'Eiichiro Oda', genres: ['Action', 'Adventure'], status: 'completed' });
        expect(context.news).toEqual([]);
        expect(context.changes.count).toBe(0);
    });

    it('says nothing when there is nothing new', async () => {
        const context = setup();
        addManga(context, 7, 'One Piece', [1, 2]);
        context.answers.set(7, { details: details(7), chapters: [chapter(1), chapter(2)] });
        await expect(context.checker.checkNow()).resolves.toEqual({ count: 0, titles: [] });
        expect(context.news).toEqual([]);
    });

    it('skips a manga that cannot be reached, and goes on with the others', async () => {
        const context = setup();
        addManga(context, 7, 'One Piece', [1]);
        const bleach = addManga(context, 8, 'Bleach', [1]);
        context.answers.set(7, new Error('offline'));
        context.answers.set(8, { details: details(8), chapters: [chapter(1), chapter(2)] });
        await expect(context.checker.checkNow()).resolves.toEqual({ count: 1, titles: ['Bleach'] });
        expect(context.db.chaptersOf(bleach)).toHaveLength(2);
    });

    it('checks nothing while it is turned off', async () => {
        const context = setup();
        addManga(context, 7, 'One Piece', [1]);
        context.enabled.value = false;
        await expect(context.checker.checkNow()).resolves.toEqual({ count: 0, titles: [] });
        expect(context.fetched).toEqual([]);
    });

    it('does not start a check while one is going on', async () => {
        const context = setup();
        addManga(context, 7, 'One Piece', [1]);
        let release: () => void = () => {return undefined};
        const checker = new MangaUpdateChecker({
            db: context.db,
            fetchManga: () => {
                return new Promise((resolve) => {
                    release = () => {
                        resolve({ details: details(7), chapters: [chapter(1), chapter(2)] });
                    };
                });
            },
            isEnabled: () => {return true},
            onNewChapters: (found) => {
                context.news.push(found);
            },
            onLibraryChanged: () => {return undefined}
        });
        const first = checker.checkNow();
        const second = checker.checkNow();
        expect(second).toBe(first);
        release();
        await first;
        expect(context.news).toHaveLength(1);
        // Once it is over a new one can start.
        const third = checker.checkNow();
        expect(third).not.toBe(first);
        release();
        await third;
    });

    describe('the timer', () => {
        it('checks soon after it starts and then once an hour, never twice at the same time', async () => {
            const context = setup();
            addManga(context, 7, 'One Piece', [1]);
            context.answers.set(7, { details: details(7), chapters: [chapter(1)] });
            context.checker.start();
            context.checker.start();
            expect(context.fetched).toEqual([]);
            await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS);
            expect(context.fetched).toEqual([7]);
            await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS - FIRST_CHECK_DELAY_MS);
            expect(context.fetched).toEqual([7, 7]);
            await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);
            expect(context.fetched).toEqual([7, 7, 7]);
            context.checker.stop();
        });

        it('uses the times it is given instead of the usual ones', async () => {
            const context = setup();
            addManga(context, 7, 'One Piece', [1]);
            context.answers.set(7, { details: details(7), chapters: [chapter(1)] });
            const checker = new MangaUpdateChecker({
                db: context.db,
                fetchManga: (remoteId) => {
                    context.fetched.push(remoteId);
                    return Promise.resolve({ details: details(remoteId), chapters: [chapter(1)] });
                },
                isEnabled: () => {return true},
                onNewChapters: () => {return undefined},
                onLibraryChanged: () => {return undefined},
                firstDelayMs: 50,
                intervalMs: 200
            });
            checker.start();
            await vi.advanceTimersByTimeAsync(49);
            expect(context.fetched).toEqual([]);
            await vi.advanceTimersByTimeAsync(1);
            expect(context.fetched).toEqual([7]);
            await vi.advanceTimersByTimeAsync(150);
            expect(context.fetched).toEqual([7, 7]);
            await vi.advanceTimersByTimeAsync(200);
            expect(context.fetched).toEqual([7, 7, 7]);
            checker.stop();
        });

        it('is once an hour and soon after the app opens', () => {
            expect(CHECK_INTERVAL_MS).toBe(3_600_000);
            expect(FIRST_CHECK_DELAY_MS).toBe(120_000);
        });

        it('stops checking when it is stopped, and can be started again', async () => {
            const context = setup();
            addManga(context, 7, 'One Piece', [1]);
            context.answers.set(7, { details: details(7), chapters: [chapter(1)] });
            context.checker.start();
            context.checker.stop();
            await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS * 3);
            expect(context.fetched).toEqual([]);
            context.checker.start();
            await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS);
            expect(context.fetched).toEqual([7]);
            context.checker.stop();
        });

        it('leaves the mangas it did not reach yet when it is stopped during a check', async () => {
            const context = setup();
            addManga(context, 7, 'One Piece', [1]);
            addManga(context, 8, 'Bleach', [1]);
            let release: () => void = () => {return undefined};
            const checker = new MangaUpdateChecker({
                db: context.db,
                fetchManga: (remoteId) => {
                    context.fetched.push(remoteId);
                    return new Promise((resolve) => {
                        release = () => {
                            resolve({ details: details(remoteId), chapters: [chapter(1)] });
                        };
                    });
                },
                isEnabled: () => {return true},
                onNewChapters: () => {return undefined},
                onLibraryChanged: () => {return undefined}
            });
            const running = checker.checkNow();
            checker.stop();
            release();
            await running;
            expect(context.fetched).toEqual([8]);
        });

        it('stops without error when it was never started', () => {
            const context = setup();
            expect(() => {
                context.checker.stop();
            }).not.toThrow();
        });
    });
});
