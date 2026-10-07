import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SPEECH_PART_SECONDS } from '@shared/anime';

export interface FfmpegResult {
    // Null when ffmpeg could not be started or was ended by a signal.
    code: number | null;
    stderr: string;
}

// Runs ffmpeg with the arguments (the tests replace it); it kills it when the signal is aborted.
export type FfmpegRunner = (args: string[], signal?: AbortSignal) => Promise<FfmpegResult>;

// The most of the output of ffmpeg that is kept (it prints a line for every second it works on).
const MAX_STDERR = 200_000;
const PART_NAME = /^part-\d+\.mp3$/;
const DURATION = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/;
const AUDIO_STREAM = /Stream #\d+:\d+.*: Audio:/;

export function createFfmpegRunner(binary: string): FfmpegRunner {
    return (args, signal) => {
        return new Promise((resolve) => {
            const child = spawn(binary, args, { windowsHide: true });
            let stderr = '';
            const onAbort = (): void => {
                child.kill();
            };
            signal?.addEventListener('abort', onAbort, { once: true });
            child.stderr.on('data', (chunk: Buffer) => {
                stderr = (stderr + chunk.toString('utf-8')).slice(-MAX_STDERR);
            });
            child.on('error', (error) => {
                signal?.removeEventListener('abort', onAbort);
                resolve({ code: null, stderr: error.message });
            });
            child.on('close', (code) => {
                signal?.removeEventListener('abort', onAbort);
                resolve({ code, stderr });
            });
        });
    };
}

// Where the parts of the audio are kept while they are sent (the tests replace it).
export interface AudioFiles {
    makeDirectory: () => string;
    // The names of the files of the folder.
    list: (directory: string) => string[];
    read: (path: string) => Uint8Array;
    // How many bytes a file has.
    size: (path: string) => number;
    remove: (directory: string) => void;
}

export const defaultAudioFiles: AudioFiles = {
    makeDirectory: () => {
        return mkdtempSync(join(tmpdir(), 'pullwave-audio-'));
    },
    list: (directory) => {
        return readdirSync(directory);
    },
    read: (path) => {
        return readFileSync(path);
    },
    size: (path) => {
        return statSync(path).size;
    },
    remove: (directory) => {
        rmSync(directory, { recursive: true, force: true });
    }
};

// The audio is sent as mono MP3 of 32 kbps: 4000 bytes for each second.
export const AUDIO_BYTES_PER_SECOND = 4000;

export type AudioProbe = { ok: true; seconds: number } | { ok: false; reason: 'no-audio' | 'extract-failed' };

// How long the audio of a video is, from what ffmpeg says when it is given only the input (it ends with an error for having no output,
// which is expected): a video with no audio stream is `no-audio`.
export async function probeAudio(videoPath: string, run: FfmpegRunner): Promise<AudioProbe> {
    const result = await run(['-hide_banner', '-nostdin', '-i', videoPath]);
    if (result.code === null) {
        return { ok: false, reason: 'extract-failed' };
    }
    const duration = DURATION.exec(result.stderr);
    if (!duration) {
        return { ok: false, reason: 'extract-failed' };
    }
    if (!AUDIO_STREAM.test(result.stderr)) {
        return { ok: false, reason: 'no-audio' };
    }
    return { ok: true, seconds: Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]) };
}

export type AudioParts = { ok: true; paths: string[] } | { ok: false; reason: 'no-audio' | 'extract-failed' };

// The audio of a video in mono, small MP3 parts of `SPEECH_PART_SECONDS` each, in a folder: the part number n starts n parts into the video.
export async function extractAudioParts(videoPath: string, directory: string, run: FfmpegRunner, audio: AudioFiles, signal?: AbortSignal): Promise<AudioParts> {
    const result = await run(
        [
            '-hide_banner',
            '-nostdin',
            '-y',
            '-v',
            'error',
            '-i',
            videoPath,
            '-vn',
            '-ac',
            '1',
            '-ar',
            '16000',
            '-c:a',
            'libmp3lame',
            '-b:a',
            '32k',
            '-f',
            'segment',
            '-segment_time',
            String(SPEECH_PART_SECONDS),
            '-reset_timestamps',
            '1',
            join(directory, 'part-%03d.mp3')
        ],
        signal
    );
    if (result.code !== 0) {
        return { ok: false, reason: 'extract-failed' };
    }
    const paths = audio
        .list(directory)
        .filter((name) => {
            return PART_NAME.test(name);
        })
        .sort()
        .map((name) => {
            return join(directory, name);
        });
    return paths.length === 0 ? { ok: false, reason: 'no-audio' } : { ok: true, paths };
}
