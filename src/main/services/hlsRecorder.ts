import { execFile } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { open, type FileHandle } from 'node:fs/promises';
import { extname } from 'node:path';
import { parseHlsPlaylist, HlsUnsupportedError, type HlsPlaylist, type HlsSegment } from './hlsPlaylist';

export interface HlsSource {
    // The media playlist of one rendition (video, audio, or both together).
    url: string;
    headers: Record<string, string>;
}

export interface HlsRecordingProgress {
    downloadedBytes: number;
    bytesPerSecond: number;
    elapsedSeconds: number;
    // Segments that expired from the playlist, or could not be downloaded, before they were saved.
    lostSegments: number;
}

export interface HlsRecordingOptions {
    sources: HlsSource[];
    // The finished file; the renditions are kept beside it while the stream is recorded.
    filePath: string;
    ffmpegBinary: string;
    onProgress?: (progress: HlsRecordingProgress) => void;
}

export type HlsRecordingResult =
    | { status: 'done'; filePath: string; lostSegments: number }
    | { status: 'error'; message: string }
    | { status: 'cancelled' };

export interface HlsRecording {
    // Settles once the recording is under way. Rejects with an HlsUnsupportedError (or the error of the first requests) when this
    // way of recording cannot follow the stream, before anything was kept: the caller then records it another way.
    started: Promise<void>;
    result: Promise<HlsRecordingResult>;
    // Ends the recording keeping what was recorded.
    stop: () => void;
    // Ends the recording and deletes what was recorded.
    cancel: () => void;
}

export interface HlsRecorderTuning {
    // Segments of a rendition downloaded at the same time: one connection of the site gives less than the stream needs.
    concurrency: number;
    // The recording starts this many segments before the end of the playlist (what a player does too).
    startSegmentsBack: number;
    segmentAttempts: number;
    retryDelayMs: number;
    requestTimeoutMs: number;
    minReloadMs: number;
    // How long the playlist can fail, or have nothing new, before the stream is taken as over.
    stallMs: number;
    // How long a recording that was stopped waits for the segments it was downloading.
    drainMs: number;
    progressMs: number;
}

export const DEFAULT_HLS_TUNING: HlsRecorderTuning = {
    concurrency: 4,
    startSegmentsBack: 3,
    segmentAttempts: 3,
    retryDelayMs: 400,
    requestTimeoutMs: 20_000,
    minReloadMs: 250,
    stallMs: 30_000,
    drainMs: 8_000,
    progressMs: 1000
};

export interface HlsRecorderDependencies {
    fetchImpl?: typeof fetch;
    // Copies the renditions into the finished file; true when it worked.
    mux?: (binary: string, args: string[]) => Promise<boolean>;
    // Waits; ends sooner when the signal is aborted.
    sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
    now?: () => number;
    tuning?: Partial<HlsRecorderTuning>;
}

class HttpStatusError extends Error {
    constructor(readonly status: number) {
        super(`The server answered ${status}`);
    }
}

function defaultMux(binary: string, args: string[]): Promise<boolean> {
    return new Promise((resolve) => {
        execFile(binary, args, { windowsHide: true }, (error) => {
            resolve(error === null);
        });
    });
}

function defaultSleep(milliseconds: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
        if (signal.aborted) {
            resolve();
            return;
        }
        const done = (): void => {
            clearTimeout(timer);
            signal.removeEventListener('abort', done);
            resolve();
        };
        const timer = setTimeout(done, milliseconds);
        signal.addEventListener('abort', done);
    });
}

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

// Where a rendition is kept while the stream is recorded: the first one is `<file>.part` (what the queue measures to show how much is
// recorded), the others are named like the pieces yt-dlp leaves, which the queue knows how to delete.
export function partPathFor(filePath: string, index: number): string {
    if (index === 0) {
        return `${filePath}.part`;
    }
    const extension = extname(filePath);
    const stem = extension.length > 0 ? filePath.slice(0, -extension.length) : filePath;
    return `${stem}.f${index}${extension}.part`;
}

