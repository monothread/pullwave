import { createReadStream, statSync } from 'node:fs';
import { extname } from 'node:path';
import { Readable } from 'node:stream';
import { ANIME_MEDIA_SCHEME, type AnimeMediaKind } from '@shared/anime';

export { ANIME_MEDIA_SCHEME };

const RANGE_PATTERN = /^bytes=(\d*)-(\d*)$/;
const CONTENT_TYPES: Record<string, string> = {
    '.mp4': 'video/mp4',
    '.m4v': 'video/mp4',
    '.webm': 'video/webm',
    '.mkv': 'video/x-matroska',
    '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo',
    '.vtt': 'text/vtt; charset=utf-8',
    '.mp3': 'audio/mpeg',
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
    '.ogg': 'audio/ogg',
    '.oga': 'audio/ogg',
    '.opus': 'audio/ogg',
    '.wav': 'audio/wav',
    '.flac': 'audio/flac',
    '.jpg': 'image/jpeg'
};

export interface ByteRange {
    start: number;
    end: number;
}

export interface MediaFileSystem {
    size: (path: string) => number | null;
    read: (path: string, range: ByteRange) => ReadableStream<Uint8Array>;
}

export interface MediaSource {
    resolve: (kind: AnimeMediaKind, episodeId: number, trackId: string) => string | null;
}

export function parseRange(header: string | null, size: number): ByteRange | 'invalid' | null {
    if (header === null) {
        return null;
    }
    const match = RANGE_PATTERN.exec(header.trim());
    if (!match || (match[1] === '' && match[2] === '')) {
        return 'invalid';
    }
    if (match[1] === '') {
        const suffix = Number(match[2]);
        return suffix === 0 ? 'invalid' : { start: Math.max(0, size - suffix), end: size - 1 };
    }
    const start = Number(match[1]);
    const end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
    return start >= size || start > end ? 'invalid' : { start, end };
}

export function contentTypeOf(path: string): string {
    return CONTENT_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

function decodeTrackId(encoded: string | undefined): string | null {
    try {
        return encoded === undefined ? '' : decodeURIComponent(encoded);
    } catch {
        return null;
    }
}

export function parseMediaUrl(url: string): { kind: AnimeMediaKind; episodeId: number; trackId: string } | null {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return null;
    }
    const match = /^\/(\d+)(?:\/([^/]+))?$/.exec(parsed.pathname);
    if (parsed.protocol !== `${ANIME_MEDIA_SCHEME}:` || match === null) {
        return null;
    }
    if (parsed.hostname !== 'episode' && parsed.hostname !== 'subtitle') {
        return null;
    }
    if (match[2] !== undefined && parsed.hostname !== 'subtitle') {
        return null;
    }
    const trackId = decodeTrackId(match[2]);
    return trackId === null ? null : { kind: parsed.hostname, episodeId: Number(match[1]), trackId };
}

function plain(status: number, headers: Record<string, string> = {}): Response {
    return new Response(null, { status, headers: { 'Access-Control-Allow-Origin': '*', ...headers } });
}

export function serveFile(request: Request, path: string | null, files: MediaFileSystem): Response {
    const size = path === null ? null : files.size(path);
    if (path === null || size === null) {
        return plain(404);
    }
    const range = parseRange(request.headers.get('range'), size);
    if (range === 'invalid') {
        return plain(416, { 'Content-Range': `bytes */${size}` });
    }
    const headers = { 'Content-Type': contentTypeOf(path), 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*' };
    if (range === null && size === 0) {
        return new Response(null, { status: 200, headers: { ...headers, 'Content-Length': '0' } });
    }
    if (range === null) {
        return new Response(files.read(path, { start: 0, end: size - 1 }), { status: 200, headers: { ...headers, 'Content-Length': String(size) } });
    }
    return new Response(files.read(path, range), {
        status: 206,
        headers: { ...headers, 'Content-Length': String(range.end - range.start + 1), 'Content-Range': `bytes ${range.start}-${range.end}/${size}` }
    });
}

export function createMediaHandler(source: MediaSource, files: MediaFileSystem): (request: Request) => Response {
    return (request) => {
        const media = parseMediaUrl(request.url);
        return serveFile(request, media ? source.resolve(media.kind, media.episodeId, media.trackId) : null, files);
    };
}

export const defaultMediaFileSystem: MediaFileSystem = {
    size: (path) => {
        try {
            const stats = statSync(path);
            return stats.isFile() ? stats.size : null;
        } catch {
            return null;
        }
    },
    read: (path, range) => {
        return Readable.toWeb(createReadStream(path, range)) as ReadableStream<Uint8Array>;
    }
};
