import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HlsUnsupportedError } from '@main/services/hlsPlaylist';
import { DEFAULT_HLS_TUNING, partPathFor, startHlsRecording, type HlsRecorderTuning, type HlsRecordingProgress, type HlsSource } from '@main/services/hlsRecorder';
import { cleanTempDirs, makeTempDir } from '../../helpers/tempDir';

afterEach(() => {
    cleanTempDirs();
});

const VIDEO: HlsSource = { url: 'https://cdn.test/video/list.m3u8?session=1', headers: { 'User-Agent': 'Agent', Referer: 'https://site.test/' } };
const AUDIO: HlsSource = { url: 'https://cdn.test/audio/list.m3u8?session=1', headers: { 'User-Agent': 'Agent' } };

interface Track {
    name: string;
    // The place of the first segment the playlist lists, and how many it lists.
    first: number;
    count: number;
    ended: boolean;
    withInit: boolean;
    initName: string;
    playlistStatus: number;
    playlistText: string | null;
}

// A site that serves the playlists and the segments of the renditions the test sets up. A segment is the text "<track>-<number>;".
class FakeSite {
    readonly tracks = new Map<string, Track>();
    readonly requests: Array<{ url: string; headers: Record<string, string> }> = [];
    // How many times an address answers with an error before it answers well, and with which status.
    readonly failures = new Map<string, { times: number; status: number }>();
    // How long an address takes to answer.
    readonly delays = new Map<string, number>();
    // What happens each time a playlist is asked for (the stream moves on).
    onPlaylist: ((track: Track, calls: number) => void) | null = null;
    // Unless a test moves the stream on itself, a playlist ends the stream when it is asked for this many times (null: it never ends).
    endsAtReload: number | null = 2;
    private readonly playlistCalls = new Map<string, number>();
    active = 0;
    mostActive = 0;
    // The same, for the segments only.
    activeSegments = 0;
    mostActiveSegments = 0;

    add(name: string, overrides: Partial<Track> = {}): Track {
        const track: Track = { name, first: 100, count: 5, ended: false, withInit: true, initName: 'init.mp4', playlistStatus: 200, playlistText: null, ...overrides };
        this.tracks.set(name, track);
        return track;
    }

    private playlistOf(track: Track): string {
        const lines = ['#EXTM3U', '#EXT-X-VERSION:6', '#EXT-X-TARGETDURATION:2', `#EXT-X-MEDIA-SEQUENCE:${String(track.first)}`];
        if (track.withInit) {
            lines.push(`#EXT-X-MAP:URI="${track.initName}"`);
        }
        for (let index = 0; index < track.count; index += 1) {
            lines.push('#EXTINF:2.0,', `seg${String(track.first + index)}.m4s`);
        }
        if (track.ended) {
            lines.push('#EXT-X-ENDLIST');
        }
        return lines.join('\n');
    }

