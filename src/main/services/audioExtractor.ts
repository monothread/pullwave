import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SPEECH_PART_SECONDS } from '@shared/anime';
import { openFfmpegLog } from './ffmpegExec';
import type { LogWriter } from './logHub';
import { createLogFeed, isFfmpegStatsLine } from './logFeed';

export interface FfmpegResult {
    code: number | null;
    stderr: string;
}

export type FfmpegRunner = (args: string[], signal?: AbortSignal) => Promise<FfmpegResult>;

const MAX_STDERR = 200_000;
const PART_NAME = /^part-\d+\.mp3$/;
const PIECE_NAME = /^piece-\d+\.mp3$/;
const SPEECH_PCM = 'speech.pcm';
const MONO_MP3 = ['-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '32k'];
const VOICE_BAND = 'highpass=f=250,lowpass=f=3500';
const DURATION = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/;
const AUDIO_STREAM = /Stream #\d+:\d+.*: Audio:/;

export function createFfmpegRunner(binary: string, openLog: () => LogWriter = openFfmpegLog): FfmpegRunner {
    return (args, signal) => {
        return new Promise((resolve) => {
            const log = openLog();
            log.command(binary, args);
            const feed = createLogFeed(log, 'stderr', isFfmpegStatsLine);
            const child = spawn(binary, args, { windowsHide: true });
            let stderr = '';
            let ended = false;
            const onAbort = (): void => {
                child.kill();
            };
            signal?.addEventListener('abort', onAbort, { once: true });
            child.stderr.on('data', (chunk: Buffer) => {
                const text = chunk.toString('utf-8');
                stderr = (stderr + text).slice(-MAX_STDERR);
                feed.push(text);
            });
            child.on('error', (error) => {
                signal?.removeEventListener('abort', onAbort);
                if (!ended) {
                    ended = true;
                    log.failure(`could not start: ${error.message}`);
                }
                resolve({ code: null, stderr: error.message });
            });
            child.on('close', (code, closeSignal) => {
                signal?.removeEventListener('abort', onAbort);
                if (!ended) {
                    ended = true;
                    feed.flush();
                    log.exit(code, closeSignal);
                }
                resolve({ code, stderr });
            });
        });
    };
}

export interface AudioFiles {
    makeDirectory: () => string;
    list: (directory: string) => string[];
    read: (path: string) => Uint8Array;
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

export const AUDIO_BYTES_PER_SECOND = 4000;

export type AudioProbe = { ok: true; seconds: number } | { ok: false; reason: 'no-audio' | 'extract-failed' };

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

export async function extractAudioParts(
    videoPath: string,
    directory: string,
    run: FfmpegRunner,
    audio: AudioFiles,
    signal?: AbortSignal,
    partSeconds: number = SPEECH_PART_SECONDS
): Promise<AudioParts> {
    const result = await run(
        [
            '-hide_banner',
            '-nostdin',
            '-y',
            '-v',
            'error',
            '-i',
            videoPath,
            ...MONO_MP3,
            '-f',
            'segment',
            '-segment_time',
            String(partSeconds),
            '-reset_timestamps',
            '1',
            join(directory, 'part-%03d.mp3')
        ],
        signal
    );
    if (result.code !== 0) {
        return { ok: false, reason: 'extract-failed' };
    }
    const paths = filesNamed(directory, PART_NAME, audio);
    return paths.length === 0 ? { ok: false, reason: 'no-audio' } : { ok: true, paths };
}

function filesNamed(directory: string, pattern: RegExp, audio: AudioFiles): string[] {
    return audio
        .list(directory)
        .filter((name) => {
            return pattern.test(name);
        })
        .sort()
        .map((name) => {
            return join(directory, name);
        });
}

export type SpeechAudio = { ok: true; pcm: Uint8Array } | { ok: false; reason: 'no-audio' | 'extract-failed' };

export async function decodeSpeechAudio(videoPath: string, directory: string, run: FfmpegRunner, audio: AudioFiles, signal?: AbortSignal): Promise<SpeechAudio> {
    const target = join(directory, SPEECH_PCM);
    const result = await run(
        ['-hide_banner', '-nostdin', '-y', '-v', 'error', '-i', videoPath, '-vn', '-af', VOICE_BAND, '-ac', '1', '-ar', '16000', '-f', 's16le', target],
        signal
    );
    if (result.code !== 0) {
        return { ok: false, reason: 'extract-failed' };
    }
    if (!audio.list(directory).includes(SPEECH_PCM)) {
        return { ok: false, reason: 'no-audio' };
    }
    const pcm = audio.read(target);
    return pcm.byteLength === 0 ? { ok: false, reason: 'no-audio' } : { ok: true, pcm };
}

function piecesOutput(directory: string, cutTimes: readonly number[]): string[] {
    if (cutTimes.length === 0) {
        return ['-f', 'mp3', join(directory, 'piece-0000.mp3')];
    }
    const times = cutTimes.map((time) => {
        return time.toFixed(3);
    });
    return ['-f', 'segment', '-segment_times', times.join(','), '-reset_timestamps', '1', join(directory, 'piece-%04d.mp3')];
}

export async function extractAudioPieces(videoPath: string, directory: string, cutTimes: readonly number[], run: FfmpegRunner, audio: AudioFiles, signal?: AbortSignal): Promise<AudioParts> {
    const result = await run(['-hide_banner', '-nostdin', '-y', '-v', 'error', '-i', videoPath, ...MONO_MP3, ...piecesOutput(directory, cutTimes)], signal);
    if (result.code !== 0) {
        return { ok: false, reason: 'extract-failed' };
    }
    const paths = filesNamed(directory, PIECE_NAME, audio);
    return paths.length === cutTimes.length + 1 ? { ok: true, paths } : { ok: false, reason: 'extract-failed' };
}
