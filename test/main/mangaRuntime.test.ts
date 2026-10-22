import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { PassThrough } from 'node:stream';
import { join } from 'node:path';
import { DEFAULT_SETTINGS, IPC } from '@shared/constants';
import type { LibraryManga, MangaCloudflareActivity, MangaJob } from '@shared/manga';
import type { Settings } from '@shared/types';
import type { ToolState } from '@shared/tools';
import { createMangaRuntime, type MangaRuntimeOptions } from '@main/mangaRuntime';
import { MangaDb } from '@main/services/manga/mangaDb';
import { CHECK_INTERVAL_MS, FIRST_CHECK_DELAY_MS } from '@main/services/manga/mangaUpdateChecker';
import { FLARESOLVERR_IMAGE, FLARESOLVERR_VERSION } from '@main/services/tools/flaresolverrDocker';
import { suwayomiSpec } from '@main/services/tools/suwayomiRelease';
import { fakeDocker } from '../helpers/fakeDocker';
import { cleanTempDirs, makeTempDir } from '../helpers/tempDir';
import { readZipEntries } from '../helpers/zipEntries';

const EXTERNAL = 'http://127.0.0.1:45679';
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9]);

type Sent = { channel: string; payload: unknown };

// The pages (by their number) whose address is not on the server of the app while they are in `failing`: the app refuses to fetch
// those, so they fail at once and are not asked for again.
function fakeSuwayomi(failing: ReadonlySet<string> = new Set()): { fetchImpl: typeof fetch; requests: string[] } {
    const requests: string[] = [];
    const fetchImpl = vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        requests.push(url);
        if (url.endsWith('/api/graphql')) {
            const body = JSON.parse(String(init?.body)) as { query: string };
            if (body.query.includes('fetchChapterPages')) {
                const pages = ['0', '1'].map((number) => {
                    return failing.has(number) ? `http://elsewhere.example/page/${number}` : `/api/v1/manga/7/chapter/1/page/${number}`;
                });
                return Promise.resolve(new Response(JSON.stringify({ data: { fetchChapterPages: { pages } } }), { status: 200 }));
            }
            return Promise.resolve(new Response(JSON.stringify({ errors: [{ message: 'not faked' }] }), { status: 200 }));
        }
        const bytes = url.endsWith('/0') ? JPEG : PNG;
        return Promise.resolve(new Response(bytes, { status: 200, headers: { 'content-type': 'image/jpeg' } }));
    }) as unknown as typeof fetch;
    return { fetchImpl, requests };
}

function setup({ failing = new Set<string>(), ...overrides }: Partial<MangaRuntimeOptions> & { settings?: Partial<Settings>; failing?: Set<string> } = {}) {
    const dir = makeTempDir();
    const sent: Sent[] = [];
    const opened: string[] = [];
    const fake = fakeSuwayomi(failing);
    const settings: Settings = { ...DEFAULT_SETTINGS, ...overrides.settings };
    const runtime = createMangaRuntime({
        platform: 'linux',
        arch: 'x64',
        dataDir: join(dir, 'userData'),
        defaultDownloadDir: join(dir, 'Downloads'),
        getSettings: () => {
            return settings;
        },
        send: (channel, payload) => {
            sent.push({ channel, payload });
        },
        openFolder: (path) => {
            opened.push(path);
        },
        externalBaseUrl: EXTERNAL,
        fetchImpl: fake.fetchImpl,
        ...overrides
    });
    return { runtime, dir, sent, opened, settings, requests: fake.requests };
}

async function untilIdle(runtime: NonNullable<ReturnType<typeof createMangaRuntime>>): Promise<void> {
    await vi.waitFor(() => {
        expect(runtime.queue.list()).toEqual([]);
    });
}

afterEach(() => {
    cleanTempDirs();
});

describe('createMangaRuntime availability', () => {
    it('does not exist where there is no program for the system', () => {
        const dir = makeTempDir();
        const options = { dataDir: dir, defaultDownloadDir: dir, getSettings: () => {return DEFAULT_SETTINGS}, send: () => {return undefined}, openFolder: () => {return undefined} };
        expect(createMangaRuntime({ ...options, platform: 'darwin', arch: 'arm64' })).toBeNull();
        expect(createMangaRuntime({ ...options, platform: 'linux', arch: 'arm64' })).toBeNull();
        expect(createMangaRuntime({ ...options, platform: 'win32', arch: 'ia32' })).toBeNull();
        expect(existsSync(join(dir, 'manga'))).toBe(false);
    });

    it('exists on Linux and Windows, 64 bits', () => {
        const dir = makeTempDir();
        const options = { dataDir: dir, defaultDownloadDir: dir, getSettings: () => {return DEFAULT_SETTINGS}, send: () => {return undefined}, openFolder: () => {return undefined} };
        expect(createMangaRuntime({ ...options, platform: 'linux', arch: 'x64' })).not.toBeNull();
        expect(createMangaRuntime({ ...options, dataDir: makeTempDir(), platform: 'win32', arch: 'x64' })).not.toBeNull();
    });

    it('exists anywhere when a server is given', () => {
        const { runtime } = setup({ platform: 'darwin', arch: 'arm64' });
        expect(runtime).not.toBeNull();
        expect(runtime?.service.status()).toEqual({ supported: true, tool: null, helper: null, helperProblem: null, helperExternal: false, server: 'running', serverError: null });
    });

    it('keeps its library in the data folder', () => {
        const { dir } = setup();
        expect(existsSync(join(dir, 'userData', 'manga', 'manga.db'))).toBe(true);
    });

    it('turns what was going on when the app last closed into errors that can be retried', () => {
        const dir = makeTempDir();
        const path = join(dir, 'userData', 'manga', 'manga.db');
        const before = new MangaDb(path);
        const manga = before.upsertManga({ remoteId: 7, sourceId: '123', title: 'One Piece', thumbnailUrl: null });
        const chapter = before.ensureChapter(manga.id, { remoteId: 1, name: 'Chapter 1', number: 1, dateUploaded: null, scanlator: null, sourceOrder: 1 });
        before.markDownloading(chapter.id, join(dir, 'Chapter 1.cbz'));
        before.close();
        const runtime = createMangaRuntime({
            platform: 'linux',
            arch: 'x64',
            dataDir: join(dir, 'userData'),
            defaultDownloadDir: dir,
            getSettings: () => {return DEFAULT_SETTINGS},
            send: () => {return undefined},
            openFolder: () => {return undefined},
            externalBaseUrl: EXTERNAL
        });
        expect(runtime?.db.getChapter(chapter.id)).toMatchObject({ status: 'error', error: { code: 'UNKNOWN' } });
    });

    it('shows again the chapters that were paused, counting the complete pages they kept, and cancels one deleting its pages', () => {
        const dir = makeTempDir();
        const path = join(dir, 'userData', 'manga', 'manga.db');
        const before = new MangaDb(path);
        const manga = before.upsertManga({ remoteId: 7, sourceId: '123', title: 'One Piece', thumbnailUrl: null });
        const kept = before.ensureChapter(manga.id, { remoteId: 1, name: 'Chapter 1', number: 1, dateUploaded: null, scanlator: null, sourceOrder: 1 });
        const lost = before.ensureChapter(manga.id, { remoteId: 2, name: 'Chapter 2', number: 2, dateUploaded: null, scanlator: null, sourceOrder: 2 });
        const outputPath = join(dir, 'Pullwave Manga', 'One Piece', 'Chapter 1.cbz');
        const work = `${outputPath}.part`;
        mkdirSync(work, { recursive: true });
        ['001.jpg', '002.png', '003.tmp', 'ComicInfo.xml'].forEach((file) => {
            writeFileSync(join(work, file), 'x');
        });
        before.markDownloading(kept.id, outputPath);
        before.setPageCount(kept.id, 4);
        before.markPaused(kept.id);
        // Its folder of pages is gone: nothing is counted.
        before.markDownloading(lost.id, join(dir, 'Pullwave Manga', 'One Piece', 'Chapter 2.cbz'));
        before.setPageCount(lost.id, 4);
        before.markPaused(lost.id);
        before.close();
        const runtime = createMangaRuntime({
            platform: 'linux',
            arch: 'x64',
            dataDir: join(dir, 'userData'),
            defaultDownloadDir: dir,
            getSettings: () => {return DEFAULT_SETTINGS},
            send: () => {return undefined},
            openFolder: () => {return undefined},
            externalBaseUrl: EXTERNAL
        });
        expect(runtime?.queue.list()).toEqual([
            { chapterId: kept.id, mangaId: manga.id, mangaTitle: 'One Piece', chapterName: 'Chapter 1', sourceId: '123', status: 'paused', pagesDone: 2, pageCount: 4, percent: 50, error: null, missingPages: 0 },
            { chapterId: lost.id, mangaId: manga.id, mangaTitle: 'One Piece', chapterName: 'Chapter 2', sourceId: '123', status: 'paused', pagesDone: 0, pageCount: 4, percent: 0, error: null, missingPages: 0 }
        ]);
        runtime?.queue.cancel(kept.id);
        expect(existsSync(work)).toBe(false);
        expect(runtime?.db.getChapter(kept.id)?.status).toBe('cancelled');
    });
});