    readonly fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const url = String(input);
        this.requests.push({ url, headers: { ...(init?.headers as Record<string, string>) } });
        const signal = init?.signal;
        const isSegment = /\/seg\d+\.m4s/.test(url);
        this.active += 1;
        this.activeSegments += isSegment ? 1 : 0;
        this.mostActive = Math.max(this.mostActive, this.active);
        this.mostActiveSegments = Math.max(this.mostActiveSegments, this.activeSegments);
        try {
            const delay = this.delays.get(url);
            if (delay !== undefined) {
                await new Promise((resolve) => {
                    setTimeout(resolve, delay);
                });
            }
            if (signal?.aborted === true) {
                throw new DOMException('aborted', 'AbortError');
            }
            const failure = this.failures.get(url);
            if (failure !== undefined && failure.times > 0) {
                failure.times -= 1;
                return new Response(null, { status: failure.status });
            }
            const match = /^https:\/\/cdn\.test\/([a-z]+)\/(.*?)(\?.*)?$/.exec(url);
            const track = match === null ? undefined : this.tracks.get(match[1] ?? '');
            if (match === null || track === undefined) {
                return new Response(null, { status: 404 });
            }
            const file = match[2] ?? '';
            if (file === 'list.m3u8') {
                const calls = (this.playlistCalls.get(track.name) ?? 0) + 1;
                this.playlistCalls.set(track.name, calls);
                if (this.onPlaylist !== null) {
                    this.onPlaylist(track, calls);
                } else if (this.endsAtReload !== null && calls >= this.endsAtReload) {
                    track.ended = true;
                }
                return new Response(track.playlistText ?? this.playlistOf(track), { status: track.playlistStatus });
            }
            if (file === track.initName) {
                return new Response(`${track.name}-init;`, { status: 200 });
            }
            const segment = /^seg(\d+)\.m4s$/.exec(file);
            return segment === null ? new Response(null, { status: 404 }) : new Response(`${track.name}-${segment[1] ?? ''};`, { status: 200 });
        } finally {
            this.active -= 1;
            this.activeSegments -= isSegment ? 1 : 0;
        }
    }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

function segmentsOf(name: string, from: number, to: number): string {
    return Array.from({ length: to - from + 1 }, (_value, index) => {
        return `${name}-${String(from + index)};`;
    }).join('');
}

function setup(options: { sources?: HlsSource[]; tuning?: Partial<HlsRecorderTuning>; muxResult?: boolean; onProgress?: (progress: HlsRecordingProgress) => void } = {}) {
    const site = new FakeSite();
    const dir = makeTempDir();
    const filePath = join(dir, 'Live [room].mp4');
    const clock = { value: 1_000_000 };
    const sleeps: number[] = [];
    const muxed: Array<{ binary: string; args: string[]; contents: string[] }> = [];
    const sources = options.sources ?? [VIDEO, AUDIO];
    const start = () => {
        return startHlsRecording(
            { sources, filePath, ffmpegBinary: '/bin/ffmpeg', onProgress: options.onProgress },
            {
                fetchImpl: site.fetchImpl,
                now: () => {
                    return clock.value;
                },
                sleep: async (milliseconds, signal) => {
                    if (signal.aborted) {
                        return;
                    }
                    sleeps.push(milliseconds);
                    clock.value += milliseconds;
                    await new Promise((resolve) => {
                        setImmediate(resolve);
                    });
                },
                mux: (binary, args) => {
                    const inputs = args.flatMap((argument, index) => {
                        return args[index - 1] === '-i' ? [argument] : [];
                    });
                    muxed.push({
                        binary,
                        args,
                        contents: inputs.map((input) => {
                            return readFileSync(input, 'utf-8');
                        })
                    });
                    return Promise.resolve(options.muxResult ?? true);
                },
                tuning: { retryDelayMs: 1, progressMs: 600_000, ...options.tuning }
            }
        );
    };
    return { site, dir, filePath, clock, sleeps, muxed, start };
}

describe('partPathFor', () => {
    it('keeps the first rendition beside the final file, where the queue measures it', () => {
        expect(partPathFor('/d/Live [room].mp4', 0)).toBe('/d/Live [room].mp4.part');
    });

    it('names the other renditions like the pieces yt-dlp leaves, with their extension', () => {
        expect(partPathFor('/d/Live [room].mp4', 1)).toBe('/d/Live [room].f1.mp4.part');
        expect(partPathFor('/d/Live [room].mkv', 2)).toBe('/d/Live [room].f2.mkv.part');
    });

    it('names the other renditions of a file with no extension', () => {
        expect(partPathFor('/d/Live', 1)).toBe('/d/Live.f1.part');
    });
});

