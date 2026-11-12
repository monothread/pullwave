import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FINGERPRINT_LENGTH, MAX_COVER_BYTES, MangaCovers } from '@main/services/manga/mangaCovers';
import { MangaDb } from '@main/services/manga/mangaDb';
import { cleanTempDirs, makeTempDir } from '../../../helpers/tempDir';

const BASE = 'http://127.0.0.1:4321';
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9]);
const hash = (bytes: Uint8Array): string => {
    return createHash('sha256').update(bytes).digest('hex');
};

afterEach(() => {
    cleanTempDirs();
});

type Answer = Response | Error;

function setup(options: { baseUrl?: string | null; answers?: Answer[]; fallback?: { find: (title: string) => Promise<string | null> } } = {}) {
    const directory = join(makeTempDir(), 'covers');
    const db = new MangaDb(':memory:');
    const requested: Array<{ url: string; init: RequestInit | undefined }> = [];
    const queue = [...(options.answers ?? [])];
    const fetchImpl = vi.fn((input: string | URL | Request, init?: RequestInit) => {
        requested.push({ url: String(input), init });
        const next = queue.length > 1 ? queue.shift()! : (queue[0] ?? new Response(JPEG));
        return next instanceof Error ? Promise.reject(next) : Promise.resolve(next.clone());
    }) as unknown as typeof fetch;
    const covers = new MangaCovers({
        directory,
        db,
        baseUrl: () => {
            return options.baseUrl === undefined ? BASE : options.baseUrl;
        },
        fetchImpl,
        fallback: options.fallback
    });
    const add = (remoteId: number, thumbnailUrl: string | null = `/api/v1/manga/${String(remoteId)}/thumbnail`) => {
        return db.upsertManga({ remoteId, sourceId: '1', title: `Manga ${String(remoteId)}`, thumbnailUrl });
    };
    return { covers, db, directory, requested, fetchImpl, add };
}

