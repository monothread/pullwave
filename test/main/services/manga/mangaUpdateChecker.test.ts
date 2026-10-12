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

        await expect(context.checker.checkNow()).resolves.toEqual({ ok: true, count: 3, titles: ['Bleach', 'One Piece'], failed: 0 });

        expect(context.db.chaptersOf(one).map((item) => {return [item.remoteId, item.status]}).sort()).toEqual([[1, 'idle'], [2, 'idle'], [3, 'idle']]);
        expect(context.db.chaptersOf(bleach)).toHaveLength(3);
        expect(context.news).toEqual([{ count: 3, titles: ['Bleach', 'One Piece'] }]);
        expect(context.changes.count).toBe(1);
        expect(context.fetched).toEqual([8, 9, 7]);
    });

    it('gives the chapters it adds a time of arrival, and the ones the manga came with none', async () => {
        const context = setup();
        const id = addManga(context, 7, 'One Piece', [1, 2]);
        context.answers.set(7, { details: details(7), chapters: [chapter(1), chapter(2), chapter(3)] });
        await context.checker.checkNow();
        const byRemote = new Map(
            context.db.chaptersOf(id).map((item) => {
                return [item.remoteId, item.addedAt];
            })
        );
        expect(byRemote.get(1)).toBeNull();
        expect(byRemote.get(2)).toBeNull();
        expect(byRemote.get(3)).toBe(1);
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
        await expect(context.checker.checkNow()).resolves.toEqual({ ok: true, count: 0, titles: [], failed: 0 });
        expect(context.news).toEqual([]);
    });

    it('skips a manga that cannot be reached, and goes on with the others', async () => {
        const context = setup();
        addManga(context, 7, 'One Piece', [1]);
        const bleach = addManga(context, 8, 'Bleach', [1]);
        context.answers.set(7, new Error('offline'));
        context.answers.set(8, { details: details(8), chapters: [chapter(1), chapter(2)] });
        await expect(context.checker.checkNow()).resolves.toEqual({ ok: true, count: 1, titles: ['Bleach'], failed: 1 });
        expect(context.db.chaptersOf(bleach)).toHaveLength(2);
    });

    it('checks nothing by itself while it is turned off', async () => {
        const context = setup();
        addManga(context, 7, 'One Piece', [1]);
        context.enabled.value = false;
        await expect(context.checker.checkNow()).resolves.toEqual({ ok: true, count: 0, titles: [], failed: 0 });
        await expect(context.checker.checkNow('auto')).resolves.toEqual({ ok: true, count: 0, titles: [], failed: 0 });
        expect(context.fetched).toEqual([]);
    });

    it('checks when the user asks for it, whatever the setting says', async () => {
        const context = setup();
        const id = addManga(context, 7, 'One Piece', [1]);
        context.enabled.value = false;
        context.answers.set(7, { details: details(7), chapters: [chapter(1), chapter(2)] });
        await expect(context.checker.checkNow('manual')).resolves.toEqual({ ok: true, count: 1, titles: ['One Piece'], failed: 0 });
        expect(context.fetched).toEqual([7]);
        expect(context.db.chaptersOf(id)).toHaveLength(2);
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

describe('MangaUpdateChecker the history of new chapters', () => {
    it('writes what the check every hour finds as automatic, and what the user asks for as manual', async () => {
        const context = setup();
        addManga(context, 7, 'One Piece', [1]);
        addManga(context, 8, 'Bleach', [1]);
        context.answers.set(7, { details: details(7), chapters: [chapter(1), chapter(2)] });
        context.answers.set(8, { details: details(8), chapters: [chapter(1), chapter(2)] });
        await context.checker.checkNow();
        context.answers.set(7, { details: details(7), chapters: [chapter(1), chapter(2), chapter(3)] });
        await context.checker.checkNow('manual');
        expect(
            context.db.updates().map((entry) => {
                return [entry.mangaTitle, entry.chapterRemoteId, entry.origin];
            })
        ).toEqual([
            ['One Piece', 3, 'manual'],
            ['One Piece', 2, 'auto'],
            ['Bleach', 2, 'auto']
        ]);
    });

    it('writes nothing when nothing is new', async () => {
        const context = setup();
        addManga(context, 7, 'One Piece', [1]);
        context.answers.set(7, { details: details(7), chapters: [chapter(1)] });
        await context.checker.checkNow();
        expect(context.db.updates()).toEqual([]);
    });
});

describe('MangaUpdateChecker one manga', () => {
    it('checks only that manga, says what it found, and writes it as manual', async () => {
        const context = setup();
        const one = addManga(context, 7, 'One Piece', [1]);
        addManga(context, 8, 'Bleach', [1]);
        context.answers.set(7, { details: details(7), chapters: [chapter(1), chapter(2), chapter(3)] });
        await expect(context.checker.checkManga(one)).resolves.toEqual({ ok: true, count: 2, titles: ['One Piece'], failed: 0 });
        expect(context.fetched).toEqual([7]);
        expect(context.news).toEqual([{ count: 2, titles: ['One Piece'] }]);
        expect(context.changes.count).toBe(1);
        expect(
            context.db.updates().map((entry) => {
                return [entry.chapterRemoteId, entry.origin];
            })
        ).toEqual([
            [3, 'manual'],
            [2, 'manual']
        ]);
    });

    it('says nothing when the manga has nothing new, and keeps what the source says about it', async () => {
        const context = setup();
        const one = addManga(context, 7, 'One Piece', [1]);
        context.answers.set(7, { details: details(7, { author: 'Eiichiro Oda' }), chapters: [chapter(1)] });
        await expect(context.checker.checkManga(one)).resolves.toEqual({ ok: true, count: 0, titles: [], failed: 0 });
        expect(context.news).toEqual([]);
        expect(context.changes.count).toBe(0);
        expect(context.db.getManga(one)).toMatchObject({ author: 'Eiichiro Oda' });
    });

    it('says why when the source cannot be reached, and when the manga is not in the library', async () => {
        const context = setup();
        const one = addManga(context, 7, 'One Piece', [1]);
        context.answers.set(7, new Error('Cloudflare protection is on'));
        await expect(context.checker.checkManga(one)).resolves.toEqual({ ok: false, error: { code: 'UNKNOWN', message: 'Cloudflare protection is on' } });
        await expect(context.checker.checkManga(999)).resolves.toEqual({ ok: false, error: { code: 'NOT_FOUND', message: 'The manga is not in the library.' } });
        expect(context.news).toEqual([]);
    });

    it('checks it even when the check every hour is turned off', async () => {
        const context = setup();
        const one = addManga(context, 7, 'One Piece', [1]);
        context.enabled.value = false;
        context.answers.set(7, { details: details(7), chapters: [chapter(1), chapter(2)] });
        await expect(context.checker.checkManga(one)).resolves.toMatchObject({ ok: true, count: 1 });
    });
});

describe('MangaUpdateChecker downloading what it finds', () => {
    function withDownloads(autoDownload: boolean) {
        const context = setup();
        const downloads: Array<[number, number[]]> = [];
        const checker = new MangaUpdateChecker({
            db: context.db,
            fetchManga: (remoteId) => {
                context.fetched.push(remoteId);
                const answer = context.answers.get(remoteId);
                return answer === undefined || answer instanceof Error ? Promise.reject(new Error('offline')) : Promise.resolve(answer);
            },
            isEnabled: () => {
                return true;
            },
            autoDownload: () => {
                return autoDownload;
            },
            download: (mangaId, chapterRemoteIds) => {
                downloads.push([mangaId, chapterRemoteIds]);
            },
            onNewChapters: () => {
                return undefined;
            },
            onLibraryChanged: () => {
                return undefined;
            }
        });
        return { context, checker, downloads };
    }

    it('queues the new chapters of each manga when the user wants them downloaded', async () => {
        const { context, checker, downloads } = withDownloads(true);
        const one = addManga(context, 7, 'One Piece', [1]);
        const bleach = addManga(context, 8, 'Bleach', [1]);
        addManga(context, 9, 'Naruto', [1]);
        context.answers.set(7, { details: details(7), chapters: [chapter(1), chapter(2), chapter(3)] });
        context.answers.set(8, { details: details(8), chapters: [chapter(1), chapter(2)] });
        context.answers.set(9, { details: details(9), chapters: [chapter(1)] });
        await checker.checkNow();
        expect(downloads).toEqual([
            [bleach, [2]],
            [one, [2, 3]]
        ]);
    });

    it('does the same for the check the user asks for, of all the mangas or of one', async () => {
        const { context, checker, downloads } = withDownloads(true);
        const one = addManga(context, 7, 'One Piece', [1]);
        context.answers.set(7, { details: details(7), chapters: [chapter(1), chapter(2)] });
        await checker.checkManga(one);
        expect(downloads).toEqual([[one, [2]]]);
        context.answers.set(7, { details: details(7), chapters: [chapter(1), chapter(2), chapter(3)] });
        await checker.checkNow('manual');
        expect(downloads).toEqual([
            [one, [2]],
            [one, [3]]
        ]);
    });

    it('only adds them to the library when the user does not want them downloaded', async () => {
        const { context, checker, downloads } = withDownloads(false);
        const one = addManga(context, 7, 'One Piece', [1]);
        context.answers.set(7, { details: details(7), chapters: [chapter(1), chapter(2)] });
        await checker.checkNow();
        expect(downloads).toEqual([]);
        expect(context.db.chaptersOf(one)).toHaveLength(2);
    });

    it('does not queue anything when nothing is new, or the manga cannot be reached', async () => {
        const { context, checker, downloads } = withDownloads(true);
        addManga(context, 7, 'One Piece', [1]);
        addManga(context, 8, 'Bleach', [1]);
        context.answers.set(7, { details: details(7), chapters: [chapter(1)] });
        await checker.checkNow();
        expect(downloads).toEqual([]);
    });

    it('works with no way to queue, which is what the check has when it is only given the database', async () => {
        const context = setup();
        const one = addManga(context, 7, 'One Piece', [1]);
        context.answers.set(7, { details: details(7), chapters: [chapter(1), chapter(2)] });
        await expect(context.checker.checkNow()).resolves.toMatchObject({ ok: true, count: 1 });
        expect(context.db.chaptersOf(one)).toHaveLength(2);
    });
});