describe('createMangaRuntime downloading the program', () => {
    it('downloads the program when the app opens, then pulls the image of the helper for Cloudflare, and tells how it goes', async () => {
        const spec = suwayomiSpec('linux', 'x64')!;
        const states: ToolState[] = [];
        const dir = makeTempDir();
        const download = vi.fn(() => {
            return Promise.reject(Object.assign(new Error('offline'), { name: 'ToolDownloadError' }));
        });
        const docker = fakeDocker({ imagePresent: false });
        const runtime = createMangaRuntime({
            platform: 'linux',
            arch: 'x64',
            dataDir: dir,
            defaultDownloadDir: dir,
            getSettings: () => {
                return { ...DEFAULT_SETTINGS, mangaFlaresolverrEnabled: true };
            },
            send: (channel, payload) => {
                if (channel === IPC.eventMangaTool) {
                    states.push(payload as ToolState);
                }
            },
            openFolder: () => {
                return undefined;
            },
            toolDependencies: { download },
            helperDependencies: { docker: docker.runner }
        });
        expect(runtime?.service.status()).toMatchObject({
            supported: true,
            tool: { id: 'suwayomi', status: 'missing', version: spec.version },
            helper: { id: 'flaresolverr', status: 'missing', version: FLARESOLVERR_VERSION },
            helperProblem: null,
            helperExternal: false,
            server: 'stopped'
        });
        runtime?.prepare();
        await vi.waitFor(() => {
            expect(states.some((state) => {
                return state.id === 'flaresolverr' && state.status === 'ready';
            })).toBe(true);
        });
        expect(download).toHaveBeenCalledTimes(1);
        expect(states[0]).toMatchObject({ id: 'suwayomi', status: 'downloading', version: spec.version });
        expect(states.find((state) => {
            return state.id === 'suwayomi' && state.status === 'error';
        })).toMatchObject({ error: { code: 'EXTRACT_FAILED', message: 'offline' } });
        expect(docker.calls).toContainEqual(['pull', FLARESOLVERR_IMAGE]);
        expect(states.find((state) => {
            return state.id === 'flaresolverr' && state.status === 'downloading';
        })).toMatchObject({ version: FLARESOLVERR_VERSION });
    });

    it('does not touch Docker when the app opens until the user installs the helper', async () => {
        const dir = makeTempDir();
        const docker = fakeDocker({ imagePresent: false });
        const states: ToolState[] = [];
        const runtime = createMangaRuntime({
            platform: 'linux',
            arch: 'x64',
            dataDir: dir,
            defaultDownloadDir: dir,
            getSettings: () => {
                return DEFAULT_SETTINGS;
            },
            send: (channel, payload) => {
                if (channel === IPC.eventMangaTool) {
                    states.push(payload as ToolState);
                }
            },
            openFolder: () => {
                return undefined;
            },
            toolDependencies: {
                download: () => {
                    return Promise.reject(new Error('offline'));
                }
            },
            helperDependencies: { docker: docker.runner }
        });
        expect(runtime?.service.status().helper).toBeNull();
        runtime?.prepare();
        await vi.waitFor(() => {
            expect(states.some((state) => {
                return state.id === 'suwayomi' && state.status === 'error';
            })).toBe(true);
        });
        expect(docker.calls).toEqual([]);
        await runtime?.service.installHelper();
        expect(docker.calls).toContainEqual(['pull', FLARESOLVERR_IMAGE]);
        await runtime?.service.removeHelper();
        expect(docker.calls.at(-1)).toEqual(['rmi', FLARESOLVERR_IMAGE]);
    });

    it('says on the screen that Docker is missing, and what to do', async () => {
        const dir = makeTempDir();
        const states: ToolState[] = [];
        const runtime = createMangaRuntime({
            platform: 'linux',
            arch: 'x64',
            dataDir: dir,
            defaultDownloadDir: dir,
            getSettings: () => {
                return { ...DEFAULT_SETTINGS, mangaFlaresolverrEnabled: true };
            },
            send: (channel, payload) => {
                if (channel === IPC.eventMangaTool) {
                    states.push(payload as ToolState);
                }
            },
            openFolder: () => {
                return undefined;
            },
            toolDependencies: {
                download: () => {
                    return Promise.reject(new Error('offline'));
                }
            },
            helperDependencies: { docker: fakeDocker({ dockerMissing: true }).runner }
        });
        runtime?.prepare();
        await vi.waitFor(() => {
            expect(runtime?.service.status().helperProblem).toEqual({ code: 'no-docker', message: 'docker: command not found' });
        });
        expect(runtime?.service.status().helper).toMatchObject({ id: 'flaresolverr', status: 'error', error: { code: 'DOCKER_MISSING', message: 'docker: command not found' } });
        expect(states.at(-1)).toMatchObject({ id: 'flaresolverr', status: 'error', error: { code: 'DOCKER_MISSING' } });
    });

    it('downloads nothing when a server is given', async () => {
        const download = vi.fn();
        const { runtime } = setup({ toolDependencies: { download } });
        runtime?.prepare();
        await Promise.resolve();
        expect(download).not.toHaveBeenCalled();
    });
});