// One rendition of the stream: follows its playlist, downloads the new segments several at a time and writes them in order.
class HlsTrack {
    bytes = 0;
    lost = 0;
    private file: FileHandle | null = null;
    private initUrl: string | null = null;
    // The highest segment handed to the downloads, and the next one to write.
    private lastQueued = 0;
    private nextWrite = 0;
    private readonly waiting: HlsSegment[] = [];
    private active = 0;
    private readonly done = new Map<number, Buffer | null>();
    private flushing = false;
    private idle: (() => void) | null = null;
    private halted = false;

    constructor(
        private readonly source: HlsSource,
        readonly partPath: string,
        private readonly hard: AbortSignal,
        private readonly soft: AbortController,
        private readonly environment: { fetchImpl: typeof fetch; sleep: (milliseconds: number, signal: AbortSignal) => Promise<void>; now: () => number; tuning: HlsRecorderTuning }
    ) {}

    private async fetchBytes(url: string): Promise<Buffer> {
        const { fetchImpl, tuning } = this.environment;
        const response = await fetchImpl(url, { headers: this.source.headers, signal: AbortSignal.any([this.hard, AbortSignal.timeout(tuning.requestTimeoutMs)]) });
        if (response.status !== 200) {
            await response.body?.cancel();
            throw new HttpStatusError(response.status);
        }
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.byteLength === 0) {
            throw new Error('The server answered with nothing');
        }
        return bytes;
    }

    private async loadPlaylist(): Promise<HlsPlaylist> {
        const { fetchImpl, tuning } = this.environment;
        const response = await fetchImpl(this.source.url, { headers: this.source.headers, signal: AbortSignal.any([this.hard, AbortSignal.timeout(tuning.requestTimeoutMs)]) });
        if (response.status !== 200) {
            await response.body?.cancel();
            throw new HttpStatusError(response.status);
        }
        return parseHlsPlaylist(await response.text(), this.source.url);
    }

    // Opens the file and saves the first segments: anything that goes wrong here means this way of recording cannot follow the stream.
    async prepare(): Promise<void> {
        const playlist = await this.loadPlaylist();
        if (playlist.segments.length === 0 || playlist.ended) {
            throw new HlsUnsupportedError('The stream has no segment to record');
        }
        const first = Math.max(0, playlist.segments.length - this.environment.tuning.startSegmentsBack);
        const wanted = playlist.segments.slice(first);
        this.file = await open(this.partPath, 'w');
        if (playlist.initUrl !== null) {
            const init = await this.fetchBytes(playlist.initUrl);
            this.initUrl = playlist.initUrl;
            await this.write(init);
        }
        const firstSegment = wanted[0];
        if (firstSegment === undefined) {
            throw new HlsUnsupportedError('The stream has no segment to record');
        }
        await this.write(await this.fetchBytes(firstSegment.url));
        this.lastQueued = firstSegment.sequence;
        this.nextWrite = firstSegment.sequence + 1;
        this.enqueueNew({ ...playlist, segments: wanted });
    }

    private async write(data: Buffer): Promise<void> {
        await this.file?.write(data);
        this.bytes += data.byteLength;
    }

    // Hands the segments that were not seen yet to the downloads. Returns how many.
    private enqueueNew(playlist: HlsPlaylist): number {
        const first = playlist.segments[0];
        if (first !== undefined && first.sequence > this.lastQueued + 1) {
            // Segments that left the playlist before they were asked for.
            for (let sequence = this.lastQueued + 1; sequence < first.sequence; sequence += 1) {
                this.done.set(sequence, null);
            }
            this.lastQueued = first.sequence - 1;
        }
        let added = 0;
        playlist.segments.forEach((segment) => {
            if (segment.sequence > this.lastQueued) {
                this.waiting.push(segment);
                this.lastQueued = segment.sequence;
                added += 1;
            }
        });
        this.pump();
        void this.flush();
        return added;
    }

    private pump(): void {
        while (this.active < this.environment.tuning.concurrency && this.waiting.length > 0) {
            const segment = this.waiting.shift();
            if (segment === undefined) {
                return;
            }
            this.active += 1;
            void this.download(segment).then((data) => {
                this.active -= 1;
                this.done.set(segment.sequence, data);
                this.pump();
                void this.flush();
                this.notifyIdle();
            });
        }
    }

    // The segment, or null when it is gone (it left the playlist) or the server would not give it.
    private async download(segment: HlsSegment): Promise<Buffer | null> {
        const { tuning, sleep } = this.environment;
        for (let attempt = 1; attempt <= tuning.segmentAttempts; attempt += 1) {
            if (this.hard.aborted) {
                return null;
            }
            try {
                return await this.fetchBytes(segment.url);
            } catch (error) {
                const gone = error instanceof HttpStatusError && (error.status === 404 || error.status === 410);
                if (gone || attempt === tuning.segmentAttempts) {
                    return null;
                }
                await sleep(tuning.retryDelayMs * attempt, this.hard);
            }
        }
        return null;
    }

    private async flush(): Promise<void> {
        if (this.flushing) {
            return;
        }
        this.flushing = true;
        for (;;) {
            if (!this.done.has(this.nextWrite)) {
                this.flushing = false;
                this.notifyIdle();
                return;
            }
            const data = this.done.get(this.nextWrite) ?? null;
            this.done.delete(this.nextWrite);
            this.nextWrite += 1;
            if (data === null) {
                this.lost += 1;
            } else {
                try {
                    await this.write(data);
                } catch {
                    this.lost += 1;
                }
            }
        }
    }

    private notifyIdle(): void {
        if (this.idle !== null && this.active === 0 && this.waiting.length === 0 && !this.flushing && !this.done.has(this.nextWrite)) {
            const resolve = this.idle;
            this.idle = null;
            resolve();
        }
    }

    // Follows the playlist until the stream is over, or until the recording is told to stop.
    async follow(): Promise<void> {
        const { tuning, sleep, now } = this.environment;
        let lastNewAt = now();
        let failingSince: number | null = null;
        while (!this.halted && !this.soft.signal.aborted) {
            const startedAt = now();
            let playlist: HlsPlaylist | null = null;
            try {
                playlist = await this.loadPlaylist();
                failingSince = null;
            } catch {
                failingSince = failingSince ?? now();
            }
            if (playlist !== null) {
                if (this.streamChanged(playlist)) {
                    break;
                }
                if (this.enqueueNew(playlist) > 0) {
                    lastNewAt = now();
                }
                if (playlist.ended) {
                    break;
                }
            }
            if ((failingSince !== null && now() - failingSince > tuning.stallMs) || now() - lastNewAt > tuning.stallMs) {
                break;
            }
            const pause = playlist === null ? tuning.retryDelayMs : Math.max(tuning.minReloadMs, ((playlist.segments.at(-1)?.durationSeconds ?? playlist.targetDurationSeconds) * 500) - (now() - startedAt));
            await sleep(pause, this.soft.signal);
        }
    }

    // The stream started over (its numbers went back, or its initialization segment changed): what comes next is another recording.
    private streamChanged(playlist: HlsPlaylist): boolean {
        const last = playlist.segments.at(-1);
        const restarted = last !== undefined && last.sequence + playlist.segments.length < this.lastQueued;
        const newInit = this.initUrl !== null && playlist.initUrl !== null && playlist.initUrl !== this.initUrl;
        return restarted || newInit;
    }

    // Waits for the segments that are being downloaded to be written (for a limited time when the recording was stopped).
    async drain(limitMs: number | null): Promise<void> {
        this.halted = true;
        const finished = new Promise<void>((resolve) => {
            this.idle = resolve;
            this.notifyIdle();
        });
        if (limitMs === null) {
            await finished;
            return;
        }
        // A real timer, whatever the way the recording waits between playlists: this is the time the user waits for the file.
        let timer: ReturnType<typeof setTimeout> | undefined;
        const limit = new Promise<void>((resolve) => {
            timer = setTimeout(resolve, limitMs);
        });
        await Promise.race([finished, limit]);
        clearTimeout(timer);
    }

    async close(): Promise<void> {
        this.waiting.length = 0;
        await this.file?.close().catch(() => {
            return undefined;
        });
        this.file = null;
    }
}

