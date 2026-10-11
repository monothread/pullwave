import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
import { FLARESOLVERR_IMAGE, FLARESOLVERR_VERSION } from '@main/services/tools/flaresolverrDocker';
import { suwayomiSpec } from '@main/services/tools/suwayomiRelease';
import { fakeDocker } from '../helpers/fakeDocker';
import { cleanTempDirs, makeTempDir } from '../helpers/tempDir';
import { readZipEntries } from '../helpers/zipEntries';

const EXTERNAL = 'http://127.0.0.1:45679';
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9]);

type Sent = { channel: string; payload: unknown };

function fakeSuwayomi(): { fetchImpl: typeof fetch; requests: string[] } {
    const requests: string[] = [];
    const fetchImpl = vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        requests.push(url);
        if (url.endsWith('/api/graphql')) {
            const body = JSON.parse(String(init?.body)) as { query: string };
            if (body.query.includes('fetchChapterPages')) {
                return Promise.resolve(new Response(JSON.stringify({ data: { fetchChapterPages: { pages: ['/api/v1/manga/7/chapter/1/page/0', '/api/v1/manga/7/chapter/1/page/1'] } } }), { status: 200 }));
            }
            return Promise.resolve(new Response(JSON.stringify({ errors: [{ message: 'not faked' }] }), { status: 200 }));
        }
        const bytes = url.endsWith('/0') ? JPEG : PNG;
        return Promise.resolve(new Response(bytes, { status: 200, headers: { 'content-type': 'image/jpeg' } }));
    }) as unknown as typeof fetch;
    return { fetchImpl, requests };
}

function setup(overrides: Partial<MangaRuntimeOptions> & { settings?: Partial<Settings> } = {}) {
    const dir = makeTempDir();
    const sent: Sent[] = [];
    const opened: string[] = [];
    const fake = fakeSuwayomi();
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
        before.markDownloading(chapter.id);
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

    it('reads the pages of a downloaded chapter from its CBZ, through the scheme of the pages, with no request to the server', async () => {
        const { runtime, requests } = setup();
        const library = runtime!.queue.enqueue(REQUEST) as LibraryManga;
        await untilIdle(runtime!);
        const chapter = runtime!.db.chaptersOf(library.id)[0]!;
        const before = requests.length;
        const answer = await runtime!.handlers.reader.pages({ chapterRemoteId: 1, libraryChapterId: chapter.id });
        expect(answer).toEqual({ ok: true, value: { pages: [`pullwave-manga://page/${String(chapter.id)}/0`, `pullwave-manga://page/${String(chapter.id)}/1`], local: true } });
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

    it('reads the pages of a chapter that is not downloaded from the server', async () => {
        const { runtime, requests } = setup();
        const answer = await runtime!.handlers.reader.pages({ chapterRemoteId: 1, libraryChapterId: null });
        expect(answer).toEqual({ ok: true, value: { pages: [expect.stringContaining('/api/v1/manga/7/chapter/1/page/0'), expect.stringContaining('/api/v1/manga/7/chapter/1/page/1')], local: false } });
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
        expect(docker.calls).toContainEqual(['ps', '--all', '--quiet', '--filter', 'label=pullwave.helper=flaresolverr']);
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