describe('createMangaRuntime downloading a chapter', () => {
    const REQUEST = {
        manga: { remoteId: 7, sourceId: '123', title: 'One Piece', thumbnailUrl: '/api/v1/manga/7/thumbnail' },
        details: null,
        chapters: [{ remoteId: 1, name: 'Romance Dawn', number: 1, dateUploaded: null, scanlator: null, sourceOrder: 1 }]
    };

    it('asks the server for the pages, fetches them and makes the CBZ in the downloads folder', async () => {
        const { runtime, dir, sent, requests } = setup();
        const library = runtime!.queue.enqueue(REQUEST) as LibraryManga;
        expect(library.title).toBe('One Piece');
        await untilIdle(runtime!);
        const expected = join(dir, 'Downloads', 'Pullwave Manga', 'One Piece', 'Chapter 1.cbz');
        expect(runtime!.db.chaptersOf(library.id)[0]).toMatchObject({ status: 'done', filePath: expected, pageCount: 2 });
        const entries = readZipEntries(readFileSync(expected));
        expect(entries.map((entry) => {
            return entry.name;
        })).toEqual(['001.jpg', '002.png', 'ComicInfo.xml']);
        expect(requests).toEqual([
            `${EXTERNAL}/api/graphql`,
            `${EXTERNAL}/api/v1/manga/7/chapter/1/page/0`,
            `${EXTERNAL}/api/v1/manga/7/chapter/1/page/1`
        ]);
        const jobs = sent.filter((item) => {
            return item.channel === IPC.eventMangaJob;
        }).map((item) => {
            return (item.payload as MangaJob).status;
        });
        expect(jobs[0]).toBe('queued');
        expect(jobs).toContain('running');
        expect(jobs.at(-1)).toBe('done');
        expect(sent.some((item) => {
            return item.channel === IPC.eventMangaLibrary;
        })).toBe(true);
    });

    it('tells the screen when the queue is held and let go', () => {
        const { runtime, sent } = setup();
        runtime!.queue.pauseAll();
        runtime!.queue.resumeAll();
        expect(sent.filter((item) => {
            return item.channel === IPC.eventMangaQueueHeld;
        })).toEqual([
            { channel: IPC.eventMangaQueueHeld, payload: true },
            { channel: IPC.eventMangaQueueHeld, payload: false }
        ]);
    });

    it('reads the pages of a downloaded chapter from its CBZ, through the scheme of the pages, with no request to the server', async () => {
        const { runtime, requests } = setup();
        const library = runtime!.queue.enqueue(REQUEST) as LibraryManga;
        await untilIdle(runtime!);
        const chapter = runtime!.db.chaptersOf(library.id)[0]!;
        const before = requests.length;
        const answer = await runtime!.handlers.reader.pages({ chapterRemoteId: 1, libraryChapterId: chapter.id });
        expect(answer).toEqual({ ok: true, value: { pages: [`pullwave-manga://page/${String(chapter.id)}/0`, `pullwave-manga://page/${String(chapter.id)}/1`], local: true, missing: [] } });
        const first = await runtime!.pageHandler(new Request(`pullwave-manga://page/${String(chapter.id)}/0`));
        expect(first.status).toBe(200);
        expect(first.headers.get('Content-Type')).toBe('image/jpeg');
        expect(Buffer.from(await first.arrayBuffer())).toEqual(Buffer.from(JPEG));
        const second = await runtime!.pageHandler(new Request(`pullwave-manga://page/${String(chapter.id)}/1`));
        expect(second.headers.get('Content-Type')).toBe('image/png');
        expect(Buffer.from(await second.arrayBuffer())).toEqual(Buffer.from(PNG));
        expect((await runtime!.pageHandler(new Request(`pullwave-manga://page/${String(chapter.id)}/2`))).status).toBe(404);
        expect((await runtime!.pageHandler(new Request('pullwave-manga://page/9999/0'))).status).toBe(404);
        expect(requests.length).toBe(before);
    });

    it('reads the pages of a downloaded chapter from its folder', async () => {
        const target = makeTempDir();
        const { runtime } = setup({ settings: { mangaDirectory: target, mangaFormat: 'folder' } });
        const library = runtime!.queue.enqueue(REQUEST) as LibraryManga;
        await untilIdle(runtime!);
        const chapter = runtime!.db.chaptersOf(library.id)[0]!;
        const answer = await runtime!.handlers.reader.pages({ chapterRemoteId: 1, libraryChapterId: chapter.id });
        expect(answer).toMatchObject({ ok: true, value: { local: true, pages: [`pullwave-manga://page/${String(chapter.id)}/0`, `pullwave-manga://page/${String(chapter.id)}/1`] } });
        const first = await runtime!.pageHandler(new Request(`pullwave-manga://page/${String(chapter.id)}/0`));
        expect(Buffer.from(await first.arrayBuffer())).toEqual(Buffer.from(JPEG));
    });

    it('finishes a chapter whose page cannot be fetched as incomplete, and tells the screen how many pages are missing', async () => {
        const { runtime, dir, sent } = setup({ failing: new Set(['1']) });
        const library = runtime!.queue.enqueue(REQUEST) as LibraryManga;
        await untilIdle(runtime!);
        const expected = join(dir, 'Downloads', 'Pullwave Manga', 'One Piece', 'Chapter 1.cbz');
        expect(runtime!.db.chaptersOf(library.id)[0]).toMatchObject({ status: 'incomplete', filePath: expected, pageCount: 2, error: null });
        expect(readZipEntries(readFileSync(expected)).map((entry) => {
            return entry.name;
        })).toEqual(['001.jpg', 'ComicInfo.xml']);
        const jobs = sent.filter((item) => {
            return item.channel === IPC.eventMangaJob;
        });
        expect(jobs.at(-1)?.payload).toMatchObject({ status: 'done', pagesDone: 2, pageCount: 2, missingPages: 1 });
    });

    it('reads an incomplete chapter from its file, with a place kept for the missing page, and downloads the page when asked', async () => {
        const failing = new Set(['1']);
        const { runtime, requests, sent } = setup({ failing });
        const library = runtime!.queue.enqueue(REQUEST) as LibraryManga;
        await untilIdle(runtime!);
        const chapter = runtime!.db.chaptersOf(library.id)[0]!;
        const pageUrl = (index: number): string => {
            return `pullwave-manga://page/${String(chapter.id)}/${String(index)}`;
        };
        const before = await runtime!.handlers.reader.pages({ chapterRemoteId: 1, libraryChapterId: chapter.id });
        expect(before).toEqual({ ok: true, value: { pages: [pageUrl(0), pageUrl(1)], local: true, missing: [1] } });
        expect((await runtime!.pageHandler(new Request(pageUrl(0)))).status).toBe(200);
        expect((await runtime!.pageHandler(new Request(pageUrl(1)))).status).toBe(404);

        failing.clear();
        const libraryChanges = sent.filter((item) => {
            return item.channel === IPC.eventMangaLibrary;
        }).length;
        await expect(runtime!.handlers.repair.repair(chapter.id, 1)).resolves.toEqual({ ok: true, value: { missing: [] } });
        expect(requests.at(-1)).toBe(`${EXTERNAL}/api/v1/manga/7/chapter/1/page/1`);
        expect(runtime!.db.getChapter(chapter.id)).toMatchObject({ status: 'done', filePath: chapter.filePath, pageCount: 2 });
        expect(sent.filter((item) => {
            return item.channel === IPC.eventMangaLibrary;
        }).length).toBeGreaterThan(libraryChanges);
        const after = await runtime!.handlers.reader.pages({ chapterRemoteId: 1, libraryChapterId: chapter.id });
        expect(after).toEqual({ ok: true, value: { pages: [pageUrl(0), pageUrl(1)], local: true, missing: [] } });
        const second = await runtime!.pageHandler(new Request(pageUrl(1)));
        expect(second.status).toBe(200);
        expect(second.headers.get('Content-Type')).toBe('image/png');
        expect(Buffer.from(await second.arrayBuffer())).toEqual(Buffer.from(PNG));
    });

    it('keeps the chapter incomplete, and says why, when the page still cannot be downloaded', async () => {
        const { runtime } = setup({ failing: new Set(['1']) });
        const library = runtime!.queue.enqueue(REQUEST) as LibraryManga;
        await untilIdle(runtime!);
        const chapter = runtime!.db.chaptersOf(library.id)[0]!;
        await expect(runtime!.handlers.repair.repair(chapter.id, null)).resolves.toEqual({ ok: false, error: { code: 'IMAGE', message: 'The page is not on the server of the app' } });
        expect(runtime!.db.getChapter(chapter.id)).toMatchObject({ status: 'incomplete', filePath: chapter.filePath });
    });

    it('repairs the folder of an incomplete chapter in place', async () => {
        const target = makeTempDir();
        const failing = new Set(['0']);
        const { runtime } = setup({ settings: { mangaDirectory: target, mangaFormat: 'folder' }, failing });
        const library = runtime!.queue.enqueue(REQUEST) as LibraryManga;
        await untilIdle(runtime!);
        const chapter = runtime!.db.chaptersOf(library.id)[0]!;
        const folder = join(target, 'One Piece', 'Chapter 1');
        expect(chapter).toMatchObject({ status: 'incomplete', filePath: folder });
        expect(readdirSync(folder).sort()).toEqual(['002.png', 'ComicInfo.xml']);
        failing.clear();
        await expect(runtime!.handlers.repair.repair(chapter.id, 0)).resolves.toEqual({ ok: true, value: { missing: [] } });
        expect(readdirSync(folder).sort()).toEqual(['001.jpg', '002.png', 'ComicInfo.xml']);
        expect(readFileSync(join(folder, '001.jpg'))).toEqual(Buffer.from(JPEG));
        expect(runtime!.db.getChapter(chapter.id)).toMatchObject({ status: 'done', filePath: folder });
    });

    it('reads the pages of a chapter that is not downloaded from the server', async () => {
        const { runtime, requests } = setup();
        const answer = await runtime!.handlers.reader.pages({ chapterRemoteId: 1, libraryChapterId: null });
        expect(answer).toEqual({ ok: true, value: { pages: [expect.stringContaining('/api/v1/manga/7/chapter/1/page/0'), expect.stringContaining('/api/v1/manga/7/chapter/1/page/1')], local: false, missing: [] } });
        expect(requests).toEqual([`${EXTERNAL}/api/graphql`]);
    });

    it('uses the folder and the format of the settings', async () => {
        const target = makeTempDir();
        const { runtime } = setup({ settings: { mangaDirectory: target, mangaFormat: 'folder' } });
        runtime!.queue.enqueue(REQUEST);
        await untilIdle(runtime!);
        expect(existsSync(join(target, 'One Piece', 'Chapter 1', '001.jpg'))).toBe(true);
        expect(existsSync(join(target, 'One Piece', 'Chapter 1', 'ComicInfo.xml'))).toBe(true);
    });

    it('stops downloading and ends the server when the app closes', async () => {
        const { runtime } = setup();
        const stop = vi.spyOn(runtime!.service, 'shutdown');
        await runtime!.shutdown();
        expect(stop).toHaveBeenCalledTimes(1);
    });
});

