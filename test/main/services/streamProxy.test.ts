import {
    createStreamHandler,
    MAX_SESSIONS,
    parseProxyUrl,
    proxyUrl,
    rewritePlaylist,
    STREAM_USER_AGENT,
    StreamSessions,
    UPSTREAM_TIMEOUT_MS,
    type StreamFetch,
    type StreamSession
} from '@main/services/streamProxy';

const MASTER = 'https://cdn.example/v/abc/master.m3u8';

function session(overrides: Partial<StreamSession> = {}): StreamSession {
    return { id: 'sess', referer: 'https://embed.example/', hosts: new Set(['cdn.example']), ...overrides };
}

function b64(text: string): string {
    return Buffer.from(text, 'utf-8').toString('base64url');
}

describe('proxyUrl and parseProxyUrl', () => {
    it('make an address that carries the session and the remote address', () => {
        const url = proxyUrl('sess-1', 'https://cdn.example/a/b.ts?token=x&y=z');
        expect(url).toBe(`pullwave-stream://p/sess-1/${b64('https://cdn.example/a/b.ts?token=x&y=z')}`);
        expect(parseProxyUrl(url)).toEqual({ sessionId: 'sess-1', remoteUrl: 'https://cdn.example/a/b.ts?token=x&y=z' });
    });

    it('keep any character of the remote address', () => {
        const remote = 'https://cdn.example/ã/日本語.ts?a=1#frag';
        expect(parseProxyUrl(proxyUrl('s', remote))?.remoteUrl).toBe(remote);
    });

    it('reject everything else', () => {
        expect(parseProxyUrl('not a url')).toBeNull();
        expect(parseProxyUrl('https://p/sess/abc')).toBeNull();
        expect(parseProxyUrl(`pullwave-stream://other/sess/${b64('x')}`)).toBeNull();
        expect(parseProxyUrl('pullwave-stream://p/sess')).toBeNull();
        expect(parseProxyUrl(`pullwave-stream://p/sess/${b64('x')}/extra`)).toBeNull();
        expect(parseProxyUrl('pullwave-stream://p//abc')).toBeNull();
        expect(parseProxyUrl('pullwave-stream://p/sess/a b')).toBeNull();
    });
});

describe('StreamSessions', () => {
    function sessions(): StreamSessions {
        let next = 0;
        return new StreamSessions(() => {
            next += 1;
            return `id${next}`;
        });
    }

    it('opens a session and gives the addresses the player uses', () => {
        const all = sessions();
        const stream = all.create({ url: MASTER, subtitleUrl: 'https://subs.example/pt.vtt', referer: 'https://embed.example/', subtitles: [] });

        expect(stream).toEqual({ sessionId: 'id1', url: proxyUrl('id1', MASTER), subtitleUrl: proxyUrl('id1', 'https://subs.example/pt.vtt'), subtitles: [] });
        expect(all.get('id1')).toEqual({ id: 'id1', referer: 'https://embed.example/', hosts: new Set(['cdn.example', 'subs.example']) });
        expect(all.size).toBe(1);
    });

    it('gives an address through the app for every subtitle the source offers, in the order it gives them, with the label of the source', () => {
        const all = sessions();
        const stream = all.create({
            url: MASTER,
            subtitleUrl: 'https://subs.example/en.vtt',
            referer: 'https://embed.example/',
            subtitles: [
                { label: 'Arabic', src: 'https://subs.example/ar.vtt' },
                { label: 'English', src: 'https://subs.example/en.vtt' },
                { label: 'Portuguese (- Portuguese(Brazil))', src: 'https://other-subs.example:8443/pt.vtt' }
            ]
        });

        expect(stream.subtitles).toEqual([
            { id: 'stream-1', label: 'Arabic', url: proxyUrl('id1', 'https://subs.example/ar.vtt') },
            { id: 'stream-2', label: 'English', url: proxyUrl('id1', 'https://subs.example/en.vtt') },
            { id: 'stream-3', label: 'Portuguese (- Portuguese(Brazil))', url: proxyUrl('id1', 'https://other-subs.example:8443/pt.vtt') }
        ]);
        expect(stream.subtitleUrl).toBe(stream.subtitles[1]?.url);
    });

    it('lets the session fetch from the hosts of every subtitle, and only those', () => {
        const all = sessions();
        all.create({
            url: MASTER,
            subtitleUrl: null,
            referer: null,
            subtitles: [
                { label: 'Arabic', src: 'https://subs.example/ar.vtt' },
                { label: 'Portuguese', src: 'https://other-subs.example:8443/pt.vtt' },
                { label: 'Broken', src: 'not a url' }
            ]
        });

        expect(all.get('id1')?.hosts).toEqual(new Set(['cdn.example', 'subs.example', 'other-subs.example:8443']));
    });

    it('has no subtitles in the list when the source does not offer any', () => {
        expect(sessions().create({ url: MASTER, subtitleUrl: null, referer: null, subtitles: [] }).subtitles).toEqual([]);
    });

    it('has no subtitle address when there are no subtitles', () => {
        expect(sessions().create({ url: MASTER, subtitleUrl: null, referer: null, subtitles: [] }).subtitleUrl).toBeNull();
    });

    it('only allows web hosts', () => {
        const all = sessions();
        all.create({ url: 'file:///etc/passwd', subtitleUrl: 'not a url', referer: null, subtitles: [] });
        expect(all.get('id1')?.hosts).toEqual(new Set());
    });

    it('closes a session, and a missing one is harmless', () => {
        const all = sessions();
        all.create({ url: MASTER, subtitleUrl: null, referer: null, subtitles: [] });
        all.close('id1');
        all.close('nope');
        expect(all.get('id1')).toBeUndefined();
        expect(all.size).toBe(0);
    });

    it('keeps only the latest sessions', () => {
        const all = sessions();
        for (let count = 0; count < MAX_SESSIONS + 2; count += 1) {
            all.create({ url: MASTER, subtitleUrl: null, referer: null, subtitles: [] });
        }
        expect(all.size).toBe(MAX_SESSIONS);
        expect(all.get('id1')).toBeUndefined();
        expect(all.get('id2')).toBeUndefined();
        expect(all.get('id3')).toBeDefined();
        expect(all.get(`id${MAX_SESSIONS + 2}`)).toBeDefined();
    });

    it('makes unique ids by default', () => {
        const all = new StreamSessions();
        const first = all.create({ url: MASTER, subtitleUrl: null, referer: null, subtitles: [] });
        const second = all.create({ url: MASTER, subtitleUrl: null, referer: null, subtitles: [] });
        expect(first.sessionId).not.toBe(second.sessionId);
        expect(first.sessionId).toMatch(/^[\w-]+$/);
    });
});

