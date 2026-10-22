import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MAX_CONSECUTIVE_SERVER_FAILURES, MangaChapterDownloader, PAGE_RETRY_DELAYS_MS, type ChapterDownloadOptions, type ChapterDownloaderDependencies, type ChapterRepairOptions } from '@main/services/manga/mangaChapterDownloader';
import { ImageFetchError, type FetchedImage } from '@main/services/manga/mangaImages';
import { buildComicInfo } from '@main/services/manga/comicInfo';
import { cleanTempDirs, makeTempDir } from '../../../helpers/tempDir';
import { readZipEntries } from '../../../helpers/zipEntries';

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9]);
const WEBP = Uint8Array.from([...Buffer.from('RIFF'), 1, 2, 3, 4, ...Buffer.from('WEBP'), 7]);
const HTML = Uint8Array.from(Buffer.from('<html>blocked</html>'));
const PAGES = ['http://127.0.0.1:1/p/0', 'http://127.0.0.1:1/p/1', 'http://127.0.0.1:1/p/2'];

function image(bytes: Uint8Array, contentType: string | null = 'image/jpeg', status = 200): FetchedImage {
    return { status, contentType, bytes };
}

interface Setup {
    downloader: MangaChapterDownloader;
    dir: string;
    outputPath: string;
    fetched: string[];
    sleeps: number[];
    pageCounts: number[];
    progress: Array<[number, number]>;
    options: (overrides?: Partial<ChapterDownloadOptions>) => ChapterDownloadOptions;
    signals: AbortSignal[];
}

function setup(parts: { pages?: string[] | Error; fetchImage?: (url: string, attempt: number) => FetchedImage | Error; writeCbz?: ChapterDownloaderDependencies['writeCbz']; format?: 'cbz' | 'folder' } = {}): Setup {
    const dir = makeTempDir();
    const fetched: string[] = [];
    const sleeps: number[] = [];
    const signals: AbortSignal[] = [];
    const attempts = new Map<string, number>();
    const pageCounts: number[] = [];
    const progress: Array<[number, number]> = [];
    const format = parts.format ?? 'cbz';
    const outputPath = join(dir, format === 'cbz' ? 'Chapter 1.cbz' : 'Chapter 1');
    const downloader = new MangaChapterDownloader({
        pages: () => {
            const pages = parts.pages ?? PAGES;
            return pages instanceof Error ? Promise.reject(pages) : Promise.resolve(pages);
        },
        fetchImage: (url, signal) => {
            fetched.push(url);
            signals.push(signal);
            const attempt = (attempts.get(url) ?? 0) + 1;
            attempts.set(url, attempt);
            const answer = parts.fetchImage ? parts.fetchImage(url, attempt) : image(JPEG);
            return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
        },
        writeCbz: parts.writeCbz,
        sleep: (milliseconds) => {
            sleeps.push(milliseconds);
            return Promise.resolve();
        }
    });
    const options = (overrides: Partial<ChapterDownloadOptions> = {}): ChapterDownloadOptions => {
        return {
            chapterRemoteId: 11,
            seriesTitle: 'One Piece',
            chapter: { name: 'Romance Dawn', number: 1, scanlator: null },
            details: { author: 'Oda', artist: null, description: null, genres: ['Action'] },
            format,
            outputPath,
            onPageCount: (count) => {
                pageCounts.push(count);
            },
            onProgress: (done, total) => {
                progress.push([done, total]);
            },
            ...overrides
        };
    };
    return { downloader, dir, outputPath, fetched, sleeps, pageCounts, progress, options, signals };
}

afterEach(() => {
    cleanTempDirs();
});

