import { createCoverHandler, createMangaProtocolHandler, createPageHandler, parseCoverUrl, parsePageUrl } from '@main/services/manga/mangaPageProtocol';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8]);

describe('parsePageUrl', () => {
    it('reads the chapter and the page', () => {
        expect(parsePageUrl('pullwave-manga://page/12/3')).toEqual({ chapterId: 12, index: 3 });
        expect(parsePageUrl('pullwave-manga://page/1/0')).toEqual({ chapterId: 1, index: 0 });
    });

    it.each([
        ['another scheme', 'http://page/1/0'],
        ['another host', 'pullwave-manga://file/1/0'],
        ['no page', 'pullwave-manga://page/1'],
        ['a path', 'pullwave-manga://page/../etc/passwd'],
        ['a negative number', 'pullwave-manga://page/-1/0'],
        ['text instead of numbers', 'pullwave-manga://page/a/b'],
        ['extra parts', 'pullwave-manga://page/1/0/0'],
        ['a page number past the limit', 'pullwave-manga://page/1/5000'],
        ['not an address', 'nonsense']
    ])('refuses %s', (_label, url) => {
        expect(parsePageUrl(url)).toBeNull();
    });
});

describe('createPageHandler', () => {
    function setup(fileOf: (id: number) => string | null, read: (path: string, index: number) => Promise<Buffer>) {
        const source = { fileOf: vi.fn(fileOf), read: vi.fn(read) };
        return { source, handle: createPageHandler(source) };
    }

    it('serves the page with its type, taken from the bytes, and does not let it be guessed', async () => {
        const { handle, source } = setup(
            () => {
                return '/manga/One Piece/Chapter 1.cbz';
            },
            () => {
                return Promise.resolve(PNG);
            }
        );
        const response = await handle(new Request('pullwave-manga://page/4/2'));
        expect(response.status).toBe(200);
        expect(response.headers.get('Content-Type')).toBe('image/png');
        expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
        expect(response.headers.get('Cache-Control')).toBe('private, max-age=3600');
        expect(Buffer.from(await response.arrayBuffer())).toEqual(PNG);
        expect(source.fileOf).toHaveBeenCalledWith(4);
        expect(source.read).toHaveBeenCalledWith('/manga/One Piece/Chapter 1.cbz', 2);
    });

    it('serves bytes that are not an image as a plain stream', async () => {
        const { handle } = setup(
            () => {
                return '/x.cbz';
            },
            () => {
                return Promise.resolve(Buffer.from('not an image at all, just text.'));
            }
        );
        expect((await handle(new Request('pullwave-manga://page/1/0'))).headers.get('Content-Type')).toBe('application/octet-stream');
    });

    it('answers 400 for an address that is not one of a page, and reads nothing', async () => {
        const { handle, source } = setup(
            () => {
                return '/x.cbz';
            },
            () => {
                return Promise.resolve(PNG);
            }
        );
        expect((await handle(new Request('pullwave-manga://page/x/y'))).status).toBe(400);
        expect(source.fileOf).not.toHaveBeenCalled();
    });

    it('answers 404 when the chapter has no file, and when the page cannot be read', async () => {
        const none = setup(
            () => {
                return null;
            },
            () => {
                return Promise.resolve(PNG);
            }
        );
        expect((await none.handle(new Request('pullwave-manga://page/1/0'))).status).toBe(404);
        expect(none.source.read).not.toHaveBeenCalled();
        const broken = setup(
            () => {
                return '/x.cbz';
            },
            () => {
                return Promise.reject(new Error('gone'));
            }
        );
        expect((await broken.handle(new Request('pullwave-manga://page/1/0'))).status).toBe(404);
    });
});