describe('createMangaRuntime files', () => {
    it('deletes a CBZ and a folder the app made, and the folder of the manga when it is left empty', () => {
        const { runtime, dir } = setup();
        const folder = join(dir, 'm', 'One Piece');
        mkdirSync(join(folder, 'Chapter 2'), { recursive: true });
        writeFileSync(join(folder, 'Chapter 1.cbz'), 'zip');
        writeFileSync(join(folder, 'Chapter 2', 'ComicInfo.xml'), '<ComicInfo/>');
        runtime!.handlers.removeChapterFiles([join(folder, 'Chapter 1.cbz'), join(folder, 'Chapter 2')]);
        expect(existsSync(join(folder, 'Chapter 1.cbz'))).toBe(false);
        expect(existsSync(join(folder, 'Chapter 2'))).toBe(false);
        expect(existsSync(folder)).toBe(false);
    });

    it('leaves the folder of the manga when something else is in it', () => {
        const { runtime, dir } = setup();
        const folder = join(dir, 'm', 'One Piece');
        mkdirSync(folder, { recursive: true });
        writeFileSync(join(folder, 'Chapter 1.cbz'), 'zip');
        writeFileSync(join(folder, 'notes.txt'), 'mine');
        runtime!.handlers.removeChapterFiles([join(folder, 'Chapter 1.cbz')]);
        expect(existsSync(join(folder, 'notes.txt'))).toBe(true);
    });

    it('never deletes what the app did not make', () => {
        const { runtime, dir } = setup();
        const folder = join(dir, 'm');
        mkdirSync(join(folder, 'Photos'), { recursive: true });
        writeFileSync(join(folder, 'Photos', 'me.jpg'), 'x');
        writeFileSync(join(folder, 'diary.txt'), 'x');
        writeFileSync(join(folder, 'archive.zip'), 'x');
        runtime!.handlers.removeChapterFiles([join(folder, 'Photos'), join(folder, 'diary.txt'), join(folder, 'archive.zip'), join(folder, 'missing.cbz')]);
        expect(existsSync(join(folder, 'Photos', 'me.jpg'))).toBe(true);
        expect(existsSync(join(folder, 'diary.txt'))).toBe(true);
        expect(existsSync(join(folder, 'archive.zip'))).toBe(true);
    });

    it('opens the folder where the chapters of a manga are, or the one they will go to', () => {
        const { runtime, dir } = setup();
        const manga = runtime!.db.upsertManga({ remoteId: 7, sourceId: '123', title: 'One Piece', thumbnailUrl: null });
        expect(runtime!.handlers.folderOf(manga.id)).toBe(join(dir, 'Downloads', 'Pullwave Manga', 'One Piece'));
        expect(runtime!.handlers.folderOf(999)).toBeNull();
        const chapter = runtime!.db.ensureChapter(manga.id, { remoteId: 1, name: 'Chapter 1', number: 1, dateUploaded: null, scanlator: null, sourceOrder: 1 });
        runtime!.db.markDone(chapter.id, '/elsewhere/One Piece/Chapter 1.cbz', 1, 1);
        expect(runtime!.handlers.folderOf(manga.id)).toBe('/elsewhere/One Piece');
        runtime!.db.markIncomplete(chapter.id, '/incomplete/One Piece/Chapter 1.cbz', 1, 2);
        expect(runtime!.handlers.folderOf(manga.id)).toBe('/incomplete/One Piece');
    });

    it('uses the folder of the settings for a manga with nothing downloaded', () => {
        const { runtime } = setup({ settings: { mangaDirectory: '/mnt/manga' } });
        const manga = runtime!.db.upsertManga({ remoteId: 7, sourceId: '123', title: 'One Piece', thumbnailUrl: null });
        expect(runtime!.handlers.folderOf(manga.id)).toBe('/mnt/manga/One Piece');
    });

    it('opens a folder through the app', () => {
        const { runtime, opened } = setup();
        runtime!.handlers.openFolder('/some/folder');
        expect(opened).toEqual(['/some/folder']);
    });

    it('opens the page of a manga on its site through the app, in the browser of the settings', () => {
        const sites: Array<[string, string]> = [];
        const { runtime, settings } = setup({
            openSite: (url, browser) => {
                sites.push([url, browser]);
            }
        });
        runtime!.handlers.openSite('https://dex.example/one-piece');
        settings.mangaSiteBrowser = 'firefox';
        runtime!.handlers.openSite('https://dex.example/bleach');
        expect(sites).toEqual([
            ['https://dex.example/one-piece', 'default'],
            ['https://dex.example/bleach', 'firefox']
        ]);
    });

    it('does nothing when the system gives no way to open a site', () => {
        const { runtime } = setup();
        expect(() => {
            runtime!.handlers.openSite('https://dex.example/one-piece');
        }).not.toThrow();
    });

    it('tells the screen when the library changes', () => {
        const { runtime, sent } = setup();
        runtime!.handlers.onLibraryChanged();
        expect(sent).toEqual([{ channel: IPC.eventMangaLibrary, payload: undefined }]);
    });
});