describe('startHlsRecording of a stream that is over', () => {
    it('keeps the initialization segment and the last segments of each rendition, in order, and copies them into the final file', async () => {
        const { site, filePath, muxed, start } = setup();
        site.add('video');
        site.add('audio');
        const recording = start();
        await recording.started;
        await expect(recording.result).resolves.toEqual({ status: 'done', filePath, lostSegments: 0 });
        // The recording starts three segments before the end of the playlist, like a player does.
        expect(muxed).toEqual([
            {
                binary: '/bin/ffmpeg',
                args: ['-y', '-v', 'error', '-i', `${filePath}.part`, '-i', partPathFor(filePath, 1), '-c', 'copy', filePath],
                contents: [`video-init;${segmentsOf('video', 102, 104)}`, `audio-init;${segmentsOf('audio', 102, 104)}`]
            }
        ]);
    });

    it('deletes the renditions once the final file is made', async () => {
        const { site, dir, start } = setup();
        site.add('video');
        site.add('audio');
        await start().result;
        expect(readdirSync(dir)).toEqual([]);
    });

    it('records a stream that has the video and the audio together as one rendition', async () => {
        const { site, filePath, muxed, start } = setup({ sources: [VIDEO] });
        site.add('video');
        await expect(start().result).resolves.toEqual({ status: 'done', filePath, lostSegments: 0 });
        expect(muxed[0]?.args).toEqual(['-y', '-v', 'error', '-i', `${filePath}.part`, '-c', 'copy', filePath]);
    });

    it('records a stream of segments that have no initialization segment', async () => {
        const { site, muxed, start } = setup({ sources: [VIDEO] });
        site.add('video', { withInit: false });
        await start().result;
        expect(muxed[0]?.contents).toEqual([segmentsOf('video', 102, 104)]);
    });

    it('records all the segments of a playlist shorter than the ones it starts before the end', async () => {
        const { site, muxed, start } = setup({ sources: [VIDEO] });
        site.add('video', { count: 2 });
        await start().result;
        expect(muxed[0]?.contents).toEqual([`video-init;${segmentsOf('video', 100, 101)}`]);
    });

    it('starts as many segments before the end as it is told to', async () => {
        const { site, muxed, start } = setup({ sources: [VIDEO], tuning: { startSegmentsBack: 1 } });
        site.add('video');
        await start().result;
        expect(muxed[0]?.contents).toEqual([`video-init;${segmentsOf('video', 104, 104)}`]);
    });

    it('sends the headers of each rendition with every request it makes', async () => {
        const { site, start } = setup();
        site.add('video');
        site.add('audio');
        await start().result;
        site.requests.forEach((request) => {
            expect(request.headers).toEqual(request.url.startsWith('https://cdn.test/video/') ? VIDEO.headers : AUDIO.headers);
        });
        expect(site.requests.length).toBeGreaterThan(0);
    });

    it('reads a stream whose addresses are relative to the playlist', async () => {
        const { site, start } = setup({ sources: [VIDEO] });
        site.add('video');
        await start().result;
        const urls = site.requests.map((request) => {
            return request.url;
        });
        expect(urls).toEqual(expect.arrayContaining(['https://cdn.test/video/init.mp4', 'https://cdn.test/video/seg102.m4s', 'https://cdn.test/video/seg103.m4s', 'https://cdn.test/video/seg104.m4s']));
    });
});