describe('rewritePlaylist', () => {
    it('points segments at the app, resolving relative addresses against the playlist', () => {
        const current = session();
        const text = ['#EXTM3U', '#EXT-X-TARGETDURATION:6', '#EXTINF:6.0,', 'seg-1.ts', '#EXTINF:6.0,', '/abs/seg-2.ts', '#EXTINF:6.0,', 'https://cdn.example/other/seg-3.ts?x=1', '#EXT-X-ENDLIST'].join('\n');

        expect(rewritePlaylist(text, MASTER, current)).toBe(
            [
                '#EXTM3U',
                '#EXT-X-TARGETDURATION:6',
                '#EXTINF:6.0,',
                proxyUrl('sess', 'https://cdn.example/v/abc/seg-1.ts'),
                '#EXTINF:6.0,',
                proxyUrl('sess', 'https://cdn.example/abs/seg-2.ts'),
                '#EXTINF:6.0,',
                proxyUrl('sess', 'https://cdn.example/other/seg-3.ts?x=1'),
                '#EXT-X-ENDLIST'
            ].join('\n')
        );
    });

    it('rewrites the addresses inside tags: keys, maps, other playlists and subtitles', () => {
        const current = session();
        const text = [
            '#EXT-X-KEY:METHOD=AES-128,URI="key.bin",IV=0x1',
            '#EXT-X-MAP:URI="init.mp4"',
            '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="s",URI="subs/en.m3u8"',
            '#EXT-X-STREAM-INF:BANDWIDTH=1000',
            '720/index.m3u8'
        ].join('\n');
        const rewritten = rewritePlaylist(text, MASTER, current).split('\n');

        expect(rewritten[0]).toBe(`#EXT-X-KEY:METHOD=AES-128,URI="${proxyUrl('sess', 'https://cdn.example/v/abc/key.bin')}",IV=0x1`);
        expect(rewritten[1]).toBe(`#EXT-X-MAP:URI="${proxyUrl('sess', 'https://cdn.example/v/abc/init.mp4')}"`);
        expect(rewritten[2]).toBe(`#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="s",URI="${proxyUrl('sess', 'https://cdn.example/v/abc/subs/en.m3u8')}"`);
        expect(rewritten[3]).toBe('#EXT-X-STREAM-INF:BANDWIDTH=1000');
        expect(rewritten[4]).toBe(proxyUrl('sess', 'https://cdn.example/v/abc/720/index.m3u8'));
    });

    it('lets the session fetch from every host the playlist points to', () => {
        const current = session();
        rewritePlaylist('#EXTM3U\nhttps://other.example/a.ts\nhttp://third.example:8080/b.ts', MASTER, current);
        expect(current.hosts).toEqual(new Set(['cdn.example', 'other.example', 'third.example:8080']));
    });

    it('leaves blank lines, comments and addresses it cannot use alone', () => {
        const current = session();
        const text = '#EXTM3U\r\n\r\n# a comment\r\ndata:text/plain,hello\r\n#EXT-X-KEY:METHOD=NONE,URI="skd://x"';
        expect(rewritePlaylist(text, MASTER, current)).toBe('#EXTM3U\n\n# a comment\ndata:text/plain,hello\n#EXT-X-KEY:METHOD=NONE,URI="skd://x"');
        expect(current.hosts).toEqual(new Set(['cdn.example']));
    });

    it('leaves an address that cannot be made absolute', () => {
        expect(rewritePlaylist('seg.ts', 'not a base', session())).toBe('seg.ts');
    });
});