class QuietProcess extends EventEmitter {
    pid = 7001;
    stdout = new PassThrough();
    stderr = new PassThrough();
    kill = vi.fn(() => {
        this.emit('exit', 0);
        return true;
    });
}

// Marks a program as installed, the way the installer does when it is done (the entry file and the marker).
function installProgram(root: string, spec: { id: string; version: string; sha256: string; entry: string }): void {
    const directory = join(root, 'manga', 'tools', spec.id, spec.version);
    mkdirSync(join(directory, spec.entry, '..'), { recursive: true });
    writeFileSync(join(directory, spec.entry), 'x');
    writeFileSync(join(directory, '.pullwave-tool.json'), JSON.stringify({ id: spec.id, version: spec.version, sha256: spec.sha256 }));
}

describe('createMangaRuntime migrating the folder', () => {
    function addDownloaded(runtime: NonNullable<ReturnType<typeof createMangaRuntime>>, base: string): { chapterId: number; path: string } {
        const manga = runtime.db.upsertManga({ remoteId: 7, sourceId: '123', title: 'One Piece', thumbnailUrl: null });
        const chapter = runtime.db.ensureChapter(manga.id, { remoteId: 1, name: 'Chapter 1', number: 1, dateUploaded: null, scanlator: null, sourceOrder: 1 });
        const path = join(base, 'One Piece', 'Chapter 1.cbz');
        mkdirSync(join(base, 'One Piece'), { recursive: true });
        writeFileSync(path, 'zip');
        runtime.db.markDone(chapter.id, path, 3, 1);
        return { chapterId: chapter.id, path };
    }

    it('asks for a folder starting at the current one, moves the chapters there, saves the folder and tells how far it is', async () => {
        const asked: string[] = [];
        const saved: string[] = [];
        const dir = makeTempDir();
        const current = join(dir, 'current');
        const target = join(dir, 'target');
        const { runtime, sent } = setup({
            settings: { mangaDirectory: current },
            chooseMigrationFolder: (startAt) => {
                asked.push(startAt);
                return Promise.resolve(target);
            },
            saveMangaDirectory: (directory) => {
                saved.push(directory);
            }
        });
        const { chapterId } = addDownloaded(runtime!, current);

        await expect(runtime!.handlers.migrateFolder()).resolves.toEqual({ ok: true, chapters: 1, files: 1, destination: target });

        expect(asked).toEqual([current]);
        expect(saved).toEqual([target]);
        expect(runtime!.db.getChapter(chapterId)?.filePath).toBe(join(target, 'One Piece', 'Chapter 1.cbz'));
        expect(readFileSync(join(target, 'One Piece', 'Chapter 1.cbz'), 'utf-8')).toBe('zip');
        expect(sent.filter((item) => {return item.channel === IPC.eventMangaMigration}).map((item) => {return item.payload})).toEqual([
            { done: 0, total: 1 },
            { done: 1, total: 1 }
        ]);
    });

    it('starts at the default folder when the settings have none', async () => {
        const asked: string[] = [];
        const { runtime, dir } = setup({
            chooseMigrationFolder: (startAt) => {
                asked.push(startAt);
                return Promise.resolve(null);
            }
        });
        await runtime!.handlers.migrateFolder();
        expect(asked).toEqual([join(dir, 'Downloads', 'Pullwave Manga')]);
    });

    it('says it was called off when no folder is chosen, and moves and saves nothing', async () => {
        const saved: string[] = [];
        const { runtime, sent } = setup({
            chooseMigrationFolder: () => {
                return Promise.resolve(null);
            },
            saveMangaDirectory: (directory) => {
                saved.push(directory);
            }
        });
        await expect(runtime!.handlers.migrateFolder()).resolves.toEqual({ ok: false, reason: 'cancelled' });
        expect(saved).toEqual([]);
        expect(sent).toEqual([]);
    });

    it('says it was called off when the system has no way to ask for a folder', async () => {
        const { runtime } = setup();
        await expect(runtime!.handlers.migrateFolder()).resolves.toEqual({ ok: false, reason: 'cancelled' });
    });

    it('answers why it did not happen, changing nothing', async () => {
        const dir = makeTempDir();
        const current = join(dir, 'current');
        const saved: string[] = [];
        const { runtime } = setup({
            settings: { mangaDirectory: current },
            chooseMigrationFolder: () => {
                return Promise.resolve(current);
            },
            saveMangaDirectory: (directory) => {
                saved.push(directory);
            }
        });
        const { chapterId, path } = addDownloaded(runtime!, current);
        await expect(runtime!.handlers.migrateFolder()).resolves.toEqual({ ok: false, reason: 'same' });
        expect(runtime!.db.getChapter(chapterId)?.filePath).toBe(path);
        expect(saved).toEqual([]);
    });
});

