import { randomUUID } from 'node:crypto';
import { ANIME_STREAM_SCHEME, type AnimeStream } from '@shared/anime';
import type { ResolvedStream } from './aniStream';

export const STREAM_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
export const UPSTREAM_TIMEOUT_MS = 30000;
export const MAX_SESSIONS = 8;

const FORWARDED_HEADERS = ['content-type', 'content-length', 'content-range', 'accept-ranges'];
const PLAYLIST_TYPE = 'application/vnd.apple.mpegurl';

export interface StreamSession {
    id: string;
    referer: string | null;
    hosts: Set<string>;
}

export type StreamFetch = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<Response>;

function toBase64Url(text: string): string {
    return Buffer.from(text, 'utf-8').toString('base64url');
}

function fromBase64Url(text: string): string {
    return Buffer.from(text, 'base64url').toString('utf-8');
}

export function proxyUrl(sessionId: string, remoteUrl: string): string {
    return `${ANIME_STREAM_SCHEME}://p/${sessionId}/${toBase64Url(remoteUrl)}`;
}

export function parseProxyUrl(url: string): { sessionId: string; remoteUrl: string } | null {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return null;
    }
    const match = /^\/([\w-]+)\/([\w-]+)$/.exec(parsed.pathname);
    if (parsed.protocol !== `${ANIME_STREAM_SCHEME}:` || parsed.hostname !== 'p' || !match) {
        return null;
    }
    return { sessionId: match[1] ?? '', remoteUrl: fromBase64Url(match[2] ?? '') };
}

function hostOf(url: string): string | null {
    try {
        const parsed = new URL(url);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.host : null;
    } catch {
        return null;
    }
}

export class StreamSessions {
    private readonly sessions = new Map<string, StreamSession>();

    constructor(private readonly newId: () => string = randomUUID) {}

    create(stream: ResolvedStream): AnimeStream {
        const session: StreamSession = { id: this.newId(), referer: stream.referer, hosts: new Set() };
        [stream.url, stream.subtitleUrl, ...stream.subtitles.map((subtitle) => {
            return subtitle.src;
        })].forEach((url) => {
            const host = url === null ? null : hostOf(url);
            if (host !== null) {
                session.hosts.add(host);
            }
        });
        this.sessions.set(session.id, session);
        while (this.sessions.size > MAX_SESSIONS) {
            const oldest = this.sessions.keys().next().value;
            if (oldest !== undefined) {
                this.sessions.delete(oldest);
            }
        }
        return {
            sessionId: session.id,
            url: proxyUrl(session.id, stream.url),
            subtitleUrl: stream.subtitleUrl === null ? null : proxyUrl(session.id, stream.subtitleUrl),
            subtitles: stream.subtitles.map((subtitle, position) => {
                return { id: `stream-${position + 1}`, label: subtitle.label, url: proxyUrl(session.id, subtitle.src) };
            })
        };
    }

    get(id: string): StreamSession | undefined {
        return this.sessions.get(id);
    }

    close(id: string): void {
        this.sessions.delete(id);
    }

    get size(): number {
        return this.sessions.size;
    }
}

export function rewritePlaylist(text: string, playlistUrl: string, session: StreamSession): string {
    const rewrite = (reference: string): string => {
        let absolute: URL;
        try {
            absolute = new URL(reference, playlistUrl);
        } catch {
            return reference;
        }
        if (absolute.protocol !== 'http:' && absolute.protocol !== 'https:') {
            return reference;
        }
        session.hosts.add(absolute.host);
        return proxyUrl(session.id, absolute.href);
    };
    return text
        .split(/\r?\n/)
        .map((line) => {
            if (line.startsWith('#')) {
                return line.replace(/URI="([^"]*)"/g, (_whole, reference: string) => {
                    return `URI="${rewrite(reference)}"`;
                });
            }
            return line.trim().length === 0 ? line : rewrite(line.trim());
        })
        .join('\n');
}

function reply(status: number, headers: Record<string, string> = {}, body: BodyInit | null = null): Response {
    return new Response(body, { status, headers: { 'Access-Control-Allow-Origin': '*', ...headers } });
}

function isPlaylist(contentType: string, remote: URL): boolean {
    return /mpegurl/i.test(contentType) || /\.m3u8$/i.test(remote.pathname);
}

function upstreamHeaders(session: StreamSession, request: Request): Record<string, string> {
    const headers: Record<string, string> = { 'User-Agent': STREAM_USER_AGENT };
    if (session.referer !== null) {
        headers.Referer = session.referer;
        headers.Origin = new URL(session.referer).origin;
    }
    const range = request.headers.get('range');
    if (range !== null) {
        headers.Range = range;
    }
    return headers;
}

export function createStreamHandler(sessions: StreamSessions, fetchRemote: StreamFetch = fetch): (request: Request) => Promise<Response> {
    return async (request) => {
        const parsed = parseProxyUrl(request.url);
        const session = parsed ? sessions.get(parsed.sessionId) : undefined;
        if (!parsed || !session) {
            return reply(404);
        }
        const remoteHost = hostOf(parsed.remoteUrl);
        if (remoteHost === null) {
            return reply(400);
        }
        if (!session.hosts.has(remoteHost)) {
            return reply(403);
        }
        let upstream: Response;
        try {
            upstream = await fetchRemote(parsed.remoteUrl, { headers: upstreamHeaders(session, request), signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
        } catch {
            return reply(502);
        }
        if (!upstream.ok) {
            return reply(upstream.status);
        }
        const remote = new URL(parsed.remoteUrl);
        const contentType = upstream.headers.get('content-type') ?? '';
        if (isPlaylist(contentType, remote)) {
            return reply(200, { 'Content-Type': PLAYLIST_TYPE }, rewritePlaylist(await upstream.text(), upstream.url || parsed.remoteUrl, session));
        }
        const headers: Record<string, string> = {};
        FORWARDED_HEADERS.forEach((name) => {
            const value = upstream.headers.get(name);
            if (value !== null) {
                headers[name] = value;
            }
        });
        return reply(upstream.status, headers, upstream.body);
    };
}