describe('MangaChapterDownloader into a CBZ', () => {
    it('downloads every page, in order, and makes the CBZ with the ComicInfo', async () => {
        const context = setup({ fetchImage: (url) => {
            return image(url.endsWith('/1') ? PNG : url.endsWith('/2') ? WEBP : JPEG, null);
        } });
        const result = await context.downloader.download(context.options()).result;
        expect(result.status).toBe('done');
        if (result.status !== 'done') {
            return;
        }
        expect(result.value).toEqual({ filePath: context.outputPath, sizeBytes: readFileSync(context.outputPath).length, pageCount: 3, missingPages: [] });
        const entries = readZipEntries(readFileSync(context.outputPath));
        expect(entries.map((entry) => {
            return entry.name;
        })).toEqual(['001.jpg', '002.png', '003.webp', 'ComicInfo.xml']);
        expect([...entries[0]!.data]).toEqual([...JPEG]);
        expect([...entries[1]!.data]).toEqual([...PNG]);
        expect(entries[3]!.data.toString('utf-8')).toBe(
            buildComicInfo({
                seriesTitle: 'One Piece',
                chapter: { name: 'Romance Dawn', number: 1, scanlator: null },
                details: { author: 'Oda', artist: null, description: null, genres: ['Action'] },
                pageCount: 3
            })
        );
        expect(context.fetched).toEqual(PAGES);
        expect(context.pageCounts).toEqual([3]);
        expect(context.progress).toEqual([[1, 3], [2, 3], [3, 3]]);
        expect(readdirSync(context.dir)).toEqual(['Chapter 1.cbz']);
    });

    it('names the pages with a width that sorts for long chapters', async () => {
        const pages = Array.from({ length: 1000 }, (_value, index) => {
            return `http://127.0.0.1:1/p/${index}`;
        });
        const context = setup({ pages });
        const result = await context.downloader.download(context.options()).result;
        expect(result.status).toBe('done');
        const names = readZipEntries(readFileSync(context.outputPath)).map((entry) => {
            return entry.name;
        });
        expect(names[0]).toBe('0001.jpg');
        expect(names[999]).toBe('1000.jpg');
    }, 30000);

    it('trusts the bytes over the content type, and the content type when the bytes are unknown', async () => {
        const context = setup({ pages: PAGES.slice(0, 2), fetchImage: (url) => {
            return url.endsWith('/0') ? image(PNG, 'image/jpeg') : image(Uint8Array.from([1, 2, 3]), 'image/webp');
        } });
        await context.downloader.download(context.options()).result;
        expect(readZipEntries(readFileSync(context.outputPath)).map((entry) => {
            return entry.name;
        })).toEqual(['001.png', '002.webp', 'ComicInfo.xml']);
    });

    it('does not ask for the pages that are already there, and ignores a half-written one', async () => {
        const context = setup();
        const work = `${context.outputPath}.part`;
        mkdirSync(work, { recursive: true });
        writeFileSync(join(work, '001.jpg'), Buffer.from(JPEG));
        writeFileSync(join(work, '002.tmp'), 'half');
        const result = await context.downloader.download(context.options()).result;
        expect(result.status).toBe('done');
        expect(context.fetched).toEqual([PAGES[1], PAGES[2]]);
        expect(readZipEntries(readFileSync(context.outputPath)).map((entry) => {
            return entry.name;
        })).toEqual(['001.jpg', '002.jpg', '003.jpg', 'ComicInfo.xml']);
        expect(context.progress).toEqual([[1, 3], [2, 3], [3, 3]]);
    });
});