describe('startHlsRecording following a stream that goes on', () => {
    // The playlist gets two more segments each time it is asked for, and ends after `reloads` times.
    function growing(site: FakeSite, reloads: number): void {
        site.onPlaylist = (track, calls) => {
            if (calls > 1) {
                track.first += 2;
            }
            track.ended = calls >= reloads;
        };
    }

    it('saves the new segments, each one once and in order, until the playlist ends', async () => {
        const { site, muxed, start } = setup({ sources: [VIDEO] });
        const track = site.add('video', { ended: false, count: 3, first: 10 });
        growing(site, 4);
        const recording = start();
        await expect(recording.result).resolves.toMatchObject({ status: 'done', lostSegments: 0 });
        // Three segments at first (10 to 12), then two more at each reload (up to 18).
        expect(track.first).toBe(16);
        expect(muxed[0]?.contents).toEqual([`video-init;${segmentsOf('video', 10, 18)}`]);
        const asked = site.requests.filter((request) => {
            return request.url.includes('/seg');
        });
        expect(asked).toHaveLength(9);
    });

    it('waits before it reads the playlist again, not less than the minimum and about half a segment otherwise', async () => {
        const { site, sleeps, start } = setup({ sources: [VIDEO] });
        site.add('video', { ended: false, count: 3, first: 10 });
        growing(site, 3);
        await start().result;
        expect(sleeps.length).toBeGreaterThan(0);
        sleeps.forEach((milliseconds) => {
            expect(milliseconds).toBe(1000);
        });
    });

    it('does not wait less than the minimum when the segments are short', async () => {
        const { site, sleeps, start } = setup({ sources: [VIDEO], tuning: { minReloadMs: 400 } });
        site.add('video', { count: 3, first: 10 });
        site.onPlaylist = (current, calls) => {
            current.first += calls > 1 ? 1 : 0;
            current.ended = calls >= 3;
            current.playlistText = ['#EXTM3U', '#EXT-X-TARGETDURATION:2', `#EXT-X-MEDIA-SEQUENCE:${String(current.first)}`, '#EXTINF:0.2,', `seg${String(current.first)}.m4s`, ...(current.ended ? ['#EXT-X-ENDLIST'] : [])].join('\n');
        };
        await start().result;
        sleeps.forEach((milliseconds) => {
            expect(milliseconds).toBe(400);
        });
    });

    it('downloads the segments of a rendition at the same time, up to the limit, and writes them in order anyway', async () => {
        const { site, muxed, start } = setup({ sources: [VIDEO], tuning: { concurrency: 3, startSegmentsBack: 10 } });
        site.add('video', { count: 8, first: 0 });
        // The first segments are the slowest to arrive.
        site.delays.set('https://cdn.test/video/seg1.m4s', 60);
        site.delays.set('https://cdn.test/video/seg2.m4s', 40);
        site.delays.set('https://cdn.test/video/seg3.m4s', 20);
        await start().result;
        expect(site.mostActiveSegments).toBe(3);
        expect(muxed[0]?.contents).toEqual([`video-init;${segmentsOf('video', 0, 7)}`]);
    });

    it('does not download one rendition with the connections of the other', async () => {
        const { site, start } = setup({ tuning: { concurrency: 2, startSegmentsBack: 10 } });
        site.add('video', { count: 6, first: 0 });
        site.add('audio', { count: 6, first: 0 });
        for (let index = 1; index < 6; index += 1) {
            site.delays.set(`https://cdn.test/video/seg${String(index)}.m4s`, 15);
            site.delays.set(`https://cdn.test/audio/seg${String(index)}.m4s`, 15);
        }
        await start().result;
        expect(site.mostActiveSegments).toBeGreaterThan(2);
        expect(site.mostActiveSegments).toBeLessThanOrEqual(4);
    });

    it('goes on with the stream when only the other rendition has ended, and ends the recording when one does', async () => {
        const { site, muxed, start } = setup();
        site.add('video', { count: 3, first: 10 });
        site.add('audio', { count: 3, first: 20 });
        site.onPlaylist = (track, calls) => {
            if (track.name === 'video') {
                track.first += calls > 1 ? 2 : 0;
            } else {
                track.ended = calls >= 3;
            }
        };
        await start().result;
        expect(muxed).toHaveLength(1);
        expect(muxed[0]?.contents[1]).toBe(`audio-init;${segmentsOf('audio', 20, 22)}`);
    });
});