describe('createMangaRuntime looking for new chapters', () => {
    function fetchWithChapters(chapters: number[]): typeof fetch {
        return vi.fn((_input: string | URL | Request, init?: RequestInit) => {
            const body = JSON.parse(String(init?.body)) as { query: string };
            if (body.query.includes('fetchMangaAndChapters')) {
                const manga = { id: 7, sourceId: '123', title: 'One Piece', thumbnailUrl: null, realUrl: 'https://dex.example/one-piece', author: 'Oda', artist: null, description: null, genre: ['Action'], status: 'ONGOING' };
                const list = chapters.map((id) => {
                    return { id, name: `Chapter ${id}`, chapterNumber: id, uploadDate: '0', scanlator: null, sourceOrder: id };
                });
                return Promise.resolve(new Response(JSON.stringify({ data: { fetchMangaAndChapters: { manga, chapters: list } } }), { status: 200 }));
            }
            return Promise.resolve(new Response(JSON.stringify({ errors: [{ message: 'not faked' }] }), { status: 200 }));
        }) as unknown as typeof fetch;
    }

    function addManga(runtime: NonNullable<ReturnType<typeof createMangaRuntime>>): number {
        const manga = runtime.db.upsertManga({ remoteId: 7, sourceId: '123', title: 'One Piece', thumbnailUrl: null });
        runtime.db.registerChapters(manga.id, [{ remoteId: 1, name: 'Chapter 1', number: 1, dateUploaded: null, scanlator: null, sourceOrder: 1 }]);
        return manga.id;
    }

    it('adds the chapters the source has that the library does not, keeps the page of the site, and tells the screen', async () => {
        const { runtime, sent } = setup({ fetchImpl: fetchWithChapters([1, 2, 3]) });
        const id = addManga(runtime!);

        await expect(runtime!.checker.checkNow()).resolves.toEqual({ ok: true, count: 2, titles: ['One Piece'], failed: 0, skipped: 0 });

        expect(runtime!.db.chaptersOf(id).map((chapter) => {return [chapter.remoteId, chapter.status]}).sort()).toEqual([[1, 'idle'], [2, 'idle'], [3, 'idle']]);
        expect(runtime!.db.getManga(id)).toMatchObject({ url: 'https://dex.example/one-piece', author: 'Oda', genres: ['Action'], status: 'ongoing' });
        expect(sent).toEqual([
            { channel: IPC.eventMangaLibrary, payload: undefined },
            { channel: IPC.eventMangaNewChapters, payload: { count: 2, titles: ['One Piece'] } }
        ]);
    });

    it('does not look when the setting is off', async () => {
        const fetchImpl = fetchWithChapters([1, 2, 3]);
        const { runtime, sent } = setup({ fetchImpl, settings: { mangaCheckNewChapters: false } });
        addManga(runtime!);
        await expect(runtime!.checker.checkNow()).resolves.toEqual({ ok: true, count: 0, titles: [], failed: 0, skipped: 0 });
        expect(fetchImpl).not.toHaveBeenCalled();
        expect(sent).toEqual([]);
    });

    it('looks anyway when the user asks for it, with the setting off, through the handlers', async () => {
        const fetchImpl = fetchWithChapters([1, 2]);
        const { runtime } = setup({ fetchImpl, settings: { mangaCheckNewChapters: false } });
        const id = addManga(runtime!);
        await expect(runtime!.handlers.checkNewChapters(id)).resolves.toEqual({ ok: true, count: 1, titles: ['One Piece'], failed: 0, skipped: 0 });
        await expect(runtime!.handlers.checkNewChapters(null)).resolves.toEqual({ ok: true, count: 0, titles: [], failed: 0, skipped: 0 });
        expect(runtime!.db.updates().map((entry) => {
            return [entry.chapterRemoteId, entry.origin];
        })).toEqual([[2, 'manual']]);
    });

    it('says why a manga could not be checked', async () => {
        const { runtime } = setup();
        const id = addManga(runtime!);
        await expect(runtime!.handlers.checkNewChapters(id)).resolves.toEqual({ ok: false, error: { code: 'UNKNOWN', message: 'not faked' } });
        await expect(runtime!.handlers.checkNewChapters(999)).resolves.toEqual({ ok: false, error: { code: 'NOT_FOUND', message: 'The manga is not in the library.' } });
    });

    it('queues the new chapters it finds when the setting says so, and only adds them when it does not', async () => {
        const on = setup({ fetchImpl: fetchWithChapters([1, 2, 3]), settings: { mangaAutoDownloadNew: true } });
        const onId = addManga(on.runtime!);
        await on.runtime!.checker.checkNow();
        expect(on.runtime!.queue.list().map((job) => {
            return [job.mangaId, job.chapterName];
        })).toEqual([
            [onId, 'Chapter 2'],
            [onId, 'Chapter 3']
        ]);
        // What was started is stopped before the test ends, so nothing is left writing to the library that is deleted.
        await on.runtime!.shutdown();
        const off = setup({ fetchImpl: fetchWithChapters([1, 2, 3]), settings: { mangaAutoDownloadNew: false } });
        addManga(off.runtime!);
        await off.runtime!.checker.checkNow();
        expect(off.runtime!.queue.list()).toEqual([]);
        await off.runtime!.shutdown();
    });

    it('leaves the library alone when the server cannot answer', async () => {
        const { runtime, sent } = setup();
        const id = addManga(runtime!);
        await expect(runtime!.checker.checkNow()).resolves.toEqual({ ok: true, count: 0, titles: [], failed: 1, skipped: 0 });
        expect(runtime!.db.chaptersOf(id)).toHaveLength(1);
        expect(sent).toEqual([]);
    });

    describe('with the sources the server has', () => {
        // The server lists the sources whose extension is installed, and answers about the mangas.
        function fetchWithSources(sourceIds: string[], chapters: number[]): typeof fetch {
            const withManga = fetchWithChapters(chapters);
            return vi.fn((input: string | URL | Request, init?: RequestInit) => {
                const body = JSON.parse(String(init?.body)) as { query: string };
                if (body.query.includes('sources') && !body.query.includes('fetchMangaAndChapters')) {
                    const nodes = sourceIds.map((id) => {
                        return { id, name: `Site ${id}`, displayName: `Site ${id}`, lang: 'en', iconUrl: '/icon', supportsLatest: true, contentWarning: 'SAFE', extension: { pkgName: 'pkg', storeIndexUrl: null } };
                    });
                    return Promise.resolve(new Response(JSON.stringify({ data: { sources: { nodes } } }), { status: 200 }));
                }
                return withManga(input, init);
            }) as unknown as typeof fetch;
        }

        it('does not look at the manga whose source is not among them, and says so', async () => {
            const fetchImpl = fetchWithSources(['999'], [1, 2, 3]);
            const { runtime, sent } = setup({ fetchImpl });
            const id = addManga(runtime!);
            await expect(runtime!.checker.checkNow()).resolves.toEqual({ ok: true, count: 0, titles: [], failed: 0, skipped: 1 });
            const asked = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.map((call) => {
                return (JSON.parse(String((call[1] as RequestInit).body)) as { query: string }).query;
            });
            expect(
                asked.some((query) => {
                    return query.includes('fetchMangaAndChapters');
                })
            ).toBe(false);
            expect(runtime!.db.chaptersOf(id)).toHaveLength(1);
            expect(sent).toEqual([]);
        });

        it('looks at the manga whose source is among them', async () => {
            const { runtime } = setup({ fetchImpl: fetchWithSources(['123'], [1, 2, 3]) });
            addManga(runtime!);
            await expect(runtime!.checker.checkNow()).resolves.toEqual({ ok: true, count: 2, titles: ['One Piece'], failed: 0, skipped: 0 });
        });

        it('answers the check of one manga as skipped when its source is not among them', async () => {
            const { runtime } = setup({ fetchImpl: fetchWithSources(['999'], [1, 2]) });
            const id = addManga(runtime!);
            await expect(runtime!.handlers.checkNewChapters(id)).resolves.toEqual({ ok: true, count: 0, titles: [], failed: 0, skipped: 1 });
        });
    });

    it('uses the times it is told to use', async () => {
        vi.useFakeTimers();
        try {
            const fetchImpl = fetchWithChapters([1, 2]);
            const { runtime } = setup({ fetchImpl, checkTimes: { firstMs: 30, everyMs: 1000 } });
            addManga(runtime!);
            runtime!.prepare();
            await vi.advanceTimersByTimeAsync(29);
            expect(fetchImpl).not.toHaveBeenCalled();
            await vi.advanceTimersByTimeAsync(1);
            expect(fetchImpl).toHaveBeenCalled();
            await runtime!.shutdown();
        } finally {
            vi.useRealTimers();
        }
    });

    it('starts when the app opens and stops when it closes', async () => {
        vi.useFakeTimers();
        try {
            const fetchImpl = fetchWithChapters([1, 2]);
            const { runtime } = setup({ fetchImpl });
            addManga(runtime!);
            runtime!.prepare();
            await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS);
            expect(fetchImpl).toHaveBeenCalled();
            const calls = (fetchImpl as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
            await runtime!.shutdown();
            await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS * 2);
            expect((fetchImpl as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(calls);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('createMangaRuntime Cloudflare helper', () => {
    let flare: Server;
    let flareRequests: string[];

    beforeEach(async () => {
        flareRequests = [];
        flare = createServer((request, response) => {
            flareRequests.push(`${request.method} ${request.url}`);
            setTimeout(() => {
                response.writeHead(200, { 'Content-Type': 'application/json' });
                response.end('{"status":"ok"}');
            }, 100);
        });
        await new Promise<void>((resolve) => {
            flare.listen(0, '127.0.0.1', resolve);
        });
    });

    afterEach(async () => {
        await new Promise<void>((resolve) => {
            flare.close(() => {
                resolve();
            });
            flare.closeAllConnections();
        });
    });

    function setupInstalled(settings: Partial<Settings> = {}) {
        const dir = makeTempDir();
        const dataDir = join(dir, 'userData');
        const spec = suwayomiSpec('linux', 'x64')!;
        installProgram(dataDir, spec);
        const sent: Sent[] = [];
        const children: ChildProcess[] = [];
        const docker = fakeDocker({ imagePresent: true });
        const spawn = (): ChildProcess => {
            const child = new QuietProcess() as unknown as ChildProcess;
            children.push(child);
            return child;
        };
        const runtime = createMangaRuntime({
            platform: 'linux',
            arch: 'x64',
            dataDir,
            defaultDownloadDir: dir,
            getSettings: () => {
                return { ...DEFAULT_SETTINGS, mangaFlaresolverrEnabled: true, ...settings };
            },
            send: (channel, payload) => {
                sent.push({ channel, payload });
            },
            openFolder: () => {
                return undefined;
            },
            // The programs are stand-ins: Suwayomi answers that it is ready, FlareSolverr is a server of the test behind a fake Docker.
            serverDependencies: {
                spawn,
                fetchImpl: (() => {
                    return Promise.resolve(new Response('{}', { status: 200 }));
                }) as unknown as typeof fetch,
                findFreePort: () => {
                    return Promise.resolve(45801);
                },
                pollIntervalMs: 5
            },
            helperDependencies: {
                docker: docker.runner,
                findFreePort: () => {
                    return Promise.resolve((flare.address() as AddressInfo).port);
                },
                pollIntervalMs: 5
            }
        });
        return { runtime: runtime!, dataDir, sent, children, docker };
    }

    it('starts no container and keeps the bypass off while the user has not installed the helper', async () => {
        const { runtime, dataDir, docker } = setupInstalled({ mangaFlaresolverrEnabled: false });
        await runtime.service.install();
        await runtime.service.requireServer();
        const conf = readFileSync(join(dataDir, 'manga', 'server', 'server.conf'), 'utf-8');
        expect(conf).toContain('server.flareSolverrEnabled = false');
        expect(docker.calls).toEqual([]);
        await runtime.shutdown();
    });

    it('starts the container with the server, and points the server at the monitor of the app, not at the container', async () => {
        const { runtime, dataDir, children, docker } = setupInstalled();
        await runtime.service.install();
        await runtime.service.requireServer();
        const port = (flare.address() as AddressInfo).port;
        expect(docker.calls).toContainEqual(['ps', '--all', '--filter', 'label=pullwave.helper=flaresolverr', '--format', '{{.ID}} {{.Names}}']);
        expect(docker.calls).toContainEqual([
            'run',
            '--detach',
            '--rm',
            '--label',
            'pullwave.helper=flaresolverr',
            '--name',
            `pullwave-flaresolverr-${process.pid}`,
            '--publish',
            `127.0.0.1:${port}:8191`,
            '--env',
            'LOG_LEVEL=info',
            FLARESOLVERR_IMAGE
        ]);
        // Only the server is a process of the app: the helper is a container.
        expect(children).toHaveLength(1);
        const conf = readFileSync(join(dataDir, 'manga', 'server', 'server.conf'), 'utf-8');
        expect(conf).toContain('server.flareSolverrEnabled = true');
        const address = /server\.flareSolverrUrl = "(http:\/\/127\.0\.0\.1:\d+)"/.exec(conf)?.[1];
        expect(address).toBeDefined();
        expect(address).not.toBe(`http://127.0.0.1:${port}`);
        expect(runtime.service.status().helper).toMatchObject({ id: 'flaresolverr', status: 'ready' });
        await runtime.shutdown();
        expect(docker.calls).toContainEqual(['stop', '--time', '3', 'c0ffee']);
    });

    it('has processes to end while the container and the server run, and none once they are stopped', async () => {
        const { runtime } = setupInstalled();
        expect(runtime.hasProcessesToEnd()).toBe(false);
        await runtime.service.install();
        await runtime.service.requireServer();
        expect(runtime.hasProcessesToEnd()).toBe(true);
        await runtime.shutdown();
        expect(runtime.hasProcessesToEnd()).toBe(false);
    });

    it('uses the FlareSolverr of the user, runs no container and sends the checks through the monitor', async () => {
        const { runtime, dataDir, docker, sent } = setupInstalled({ mangaFlaresolverrUrl: `http://127.0.0.1:${(flare.address() as AddressInfo).port}` });
        await runtime.service.install();
        await runtime.service.requireServer();
        expect(docker.calls).toEqual([]);
        expect(runtime.service.status()).toMatchObject({ helper: null, helperProblem: null, helperExternal: true });
        const conf = readFileSync(join(dataDir, 'manga', 'server', 'server.conf'), 'utf-8');
        const address = /server\.flareSolverrUrl = "(http:\/\/127\.0\.0\.1:\d+)"/.exec(conf)![1]!;
        const answer = await fetch(`${address}/v1`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cmd: 'request.get', url: 'https://manganato.com/genre' }) });
        expect(await answer.json()).toEqual({ status: 'ok' });
        expect(flareRequests).toEqual(['POST /v1']);
        expect(
            sent.filter((item) => {
                return item.channel === IPC.eventMangaCloudflare;
            })
        ).toHaveLength(2);
        await runtime.shutdown();
    });

    it('tells the screen a check of Cloudflare is going on, and for which site, when the server asks FlareSolverr for a page', async () => {
        const { runtime, dataDir, sent } = setupInstalled();
        await runtime.service.install();
        await runtime.service.requireServer();
        const conf = readFileSync(join(dataDir, 'manga', 'server', 'server.conf'), 'utf-8');
        const address = /server\.flareSolverrUrl = "(http:\/\/127\.0\.0\.1:\d+)"/.exec(conf)![1]!;
        const answer = await fetch(`${address}/v1`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cmd: 'request.get', url: 'https://manganato.com/genre' }) });
        expect(answer.status).toBe(200);
        expect(await answer.json()).toEqual({ status: 'ok' });
        expect(flareRequests).toContain('POST /v1');
        const events = sent
            .filter((item) => {
                return item.channel === IPC.eventMangaCloudflare;
            })
            .map((item) => {
                return (item.payload as MangaCloudflareActivity[]).map((check) => {
                    return check.host;
                });
            });
        expect(events).toEqual([['manganato.com'], []]);
        await runtime.shutdown();
    });

    it('starts the server with the bypass off when Docker is missing', async () => {
        const dir = makeTempDir();
        const dataDir = join(dir, 'userData');
        installProgram(dataDir, suwayomiSpec('linux', 'x64')!);
        const docker = fakeDocker({ dockerMissing: true });
        const runtime = createMangaRuntime({
            platform: 'linux',
            arch: 'x64',
            dataDir,
            defaultDownloadDir: dir,
            getSettings: () => {
                return { ...DEFAULT_SETTINGS, mangaFlaresolverrEnabled: true };
            },
            send: () => {return undefined},
            openFolder: () => {return undefined},
            serverDependencies: {
                spawn: () => {
                    return new QuietProcess() as unknown as ChildProcess;
                },
                fetchImpl: (() => {
                    return Promise.resolve(new Response('{}', { status: 200 }));
                }) as unknown as typeof fetch,
                findFreePort: () => {
                    return Promise.resolve(45802);
                },
                pollIntervalMs: 5
            },
            helperDependencies: { docker: docker.runner }
        })!;
        await runtime.service.install();
        await runtime.service.requireServer();
        const conf = readFileSync(join(dataDir, 'manga', 'server', 'server.conf'), 'utf-8');
        expect(conf).toContain('server.flareSolverrEnabled = false');
        expect(conf).not.toContain('flareSolverrUrl');
        expect(docker.calls.some((call) => {
            return call[0] === 'run';
        })).toBe(false);
        await runtime.shutdown();
    });
});

