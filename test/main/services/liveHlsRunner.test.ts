import type { DownloadInfo, LiveStreamInfo, ProgressInfo } from '@shared/types';
import { mapDownloadError } from '@main/services/errorMapper';
import type { HlsRecording, HlsRecordingOptions, HlsRecordingResult } from '@main/services/hlsRecorder';
import { canRecordLive, runYtdlpLiveAware, type LiveAwareRunOptions } from '@main/services/liveHlsRunner';
import type { RunHandle, RunOptions, RunResult } from '@main/services/ytdlpRunner';

const HEADERS = { 'User-Agent': 'Agent', Referer: 'https://site.test/' };
const LIVE: LiveStreamInfo = {
    live: true,
    sources: [
        { url: 'https://cdn.test/video.m3u8', protocol: 'm3u8_native', headers: HEADERS },
        { url: 'https://cdn.test/audio.m3u8', protocol: 'm3u8_native', headers: { 'User-Agent': 'Agent' } }
    ]
};
const INFO: DownloadInfo = { live: true, filePath: '/d/Live [room].mp4' };

interface FakeRun {
    options: RunOptions;
    cancel: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    finish: (result: RunResult) => void;
}

interface FakeRecording {
    options: HlsRecordingOptions;
    recording: HlsRecording;
    startSucceeded: () => void;
    startFailed: (error: Error) => void;
    finish: (result: HlsRecordingResult) => void;
}

function setup(args: string[] = ['--newline', 'https://x.test/live']) {
    const runs: FakeRun[] = [];
    const recordings: FakeRecording[] = [];
    const progress: ProgressInfo[] = [];
    const infos: DownloadInfo[] = [];
    const runner = vi.fn((options: RunOptions): RunHandle => {
        let finish: (result: RunResult) => void = () => {
            return undefined;
        };
        const result = new Promise<RunResult>((resolve) => {
            finish = resolve;
        });
        const cancel = vi.fn(() => {
            finish({ status: 'cancelled' });
        });
        const stop = vi.fn();
        runs.push({ options, cancel, stop, finish });
        return { result, cancel, stop };
    });
    const record = vi.fn((options: HlsRecordingOptions): HlsRecording => {
        let startSucceeded: () => void = () => {
            return undefined;
        };
        let startFailed: (error: Error) => void = () => {
            return undefined;
        };
        let finish: (result: HlsRecordingResult) => void = () => {
            return undefined;
        };
        const started = new Promise<void>((resolve, reject) => {
            startSucceeded = resolve;
            startFailed = reject;
        });
        const result = new Promise<HlsRecordingResult>((resolve) => {
            finish = resolve;
        });
        started.catch(() => {
            return undefined;
        });
        const recording: HlsRecording = { started, result, stop: vi.fn(), cancel: vi.fn(() => {
                finish({ status: 'cancelled' });
            })
        };
        recordings.push({ options, recording, startSucceeded, startFailed, finish });
        return recording;
    });
    const runOptions: LiveAwareRunOptions = {
        binary: '/bin/yt-dlp',
        args,
        ffmpegBinary: '/bin/ffmpeg',
        onProgress: (info) => {
            progress.push(info);
        },
        onInfo: (info) => {
            infos.push(info);
        },
        env: { PATH: '/bundled' },
        runner,
        record
    };
    const start = () => {
        return runYtdlpLiveAware(runOptions);
    };
    return { runs, recordings, progress, infos, runner, record, start };
}

async function settle(): Promise<void> {
    for (let turn = 0; turn < 5; turn += 1) {
        await new Promise((resolve) => {
            setImmediate(resolve);
        });
    }
}

describe('canRecordLive', () => {
    it('is true for the arguments of a plain download', () => {
        expect(canRecordLive(['--newline', '-f', 'bv*+ba/b', '--merge-output-format', 'mp4', '--', 'https://x.test'])).toBe(true);
    });

    it.each(['-x', '--extract-audio', '--embed-subs', '--write-subs', '--write-auto-subs'])('is false when yt-dlp is asked for %s, which changes the file afterwards', (option) => {
        expect(canRecordLive(['--newline', option, 'https://x.test'])).toBe(false);
    });
});

