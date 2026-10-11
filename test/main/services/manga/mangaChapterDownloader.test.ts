import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MangaChapterDownloader, PAGE_RETRY_DELAYS_MS, type ChapterDownloadOptions, type ChapterDownloaderDependencies } from '@main/services/manga/mangaChapterDownloader';
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
        expect(result.value).toEqual({ filePath: context.outputPath, sizeBytes: readFileSync(context.outputPath).length, pageCount: 3 });
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
        expect(result.value).toEqual({ filePath: context.outputPath, sizeBytes: expectedSize, pageCount: 3 });
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

    it('gives up on a page that keeps failing and keeps the pages it has', async () => {
        const context = setup({ fetchImage: (url) => {
            return url.endsWith('/1') ? image(new Uint8Array(), null, 500) : image(JPEG);
        } });
        const result = await context.downloader.download(context.options()).result;
        expect(result).toEqual({ status: 'error', error: { code: 'REQUEST_FAILED', message: 'The server answered 500 for a page' } });
        expect(context.fetched).toEqual([PAGES[0], PAGES[1], PAGES[1], PAGES[1]]);
        expect(readdirSync(`${context.outputPath}.part`)).toEqual(['001.jpg']);
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