describe('createMangaRuntime updates and health', () => {
    const HASH = 'd'.repeat(64);

    function fromDisk(selected: { suwayomi?: object; flaresolverr?: object } = {}) {
        const dir = makeTempDir();
        const tools = join(dir, 'manga', 'tools');
        mkdirSync(tools, { recursive: true });
        if (selected.suwayomi !== undefined) {
            writeFileSync(join(tools, 'suwayomi-selected.json'), JSON.stringify(selected.suwayomi));
        }
        if (selected.flaresolverr !== undefined) {
            writeFileSync(join(tools, 'flaresolverr-selected.json'), JSON.stringify(selected.flaresolverr));
        }
        const sent: Sent[] = [];
        const restarts = { count: 0 };
        const docker = fakeDocker({ imagePresent: true });
        const runtime = createMangaRuntime({
            platform: 'linux',
            arch: 'x64',
            dataDir: dir,
            defaultDownloadDir: dir,
            getSettings: () => {
                return { ...DEFAULT_SETTINGS, mangaFlaresolverrEnabled: true };
            },
            send: (channel, payload) => {
                sent.push({ channel, payload });
            },
            openFolder: () => {
                return undefined;
            },
            restartApp: () => {
                restarts.count += 1;
            },
            toolDependencies: {
                download: () => {
                    return Promise.reject(new Error('offline'));
                }
            },
            helperDependencies: { docker: docker.runner }
        })!;
        return { runtime, dir, tools, sent, restarts, docker };
    }

    it('runs the program the app ships with when no update was chosen', () => {
        const { runtime } = fromDisk();
        expect(runtime.service.status().tool).toMatchObject({ id: 'suwayomi', version: suwayomiSpec('linux', 'x64')!.version });
    });

    it('runs the release the user updated to, from the next time the app opens', () => {
        const { runtime } = fromDisk({ suwayomi: { version: 'v9.0.0', sha256: HASH, sizeBytes: 1000 } });
        expect(runtime.service.status().tool).toMatchObject({ id: 'suwayomi', version: 'v9.0.0' });
    });

    it('runs the program the app ships with when what was kept is not valid', () => {
        const { runtime } = fromDisk({ suwayomi: { version: '../../x', sha256: 'zz', sizeBytes: -1 } });
        expect(runtime.service.status().tool).toMatchObject({ version: suwayomiSpec('linux', 'x64')!.version });
    });

    it('runs the image of the helper the user updated to', () => {
        const { runtime } = fromDisk({ flaresolverr: { version: 'v9.9.9' } });
        expect(runtime.service.status().helper).toMatchObject({ id: 'flaresolverr', version: 'v9.9.9' });
    });

    it('runs the image the app ships with when what was kept is not valid', () => {
        const { runtime } = fromDisk({ flaresolverr: { version: 'latest; rm -rf /' } });
        expect(runtime.service.status().helper).toMatchObject({ version: FLARESOLVERR_VERSION });
    });

    it('gives the handlers the updates and a way to restart the app', () => {
        const { runtime, restarts } = fromDisk();
        expect(runtime.handlers.updates).toBe(runtime.updates);
        runtime.handlers.restartApp();
        expect(restarts.count).toBe(1);
    });

    it('does not fail when the app is not given a way to restart', () => {
        const { runtime } = setup();
        expect(() => {
            runtime!.handlers.restartApp();
        }).not.toThrow();
    });

    it('asks for no helper to update where the user runs a server of their own', async () => {
        const { runtime } = setup();
        await expect(runtime!.updates.updateHelper()).resolves.toEqual({ ok: false, reason: 'not-installed', message: null });
    });

    it('asks the server that is given about its version when the health is asked', async () => {
        const { runtime, requests } = setup();
        await expect(runtime!.service.health(false)).resolves.toMatchObject({ server: { state: 'unhealthy', message: 'not faked', external: false } });
        expect(requests).toEqual([`${EXTERNAL}/api/graphql`]);
    });
});