describe('runYtdlpLiveAware a download that is not a live HLS stream', () => {
    it('runs yt-dlp as it is asked to and gives its result', async () => {
        const { runs, runner, record, start, infos } = setup();
        const handle = start();
        expect(runner).toHaveBeenCalledTimes(1);
        expect(runs[0]?.options).toMatchObject({ binary: '/bin/yt-dlp', args: ['--newline', 'https://x.test/live'], env: { PATH: '/bundled' } });
        runs[0]?.options.onInfo?.({ live: false, filePath: '/d/Video [id].mp4' });
        expect(infos).toEqual([{ live: false, filePath: '/d/Video [id].mp4' }]);
        runs[0]?.finish({ status: 'done', filePath: '/d/Video [id].mp4' });
        await expect(handle.result).resolves.toEqual({ status: 'done', filePath: '/d/Video [id].mp4' });
        expect(record).not.toHaveBeenCalled();
    });

    it('gives the progress of yt-dlp to the caller', () => {
        const { runs, progress, start } = setup();
        start();
        const info: ProgressInfo = { percent: 12, speed: '1MiB/s', eta: '00:10', title: 'T', downloadedBytes: 10, elapsedSeconds: 2, live: false };
        runs[0]?.options.onProgress(info);
        expect(progress).toEqual([info]);
    });

    it.each([
        ['a video that is not live', { ...LIVE, live: false }],
        ['a live stream of DASH', { live: true, sources: [{ url: 'https://cdn.test/x.mpd', protocol: 'http_dash_segments', headers: {} }] }],
        ['a live stream with one rendition that is not HLS', { live: true, sources: [LIVE.sources[0]!, { url: 'https://cdn.test/a.mp4', protocol: 'https', headers: {} }] }],
        ['a stream with no rendition', { live: true, sources: [] }]
    ] satisfies Array<[string, LiveStreamInfo]>)('leaves %s to yt-dlp', async (_label, stream) => {
        const { runs, record, start } = setup();
        const handle = start();
        runs[0]?.options.onInfo?.(INFO);
        runs[0]?.options.onStream?.(stream);
        expect(runs[0]?.cancel).not.toHaveBeenCalled();
        runs[0]?.finish({ status: 'done', filePath: '/d/Live [room].mp4' });
        await expect(handle.result).resolves.toEqual({ status: 'done', filePath: '/d/Live [room].mp4' });
        expect(record).not.toHaveBeenCalled();
    });

    it('leaves the stream to yt-dlp when it is told where the file is only afterwards', async () => {
        const { runs, record, start } = setup();
        const handle = start();
        runs[0]?.options.onStream?.(LIVE);
        runs[0]?.finish({ status: 'done', filePath: null });
        await handle.result;
        expect(runs[0]?.cancel).not.toHaveBeenCalled();
        expect(record).not.toHaveBeenCalled();
    });

    it.each([['-x'], ['--extract-audio'], ['--embed-subs'], ['--write-subs'], ['--write-auto-subs']])('leaves the live stream to yt-dlp when it is asked for %s', async (option) => {
        const { runs, record, start } = setup(['--newline', option, 'https://x.test/live']);
        const handle = start();
        runs[0]?.options.onInfo?.(INFO);
        runs[0]?.options.onStream?.(LIVE);
        expect(runs[0]?.cancel).not.toHaveBeenCalled();
        runs[0]?.finish({ status: 'done', filePath: '/d/Live [room].mp4' });
        await handle.result;
        expect(record).not.toHaveBeenCalled();
    });

    it('gives the error of yt-dlp', async () => {
        const { runs, start } = setup();
        const handle = start();
        const error = mapDownloadError('ERROR: boom', 1);
        runs[0]?.finish({ status: 'error', error });
        await expect(handle.result).resolves.toEqual({ status: 'error', error });
    });
});