describe('parseCoverUrl', () => {
    it('reads the manga, with or without the fingerprint', () => {
        expect(parseCoverUrl('pullwave-manga://cover/12')).toEqual({ mangaId: 12 });
        expect(parseCoverUrl('pullwave-manga://cover/12?v=abc123def456')).toEqual({ mangaId: 12 });
    });

    it.each([
        ['another scheme', 'http://cover/1'],
        ['another host', 'pullwave-manga://page/1'],
        ['a page address', 'pullwave-manga://page/1/0'],
        ['no manga', 'pullwave-manga://cover/'],
        ['a path', 'pullwave-manga://cover/../etc/passwd'],
        ['a negative number', 'pullwave-manga://cover/-1'],
        ['text instead of a number', 'pullwave-manga://cover/a'],
        ['extra parts', 'pullwave-manga://cover/1/0'],
        ['not an address', 'nonsense']
    ])('refuses %s', (_label, url) => {
        expect(parseCoverUrl(url)).toBeNull();
    });
});

describe('createCoverHandler', () => {
    function setup(fileOf: (id: number) => string | null, read: (path: string) => Promise<Buffer>) {
        const source = { fileOf: vi.fn(fileOf), read: vi.fn(read) };
        return { source, handle: createCoverHandler(source) };
    }

    it('serves the cover with its type taken from the bytes, to be kept for good', async () => {
        const { handle, source } = setup(
            () => {
                return '/data/manga/covers/12';
            },
            () => {
                return Promise.resolve(PNG);
            }
        );
        const response = await handle(new Request('pullwave-manga://cover/12?v=abc123def456'));
        expect(response.status).toBe(200);
        expect(response.headers.get('Content-Type')).toBe('image/png');
        expect(response.headers.get('Cache-Control')).toBe('private, max-age=31536000, immutable');
        expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
        expect(Buffer.from(await response.arrayBuffer())).toEqual(PNG);
        expect(source.fileOf).toHaveBeenCalledWith(12);
        expect(source.read).toHaveBeenCalledWith('/data/manga/covers/12');
    });

    it('refuses an address that is not a cover, without reading anything', async () => {
        const { handle, source } = setup(
            () => {
                return '/x';
            },
            () => {
                return Promise.resolve(PNG);
            }
        );
        expect((await handle(new Request('pullwave-manga://cover/..%2F..'))).status).toBe(400);
        expect(source.fileOf).not.toHaveBeenCalled();
        expect(source.read).not.toHaveBeenCalled();
    });

    it('says there is none when no cover is kept, when the file is not an image, or when it cannot be read', async () => {
        const none = setup(
            () => {
                return null;
            },
            () => {
                return Promise.resolve(PNG);
            }
        );
        expect((await none.handle(new Request('pullwave-manga://cover/5'))).status).toBe(404);
        expect(none.source.read).not.toHaveBeenCalled();
        const text = setup(
            () => {
                return '/x';
            },
            () => {
                return Promise.resolve(Buffer.from('<html>'));
            }
        );
        expect((await text.handle(new Request('pullwave-manga://cover/5'))).status).toBe(404);
        const broken = setup(
            () => {
                return '/x';
            },
            () => {
                return Promise.reject(new Error('gone'));
            }
        );
        expect((await broken.handle(new Request('pullwave-manga://cover/5'))).status).toBe(404);
    });
});

describe('createMangaProtocolHandler', () => {
    it('sends the covers to the covers and the pages to the pages', async () => {
        const pages = { fileOf: vi.fn(() => {
            return '/m/Chapter 1.cbz';
        }), read: vi.fn(() => {
            return Promise.resolve(PNG);
        }) };
        const covers = { fileOf: vi.fn(() => {
            return '/data/covers/3';
        }), read: vi.fn(() => {
            return Promise.resolve(PNG);
        }) };
        const handle = createMangaProtocolHandler(pages, covers);
        expect((await handle(new Request('pullwave-manga://cover/3?v=x'))).status).toBe(200);
        expect(covers.fileOf).toHaveBeenCalledWith(3);
        expect(pages.fileOf).not.toHaveBeenCalled();
        expect((await handle(new Request('pullwave-manga://page/4/1'))).status).toBe(200);
        expect(pages.fileOf).toHaveBeenCalledWith(4);
        expect(pages.read).toHaveBeenCalledWith('/m/Chapter 1.cbz', 1);
        expect(covers.fileOf).toHaveBeenCalledTimes(1);
        expect((await handle(new Request('pullwave-manga://other/1'))).status).toBe(400);
    });
});
