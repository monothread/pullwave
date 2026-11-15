import { MANGA_PAGE_SCHEME } from '@shared/manga';
import { MAX_LOCAL_PAGES } from './localPages';
import { detectImageType } from './imageType';
import { parseIconUrl } from './mangaIcons';

export { MANGA_PAGE_SCHEME };

export interface PageSource {
    fileOf: (chapterId: number) => string | null;
    read: (path: string, index: number) => Promise<Buffer>;
}

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
    fileOf: (mangaId: number) => string | null;
    read: (path: string) => Promise<Buffer>;
}

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
    fileOf: (key: string) => string | null;
    read: (path: string) => Promise<Buffer>;
}

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