describe('runYtdlpLiveAware a live HLS stream', () => {
    it('ends yt-dlp before it records anything and records the stream itself, with what yt-dlp found', async () => {
        const { runs, recordings, record, start, infos } = setup();
        const handle = start();
        runs[0]?.options.onInfo?.(INFO);
        runs[0]?.options.onStream?.(LIVE);
        expect(infos).toEqual([INFO]);
        expect(runs[0]?.cancel).toHaveBeenCalledTimes(1);
        await settle();
        expect(record).toHaveBeenCalledTimes(1);
        expect(recordings[0]?.options).toMatchObject({
            sources: [
                { url: 'https://cdn.test/video.m3u8', headers: HEADERS },
                { url: 'https://cdn.test/audio.m3u8', headers: { 'User-Agent': 'Agent' } }
            ],
            filePath: '/d/Live [room].mp4',
            ffmpegBinary: '/bin/ffmpeg'
        });
        recordings[0]?.startSucceeded();
        recordings[0]?.finish({ status: 'done', filePath: '/d/Live [room].mp4', lostSegments: 0 });
        await expect(handle.result).resolves.toEqual({ status: 'done', filePath: '/d/Live [room].mp4' });
    });

    it('does not record before yt-dlp has ended', async () => {
        const { runs, record, start } = setup();
        start();
        runs[0]?.options.onInfo?.(INFO);
        runs[0]?.cancel.mockImplementation(() => {
            return undefined;
        });
        runs[0]?.options.onStream?.(LIVE);
        await settle();
        expect(record).not.toHaveBeenCalled();
        runs[0]?.finish({ status: 'cancelled' });
        await settle();
        expect(record).toHaveBeenCalledTimes(1);
    });

    it('records only once when the stream is announced again', async () => {
        const { runs, record, start } = setup();
        start();
        runs[0]?.options.onInfo?.(INFO);
        runs[0]?.options.onStream?.(LIVE);
        runs[0]?.options.onStream?.(LIVE);
        await settle();
        expect(runs[0]?.cancel).toHaveBeenCalledTimes(1);
        expect(record).toHaveBeenCalledTimes(1);
    });

    it('tells the caller how the recording goes, as yt-dlp tells it for a live stream', async () => {
        const { runs, recordings, progress, start } = setup();
        start();
        runs[0]?.options.onInfo?.(INFO);
        runs[0]?.options.onStream?.(LIVE);
        await settle();
        recordings[0]?.options.onProgress?.({ downloadedBytes: 5_000_000, bytesPerSecond: 1.5 * 1024 * 1024, elapsedSeconds: 7, lostSegments: 2 });
        expect(progress).toEqual([{ percent: 0, speed: '1.50MiB/s', eta: '', title: '', downloadedBytes: 5_000_000, elapsedSeconds: 7, live: true }]);
    });

    it('gives the error of the recording the way the errors of yt-dlp are given', async () => {
        const { runs, recordings, start } = setup();
        const handle = start();
        runs[0]?.options.onInfo?.(INFO);
        runs[0]?.options.onStream?.(LIVE);
        await settle();
        recordings[0]?.startSucceeded();
        recordings[0]?.finish({ status: 'error', message: 'ffmpeg could not copy the recording into the final file' });
        await expect(handle.result).resolves.toEqual({ status: 'error', error: mapDownloadError('ffmpeg could not copy the recording into the final file', 1) });
    });

    it('tells it was cancelled when the recording is', async () => {
        const { runs, recordings, start } = setup();
        const handle = start();
        runs[0]?.options.onInfo?.(INFO);
        runs[0]?.options.onStream?.(LIVE);
        await settle();
        recordings[0]?.startSucceeded();
        recordings[0]?.finish({ status: 'cancelled' });
        await expect(handle.result).resolves.toEqual({ status: 'cancelled' });
    });

    it('records the stream with yt-dlp, the way it always did, when the app cannot follow it', async () => {
        const { runs, recordings, runner, record, start } = setup();
        const handle = start();
        runs[0]?.options.onInfo?.(INFO);
        runs[0]?.options.onStream?.(LIVE);
        await settle();
        recordings[0]?.startFailed(new Error('The segments are encrypted'));
        recordings[0]?.finish({ status: 'error', message: 'The segments are encrypted' });
        await settle();
        expect(runner).toHaveBeenCalledTimes(2);
        expect(runs[1]?.options).toMatchObject({ binary: '/bin/yt-dlp', args: ['--newline', 'https://x.test/live'], env: { PATH: '/bundled' } });
        // The second run does not hand the stream over again.
        expect(runs[1]?.options.onStream).toBeUndefined();
        runs[1]?.options.onInfo?.(INFO);
        runs[1]?.finish({ status: 'done', filePath: '/d/Live [room].mp4' });
        await expect(handle.result).resolves.toEqual({ status: 'done', filePath: '/d/Live [room].mp4' });
        expect(record).toHaveBeenCalledTimes(1);
    });

    it('gives the progress of the second run of yt-dlp too', async () => {
        const { runs, recordings, progress, start } = setup();
        start();
        runs[0]?.options.onInfo?.(INFO);
        runs[0]?.options.onStream?.(LIVE);
        await settle();
        recordings[0]?.startFailed(new Error('x'));
        recordings[0]?.finish({ status: 'error', message: 'x' });
        await settle();
        runs[1]?.options.onProgress({ percent: 0, speed: '2MiB/s', eta: '', title: 'T', downloadedBytes: 1, elapsedSeconds: 1, live: true });
        expect(progress).toHaveLength(1);
        expect(progress[0]?.speed).toBe('2MiB/s');
    });
});

