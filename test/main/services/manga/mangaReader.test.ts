import { MangaReader } from '@main/services/manga/mangaReader';
import { SuwayomiApiError } from '@main/services/manga/suwayomiClient';

function setup(options: { file?: string | null; count?: number | Error; remote?: string[] | Error; exists?: boolean; incompletePageCount?: number | null; missing?: number[] } = {}) {
    const fileOf = vi.fn(() => {
        return options.file === undefined ? '/manga/One Piece/Chapter 1.cbz' : options.file;
    });
    const count = vi.fn(() => {
        const value = options.count ?? 3;
        return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
    });
    const remotePages = vi.fn(() => {
        const value = options.remote ?? ['http://127.0.0.1:4321/api/v1/manga/7/chapter/11/page/0'];
        return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
    });
    const missing = vi.fn(() => {
        return Promise.resolve(options.missing ?? []);
    });
    const incompletePageCount = vi.fn(() => {
        return options.incompletePageCount ?? null;
    });
    const pathExists = vi.fn(() => {
        return options.exists ?? true;
    });
    return { reader: new MangaReader({ fileOf, incompletePageCount, localPages: { count, missing }, remotePages, pathExists }), fileOf, count, missing, incompletePageCount, remotePages, pathExists };
}

describe('MangaReader', () => {
    it('gives the pages of the file when the chapter was downloaded, and asks the source for nothing', async () => {
        const { reader, fileOf, count, remotePages, pathExists } = setup();
        await expect(reader.pages({ chapterRemoteId: 11, libraryChapterId: 4 })).resolves.toEqual({
            ok: true,
            value: { pages: ['pullwave-manga://page/4/0', 'pullwave-manga://page/4/1', 'pullwave-manga://page/4/2'], local: true, missing: [] }
        });
        expect(fileOf).toHaveBeenCalledWith(4);
        expect(pathExists).toHaveBeenCalledWith('/manga/One Piece/Chapter 1.cbz');
        expect(count).toHaveBeenCalledWith('/manga/One Piece/Chapter 1.cbz');
        expect(remotePages).not.toHaveBeenCalled();
    });

    it('asks the source when the chapter is not in the library', async () => {
        const { reader, fileOf, remotePages } = setup();
        await expect(reader.pages({ chapterRemoteId: 11, libraryChapterId: null })).resolves.toEqual({
            ok: true,
            value: { pages: ['http://127.0.0.1:4321/api/v1/manga/7/chapter/11/page/0'], local: false, missing: [] }
        });
        expect(fileOf).not.toHaveBeenCalled();
        expect(remotePages).toHaveBeenCalledWith(11);
    });

    it.each([
        ['it has no file', { file: null }],
        ['its file is gone', { exists: false }],
        ['its file has no image', { count: 0 }],
        ['its file cannot be read', { count: new Error('bad zip') }]
    ])('asks the source when %s', async (_label, options) => {
        const { reader, remotePages } = setup(options);
        await expect(reader.pages({ chapterRemoteId: 11, libraryChapterId: 4 })).resolves.toMatchObject({ ok: true, value: { local: false } });
        expect(remotePages).toHaveBeenCalledWith(11);
    });

    it('gives the error of the source, in the shape the screen takes', async () => {
        const { reader } = setup({ remote: new SuwayomiApiError('API_ERROR', 'Cloudflare bypass currently disabled') });
        await expect(reader.pages({ chapterRemoteId: 11, libraryChapterId: null })).resolves.toEqual({ ok: false, error: { code: 'API_ERROR', message: 'Cloudflare bypass currently disabled' } });
        const other = setup({ remote: new Error('offline') });
        await expect(other.reader.pages({ chapterRemoteId: 11, libraryChapterId: null })).resolves.toEqual({ ok: false, error: { code: 'UNKNOWN', message: 'offline' } });
    });

    it('checks the file on the disk by default', async () => {
        const reader = new MangaReader({
            fileOf: () => {
                return '/does/not/exist.cbz';
            },
            incompletePageCount: () => {
                return null;
            },
            localPages: { count: vi.fn(), missing: vi.fn() },
            remotePages: () => {
                return Promise.resolve([]);
            }
        });
        await expect(reader.pages({ chapterRemoteId: 1, libraryChapterId: 2 })).resolves.toEqual({ ok: true, value: { pages: [], local: false, missing: [] } });
    });

    it('gives a place for every page of an incomplete chapter, and the places of the ones it lacks', async () => {
        const { reader, missing, incompletePageCount, remotePages } = setup({ count: 3, incompletePageCount: 5, missing: [1, 4] });
        await expect(reader.pages({ chapterRemoteId: 11, libraryChapterId: 4 })).resolves.toEqual({
            ok: true,
            value: {
                pages: ['pullwave-manga://page/4/0', 'pullwave-manga://page/4/1', 'pullwave-manga://page/4/2', 'pullwave-manga://page/4/3', 'pullwave-manga://page/4/4'],
                local: true,
                missing: [1, 4]
            }
        });
        expect(incompletePageCount).toHaveBeenCalledWith(4);
        expect(missing).toHaveBeenCalledWith('/manga/One Piece/Chapter 1.cbz', 5);
        expect(remotePages).not.toHaveBeenCalled();
    });

    it('does not look for missing pages in a chapter that is whole', async () => {
        const { reader, missing } = setup({ count: 2, incompletePageCount: null });
        await reader.pages({ chapterRemoteId: 11, libraryChapterId: 4 });
        expect(missing).not.toHaveBeenCalled();
    });

    it('gives no missing page when the file of an incomplete chapter has all its pages', async () => {
        const { reader, missing } = setup({ count: 3, incompletePageCount: 3 });
        await expect(reader.pages({ chapterRemoteId: 11, libraryChapterId: 4 })).resolves.toMatchObject({ ok: true, value: { local: true, missing: [] } });
        expect(missing).not.toHaveBeenCalled();
    });
});