// Records a live HLS stream: every rendition is followed on its own, the new segments are downloaded several at a time (a single
// connection to the site is slower than the stream, which is what makes ffmpeg skip segments) and written in order, and when the
// stream is over the renditions are copied into the finished file.
export function startHlsRecording(options: HlsRecordingOptions, dependencies: HlsRecorderDependencies = {}): HlsRecording {
    const tuning: HlsRecorderTuning = { ...DEFAULT_HLS_TUNING, ...dependencies.tuning };
    const now = dependencies.now ?? Date.now;
    const environment = { fetchImpl: dependencies.fetchImpl ?? fetch, sleep: dependencies.sleep ?? defaultSleep, now, tuning };
    const mux = dependencies.mux ?? defaultMux;
    const hard = new AbortController();
    const soft = new AbortController();
    const tracks = options.sources.map((source, index) => {
        return new HlsTrack(source, partPathFor(options.filePath, index), hard.signal, soft, environment);
    });
    const startedAt = now();
    let stopped = false;
    let cancelled = false;

    const removeParts = async (): Promise<void> => {
        await Promise.all(
            tracks.map((track) => {
                return rm(track.partPath, { force: true });
            })
        );
    };
    const totals = (): { bytes: number; lost: number } => {
        return {
            bytes: tracks.reduce((sum, track) => {
                return sum + track.bytes;
            }, 0),
            lost: tracks.reduce((sum, track) => {
                return sum + track.lost;
            }, 0)
        };
    };

    let reportedBytes = 0;
    let reportedAt = startedAt;
    const reporter = setInterval(() => {
        const { bytes, lost } = totals();
        const at = now();
        const seconds = Math.max((at - reportedAt) / 1000, 0.001);
        options.onProgress?.({ downloadedBytes: bytes, bytesPerSecond: (bytes - reportedBytes) / seconds, elapsedSeconds: Math.round((at - startedAt) / 1000), lostSegments: lost });
        reportedBytes = bytes;
        reportedAt = at;
    }, tuning.progressMs);
    reporter.unref();

    // The other renditions are told to stop as soon as one fails, and everything is waited for before anything is cleaned up: a rendition
    // that is still opening its file would otherwise create it after the cleanup.
    const failure: { error: unknown } | { error?: undefined } = {};
    const started = Promise.allSettled(
        tracks.map((track) => {
            return track.prepare().catch((error: unknown) => {
                // The first failure is the one that tells why; the others are the renditions that were stopped because of it.
                if (!('error' in failure) || failure.error === undefined) {
                    Object.assign(failure, { error });
                }
                hard.abort();
                throw error;
            });
        })
    ).then((outcomes) => {
        if (
            outcomes.some((outcome) => {
                return outcome.status === 'rejected';
            })
        ) {
            throw failure.error;
        }
    });

    const result = (async (): Promise<HlsRecordingResult> => {
        try {
            await started;
        } catch (error) {
            clearInterval(reporter);
            hard.abort();
            await Promise.all(
                tracks.map((track) => {
                    return track.close();
                })
            );
            await removeParts();
            return cancelled ? { status: 'cancelled' } : { status: 'error', message: messageOf(error) };
        }
        // The stream is over for all the renditions as soon as it is for one of them.
        await Promise.race(
            tracks.map((track) => {
                return track.follow();
            })
        );
        soft.abort();
        await Promise.all(
            tracks.map((track) => {
                return track.drain(stopped ? tuning.drainMs : null);
            })
        );
        clearInterval(reporter);
        await Promise.all(
            tracks.map((track) => {
                return track.close();
            })
        );
        if (cancelled) {
            await removeParts();
            return { status: 'cancelled' };
        }
        const { bytes, lost } = totals();
        if (bytes === 0) {
            await removeParts();
            return { status: 'error', message: 'Nothing was recorded' };
        }
        const copied = await mux(options.ffmpegBinary, [
            '-y',
            '-v',
            'error',
            ...tracks.flatMap((track) => {
                return ['-i', track.partPath];
            }),
            '-c',
            'copy',
            options.filePath
        ]);
        if (!copied) {
            return { status: 'error', message: 'ffmpeg could not copy the recording into the final file' };
        }
        await removeParts();
        return { status: 'done', filePath: options.filePath, lostSegments: lost };
    })();

    // A rejection of `started` is handled by `result`; callers that wait for it get it too.
    started.catch(() => {
        return undefined;
    });

    return {
        started,
        result,
        stop: (): void => {
            stopped = true;
            soft.abort();
        },
        cancel: (): void => {
            cancelled = true;
            hard.abort();
            soft.abort();
        }
    };
}
