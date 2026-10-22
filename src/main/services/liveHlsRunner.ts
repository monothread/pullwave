import type { LiveStreamInfo } from '@shared/types';
import { mapDownloadError } from './errorMapper';
import { startHlsRecording, type HlsRecordingProgress } from './hlsRecorder';
import { runYtdlp, type RunHandle, type RunOptions, type RunResult } from './ytdlpRunner';

export interface LiveAwareRunOptions extends RunOptions {
    // The ffmpeg that copies the renditions of a recording into the finished file.
    ffmpegBinary: string;
    record?: typeof startHlsRecording;
    runner?: typeof runYtdlp;
}

// Options that make yt-dlp change the file after it is downloaded (audio only, subtitles). The app copies the stream as it is, so
// a download that asks for them is left to yt-dlp.
const POST_PROCESSING_OPTIONS = ['-x', '--extract-audio', '--embed-subs', '--write-subs', '--write-auto-subs'];

export function canRecordLive(args: readonly string[]): boolean {
    return !args.some((argument) => {
        return POST_PROCESSING_OPTIONS.includes(argument);
    });
}

// A live stream of HLS playlists is the kind this app can record itself.
function isRecordableLive(stream: LiveStreamInfo): boolean {
    return (
        stream.live &&
        stream.sources.length > 0 &&
        stream.sources.every((source) => {
            return source.protocol.startsWith('m3u8');
        })
    );
}

function formatSpeed(bytesPerSecond: number): string {
    return `${(bytesPerSecond / (1024 * 1024)).toFixed(2)}MiB/s`;
}

interface TakeoverPlan {
    filePath: string;
    stream: LiveStreamInfo;
}

// Runs yt-dlp like `runYtdlp` does, except for the live HLS streams: yt-dlp hands those to ffmpeg, which follows the playlist one
// segment at a time and skips the segments that left the playlist while it waited for the one before (a site whose connection is
// slower than the stream loses most of it). As soon as yt-dlp says the stream is such a live, it is stopped before it records
// anything and the app records the stream, downloading several segments at a time. If the app cannot follow the stream, yt-dlp is
// run again and records it as it always did. The handle behaves like the one of a single run.
export function runYtdlpLiveAware(options: LiveAwareRunOptions): RunHandle {
    const runner = options.runner ?? runYtdlp;
    const record = options.record ?? startHlsRecording;
    let ending: 'cancel' | 'stop' | null = null;
    let current: Pick<RunHandle, 'cancel' | 'stop'> = {
        cancel: (): void => {
            return undefined;
        },
        stop: (): void => {
            return undefined;
        }
    };

    const runPlain = (): Promise<RunResult> => {
        const handle = runner({ ...options, onStream: undefined });
        current = handle;
        return handle.result;
    };

    const recordInstead = async (plan: TakeoverPlan): Promise<RunResult> => {
        const recording = record({
            sources: plan.stream.sources.map((source) => {
                return { url: source.url, headers: source.headers };
            }),
            filePath: plan.filePath,
            ffmpegBinary: options.ffmpegBinary,
            onProgress: (progress: HlsRecordingProgress) => {
                options.onProgress({
                    percent: 0,
                    speed: formatSpeed(progress.bytesPerSecond),
                    eta: '',
                    title: '',
                    downloadedBytes: progress.downloadedBytes,
                    elapsedSeconds: progress.elapsedSeconds,
                    live: true
                });
            }
        });
        current = recording;
        if (ending === 'cancel') {
            recording.cancel();
        } else if (ending === 'stop') {
            recording.stop();
        }
        // The recording is under way, or it ended (or was refused) before it got there.
        const underWay = await Promise.race([
            recording.started.then(
                () => {
                    return true;
                },
                () => {
                    return false;
                }
            ),
            recording.result.then(() => {
                return false;
            })
        ]);
        if (!underWay) {
            // Nothing was kept: the stream is recorded the way it always was, unless the user already ended the download.
            await recording.result;
            return ending === null ? runPlain() : { status: 'cancelled' };
        }
        const result = await recording.result;
        if (result.status === 'done') {
            return { status: 'done', filePath: result.filePath };
        }
        if (result.status === 'cancelled') {
            return { status: 'cancelled' };
        }
        return { status: 'error', error: mapDownloadError(result.message, 1) };
    };

    const run = async (): Promise<RunResult> => {
        let plan: TakeoverPlan | null = null;
        let filePath: string | null = null;
        const handle = runner({
            ...options,
            onInfo: (info) => {
                filePath = info.filePath;
                options.onInfo?.(info);
            },
            onStream: (stream) => {
                if (plan !== null || ending !== null || filePath === null || !isRecordableLive(stream) || !canRecordLive(options.args)) {
                    return;
                }
                plan = { filePath, stream };
                // yt-dlp has only just started its downloader: it is ended before it records anything.
                handle.cancel();
            }
        });
        current = handle;
        const first = await handle.result;
        return plan === null ? first : recordInstead(plan);
    };

    return {
        result: run(),
        cancel: (): void => {
            ending = 'cancel';
            current.cancel();
        },
        stop: (): void => {
            ending = 'stop';
            current.stop();
        }
    };
}