describe('createStreamHandler', () => {
    function setup(respond: (url: string) => Response | Promise<Response> = () => {return new Response('data')}) {
        const sessions = new StreamSessions(() => {return 'sess'});
        const stream = sessions.create({ url: MASTER, subtitleUrl: 'https://cdn.example/subs/pt.vtt', referer: 'https://embed.example/path/', subtitles: [] });
        const fetchRemote = vi.fn<StreamFetch>(async (url) => {
            return respond(url);
        });
        const handler = createStreamHandler(sessions, fetchRemote);
        const get = (remote: string, headers: Record<string, string> = {}): Promise<Response> => {
            return handler(new Request(proxyUrl('sess', remote), { headers }));
        };
        return { sessions, stream, fetchRemote, handler, get };
    }

    it('fetches the address with the referer, the origin and a browser user agent', async () => {
        const { get, fetchRemote } = setup();
        await get('https://cdn.example/v/abc/seg-1.ts');

        expect(fetchRemote).toHaveBeenCalledTimes(1);
        const [url, init] = fetchRemote.mock.calls[0] as [string, Parameters<StreamFetch>[1]];
        expect(url).toBe('https://cdn.example/v/abc/seg-1.ts');
        expect(init.headers).toEqual({ 'User-Agent': STREAM_USER_AGENT, Referer: 'https://embed.example/path/', Origin: 'https://embed.example' });
        expect(init.signal).toBeInstanceOf(AbortSignal);
        expect(UPSTREAM_TIMEOUT_MS).toBe(30000);
    });

    it('sends no referer when the stream has none', async () => {
        const sessions = new StreamSessions(() => {return 'sess'});
        sessions.create({ url: MASTER, subtitleUrl: null, referer: null, subtitles: [] });
        const fetchRemote = vi.fn<StreamFetch>(async () => {
            return new Response('x');
        });
        await createStreamHandler(sessions, fetchRemote)(new Request(proxyUrl('sess', MASTER)));
        expect((fetchRemote.mock.calls[0] as [string, Parameters<StreamFetch>[1]])[1].headers).toEqual({ 'User-Agent': STREAM_USER_AGENT });
    });

    it('passes on the range that was asked for', async () => {
        const { get, fetchRemote } = setup(() => {return new Response('xx', { status: 206, headers: { 'Content-Range': 'bytes 0-1/10' } })});
        const response = await get('https://cdn.example/a.mp4', { Range: 'bytes=0-1' });

        expect((fetchRemote.mock.calls[0] as [string, Parameters<StreamFetch>[1]])[1].headers.Range).toBe('bytes=0-1');
        expect(response.status).toBe(206);
        expect(response.headers.get('content-range')).toBe('bytes 0-1/10');
    });

    it('passes a segment through as it arrives, keeping what the player needs to know about it', async () => {
        const { get } = setup(() => {return new Response('SEGMENT-BYTES', { status: 200, headers: { 'Content-Type': 'video/mp2t', 'Content-Length': '13', 'Accept-Ranges': 'bytes', 'Set-Cookie': 'a=b' } })});
        const response = await get('https://cdn.example/v/abc/seg-1.ts');

        expect(response.status).toBe(200);
        expect(Object.fromEntries(response.headers)).toEqual({
            'access-control-allow-origin': '*',
            'accept-ranges': 'bytes',
            'content-length': '13',
            'content-type': 'video/mp2t'
        });
        expect(await response.text()).toBe('SEGMENT-BYTES');
    });

    it('rewrites a playlist, recognised by its type', async () => {
        const { get } = setup(() => {return new Response('#EXTM3U\nseg-1.ts', { headers: { 'Content-Type': 'application/x-mpegURL' } })});
        const response = await get(MASTER);

        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('application/vnd.apple.mpegurl');
        expect(response.headers.get('access-control-allow-origin')).toBe('*');
        expect(await response.text()).toBe(`#EXTM3U\n${proxyUrl('sess', 'https://cdn.example/v/abc/seg-1.ts')}`);
    });

    it('rewrites a playlist recognised by its name when the type says nothing', async () => {
        const { get } = setup(() => {return new Response('#EXTM3U\n720/index.m3u8', { headers: { 'Content-Type': 'application/octet-stream' } })});
        expect(await (await get(MASTER)).text()).toBe(`#EXTM3U\n${proxyUrl('sess', 'https://cdn.example/v/abc/720/index.m3u8')}`);
    });

    it('serves subtitles as they are', async () => {
        const { get } = setup(() => {return new Response('WEBVTT', { headers: { 'Content-Type': 'text/vtt' } })});
        const response = await get('https://cdn.example/subs/pt.vtt');
        expect(response.headers.get('content-type')).toBe('text/vtt');
        expect(await response.text()).toBe('WEBVTT');
    });

    it('answers 404 for an address that is not a stream address or for a session that is gone', async () => {
        const { handler, fetchRemote } = setup();
        expect((await handler(new Request('pullwave-stream://p/nope/abc'))).status).toBe(404);
        expect((await handler(new Request(`pullwave-stream://p/other/${b64(MASTER)}`))).status).toBe(404);
        expect((await handler(new Request('pullwave-stream://wrong/sess/abc'))).status).toBe(404);
        expect(fetchRemote).not.toHaveBeenCalled();
    });

    it('answers 400 for an address that is not a web address', async () => {
        const { get, fetchRemote } = setup();
        expect((await get('file:///etc/passwd')).status).toBe(400);
        expect((await get('not a url')).status).toBe(400);
        expect(fetchRemote).not.toHaveBeenCalled();
    });

    it('answers 403 for a host the stream never used', async () => {
        const { get, fetchRemote } = setup();
        expect((await get('http://127.0.0.1:9000/secret')).status).toBe(403);
        expect((await get('https://evil.example/x.ts')).status).toBe(403);
        expect(fetchRemote).not.toHaveBeenCalled();
    });

    it('answers 404 once the session was closed', async () => {
        const { get, sessions, fetchRemote } = setup();
        sessions.close('sess');
        expect((await get(MASTER)).status).toBe(404);
        expect(fetchRemote).not.toHaveBeenCalled();
    });

    it('allows a host once a playlist has pointed to it', async () => {
        const { get } = setup((url) => {
            return url === MASTER ? new Response('#EXTM3U\nhttps://media.example/seg.ts', { headers: { 'Content-Type': 'application/vnd.apple.mpegurl' } }) : new Response('bytes');
        });
        expect((await get('https://media.example/seg.ts')).status).toBe(403);
        await get(MASTER);
        const response = await get('https://media.example/seg.ts');
        expect(response.status).toBe(200);
        expect(await response.text()).toBe('bytes');
    });

    it('passes on the status of a failed request', async () => {
        const { get } = setup(() => {return new Response('forbidden', { status: 403 })});
        const response = await get(MASTER);
        expect(response.status).toBe(403);
        expect(response.headers.get('access-control-allow-origin')).toBe('*');
        expect(await response.text()).toBe('');
    });

    it('answers 502 when the remote site cannot be reached', async () => {
        const { get } = setup(() => {
            throw new Error('ECONNRESET');
        });
        expect((await get(MASTER)).status).toBe(502);
    });

    it('resolves the addresses of a playlist against where it ended up after a redirect', async () => {
        const redirected = new Response('#EXTM3U\nseg.ts', { headers: { 'Content-Type': 'application/vnd.apple.mpegurl' } });
        Object.defineProperty(redirected, 'url', { value: 'https://cdn.example/moved/master.m3u8' });
        const { get } = setup(() => {return redirected});
        expect(await (await get(MASTER)).text()).toBe(`#EXTM3U\n${proxyUrl('sess', 'https://cdn.example/moved/seg.ts')}`);
    });

    it('uses the real fetch when none is given', async () => {
        const sessions = new StreamSessions(() => {return 'sess'});
        sessions.create({ url: 'http://127.0.0.1:1/x.ts', subtitleUrl: null, referer: null, subtitles: [] });
        const response = await createStreamHandler(sessions)(new Request(proxyUrl('sess', 'http://127.0.0.1:1/x.ts')));
        expect(response.status).toBe(502);
    });
});