describe('startHlsRecording when segments are lost', () => {
    it('counts a segment that left the playlist before it could be asked for, and goes on with the next ones', async () => {
        const { site, muxed, start } = setup({ sources: [VIDEO] });
        site.add('video', { ended: false, count: 3, first: 10 });
        site.onPlaylist = (track, calls) => {
            // The second reload shows segments 15 to 17: 13 and 14 were never listed again.
            track.first = calls === 1 ? 10 : 15;
            track.ended = calls >= 2;
        };
        const result = await start().result;
        expect(result).toMatchObject({ status: 'done', lostSegments: 2 });
        expect(muxed[0]?.contents).toEqual([`video-init;${segmentsOf('video', 10, 12)}${segmentsOf('video', 15, 17)}`]);
    });

    it.each([404, 410])('counts a segment the site answers %i for, without asking again', async (status) => {
        const { site, muxed, start } = setup({ sources: [VIDEO], tuning: { startSegmentsBack: 10 } });
        site.add('video', { count: 4, first: 0 });
        site.failures.set('https://cdn.test/video/seg2.m4s', { times: 100, status });
        const result = await start().result;
        expect(result).toMatchObject({ status: 'done', lostSegments: 1 });
        expect(muxed[0]?.contents).toEqual([`video-init;${segmentsOf('video', 0, 1)}${segmentsOf('video', 3, 3)}`]);
        expect(
            site.requests.filter((request) => {
                return request.url.endsWith('seg2.m4s');
            })
        ).toHaveLength(1);
    });

    it('asks again for a segment that failed, and keeps it when the site gives it', async () => {
        const { site, muxed, start } = setup({ sources: [VIDEO], tuning: { startSegmentsBack: 10 } });
        site.add('video', { count: 4, first: 0 });
        site.failures.set('https://cdn.test/video/seg2.m4s', { times: 2, status: 503 });
        const result = await start().result;
        expect(result).toMatchObject({ status: 'done', lostSegments: 0 });
        expect(muxed[0]?.contents).toEqual([`video-init;${segmentsOf('video', 0, 3)}`]);
        expect(
            site.requests.filter((request) => {
                return request.url.endsWith('seg2.m4s');
            })
        ).toHaveLength(3);
    });

    it('gives up on a segment after the attempts it has, and counts it', async () => {
        const { site, muxed, start } = setup({ sources: [VIDEO], tuning: { startSegmentsBack: 10, segmentAttempts: 2 } });
        site.add('video', { count: 4, first: 0 });
        site.failures.set('https://cdn.test/video/seg2.m4s', { times: 100, status: 503 });
        const result = await start().result;
        expect(result).toMatchObject({ status: 'done', lostSegments: 1 });
        expect(muxed[0]?.contents).toEqual([`video-init;${segmentsOf('video', 0, 1)}${segmentsOf('video', 3, 3)}`]);
        expect(
            site.requests.filter((request) => {
                return request.url.endsWith('seg2.m4s');
            })
        ).toHaveLength(2);
    });

    it('counts a segment that comes back empty', async () => {
        const { site, start } = setup({ sources: [VIDEO], tuning: { startSegmentsBack: 10, segmentAttempts: 1 } });
        site.add('video', { count: 3, first: 0 });
        const original = site.fetchImpl.getMockImplementation() as (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
        site.fetchImpl.mockImplementation(async (input, init) => {
            if (String(input).endsWith('seg1.m4s')) {
                return new Response('', { status: 200 });
            }
            return original(input, init);
        });
        await expect(start().result).resolves.toMatchObject({ status: 'done', lostSegments: 1 });
    });
});

describe('startHlsRecording when the stream stops', () => {
    it('takes the stream as over when nothing new comes for a while, and keeps what it has', async () => {
        const { site, clock, muxed, start } = setup({ sources: [VIDEO], tuning: { stallMs: 10_000 } });
        site.endsAtReload = null;
        site.add('video', { count: 3, first: 10 });
        const begin = clock.value;
        await expect(start().result).resolves.toMatchObject({ status: 'done', lostSegments: 0 });
        expect(clock.value - begin).toBeGreaterThan(10_000);
        expect(muxed[0]?.contents).toEqual([`video-init;${segmentsOf('video', 10, 12)}`]);
    });

    it('takes the stream as over when the playlist cannot be read for a while, and keeps what it has', async () => {
        const { site, muxed, start } = setup({ sources: [VIDEO], tuning: { stallMs: 5_000 } });
        const track = site.add('video', { ended: false, count: 3, first: 10 });
        site.onPlaylist = (current, calls) => {
            current.playlistStatus = calls > 1 ? 403 : 200;
            current.first = 10 + (calls > 1 ? 0 : 0);
        };
        await expect(start().result).resolves.toMatchObject({ status: 'done' });
        expect(track.playlistStatus).toBe(403);
        expect(muxed[0]?.contents).toEqual([`video-init;${segmentsOf('video', 10, 12)}`]);
    });

    it('goes on when the playlist fails only for a moment', async () => {
        const { site, muxed, start } = setup({ sources: [VIDEO], tuning: { stallMs: 60_000 } });
        site.add('video', { ended: false, count: 3, first: 10 });
        site.onPlaylist = (track, calls) => {
            track.playlistStatus = calls === 2 || calls === 3 ? 503 : 200;
            track.first = calls >= 4 ? 13 : 10;
            track.ended = calls >= 4;
        };
        await expect(start().result).resolves.toMatchObject({ status: 'done', lostSegments: 0 });
        expect(muxed[0]?.contents).toEqual([`video-init;${segmentsOf('video', 10, 15)}`]);
    });

    it('takes a stream that started over as another recording: the numbers went back', async () => {
        const { site, muxed, start } = setup({ sources: [VIDEO], tuning: { stallMs: 600_000 } });
        site.add('video', { ended: false, count: 3, first: 500 });
        site.onPlaylist = (track, calls) => {
            track.first = calls === 1 ? 500 : 3;
        };
        await expect(start().result).resolves.toMatchObject({ status: 'done', lostSegments: 0 });
        expect(muxed[0]?.contents).toEqual([`video-init;${segmentsOf('video', 500, 502)}`]);
    });

    it('takes a stream that has another initialization segment as another recording', async () => {
        const { site, muxed, start } = setup({ sources: [VIDEO], tuning: { stallMs: 600_000 } });
        site.add('video', { ended: false, count: 3, first: 10 });
        site.onPlaylist = (track, calls) => {
            track.initName = calls === 1 ? 'init.mp4' : 'init2.mp4';
            track.first = 10 + calls;
        };
        await expect(start().result).resolves.toMatchObject({ status: 'done' });
        expect(muxed[0]?.contents[0]).toBe(`video-init;${segmentsOf('video', 11, 13)}`);
    });
});

describe('startHlsRecording stop and cancel', () => {
    // A stream that never ends: two more segments each time its playlist is asked for.
    function endless(site: FakeSite): void {
        site.add('video', { ended: false, count: 3, first: 10 });
        site.onPlaylist = (track, calls) => {
            track.first = 10 + (calls - 1) * 2;
        };
    }

    it('stops when it is asked to and keeps what it recorded', async () => {
        const { site, filePath, muxed, dir, start } = setup({ sources: [VIDEO] });
        endless(site);
        const recording = start();
        await recording.started;
        recording.stop();
        const result = await recording.result;
        expect(result).toMatchObject({ status: 'done', filePath });
        expect(muxed).toHaveLength(1);
        expect(muxed[0]?.contents[0]?.startsWith('video-init;video-10;video-11;video-12;')).toBe(true);
        expect(readdirSync(dir)).toEqual([]);
    });

    it('stops when it is asked to before the recording is under way', async () => {
        const { site, muxed, start } = setup({ sources: [VIDEO] });
        endless(site);
        const recording = start();
        recording.stop();
        await expect(recording.result).resolves.toMatchObject({ status: 'done' });
        expect(muxed).toHaveLength(1);
    });

    it('waits for the segments being downloaded when it is stopped, up to a limit', async () => {
        const { site, muxed, start } = setup({ sources: [VIDEO], tuning: { drainMs: 5_000, startSegmentsBack: 3 } });
        endless(site);
        const recording = start();
        await recording.started;
        site.delays.set('https://cdn.test/video/seg12.m4s', 30);
        recording.stop();
        await recording.result;
        // The slow segment was waited for: it is in the file, after the ones before it.
        expect(muxed[0]?.contents[0]?.startsWith(`video-init;${segmentsOf('video', 10, 12)}`)).toBe(true);
    });

    it('does not wait longer than the limit for a segment that does not come', async () => {
        const { site, muxed, start } = setup({ sources: [VIDEO], tuning: { drainMs: 20 } });
        endless(site);
        site.delays.set('https://cdn.test/video/seg12.m4s', 400);
        const recording = start();
        await recording.started;
        const begin = Date.now();
        recording.stop();
        await expect(recording.result).resolves.toMatchObject({ status: 'done' });
        expect(Date.now() - begin).toBeLessThan(300);
        expect(muxed[0]?.contents[0]?.includes('video-12;')).toBe(false);
    });

    it('cancels when it is asked to: nothing is copied and nothing is left', async () => {
        const { site, dir, muxed, start } = setup({ sources: [VIDEO] });
        endless(site);
        const recording = start();
        await recording.started;
        recording.cancel();
        await expect(recording.result).resolves.toEqual({ status: 'cancelled' });
        expect(muxed).toEqual([]);
        expect(readdirSync(dir)).toEqual([]);
    });

    it('cancels when it is asked to before the recording is under way', async () => {
        const { site, dir, muxed, start } = setup({ sources: [VIDEO] });
        endless(site);
        site.delays.set('https://cdn.test/video/list.m3u8?session=1', 20);
        const recording = start();
        recording.cancel();
        await expect(recording.result).resolves.toEqual({ status: 'cancelled' });
        await expect(recording.started).rejects.toBeDefined();
        expect(muxed).toEqual([]);
        expect(readdirSync(dir)).toEqual([]);
    });
});

describe('startHlsRecording when it cannot follow the stream', () => {
    it('refuses a stream the site does not give, before it keeps anything', async () => {
        const { site, dir, muxed, start } = setup({ sources: [VIDEO] });
        site.add('video', { playlistStatus: 403 });
        const recording = start();
        await expect(recording.started).rejects.toThrow('The server answered 403');
        await expect(recording.result).resolves.toEqual({ status: 'error', message: 'The server answered 403' });
        expect(muxed).toEqual([]);
        expect(readdirSync(dir)).toEqual([]);
    });

    it.each([
        ['encrypted segments', '#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-KEY:METHOD=AES-128,URI="k"\n#EXTINF:2,\nseg1.m4s', 'The segments are encrypted'],
        ['a playlist of playlists', '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nlow.m3u8', 'The playlist lists other playlists, not segments'],
        ['byte ranges', '#EXTM3U\n#EXTINF:2,\n#EXT-X-BYTERANGE:10@0\nseg1.m4s', 'The segments are byte ranges'],
        ['a playlist with no segment', '#EXTM3U\n#EXT-X-TARGETDURATION:2', 'The stream has no segment to record'],
        ['a stream that is over already', '#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXTINF:2,\nseg1.m4s\n#EXT-X-ENDLIST', 'The stream has no segment to record']
    ])('refuses %s with an error that says this way cannot follow it', async (_label, text, message) => {
        const { site, dir, start } = setup({ sources: [VIDEO] });
        site.add('video', { playlistText: text });
        const recording = start();
        await expect(recording.started).rejects.toThrow(HlsUnsupportedError);
        await expect(recording.started).rejects.toThrow(message);
        await expect(recording.result).resolves.toEqual({ status: 'error', message });
        expect(readdirSync(dir)).toEqual([]);
    });

    it('refuses the stream when the first segment cannot be had, and leaves nothing', async () => {
        const { site, dir, start } = setup({ sources: [VIDEO] });
        site.add('video');
        site.failures.set('https://cdn.test/video/seg102.m4s', { times: 100, status: 500 });
        const recording = start();
        await expect(recording.started).rejects.toThrow('The server answered 500');
        await recording.result;
        expect(readdirSync(dir)).toEqual([]);
    });

    it('refuses the stream when the initialization segment cannot be had', async () => {
        const { site, start } = setup({ sources: [VIDEO] });
        site.add('video');
        site.failures.set('https://cdn.test/video/init.mp4', { times: 100, status: 404 });
        await expect(start().started).rejects.toThrow('The server answered 404');
    });

    it('refuses the stream when one of the renditions cannot be followed, and leaves the other one\'s file out', async () => {
        const { site, dir, start } = setup();
        site.add('video');
        site.add('audio', { playlistStatus: 500 });
        const recording = start();
        await expect(recording.started).rejects.toThrow('The server answered 500');
        await recording.result;
        expect(readdirSync(dir)).toEqual([]);
    });

    it('refuses a stream whose first segment is empty', async () => {
        const { site, start } = setup({ sources: [VIDEO] });
        site.add('video');
        const original = site.fetchImpl.getMockImplementation() as (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
        site.fetchImpl.mockImplementation(async (input, init) => {
            if (String(input).endsWith('seg102.m4s')) {
                return new Response('', { status: 200 });
            }
            return original(input, init);
        });
        await expect(start().started).rejects.toThrow('The server answered with nothing');
    });

    it('says so, and keeps the renditions, when ffmpeg cannot make the final file', async () => {
        const { site, filePath, dir, start } = setup({ muxResult: false });
        site.add('video');
        site.add('audio');
        await expect(start().result).resolves.toEqual({ status: 'error', message: 'ffmpeg could not copy the recording into the final file' });
        expect(existsSync(filePath)).toBe(false);
        expect(readdirSync(dir).sort()).toEqual(['Live [room].f1.mp4.part', 'Live [room].mp4.part']);
    });
});

describe('startHlsRecording progress', () => {
    it('tells how much was recorded and how fast, until the recording ends', async () => {
        const reports: HlsRecordingProgress[] = [];
        const { site, clock, start } = setup({
            sources: [VIDEO],
            tuning: { progressMs: 5, stallMs: 10_000 },
            onProgress: (progress) => {
                reports.push(progress);
                clock.value += 1000;
            }
        });
        site.add('video', { ended: false, count: 3, first: 10 });
        site.onPlaylist = (track, calls) => {
            track.first = 10 + calls;
            track.ended = calls >= 12;
        };
        site.delays.set('https://cdn.test/video/list.m3u8?session=1', 8);
        await start().result;
        expect(reports.length).toBeGreaterThan(0);
        const last = reports.at(-1);
        expect(last?.downloadedBytes).toBeGreaterThan(0);
        expect(last?.bytesPerSecond).toBeGreaterThanOrEqual(0);
        expect(last?.lostSegments).toBe(0);
        expect(last?.elapsedSeconds).toBeGreaterThan(0);
        reports.forEach((report, index) => {
            expect(report.downloadedBytes).toBeGreaterThanOrEqual(reports[index - 1]?.downloadedBytes ?? 0);
        });
    });

    it('has defaults that download several segments at once', () => {
        expect(DEFAULT_HLS_TUNING.concurrency).toBeGreaterThan(1);
        expect(DEFAULT_HLS_TUNING.startSegmentsBack).toBe(3);
        expect(DEFAULT_HLS_TUNING.segmentAttempts).toBe(3);
    });
});
