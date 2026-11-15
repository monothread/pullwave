import { basename, extname } from 'node:path';
import type { AudioFormat } from '@shared/types';
import type { CutMedia, CutMediaKind } from '@shared/cut';

const DURATION = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/;
const VIDEO_STREAM = /Stream #\d+:\d+[^\n]*: Video:[^\n]*/g;
const AUDIO_STREAM = /Stream #\d+:\d+[^\n]*: Audio:/;
const ATTACHED_PICTURE = /\(attached pic\)/;
const PROGRESS_TIME = /time=(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/g;

function seconds(hours: string | undefined, minutes: string | undefined, rest: string | undefined): number {
    return Number(hours) * 3600 + Number(minutes) * 60 + Number(rest);
}

export interface MediaProbe {
    durationSeconds: number;
    kind: CutMediaKind;
}

export function parseMediaProbe(stderr: string): MediaProbe | null {
    const duration = DURATION.exec(stderr);
    if (!duration) {
        return null;
    }
    const videos = (stderr.match(VIDEO_STREAM) ?? []).filter((stream) => {
        return !ATTACHED_PICTURE.test(stream);
    });
    const hasAudio = AUDIO_STREAM.test(stderr);
    if (videos.length === 0 && !hasAudio) {
        return null;
    }
    return { durationSeconds: seconds(duration[1], duration[2], duration[3]), kind: videos.length > 0 ? 'video' : 'audio' };
}

export function parseProgressSeconds(output: string): number | null {
    const last = [...output.matchAll(PROGRESS_TIME)].at(-1);
    return last ? seconds(last[1], last[2], last[3]) : null;
}

export function mediaOf(path: string, probe: MediaProbe): CutMedia {
    const extension = extname(path);
    return { path, name: basename(path, extension), extension: extension.toLowerCase(), kind: probe.kind, durationSeconds: probe.durationSeconds };
}

export interface OutputFormat {
    extension: string;
    dropVideo: boolean;
    codecArgs: string[];
}

const X264_AAC = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-c:a', 'aac', '-b:a', '192k'];
const VIDEO_CODECS: Record<string, string[]> = {
    '.mp4': [...X264_AAC, '-movflags', '+faststart'],
    '.m4v': [...X264_AAC, '-movflags', '+faststart'],
    '.mov': X264_AAC,
    '.mkv': X264_AAC,
    '.webm': ['-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '32', '-row-mt', '1', '-c:a', 'libopus']
};

const AUDIO_CODECS: Record<string, string[]> = {
    '.mp3': ['-c:a', 'libmp3lame', '-q:a', '2'],
    '.m4a': ['-c:a', 'aac', '-b:a', '192k'],
    '.aac': ['-c:a', 'aac', '-b:a', '192k'],
    '.opus': ['-c:a', 'libopus', '-b:a', '128k'],
    '.ogg': ['-c:a', 'libvorbis', '-q:a', '5'],
    '.oga': ['-c:a', 'libvorbis', '-q:a', '5'],
    '.flac': ['-c:a', 'flac'],
    '.wav': ['-c:a', 'pcm_s16le']
};

export function outputFormat(media: Pick<CutMedia, 'extension' | 'kind'>, audioOnly: boolean, audioFormat: AudioFormat): OutputFormat {
    if (media.kind === 'video' && audioOnly) {
        const extension = `.${audioFormat}`;
        return { extension, dropVideo: true, codecArgs: AUDIO_CODECS[extension] ?? [] };
    }
    if (media.kind === 'audio') {
        return { extension: media.extension, dropVideo: true, codecArgs: AUDIO_CODECS[media.extension] ?? [] };
    }
    return { extension: media.extension, dropVideo: false, codecArgs: VIDEO_CODECS[media.extension] ?? [] };
}

export interface CutCommand {
    input: string;
    output: string;
    start: number;
    end: number;
    format: OutputFormat;
    threads: number;
}

export function buildCutArgs(command: CutCommand): string[] {
    return [
        '-hide_banner',
        '-nostdin',
        '-n',
        '-v',
        'error',
        '-stats',
        '-ss',
        String(command.start),
        '-i',
        command.input,
        '-t',
        String(Number((command.end - command.start).toFixed(3))),
        ...(command.format.dropVideo ? ['-vn'] : []),
        ...command.format.codecArgs,
        '-threads',
        String(Math.max(1, Math.floor(command.threads))),
        command.output
    ];
}

export function clockForName(totalSeconds: number): string {
    const whole = Math.floor(totalSeconds);
    const hours = Math.floor(whole / 3600);
    const minutes = Math.floor((whole % 3600) / 60);
    const rest = String(whole % 60).padStart(2, '0');
    return hours > 0 ? `${hours}h${String(minutes).padStart(2, '0')}m${rest}s` : `${minutes}m${rest}s`;
}

export function partFileName(name: string, index: number, total: number, start: number, end: number, extension: string): string {
    const digits = Math.max(2, String(total).length);
    return `${name} - ${String(index + 1).padStart(digits, '0')} (${clockForName(start)}-${clockForName(end)})${extension}`;
}

export function safeName(name: string): string {
    const cleaned = Array.from(name, (character) => {
        return character.charCodeAt(0) < 32 ? '_' : character;
    })
        .join('')
        .replace(/[\\/:*?"<>|]/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^\.+|[. ]+$/g, '');
    return cleaned.length > 0 ? cleaned.slice(0, 120) : 'cut';
}

export function freePath(path: string, exists: (candidate: string) => boolean): string {
    if (!exists(path)) {
        return path;
    }
    const extension = extname(path);
    const stem = path.slice(0, path.length - extension.length);
    for (let number = 2; ; number += 1) {
        const candidate = `${stem} (${number})${extension}`;
        if (!exists(candidate)) {
            return candidate;
        }
    }
}