describe('createMangaRuntime covers', () => {
    it('keeps the cover of a manga of the library in the data folder and serves it through the scheme of the pages', async () => {
        const { runtime, dir, requests } = setup();
        const id = runtime!.db.upsertManga({ remoteId: 7, sourceId: '123', title: 'One Piece', thumbnailUrl: '/api/v1/manga/7/thumbnail' }).id;
        await expect(runtime!.handlers.covers.refresh(id)).resolves.toBe(true);
        expect(requests).toEqual([`${EXTERNAL}/api/v1/manga/7/thumbnail`]);
        expect(readFileSync(join(dir, 'userData', 'manga', 'covers', String(id)))).toEqual(Buffer.from(PNG));
        const url = runtime!.handlers.covers.urlOf(id)!;
        expect(url).toMatch(new RegExp(`^pullwave-manga://cover/${String(id)}\\?v=[0-9a-f]{12}$`));
        const response = await runtime!.pageHandler(new Request(url));
        expect(response.status).toBe(200);
        expect(response.headers.get('Content-Type')).toBe('image/png');
        expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from(PNG));
    });

    it('says there is no cover for a manga that has none kept, and still serves the pages of the chapters', async () => {
        const { runtime } = setup();
        const id = runtime!.db.upsertManga({ remoteId: 7, sourceId: '123', title: 'One Piece', thumbnailUrl: '/api/v1/manga/7/thumbnail' }).id;
        expect((await runtime!.pageHandler(new Request(`pullwave-manga://cover/${String(id)}`))).status).toBe(404);
        expect((await runtime!.pageHandler(new Request('pullwave-manga://page/999/0'))).status).toBe(404);
    });

    it('remembers the fingerprint of the cover and has no more covers to take', async () => {
        const { runtime } = setup();
        const id = runtime!.db.upsertManga({ remoteId: 7, sourceId: '123', title: 'One Piece', thumbnailUrl: '/api/v1/manga/7/thumbnail' }).id;
        await runtime!.handlers.covers.refresh(id);
        expect(runtime!.db.coverHash(id)).toMatch(/^[0-9a-f]{64}$/);
        expect(runtime!.handlers.covers.pending(true)).toBe(false);
    });
});

describe('createMangaRuntime icons of the sources', () => {
    it('keeps an icon in the data folder and serves it through the scheme', async () => {
        const { runtime, dir } = setup();
        const address = `${EXTERNAL}/api/v1/extension/icon/fake`;
        expect(runtime!.handlers.icons.present(address)).toBe(address);
        await vi.waitFor(() => {
            expect(runtime!.handlers.icons.present(address)).toMatch(/^pullwave-manga:\/\/icon\/[0-9a-f]{24}$/);
        });
        const url = runtime!.handlers.icons.present(address)!;
        const response = await runtime!.pageHandler(new Request(url));
        expect(response.status).toBe(200);
        expect(response.headers.get('Content-Type')).toBe('image/png');
        expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from(PNG));
        expect(readFileSync(join(dir, 'userData', 'manga', 'icons', url.split('/').at(-1)!))).toEqual(Buffer.from(PNG));
    });

    it('says there is no icon for a key that is not kept', async () => {
        const { runtime } = setup();
        expect((await runtime!.pageHandler(new Request(`pullwave-manga://icon/${'0'.repeat(24)}`))).status).toBe(404);
    });
});
