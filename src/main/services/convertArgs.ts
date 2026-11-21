import { basename, extname } from 'node:path';
import { CONVERT_AUDIO_FORMATS, CONVERT_OUTPUT_MODES, type ConvertAudioFormat, type ConvertMedia, type ConvertOutputMode, type ConvertProbeFailure } from '@shared/convert';
import { freePath, parseProgressSeconds, safeName } from './cutArgs';

export { freePath, parseProgressSeconds, safeName };

const DURATION = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/;
const VIDEO_STREAM = /Stream #\d+:\d+[^\n]*: Video:[^\n]*/g;
const AUDIO_STREAM = /Stream #\d+:\d+[^\n]*: Audio:/;
const ATTACHED_PICTURE = /\(attached pic\)/;

export const CONVERT_CODECS: Readonly<Record<ConvertAudioFormat, readonly string[]>> = {
    mp3: ['-c:a', 'libmp3lame', '-q:a', '2'],
    m4a: ['-c:a', 'aac', '-b:a', '192k'],
    opus: ['-c:a', 'libopus', '-b:a', '128k'],
    flac: ['-c:a', 'flac'],
    wav: ['-c:a', 'pcm_s16le']
};

const FORMAT_SET: ReadonlySet<string> = new Set(CONVERT_AUDIO_FORMATS);
const MODE_SET: ReadonlySet<string> = new Set(CONVERT_OUTPUT_MODES);

export function isConvertAudioFormat(value: unknown): value is ConvertAudioFormat {
    return typeof value === 'string' && FORMAT_SET.has(value);
}

export function isConvertOutputMode(value: unknown): value is ConvertOutputMode {
    return typeof value === 'string' && MODE_SET.has(value);
}

export type VideoAudioProbe = { ok: true; durationSeconds: number } | { ok: false; reason: Exclude<ConvertProbeFailure, 'no-ffmpeg'> };

export function parseVideoAudioProbe(stderr: string): VideoAudioProbe {
    const duration = DURATION.exec(stderr);
    if (duration === null) {
        return { ok: false, reason: 'unreadable' };
    }
    const videos = (stderr.match(VIDEO_STREAM) ?? []).filter((stream) => {
        return !ATTACHED_PICTURE.test(stream);
    });
    if (videos.length === 0) {
        return { ok: false, reason: 'not-video' };
    }
    if (!AUDIO_STREAM.test(stderr)) {
        return { ok: false, reason: 'no-audio' };
    }
    const durationSeconds = Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]);
    return { ok: true, durationSeconds };
}

export function convertMediaOf(path: string, durationSeconds: number): ConvertMedia {
    const extension = extname(path);
    return { path, name: basename(path, extension), extension: extension.toLowerCase(), durationSeconds };
}

export interface ConvertCommand {
    input: string;
    output: string;
    format: ConvertAudioFormat;
    threads: number;
}

export function buildConvertArgs(command: ConvertCommand): string[] {
    return [
        '-hide_banner',
        '-nostdin',
        '-y',
        '-v',
        'error',
        '-stats',
        '-i',
        command.input,
        '-vn',
        ...CONVERT_CODECS[command.format],
        '-threads',
        String(Math.max(1, Math.floor(command.threads))),
        command.output
    ];
}
