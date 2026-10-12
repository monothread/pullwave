import { MANGA_PAGE_SCHEME } from '@shared/manga';
import { MAX_LOCAL_PAGES } from './localPages';
import { detectImageType } from './imageType';
import { parseIconUrl } from './mangaIcons';

export { MANGA_PAGE_SCHEME };

export interface PageSource {
    // The file of a chapter of the library that was downloaded (null: there is none to read).
    fileOf: (chapterId: number) => string | null;
    read: (path: string, index: number) => Promise<Buffer>;
}

// `pullwave-manga://page/<chapter id>/<page number>`; null for anything else.
export function parsePageUrl(url: string): { chapterId: number; index: number } | null {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return null;
    }
    const match = /^\/(\d{1,15})\/(\d{1,6})$/.exec(parsed.pathname);
    if (parsed.protocol !== `${MANGA_PAGE_SCHEME}:` || parsed.hostname !== 'page' || match === null) {
        return null;
    }
    const index = Number(match[2]);
    return index < MAX_LOCAL_PAGES ? { chapterId: Number(match[1]), index } : null;
}

function plain(status: number): Response {
    return new Response(null, { status });
}

// Serves one page of a chapter of the library. The address carries an id, never a path: only files of chapters the app downloaded can be
// reached.
export function createPageHandler(source: PageSource): (request: Request) => Promise<Response> {
    return async (request) => {
        const page = parsePageUrl(request.url);
        if (page === null) {
            return plain(400);
        }
        const path = source.fileOf(page.chapterId);
        if (path === null) {
            return plain(404);
        }
        try {
            const bytes = await source.read(path, page.index);
            const type = detectImageType(bytes);
            return new Response(new Uint8Array(bytes), {
                status: 200,
                headers: { 'Content-Type': type?.mime ?? 'application/octet-stream', 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' }
            });
        } catch {
            return plain(404);
        }
    };
}

export interface CoverSource {
    // The file with the cover of a manga of the library (null: none is kept).
    fileOf: (mangaId: number) => string | null;
    read: (path: string) => Promise<Buffer>;
}

// `pullwave-manga://cover/<manga id>`; null for anything else.
export function parseCoverUrl(url: string): { mangaId: number } | null {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return null;
    }
    const match = /^\/(\d{1,15})$/.exec(parsed.pathname);
    if (parsed.protocol !== `${MANGA_PAGE_SCHEME}:` || parsed.hostname !== 'cover' || match === null) {
        return null;
    }
    return { mangaId: Number(match[1]) };
}

// Serves the cover of a manga of the library. The address carries an id, never a path. It carries a fingerprint too, so a cover that
// changes has another address and the one served can be kept for good.
export function createCoverHandler(source: CoverSource): (request: Request) => Promise<Response> {
    return async (request) => {
        const cover = parseCoverUrl(request.url);
        if (cover === null) {
            return plain(400);
        }
        const path = source.fileOf(cover.mangaId);
        if (path === null) {
            return plain(404);
        }
        try {
            const bytes = await source.read(path);
            const type = detectImageType(bytes);
            if (type === null) {
                return plain(404);
            }
            return new Response(new Uint8Array(bytes), {
                status: 200,
                headers: { 'Content-Type': type.mime, 'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' }
            });
        } catch {
            return plain(404);
        }
    };
}

export interface IconSource {
    // The file with the icon of a source (null: none is kept).
    fileOf: (key: string) => string | null;
    read: (path: string) => Promise<Buffer>;
}

// Serves the icon of a source. The address carries a key, never a path.
export function createIconHandler(source: IconSource): (request: Request) => Promise<Response> {
    return async (request) => {
        const icon = parseIconUrl(request.url);
        if (icon === null) {
            return plain(400);
        }
        const path = source.fileOf(icon.key);
        if (path === null) {
            return plain(404);
        }
        try {
            const bytes = await source.read(path);
            const type = detectImageType(bytes);
            if (type === null) {
                return plain(404);
            }
            return new Response(new Uint8Array(bytes), {
                status: 200,
                headers: { 'Content-Type': type.mime, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' }
            });
        } catch {
            return plain(404);
        }
    };
}

// The one handler of the scheme: the covers, the icons of the sources and the pages of the chapters each go to their own place.
export function createMangaProtocolHandler(pages: PageSource, covers: CoverSource, icons: IconSource): (request: Request) => Promise<Response> {
    const pageHandler = createPageHandler(pages);
    const coverHandler = createCoverHandler(covers);
    const iconHandler = createIconHandler(icons);
    return (request) => {
        if (parseCoverUrl(request.url) !== null) {
            return coverHandler(request);
        }
        return parseIconUrl(request.url) !== null ? iconHandler(request) : pageHandler(request);
    };
}