describe('runYtdlpLiveAware cancel and stop', () => {
    it('cancels the run of yt-dlp while that is what goes on', () => {
        const { runs, start } = setup();
        const handle = start();
        handle.cancel();
        expect(runs[0]?.cancel).toHaveBeenCalledTimes(1);
        expect(runs[0]?.stop).not.toHaveBeenCalled();
    });

    it('stops the run of yt-dlp while that is what goes on', () => {
        const { runs, start } = setup();
        const handle = start();
        handle.stop();
        expect(runs[0]?.stop).toHaveBeenCalledTimes(1);
        expect(runs[0]?.cancel).not.toHaveBeenCalled();
    });

    it('does not hand the stream over once the download was ended', async () => {
        const { runs, record, start } = setup();
        const handle = start();
        handle.stop();
        runs[0]?.options.onInfo?.(INFO);
        runs[0]?.options.onStream?.(LIVE);
        expect(runs[0]?.cancel).not.toHaveBeenCalled();
        runs[0]?.finish({ status: 'done', filePath: '/d/Live [room].mp4' });
        await handle.result;
        expect(record).not.toHaveBeenCalled();
    });

    it('cancels the recording', async () => {
        const { runs, recordings, start } = setup();
        const handle = start();
        runs[0]?.options.onInfo?.(INFO);
        runs[0]?.options.onStream?.(LIVE);
        await settle();
        recordings[0]?.startSucceeded();
        handle.cancel();
        expect(recordings[0]?.recording.cancel).toHaveBeenCalledTimes(1);
        await expect(handle.result).resolves.toEqual({ status: 'cancelled' });
    });

    it('stops the recording, keeping what it recorded', async () => {
        const { runs, recordings, start } = setup();
        const handle = start();
        runs[0]?.options.onInfo?.(INFO);
        runs[0]?.options.onStream?.(LIVE);
        await settle();
        recordings[0]?.startSucceeded();
        handle.stop();
        expect(recordings[0]?.recording.stop).toHaveBeenCalledTimes(1);
        recordings[0]?.finish({ status: 'done', filePath: '/d/Live [room].mp4', lostSegments: 1 });
        await expect(handle.result).resolves.toEqual({ status: 'done', filePath: '/d/Live [room].mp4' });
    });

    it('ends the recording as soon as it starts when the download was ended while yt-dlp was being stopped', async () => {
        const { runs, recordings, start } = setup();
        const handle = start();
        runs[0]?.options.onInfo?.(INFO);
        runs[0]?.cancel.mockImplementation(() => {
            return undefined;
        });
        runs[0]?.options.onStream?.(LIVE);
        handle.stop();
        runs[0]?.finish({ status: 'cancelled' });
        await settle();
        expect(recordings[0]?.recording.stop).toHaveBeenCalledTimes(1);
        recordings[0]?.startSucceeded();
        recordings[0]?.finish({ status: 'done', filePath: '/d/Live [room].mp4', lostSegments: 0 });
        await expect(handle.result).resolves.toEqual({ status: 'done', filePath: '/d/Live [room].mp4' });
    });

    it('cancels the recording as soon as it starts when the download was cancelled while yt-dlp was being stopped', async () => {
        const { runs, recordings, start } = setup();
        const handle = start();
        runs[0]?.options.onInfo?.(INFO);
        runs[0]?.cancel.mockImplementation(() => {
            return undefined;
        });
        runs[0]?.options.onStream?.(LIVE);
        handle.cancel();
        runs[0]?.finish({ status: 'cancelled' });
        await settle();
        expect(recordings[0]?.recording.cancel).toHaveBeenCalledTimes(1);
        await expect(handle.result).resolves.toEqual({ status: 'cancelled' });
    });

    it('does not run yt-dlp again when the download was ended and the recording could not start', async () => {
        const { runs, recordings, runner, start } = setup();
        const handle = start();
        runs[0]?.options.onInfo?.(INFO);
        runs[0]?.options.onStream?.(LIVE);
        await settle();
        handle.stop();
        recordings[0]?.startFailed(new Error('The server answered 403'));
        recordings[0]?.finish({ status: 'error', message: 'The server answered 403' });
        await expect(handle.result).resolves.toEqual({ status: 'cancelled' });
        expect(runner).toHaveBeenCalledTimes(1);
    });

    it('cancels the run of yt-dlp that takes the place of the recording that could not start', async () => {
        const { runs, recordings, start } = setup();
        const handle = start();
        runs[0]?.options.onInfo?.(INFO);
        runs[0]?.options.onStream?.(LIVE);
        await settle();
        recordings[0]?.startFailed(new Error('x'));
        recordings[0]?.finish({ status: 'error', message: 'x' });
        await settle();
        handle.cancel();
        expect(runs[1]?.cancel).toHaveBeenCalledTimes(1);
        await expect(handle.result).resolves.toEqual({ status: 'cancelled' });
    });
});