describe('MangaChapterDownloader a server that does not answer', () => {
    const MANY = Array.from({ length: 12 }, (_value, index) => {
        return `http://127.0.0.1:1/p/${index}`;
    });
    const NO_ANSWER = (): FetchedImage => {
        return image(new Uint8Array(), null, 503);
    };

    function failing(indexes: number[], answer: () => FetchedImage | Error = NO_ANSWER) {
        return (url: string): FetchedImage | Error => {
            return indexes.includes(Number(url.split('/').pop())) ? answer() : image(JPEG);
        };
    }

    it('gives up the chapter after the pages that fail one after the other because of the server, without waiting for the rest', async () => {
        expect(MAX_CONSECUTIVE_SERVER_FAILURES).toBe(5);
        const context = setup({ pages: MANY, fetchImage: failing([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) });
        const result = await context.downloader.download(context.options()).result;
        expect(result).toEqual({ status: 'error', error: { code: 'REQUEST_FAILED', message: 'The server answered 503 for a page' } });
        // Two pages that arrived, then five pages with their three tries each; none of the other five was asked for.
        expect(context.fetched).toHaveLength(2 + 5 * (1 + PAGE_RETRY_DELAYS_MS.length));
        expect(context.fetched.at(-1)).toBe(MANY[6]);
        expect(context.progress).toEqual([[1, 12], [2, 12], [3, 12], [4, 12], [5, 12], [6, 12]]);
        expect(readdirSync(`${context.outputPath}.part`).sort()).toEqual(['001.jpg', '002.jpg']);
        expect(existsSync(context.outputPath)).toBe(false);
    });

    it('counts the pages the connection could not get as the ones the server did not answer', async () => {
        const context = setup({ pages: MANY, fetchImage: failing([0, 1, 2, 3, 4, 5], () => {
            return Object.assign(new Error('the server is gone'), { code: 'SERVER_UNAVAILABLE' });
        }) });
        const result = await context.downloader.download(context.options()).result;
        expect(result).toEqual({ status: 'error', error: { code: 'SERVER_UNAVAILABLE', message: 'the server is gone' } });
        expect(context.fetched).toHaveLength(5 * (1 + PAGE_RETRY_DELAYS_MS.length));
    });

    it('starts the count again when a page arrives, so scattered failures only leave pages missing', async () => {
        const missing = [0, 1, 2, 3, 5, 6, 7, 8, 10, 11];
        const context = setup({ pages: MANY, fetchImage: failing(missing) });
        const result = await context.downloader.download(context.options()).result;
        expect(result.status).toBe('done');
        expect(result.status === 'done' ? result.value.missingPages : null).toEqual(missing);
        expect(readZipEntries(readFileSync(context.outputPath)).map((entry) => {
            return entry.name;
        })).toEqual(['005.jpg', '010.jpg', 'ComicInfo.xml']);
    });

    it('does not count the pages that are not images or that the app refuses, which fail at once', async () => {
        const context = setup({ pages: MANY, fetchImage: failing([0, 1, 2, 3, 4, 5, 6, 7], () => {
            return image(HTML, 'text/html');
        }) });
        const result = await context.downloader.download(context.options()).result;
        expect(result.status === 'done' ? result.value.missingPages : null).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
        expect(context.sleeps).toHaveLength(8 * PAGE_RETRY_DELAYS_MS.length);
        const refused = setup({ pages: MANY, fetchImage: failing([0, 1, 2, 3, 4, 5, 6], () => {
            return new ImageFetchError('The page is not on the server of the app');
        }) });
        const answer = await refused.downloader.download(refused.options()).result;
        expect(answer.status === 'done' ? answer.value.missingPages : null).toEqual([0, 1, 2, 3, 4, 5, 6]);
        expect(refused.sleeps).toEqual([]);
    });

    it('does not let a page that is not an image or refused interrupt the count of the server failures', async () => {
        const context = setup({ pages: MANY, fetchImage: (url) => {
            const index = Number(url.split('/').pop());
            if (index === 2) {
                return image(HTML, 'text/html');
            }
            return index < 5 ? NO_ANSWER() : image(JPEG);
        } });
        const result = await context.downloader.download(context.options()).result;
        expect(result.status).toBe('done');
        expect(result.status === 'done' ? result.value.missingPages : null).toEqual([0, 1, 2, 3, 4]);
    });
});

describe('MangaChapterDownloader into a folder', () => {
    it('makes the folder with the pages and the ComicInfo, and nothing else', async () => {
        const context = setup({ format: 'folder' });
        const result = await context.downloader.download(context.options()).result;
        expect(result.status).toBe('done');
        if (result.status !== 'done') {
            return;
        }
        expect(readdirSync(context.outputPath).sort()).toEqual(['001.jpg', '002.jpg', '003.jpg', 'ComicInfo.xml']);
        expect(readdirSync(context.dir)).toEqual(['Chapter 1']);
        const expectedSize = readdirSync(context.outputPath).reduce((total, file) => {
            return total + readFileSync(join(context.outputPath, file)).length;
        }, 0);
        expect(result.value).toEqual({ filePath: context.outputPath, sizeBytes: expectedSize, pageCount: 3, missingPages: [] });
    });

    it('fails and keeps the pages when the place for the folder is taken', async () => {
        const context = setup({ format: 'folder' });
        mkdirSync(context.outputPath, { recursive: true });
        const result = await context.downloader.download(context.options()).result;
        expect(result).toEqual({ status: 'error', error: { code: 'DISK', message: 'The place for the chapter is taken' } });
        expect(existsSync(`${context.outputPath}.part`)).toBe(true);
    });
});

describe('MangaChapterDownloader failures', () => {
    it('asks again for a page that failed, waiting longer each time', async () => {
        const context = setup({ pages: [PAGES[0]!], fetchImage: (_url, attempt) => {
            return attempt < 3 ? image(new Uint8Array(), null, 503) : image(JPEG);
        } });
        const result = await context.downloader.download(context.options()).result;
        expect(result.status).toBe('done');
        expect(context.fetched).toHaveLength(3);
        expect(context.sleeps).toEqual([...PAGE_RETRY_DELAYS_MS]);
    });

    it('skips a page that keeps failing and finishes the chapter without it', async () => {
        const context = setup({ fetchImage: (url) => {
            return url.endsWith('/1') ? image(new Uint8Array(), null, 500) : image(JPEG);
        } });
        const result = await context.downloader.download(context.options()).result;
        expect(result.status).toBe('done');
        if (result.status !== 'done') {
            return;
        }
        expect(result.value).toEqual({ filePath: context.outputPath, sizeBytes: readFileSync(context.outputPath).length, pageCount: 3, missingPages: [1] });
        expect(context.fetched).toEqual([PAGES[0], PAGES[1], PAGES[1], PAGES[1], PAGES[2]]);
        expect(context.sleeps).toEqual([...PAGE_RETRY_DELAYS_MS]);
        expect(context.progress).toEqual([[1, 3], [2, 3], [3, 3]]);
        const entries = readZipEntries(readFileSync(context.outputPath));
        expect(entries.map((entry) => {
            return entry.name;
        })).toEqual(['001.jpg', '003.jpg', 'ComicInfo.xml']);
        expect(entries[2]!.data.toString('utf-8')).toBe(
            buildComicInfo({
                seriesTitle: 'One Piece',
                chapter: { name: 'Romance Dawn', number: 1, scanlator: null },
                details: { author: 'Oda', artist: null, description: null, genres: ['Action'] },
                pageCount: 2
            })
        );
        expect(readdirSync(context.dir)).toEqual(['Chapter 1.cbz']);
    });

    it('skips the pages that are not images or that the app refuses to fetch, and tells which ones are missing', async () => {
        const context = setup({ pages: [...PAGES, 'http://127.0.0.1:1/p/3', 'http://127.0.0.1:1/p/4'], fetchImage: (url) => {
            if (url.endsWith('/0')) {
                return image(HTML, 'text/html');
            }
            if (url.endsWith('/3')) {
                return new ImageFetchError('The page is not on the server of the app');
            }
            return image(JPEG);
        } });
        const result = await context.downloader.download(context.options()).result;
        expect(result).toEqual({ status: 'done', value: { filePath: context.outputPath, sizeBytes: readFileSync(context.outputPath).length, pageCount: 5, missingPages: [0, 3] } });
        expect(readZipEntries(readFileSync(context.outputPath)).map((entry) => {
            return entry.name;
        })).toEqual(['002.jpg', '003.jpg', '005.jpg', 'ComicInfo.xml']);
    });

    it('skips a page that keeps failing in a folder too', async () => {
        const context = setup({ format: 'folder', fetchImage: (url) => {
            return url.endsWith('/0') ? new Error('ECONNRESET') : image(JPEG);
        } });
        const result = await context.downloader.download(context.options()).result;
        expect(result.status).toBe('done');
        expect(result.status === 'done' ? result.value.missingPages : null).toEqual([0]);
        expect(readdirSync(context.outputPath).sort()).toEqual(['002.jpg', '003.jpg', 'ComicInfo.xml']);
    });

    it('asks again, when it goes on, for the pages it had skipped', async () => {
        const context = setup();
        const work = `${context.outputPath}.part`;
        mkdirSync(work, { recursive: true });
        writeFileSync(join(work, '001.jpg'), Buffer.from(JPEG));
        writeFileSync(join(work, '003.jpg'), Buffer.from(JPEG));
        const result = await context.downloader.download(context.options()).result;
        expect(result.status === 'done' ? result.value.missingPages : null).toEqual([]);
        expect(context.fetched).toEqual([PAGES[1]]);
    });

    it('fails with the last failure when no page at all could be downloaded', async () => {
        const context = setup({ fetchImage: (url) => {
            return url.endsWith('/2') ? image(new Uint8Array(), null, 503) : image(HTML, 'text/html');
        } });
        const result = await context.downloader.download(context.options()).result;
        expect(result).toEqual({ status: 'error', error: { code: 'REQUEST_FAILED', message: 'The server answered 503 for a page' } });
        expect(existsSync(context.outputPath)).toBe(false);
    });

    it('treats a network failure as a failure of the request and asks again', async () => {
        const context = setup({ pages: [PAGES[0]!], fetchImage: () => {
            return new Error('ECONNRESET');
        } });
        const result = await context.downloader.download(context.options()).result;
        expect(result).toEqual({ status: 'error', error: { code: 'REQUEST_FAILED', message: 'ECONNRESET' } });
        expect(context.fetched).toHaveLength(1 + PAGE_RETRY_DELAYS_MS.length);
    });

    it('treats a page that is not an image as an error after asking again', async () => {
        const context = setup({ pages: [PAGES[0]!], fetchImage: () => {
            return image(HTML, 'text/html');
        } });
        const result = await context.downloader.download(context.options()).result;
        expect(result).toEqual({ status: 'error', error: { code: 'IMAGE', message: 'A page is not an image' } });
        expect(context.fetched).toHaveLength(3);
        expect(readdirSync(`${context.outputPath}.part`)).toEqual([]);
    });

    it('accepts a page the server says is an image even if its bytes are not known', async () => {
        const context = setup({ pages: [PAGES[0]!], fetchImage: () => {
            return image(Uint8Array.from([1, 2, 3]), 'image/jxl');
        } });
        const result = await context.downloader.download(context.options()).result;
        expect(result.status).toBe('done');
    });

    it('treats an empty page as an error', async () => {
        const context = setup({ pages: [PAGES[0]!], fetchImage: () => {
            return image(new Uint8Array());
        } });
        expect(await context.downloader.download(context.options()).result).toEqual({ status: 'error', error: { code: 'IMAGE', message: 'A page came back empty' } });
    });

    it('does not ask again for a page that the app refuses to fetch', async () => {
        const context = setup({ pages: [PAGES[0]!], fetchImage: () => {
            return new ImageFetchError('The page is not on the server of the app');
        } });
        const result = await context.downloader.download(context.options()).result;
        expect(result).toEqual({ status: 'error', error: { code: 'IMAGE', message: 'The page is not on the server of the app' } });
        expect(context.fetched).toHaveLength(1);
        expect(context.sleeps).toEqual([]);
    });

    it('fails without asking for anything when the chapter has no pages', async () => {
        const context = setup({ pages: [] });
        const result = await context.downloader.download(context.options()).result;
        expect(result).toEqual({ status: 'error', error: { code: 'EMPTY_CHAPTER', message: 'The chapter has no pages' } });
        expect(context.fetched).toEqual([]);
        expect(context.pageCounts).toEqual([]);
        expect(existsSync(`${context.outputPath}.part`)).toBe(false);
    });

    it.each(['SERVER_UNAVAILABLE', 'REQUEST_FAILED', 'API_ERROR', 'INVALID_RESPONSE'] as const)('keeps the code %s when the list of pages cannot be had', async (code) => {
        const context = setup({ pages: Object.assign(new Error('the server said no'), { code }) });
        expect(await context.downloader.download(context.options()).result).toEqual({ status: 'error', error: { code, message: 'the server said no' } });
    });

    it('reports an error it does not know as UNKNOWN', async () => {
        const context = setup({ pages: new Error('something odd') });
        expect(await context.downloader.download(context.options()).result).toEqual({ status: 'error', error: { code: 'UNKNOWN', message: 'something odd' } });
    });

    it.each(['ENOSPC', 'EACCES', 'EPERM', 'EROFS', 'EDQUOT', 'ENAMETOOLONG'])('reports %s while making the CBZ as a disk problem', async (code) => {
        const context = setup({ writeCbz: () => {
            return Promise.reject(Object.assign(new Error('disk trouble'), { code }));
        } });
        expect(await context.downloader.download(context.options()).result).toEqual({ status: 'error', error: { code: 'DISK', message: 'disk trouble' } });
        expect(context.fetched).toEqual(PAGES);
    });

    it('fails before asking for any page when the work folder cannot be made', async () => {
        const context = setup({ pages: [PAGES[0]!] });
        const blocker = join(context.dir, 'Chapter 1.cbz.part');
        writeFileSync(blocker, 'a file where the folder should be');
        const result = await context.downloader.download(context.options()).result;
        expect(result).toMatchObject({ status: 'error', error: { code: 'UNKNOWN' } });
        expect(result.status === 'error' ? result.error.message : '').toContain('EEXIST');
        expect(context.fetched).toEqual([]);
    });
});

describe('MangaChapterDownloader cancelling', () => {
    it('stops, tells it was cancelled and keeps the pages it has for a later start', async () => {
        const context = setup();
        const holder: { handle: ReturnType<MangaChapterDownloader['download']> | null } = { handle: null };
        const downloader = new MangaChapterDownloader({
            pages: () => {
                return Promise.resolve(PAGES);
            },
            fetchImage: (url, signal) => {
                context.fetched.push(url);
                if (url === PAGES[1]) {
                    holder.handle?.cancel();
                    signal.throwIfAborted();
                }
                return Promise.resolve(image(JPEG));
            },
            sleep: () => {
                return Promise.resolve();
            }
        });
        const handle = downloader.download(context.options());
        holder.handle = handle;
        expect(await handle.result).toEqual({ status: 'cancelled' });
        expect(readdirSync(`${context.outputPath}.part`)).toEqual(['001.jpg']);
        expect(existsSync(context.outputPath)).toBe(false);
        expect(context.fetched).toEqual([PAGES[0], PAGES[1]]);
    });

    it('goes on from the pages it kept when started again', async () => {
        const first = setup();
        const work = `${first.outputPath}.part`;
        mkdirSync(work, { recursive: true });
        writeFileSync(join(work, '001.jpg'), Buffer.from(JPEG));
        const again = await first.downloader.download(first.options()).result;
        expect(again.status).toBe('done');
        expect(first.fetched).toEqual([PAGES[1], PAGES[2]]);
    });

    it('tells it was cancelled when it is cancelled before it starts', async () => {
        const context = setup();
        const handle = context.downloader.download(context.options());
        handle.cancel();
        expect(await handle.result).toEqual({ status: 'cancelled' });
    });

    it('gives the same signal to every page it asks for', async () => {
        const context = setup();
        await context.downloader.download(context.options()).result;
        expect(context.signals).toHaveLength(3);
        expect(new Set(context.signals).size).toBe(1);
    });
});

describe('MangaChapterDownloader downloading again the missing pages', () => {
    interface Repairing {
        context: Setup;
        failing: Set<string>;
        // Whether the pages in `failing` fail because the server does not answer (otherwise because they are not images).
        serverDown: { value: boolean };
        repairOptions: (overrides?: Partial<ChapterRepairOptions>) => ChapterRepairOptions;
        fetchedBefore: () => number;
    }

    // A chapter that was downloaded while the pages in `failing` failed; those pages answer from then on only when `failing` is emptied.
    async function incompleteChapter(failingUrls: string[], format: 'cbz' | 'folder' = 'cbz', pages: string[] = PAGES, serverDownAtFirst = true): Promise<Repairing> {
        const failing = new Set(failingUrls);
        const serverDown = { value: serverDownAtFirst };
        const context = setup({ format, pages, fetchImage: (url) => {
            if (!failing.has(url)) {
                return image(PNG, 'image/png');
            }
            return serverDown.value ? image(new Uint8Array(), null, 500) : image(HTML, 'text/html');
        } });
        const first = await context.downloader.download(context.options()).result;
        expect(first.status).toBe('done');
        const fetchedBefore = context.fetched.length;
        return {
            context,
            failing,
            serverDown,
            fetchedBefore: () => {
                return fetchedBefore;
            },
            repairOptions: (overrides = {}) => {
                return {
                    chapterRemoteId: 11,
                    seriesTitle: 'One Piece',
                    chapter: { name: 'Romance Dawn', number: 1, scanlator: null },
                    details: { author: 'Oda', artist: null, description: null, genres: ['Action'] },
                    filePath: context.outputPath,
                    pageCount: pages.length,
                    pageIndex: null,
                    ...overrides
                };
            }
        };
    }

    function comicInfoOf(pageCount: number): string {
        return buildComicInfo({
            seriesTitle: 'One Piece',
            chapter: { name: 'Romance Dawn', number: 1, scanlator: null },
            details: { author: 'Oda', artist: null, description: null, genres: ['Action'] },
            pageCount
        });
    }

    it('downloads only the missing pages into the CBZ and keeps the ones it had', async () => {
        const { context, failing, repairOptions, fetchedBefore } = await incompleteChapter([PAGES[1]!]);
        failing.clear();
        const result = await context.downloader.repair(repairOptions());
        expect(result).toEqual({ status: 'done', value: { filePath: context.outputPath, sizeBytes: readFileSync(context.outputPath).length, pageCount: 3, missingPages: [] } });
        expect(context.fetched.slice(fetchedBefore())).toEqual([PAGES[1]]);
        const entries = readZipEntries(readFileSync(context.outputPath));
        expect(entries.map((entry) => {
            return entry.name;
        })).toEqual(['001.png', '002.png', '003.png', 'ComicInfo.xml']);
        expect([...entries[0]!.data]).toEqual([...PNG]);
        expect([...entries[1]!.data]).toEqual([...PNG]);
        expect(entries[3]!.data.toString('utf-8')).toBe(comicInfoOf(3));
        expect(readdirSync(context.dir)).toEqual(['Chapter 1.cbz']);
    });

    it('downloads only the page asked for and leaves the others missing', async () => {
        const { context, failing, repairOptions, fetchedBefore } = await incompleteChapter([PAGES[0]!, PAGES[2]!]);
        failing.clear();
        const result = await context.downloader.repair(repairOptions({ pageIndex: 2 }));
        expect(result.status === 'done' ? result.value.missingPages : null).toEqual([0]);
        expect(context.fetched.slice(fetchedBefore())).toEqual([PAGES[2]]);
        expect(readZipEntries(readFileSync(context.outputPath)).map((entry) => {
            return entry.name;
        })).toEqual(['002.png', '003.png', 'ComicInfo.xml']);
    });

    it('keeps the pages it could get and the ones that failed again stay missing', async () => {
        const { context, failing, repairOptions } = await incompleteChapter([PAGES[0]!, PAGES[2]!]);
        failing.delete(PAGES[0]!);
        const result = await context.downloader.repair(repairOptions());
        expect(result).toEqual({ status: 'done', value: { filePath: context.outputPath, sizeBytes: readFileSync(context.outputPath).length, pageCount: 3, missingPages: [2] } });
        const entries = readZipEntries(readFileSync(context.outputPath));
        expect(entries.map((entry) => {
            return entry.name;
        })).toEqual(['001.png', '002.png', 'ComicInfo.xml']);
        expect(entries[2]!.data.toString('utf-8')).toBe(comicInfoOf(2));
    });

    it('fails, leaving the CBZ as it was, when none of the pages asked for could be downloaded', async () => {
        const { context, repairOptions } = await incompleteChapter([PAGES[1]!]);
        const before = readFileSync(context.outputPath);
        const result = await context.downloader.repair(repairOptions());
        expect(result).toEqual({ status: 'error', error: { code: 'REQUEST_FAILED', message: 'The server answered 500 for a page' } });
        expect(readFileSync(context.outputPath).equals(before)).toBe(true);
        expect(readdirSync(context.dir)).toEqual(['Chapter 1.cbz']);
    });

    it('asks again for a page that failed, waiting longer each time', async () => {
        const { context, repairOptions } = await incompleteChapter([PAGES[1]!]);
        context.sleeps.length = 0;
        await context.downloader.repair(repairOptions());
        expect(context.sleeps).toEqual([...PAGE_RETRY_DELAYS_MS]);
    });

    it('rebuilds the CBZ without asking for anything when no page is lacking', async () => {
        const { context, repairOptions, fetchedBefore } = await incompleteChapter([]);
        const result = await context.downloader.repair(repairOptions());
        expect(result.status === 'done' ? result.value.missingPages : null).toEqual([]);
        expect(context.fetched).toHaveLength(fetchedBefore());
    });

    it('asks for nothing when the page asked for is already there', async () => {
        const { context, repairOptions, fetchedBefore } = await incompleteChapter([PAGES[1]!]);
        const result = await context.downloader.repair(repairOptions({ pageIndex: 0 }));
        expect(result.status === 'done' ? result.value.missingPages : null).toEqual([1]);
        expect(context.fetched).toHaveLength(fetchedBefore());
    });

    it('does not take what a work folder left by an earlier try has', async () => {
        const { context, failing, repairOptions } = await incompleteChapter([PAGES[1]!]);
        const work = `${context.outputPath}.part`;
        mkdirSync(work, { recursive: true });
        writeFileSync(join(work, '002.jpg'), 'stale');
        failing.clear();
        await context.downloader.repair(repairOptions());
        const entries = readZipEntries(readFileSync(context.outputPath));
        expect([...entries[1]!.data]).toEqual([...PNG]);
        expect(existsSync(work)).toBe(false);
    });

    it('works in place on a folder of images and writes its ComicInfo again', async () => {
        const { context, failing, repairOptions, fetchedBefore } = await incompleteChapter([PAGES[2]!], 'folder');
        expect(readdirSync(context.outputPath).sort()).toEqual(['001.png', '002.png', 'ComicInfo.xml']);
        expect(readFileSync(join(context.outputPath, 'ComicInfo.xml'), 'utf-8')).toBe(comicInfoOf(2));
        failing.clear();
        const result = await context.downloader.repair(repairOptions());
        const expectedSize = readdirSync(context.outputPath).reduce((total, file) => {
            return total + readFileSync(join(context.outputPath, file)).length;
        }, 0);
        expect(result).toEqual({ status: 'done', value: { filePath: context.outputPath, sizeBytes: expectedSize, pageCount: 3, missingPages: [] } });
        expect(context.fetched.slice(fetchedBefore())).toEqual([PAGES[2]]);
        expect(readdirSync(context.outputPath).sort()).toEqual(['001.png', '002.png', '003.png', 'ComicInfo.xml']);
        expect(readFileSync(join(context.outputPath, 'ComicInfo.xml'), 'utf-8')).toBe(comicInfoOf(3));
        expect(readdirSync(context.dir)).toEqual(['Chapter 1']);
    });

    it('fails, leaving the folder as it was, when the page could not be downloaded', async () => {
        const { context, repairOptions } = await incompleteChapter([PAGES[2]!], 'folder');
        const result = await context.downloader.repair(repairOptions({ pageIndex: 2 }));
        expect(result).toEqual({ status: 'error', error: { code: 'REQUEST_FAILED', message: 'The server answered 500 for a page' } });
        expect(readdirSync(context.outputPath).sort()).toEqual(['001.png', '002.png', 'ComicInfo.xml']);
    });

    it('refuses to go on when the source has another number of pages now', async () => {
        const { context, repairOptions } = await incompleteChapter([PAGES[1]!]);
        const result = await context.downloader.repair(repairOptions({ pageCount: 5 }));
        expect(result).toEqual({ status: 'error', error: { code: 'INVALID_RESPONSE', message: 'The source has another number of pages now' } });
        expect(readdirSync(context.dir)).toEqual(['Chapter 1.cbz']);
    });

    it('reports the failure to get the list of pages', async () => {
        const failing = new MangaChapterDownloader({
            pages: () => {
                return Promise.reject(Object.assign(new Error('the server said no'), { code: 'SERVER_UNAVAILABLE' }));
            },
            fetchImage: () => {
                return Promise.resolve(image(JPEG));
            }
        });
        const result = await failing.repair({
            chapterRemoteId: 11,
            seriesTitle: 'One Piece',
            chapter: { name: 'Romance Dawn', number: 1, scanlator: null },
            details: null,
            filePath: join(makeTempDir(), 'Chapter 1.cbz'),
            pageCount: 3,
            pageIndex: null
        });
        expect(result).toEqual({ status: 'error', error: { code: 'SERVER_UNAVAILABLE', message: 'the server said no' } });
    });

    it('uses the extractor it is given to open the CBZ', async () => {
        const dir = makeTempDir();
        const filePath = join(dir, 'Chapter 1.cbz');
        writeFileSync(filePath, 'not a zip');
        const extracted: Array<[string, string]> = [];
        const downloader = new MangaChapterDownloader({
            pages: () => {
                return Promise.resolve(PAGES);
            },
            fetchImage: () => {
                return Promise.resolve(image(JPEG));
            },
            extractCbzPages: (file, directory) => {
                extracted.push([file, directory]);
                writeFileSync(join(directory, '001.jpg'), Buffer.from(JPEG));
                writeFileSync(join(directory, '003.jpg'), Buffer.from(JPEG));
                return Promise.resolve();
            }
        });
        const result = await downloader.repair({
            chapterRemoteId: 11,
            seriesTitle: 'One Piece',
            chapter: { name: 'Romance Dawn', number: 1, scanlator: null },
            details: null,
            filePath,
            pageCount: 3,
            pageIndex: null
        });
        expect(extracted).toEqual([[filePath, `${filePath}.part`]]);
        expect(result.status === 'done' ? result.value.missingPages : null).toEqual([]);
        expect(readZipEntries(readFileSync(filePath)).map((entry) => {
            return entry.name;
        })).toEqual(['001.jpg', '002.jpg', '003.jpg', 'ComicInfo.xml']);
    });

    it('gives up after the pages that fail one after the other because the server does not answer', async () => {
        const pages = Array.from({ length: 9 }, (_value, index) => {
            return `http://127.0.0.1:1/p/${index}`;
        });
        const lacking = pages.slice(1, 8);
        const { context, serverDown, repairOptions, fetchedBefore } = await incompleteChapter(lacking, 'cbz', pages, false);
        const before = readFileSync(context.outputPath);
        serverDown.value = true;
        const result = await context.downloader.repair(repairOptions());
        expect(result).toEqual({ status: 'error', error: { code: 'REQUEST_FAILED', message: 'The server answered 500 for a page' } });
        expect(context.fetched.slice(fetchedBefore())).toHaveLength(MAX_CONSECUTIVE_SERVER_FAILURES * (1 + PAGE_RETRY_DELAYS_MS.length));
        expect(readFileSync(context.outputPath).equals(before)).toBe(true);
        expect(readdirSync(context.dir)).toEqual(['Chapter 1.cbz']);
    });

    it('tells it was cancelled, leaving the CBZ as it was and no work folder, when it is aborted', async () => {
        const { context, repairOptions, fetchedBefore } = await incompleteChapter([PAGES[1]!]);
        const before = readFileSync(context.outputPath);
        const controller = new AbortController();
        controller.abort();
        expect(await context.downloader.repair(repairOptions(), controller.signal)).toEqual({ status: 'cancelled' });
        expect(context.fetched).toHaveLength(fetchedBefore());
        expect(readFileSync(context.outputPath).equals(before)).toBe(true);
        expect(readdirSync(context.dir)).toEqual(['Chapter 1.cbz']);
    });

    it('stops in the middle of the pages when it is aborted, and gives the signal to the pages it asks for', async () => {
        const { context, failing, repairOptions, fetchedBefore } = await incompleteChapter([PAGES[1]!, PAGES[2]!]);
        failing.clear();
        const controller = new AbortController();
        const downloader = new MangaChapterDownloader({
            pages: () => {
                return Promise.resolve(PAGES);
            },
            fetchImage: (url, signal) => {
                context.fetched.push(url);
                context.signals.push(signal);
                if (url === PAGES[1]) {
                    controller.abort();
                    signal.throwIfAborted();
                }
                return Promise.resolve(image(PNG, 'image/png'));
            },
            sleep: () => {
                return Promise.resolve();
            }
        });
        expect(await downloader.repair(repairOptions({ pageCount: 3 }), controller.signal)).toEqual({ status: 'cancelled' });
        expect(context.fetched.slice(fetchedBefore())).toEqual([PAGES[1]]);
        expect(context.signals.at(-1)).toBe(controller.signal);
        expect(readdirSync(context.dir)).toEqual(['Chapter 1.cbz']);
    });
});