describe('MangaCovers refresh', () => {
    it('takes the cover from the server, keeps it in a file of the manga and remembers its fingerprint', async () => {
        const { covers, db, directory, requested, add } = setup();
        const manga = add(7);
        await expect(covers.refresh(manga.id)).resolves.toBe(true);
        expect(requested).toEqual([{ url: `${BASE}/api/v1/manga/7/thumbnail`, init: { signal: expect.any(AbortSignal) } }]);
        expect(readFileSync(join(directory, String(manga.id)))).toEqual(Buffer.from(JPEG));
        expect(existsSync(join(directory, `${String(manga.id)}.part`))).toBe(false);
        expect(db.coverHash(manga.id)).toBe(hash(JPEG));
        expect(covers.fileOf(manga.id)).toBe(join(directory, String(manga.id)));
        expect(covers.urlOf(manga.id)).toBe(`pullwave-manga://cover/${String(manga.id)}?v=${hash(JPEG).slice(0, FINGERPRINT_LENGTH)}`);
    });

    it('takes a cover that is a whole address as it is', async () => {
        const { covers, requested, add } = setup({ baseUrl: null });
        const manga = add(8, 'https://cdn.example/b.jpg');
        await expect(covers.refresh(manga.id)).resolves.toBe(true);
        expect(requested.map((item) => {
            return item.url;
        })).toEqual(['https://cdn.example/b.jpg']);
    });

    it('says nothing changed when the image is the one that is kept, and does not write it again', async () => {
        const { covers, directory, add } = setup();
        const manga = add(7);
        await covers.refresh(manga.id);
        const path = join(directory, String(manga.id));
        writeFileSync(path, JPEG);
        await expect(covers.refresh(manga.id)).resolves.toBe(false);
        expect(covers.urlOf(manga.id)).toContain(hash(JPEG).slice(0, FINGERPRINT_LENGTH));
    });

    it('replaces the cover when the source has another one, with another fingerprint in the address', async () => {
        const { covers, db, directory, add } = setup({ answers: [new Response(JPEG), new Response(PNG)] });
        const manga = add(7);
        await covers.refresh(manga.id);
        const before = covers.urlOf(manga.id);
        await expect(covers.refresh(manga.id)).resolves.toBe(true);
        expect(readFileSync(join(directory, String(manga.id)))).toEqual(Buffer.from(PNG));
        expect(db.coverHash(manga.id)).toBe(hash(PNG));
        expect(covers.urlOf(manga.id)).not.toBe(before);
        expect(covers.urlOf(manga.id)).toBe(`pullwave-manga://cover/${String(manga.id)}?v=${hash(PNG).slice(0, FINGERPRINT_LENGTH)}`);
    });

    it('writes the cover again when the fingerprint is kept but the file is gone', async () => {
        const { covers, directory, add } = setup();
        const manga = add(7);
        await covers.refresh(manga.id);
        covers.remove(manga.id);
        await expect(covers.refresh(manga.id)).resolves.toBe(true);
        expect(existsSync(join(directory, String(manga.id)))).toBe(true);
    });

    it('keeps the old cover when the new one does not come', async () => {
        const { covers, directory, db, add } = setup({ answers: [new Response(JPEG), new Response('no', { status: 503 }), new Error('offline'), new Response('<html></html>'), new Response(new Uint8Array(0)), new Response(Uint8Array.from({ length: MAX_COVER_BYTES + 1 }, (_value, index) => {
            return index < JPEG.length ? JPEG[index]! : 0;
        }))] });
        const manga = add(7);
        await covers.refresh(manga.id);
        for (let attempt = 0; attempt < 5; attempt += 1) {
            await expect(covers.refresh(manga.id)).resolves.toBe(false);
        }
        expect(readFileSync(join(directory, String(manga.id)))).toEqual(Buffer.from(JPEG));
        expect(db.coverHash(manga.id)).toBe(hash(JPEG));
    });

    it('does nothing for a manga that is not in the library, has no cover, or has a path while the server is not running, when there is no fallback', async () => {
        const { covers, fetchImpl, add } = setup({ baseUrl: null });
        await expect(covers.refresh(999)).resolves.toBe(false);
        await expect(covers.refresh(add(1, null).id)).resolves.toBe(false);
        await expect(covers.refresh(add(2).id)).resolves.toBe(false);
        await expect(covers.refresh(add(3, 'ftp://x/y.jpg').id)).resolves.toBe(false);
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('asks for a cover once when it is asked for twice at the same time', async () => {
        const { covers, fetchImpl, add } = setup();
        const manga = add(7);
        const results = await Promise.all([covers.refresh(manga.id), covers.refresh(manga.id)]);
        expect(results).toEqual([true, true]);
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('does not give an address while no cover is kept, or when the file is gone', async () => {
        const { covers, add } = setup();
        const manga = add(7);
        expect(covers.urlOf(manga.id)).toBeNull();
        expect(covers.fileOf(manga.id)).toBeNull();
        await covers.refresh(manga.id);
        covers.remove(manga.id);
        expect(covers.urlOf(manga.id)).toBeNull();
        expect(covers.fileOf(manga.id)).toBeNull();
    });

    it('reads the file of a cover', async () => {
        const { covers, add } = setup();
        const manga = add(7);
        await covers.refresh(manga.id);
        await expect(covers.read(covers.fileOf(manga.id)!)).resolves.toEqual(Buffer.from(JPEG));
    });
});

describe('MangaCovers the ones the library lacks', () => {
    it('takes them one after the other and says it changed', async () => {
        const { covers, requested, add, db } = setup();
        const first = add(1);
        const second = add(2);
        expect(covers.pending(true)).toBe(true);
        await expect(covers.backfill()).resolves.toBe(true);
        expect(requested.map((item) => {
            return item.url;
        })).toEqual([`${BASE}/api/v1/manga/1/thumbnail`, `${BASE}/api/v1/manga/2/thumbnail`]);
        expect(db.coverHash(first.id)).toBe(hash(JPEG));
        expect(db.coverHash(second.id)).toBe(hash(JPEG));
        expect(covers.pending(true)).toBe(false);
        await expect(covers.backfill()).resolves.toBe(false);
    });

    it('does not ask again for a cover that did not come, until the app opens again', async () => {
        const { covers, fetchImpl, add } = setup({ answers: [new Response('no', { status: 404 })] });
        add(1);
        await expect(covers.backfill()).resolves.toBe(false);
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        expect(covers.pending(true)).toBe(false);
        expect(covers.needsServer).toBe(false);
        await covers.backfill();
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('asks again for a cover that did not come once the manga is refreshed on its own', async () => {
        const { covers, add, db } = setup({ answers: [new Response('no', { status: 404 }), new Response(JPEG)] });
        const manga = add(1);
        await covers.backfill();
        await expect(covers.refresh(manga.id)).resolves.toBe(true);
        expect(db.coverHash(manga.id)).toBe(hash(JPEG));
        expect(covers.pending(true)).toBe(false);
    });

    it('says the server is needed only for the covers that are paths of it', () => {
        const { covers, add } = setup({ baseUrl: null });
        add(1, 'https://cdn.example/a.jpg');
        add(2, null);
        expect(covers.needsServer).toBe(false);
        expect(covers.pending(false)).toBe(true);
        add(3);
        expect(covers.needsServer).toBe(true);
        expect(covers.pending(true)).toBe(true);
    });

    it('is not pending when only paths of the server are left and it is not running', () => {
        const { covers, add } = setup({ baseUrl: null });
        add(3);
        expect(covers.pending(false)).toBe(false);
        expect(covers.pending(true)).toBe(true);
    });

    it('leaves the paths of the server alone while it is not running, without marking them as failed', async () => {
        const { covers, fetchImpl, add } = setup({ baseUrl: null });
        add(3);
        await expect(covers.backfill()).resolves.toBe(false);
        expect(fetchImpl).not.toHaveBeenCalled();
        expect(covers.needsServer).toBe(true);
    });

    it('does one run when asked twice at the same time', async () => {
        const { covers, fetchImpl, add } = setup();
        add(1);
        const results = await Promise.all([covers.backfill(), covers.backfill()]);
        expect(results).toEqual([true, true]);
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });
});

describe('MangaCovers whether the file of a cover is there', () => {
    it('looks at the folder once for each cover, and keeps the answer after that', () => {
        const { covers, db, directory, add } = setup();
        const manga = add(7);
        db.setCoverHash(manga.id, hash(JPEG));
        expect(covers.urlOf(manga.id)).toBeNull();
        mkdirSync(directory, { recursive: true });
        writeFileSync(join(directory, String(manga.id)), JPEG);
        expect(covers.urlOf(manga.id)).toBeNull();
        expect(covers.fileOf(manga.id)).toBeNull();
        const other = add(8);
        db.setCoverHash(other.id, hash(JPEG));
        writeFileSync(join(directory, String(other.id)), JPEG);
        expect(covers.urlOf(other.id)).toBe(`pullwave-manga://cover/${String(other.id)}?v=${hash(JPEG).slice(0, FINGERPRINT_LENGTH)}`);
        rmSync(join(directory, String(other.id)));
        expect(covers.fileOf(other.id)).toBe(join(directory, String(other.id)));
    });

    it('knows the cover it wrote is there, and the one it removed is not', async () => {
        const { covers, directory, add } = setup();
        const manga = add(7);
        expect(covers.fileOf(manga.id)).toBeNull();
        await covers.refresh(manga.id);
        expect(covers.fileOf(manga.id)).toBe(join(directory, String(manga.id)));
        covers.remove(manga.id);
        expect(covers.fileOf(manga.id)).toBeNull();
        await covers.refresh(manga.id);
        expect(covers.urlOf(manga.id)).toBe(`pullwave-manga://cover/${String(manga.id)}?v=${hash(JPEG).slice(0, FINGERPRINT_LENGTH)}`);
    });

    it('fails to read a cover whose file is not there', async () => {
        const { covers, directory } = setup();
        await expect(covers.read(join(directory, 'gone'))).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('knows a cover is gone once its file cannot be read: it gives no address and takes it again', async () => {
        const { covers, directory, fetchImpl, add } = setup();
        const manga = add(7);
        await covers.refresh(manga.id);
        const path = join(directory, String(manga.id));
        rmSync(path);
        expect(covers.fileOf(manga.id)).toBe(path);
        await expect(covers.read(path)).rejects.toMatchObject({ code: 'ENOENT' });
        expect(covers.fileOf(manga.id)).toBeNull();
        expect(covers.urlOf(manga.id)).toBeNull();
        await expect(covers.refresh(manga.id)).resolves.toBe(true);
        expect(fetchImpl).toHaveBeenCalledTimes(2);
        expect(readFileSync(path)).toEqual(Buffer.from(JPEG));
        expect(covers.fileOf(manga.id)).toBe(path);
    });
});

describe('MangaCovers removal', () => {
    it('deletes the cover and what was left of one being written', async () => {
        const { covers, directory, add } = setup();
        const manga = add(7);
        await covers.refresh(manga.id);
        writeFileSync(join(directory, `${String(manga.id)}.part`), 'x');
        covers.remove(manga.id);
        expect(existsSync(join(directory, String(manga.id)))).toBe(false);
        expect(existsSync(join(directory, `${String(manga.id)}.part`))).toBe(false);
    });

    it('does not fail for a cover that is not there', () => {
        const { covers } = setup();
        expect(() => {
            covers.remove(5);
        }).not.toThrow();
    });
});

describe('MangaCovers the cover looked for in other services', () => {
    const FALLBACK_COVER = 'https://uploads.example/covers/a/b.jpg.512.jpg';

    function fallbackFinding(url: string | null) {
        return {
            find: vi.fn(async (title: string): Promise<string | null> => {
                void title;
                return url;
            })
        };
    }

    it('takes the cover of the source when it comes, without asking the other services', async () => {
        const fallback = fallbackFinding(FALLBACK_COVER);
        const { covers, requested, add, db } = setup({ fallback });
        const manga = add(7);
        await expect(covers.refresh(manga.id)).resolves.toBe(true);
        expect(fallback.find).not.toHaveBeenCalled();
        expect(requested.map((item) => {
            return item.url;
        })).toEqual([`${BASE}/api/v1/manga/7/thumbnail`]);
        expect(db.coverHash(manga.id)).toBe(hash(JPEG));
    });

    it('looks the cover up by the title when the source gives none, and keeps the picture it finds', async () => {
        const fallback = fallbackFinding(FALLBACK_COVER);
        const { covers, requested, add, db, directory } = setup({ fallback, answers: [new Response(PNG)] });
        const manga = add(1, null);
        await expect(covers.refresh(manga.id)).resolves.toBe(true);
        expect(fallback.find.mock.calls).toEqual([['Manga 1']]);
        expect(requested).toEqual([{ url: FALLBACK_COVER, init: { signal: expect.any(AbortSignal) } }]);
        expect(readFileSync(join(directory, String(manga.id)))).toEqual(Buffer.from(PNG));
        expect(db.coverHash(manga.id)).toBe(hash(PNG));
        expect(covers.urlOf(manga.id)).toBe(`pullwave-manga://cover/${String(manga.id)}?v=${hash(PNG).slice(0, FINGERPRINT_LENGTH)}`);
    });

    it('looks the cover up by the title when the one of the source does not come', async () => {
        const fallback = fallbackFinding(FALLBACK_COVER);
        const { covers, requested, add, db } = setup({ fallback, answers: [new Response('no', { status: 404 }), new Response(PNG)] });
        const manga = add(7);
        await expect(covers.refresh(manga.id)).resolves.toBe(true);
        expect(requested.map((item) => {
            return item.url;
        })).toEqual([`${BASE}/api/v1/manga/7/thumbnail`, FALLBACK_COVER]);
        expect(db.coverHash(manga.id)).toBe(hash(PNG));
    });

    it('looks the cover up by the title when what the source gives is not a picture, or is of an address it cannot take', async () => {
        const fallback = fallbackFinding(FALLBACK_COVER);
        const { covers, requested, add } = setup({ fallback, baseUrl: null, answers: [new Response('<html></html>'), new Response(PNG), new Response(PNG)] });
        await expect(covers.refresh(add(1, 'https://cdn.example/a.jpg').id)).resolves.toBe(true);
        await expect(covers.refresh(add(2, 'ftp://x/y.jpg').id)).resolves.toBe(true);
        expect(requested.map((item) => {
            return item.url;
        })).toEqual(['https://cdn.example/a.jpg', FALLBACK_COVER, FALLBACK_COVER]);
        expect(fallback.find.mock.calls).toEqual([['Manga 1'], ['Manga 2']]);
    });

    it('waits for the server for a cover that is a path of it, without asking the other services or marking it as failed', async () => {
        const fallback = fallbackFinding(FALLBACK_COVER);
        const { covers, fetchImpl, add } = setup({ fallback, baseUrl: null });
        const manga = add(3);
        await expect(covers.refresh(manga.id)).resolves.toBe(false);
        expect(fallback.find).not.toHaveBeenCalled();
        expect(fetchImpl).not.toHaveBeenCalled();
        expect(covers.pending(true)).toBe(true);
    });

    it('marks the cover as failed when no service has one, and does not ask again until the app opens again', async () => {
        const fallback = fallbackFinding(null);
        const { covers, fetchImpl, add, db } = setup({ fallback });
        const manga = add(1, null);
        expect(covers.pending(false)).toBe(true);
        await expect(covers.backfill()).resolves.toBe(false);
        expect(fallback.find.mock.calls).toEqual([['Manga 1']]);
        expect(fetchImpl).not.toHaveBeenCalled();
        expect(db.coverHash(manga.id)).toBeNull();
        expect(covers.pending(false)).toBe(false);
        await covers.backfill();
        expect(fallback.find).toHaveBeenCalledTimes(1);
    });

    it('marks the cover as failed when the other services cannot be asked, or what they give does not come', async () => {
        const failing = { find: vi.fn(async (): Promise<string | null> => {
            throw new Error('Kitsu could not be reached: offline');
        }) };
        const first = setup({ fallback: failing });
        await expect(first.covers.refresh(first.add(1, null).id)).resolves.toBe(false);
        expect(first.covers.pending(false)).toBe(false);

        const second = setup({ fallback: fallbackFinding(FALLBACK_COVER), answers: [new Response('no', { status: 503 })] });
        await expect(second.covers.refresh(second.add(1, null).id)).resolves.toBe(false);
        expect(second.requested.map((item) => {
            return item.url;
        })).toEqual([FALLBACK_COVER]);
        expect(second.covers.pending(false)).toBe(false);
    });

    it('does not take what the other services give when it is not a web address', async () => {
        const fallback = fallbackFinding('file:///etc/passwd');
        const { covers, fetchImpl, add } = setup({ fallback });
        await expect(covers.refresh(add(1, null).id)).resolves.toBe(false);
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('takes, in the run of the ones the library lacks, the covers of the mangas whose source gives none', async () => {
        const fallback = fallbackFinding(FALLBACK_COVER);
        const { covers, add, db } = setup({ fallback, answers: [new Response(JPEG), new Response(PNG)] });
        const withCover = add(1);
        const withoutCover = add(2, null);
        await expect(covers.backfill()).resolves.toBe(true);
        expect(fallback.find.mock.calls).toEqual([['Manga 2']]);
        expect(db.coverHash(withCover.id)).toBe(hash(JPEG));
        expect(db.coverHash(withoutCover.id)).toBe(hash(PNG));
        expect(covers.pending(true)).toBe(false);
    });
});
