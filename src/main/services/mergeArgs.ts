import { basename, extname } from 'node:path';
import {
    MERGE_OUTPUT_MODES,
    MERGE_VIDEO_FORMATS,
    type MergeMedia,
    type MergeOutputMode,
    type MergeProbeFailure,
    type MergeVideoFormat
} from '@shared/merge';
import { freePath, parseProgressSeconds, safeName } from './cutArgs';

export { freePath, parseProgressSeconds, safeName };

const DURATION = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/;
const STREAM_LINE = /Stream #\d+:\d+[^\n]*: (Video|Audio):[^\n]*/g;
const ATTACHED_PICTURE = /\(attached pic\)/;
const RESOLUTION = /(\d{2,5})x(\d{2,5})(?:\s|\[|$)/;
const FPS = /(\d+(?:\.\d+)?)\s*(?:fps|tbr)\b/;
const TIMEBASE = /(\d+(?:\.\d+)?[kM]?)\s*tbn\b/i;
const SAMPLE_RATE = /(\d+)\s*Hz\b/i;

const FORMAT_SET: ReadonlySet<string> = new Set(MERGE_VIDEO_FORMATS);
const MODE_SET: ReadonlySet<string> = new Set(MERGE_OUTPUT_MODES);

const CONTAINER_EXTENSIONS: Readonly<Record<MergeVideoFormat, ReadonlySet<string>>> = {
    mp4: new Set(['.mp4', '.m4v']),
    mkv: new Set(['.mkv']),
    webm: new Set(['.webm'])
};

const CONTAINER_VIDEO_CODECS: Readonly<Record<MergeVideoFormat, ReadonlySet<string>>> = {
    mp4: new Set(['h264', 'hevc', 'mpeg4', 'av1']),
    mkv: new Set(['h264', 'hevc', 'vp8', 'vp9', 'av1', 'mpeg4']),
    webm: new Set(['vp8', 'vp9', 'av1'])
};

const CONTAINER_AUDIO_CODECS: Readonly<Record<MergeVideoFormat, ReadonlySet<string>>> = {
    mp4: new Set(['aac', 'mp3', 'opus', 'ac3', 'eac3']),
    mkv: new Set(['aac', 'mp3', 'opus', 'vorbis', 'flac', 'ac3', 'eac3', 'pcm_s16le']),
    webm: new Set(['opus', 'vorbis'])
};

const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 720;
const DEFAULT_FPS = 30;

export function isMergeVideoFormat(value: unknown): value is MergeVideoFormat {
    return typeof value === 'string' && FORMAT_SET.has(value);
}

export function isMergeOutputMode(value: unknown): value is MergeOutputMode {
    return typeof value === 'string' && MODE_SET.has(value);
}

function splitTopLevelCommas(text: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let start = 0;
    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        if (char === '(' || char === '[') {
            depth += 1;
        } else if (char === ')' || char === ']') {
            depth = Math.max(0, depth - 1);
        } else if (char === ',' && depth === 0) {
            parts.push(text.slice(start, index).trim());
            start = index + 1;
        }
    }
    parts.push(text.slice(start).trim());
    return parts;
}

export interface VideoStreamDetails {
    durationSeconds: number;
    width: number;
    height: number;
    fps: number;
    videoCodec: string;
    pixelFormat: string;
    videoTimebase: string;
    hasAudio: boolean;
    audioCodec: string | null;
    audioSampleRate: number | null;
    audioChannels: string | null;
    streamOrder: string;
}

export type MergeVideoProbe =
    | { ok: true; details: VideoStreamDetails }
    | { ok: false; reason: Exclude<MergeProbeFailure, 'no-ffmpeg'> };

export function parseMergeVideoProbe(stderr: string): MergeVideoProbe {
    const duration = DURATION.exec(stderr);
    if (duration === null) {
        return { ok: false, reason: 'unreadable' };
    }
    const streams = (stderr.match(STREAM_LINE) ?? []).filter((stream) => {
        return !ATTACHED_PICTURE.test(stream);
    });
    let firstVideo: string | undefined;
    let firstAudio: string | undefined;
    const order: string[] = [];
    for (const stream of streams) {
        if (/:\s*Video:/.test(stream)) {
            firstVideo ??= stream;
            order.push('v');
        } else if (/:\s*Audio:/.test(stream)) {
            firstAudio ??= stream;
            order.push('a');
        }
    }
    if (firstVideo === undefined) {
        return { ok: false, reason: 'not-video' };
    }
    const afterVideo = firstVideo.split(/:\s*Video:\s*/)[1] ?? '';
    const tokens = splitTopLevelCommas(afterVideo);
    const videoCodec = (tokens[0]?.split(/[\s(]/)[0] ?? '').toLowerCase();
    const rawPixel = tokens[1] ?? '';
    const pixelFormat = !RESOLUTION.test(rawPixel) ? (rawPixel.split(/[\s(]/)[0] ?? '').toLowerCase() : '';
    let width = 0;
    let height = 0;
    for (const token of tokens) {
        const match = RESOLUTION.exec(token);
        if (match !== null) {
            width = Number(match[1]);
            height = Number(match[2]);
            break;
        }
    }
    let fps = 0;
    for (const token of tokens) {
        const match = FPS.exec(token);
        if (match !== null) {
            const parsed = Number(match[1]);
            if (Number.isFinite(parsed) && parsed > 0) {
                fps = parsed;
                break;
            }
        }
    }
    let videoTimebase = '';
    for (const token of tokens) {
        const match = TIMEBASE.exec(token);
        if (match !== null) {
            videoTimebase = match[1]!.toLowerCase();
            break;
        }
    }

    let hasAudio = false;
    let audioCodec: string | null = null;
    let audioSampleRate: number | null = null;
    let audioChannels: string | null = null;
    if (firstAudio !== undefined) {
        hasAudio = true;
        const afterAudio = firstAudio.split(/:\s*Audio:\s*/)[1] ?? '';
        const audioTokens = splitTopLevelCommas(afterAudio);
        const parsedCodec = (audioTokens[0]?.split(/[\s(]/)[0] ?? '').toLowerCase();
        audioCodec = parsedCodec.length > 0 ? parsedCodec : null;
        let sampleRateIndex = -1;
        for (let index = 1; index < audioTokens.length; index += 1) {
            const match = SAMPLE_RATE.exec(audioTokens[index]!);
            if (match !== null) {
                audioSampleRate = Number(match[1]);
                sampleRateIndex = index;
                break;
            }
        }
        if (sampleRateIndex >= 0 && audioTokens[sampleRateIndex + 1] !== undefined) {
            const channelToken = (audioTokens[sampleRateIndex + 1]!.split(/[\s(]/)[0] ?? '').toLowerCase();
            if (channelToken.length > 0) {
                audioChannels = channelToken;
            }
        }
    }

    const durationSeconds = Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]);
    return {
        ok: true,
        details: {
            durationSeconds,
            width,
            height,
            fps,
            videoCodec,
            pixelFormat,
            videoTimebase,
            hasAudio,
            audioCodec,
            audioSampleRate,
            audioChannels,
            streamOrder: order.join('')
        }
    };
}

export function mergeMediaOf(path: string, details: VideoStreamDetails): MergeMedia {
    const extension = extname(path);
    return {
        path,
        name: basename(path, extension),
        extension: extension.toLowerCase(),
        durationSeconds: details.durationSeconds,
        width: details.width,
        height: details.height,
        fps: details.fps,
        videoCodec: details.videoCodec,
        pixelFormat: details.pixelFormat,
        videoTimebase: details.videoTimebase,
        hasAudio: details.hasAudio,
        audioCodec: details.audioCodec,
        audioSampleRate: details.audioSampleRate,
        audioChannels: details.audioChannels,
        streamOrder: details.streamOrder
    };
}

export function canStreamCopy(items: readonly MergeMedia[], format: MergeVideoFormat): boolean {
    if (items.length < 2) {
        return false;
    }
    const first = items[0]!;
    if (
        first.videoCodec.length === 0 ||
        first.pixelFormat.length === 0 ||
        first.videoTimebase.length === 0 ||
        first.streamOrder.length === 0 ||
        first.width <= 0 ||
        first.height <= 0 ||
        first.fps <= 0
    ) {
        return false;
    }
    if (!CONTAINER_EXTENSIONS[format].has(first.extension)) {
        return false;
    }
    if (!CONTAINER_VIDEO_CODECS[format].has(first.videoCodec)) {
        return false;
    }
    if (first.hasAudio) {
        if (
            first.audioCodec === null ||
            first.audioSampleRate === null ||
            first.audioChannels === null ||
            !CONTAINER_AUDIO_CODECS[format].has(first.audioCodec)
        ) {
            return false;
        }
    }
    return items.every((item) => {
        return (
            item.extension === first.extension &&
            item.videoCodec === first.videoCodec &&
            item.pixelFormat === first.pixelFormat &&
            item.videoTimebase === first.videoTimebase &&
            item.streamOrder === first.streamOrder &&
            item.width === first.width &&
            item.height === first.height &&
            item.fps === first.fps &&
            item.hasAudio === first.hasAudio &&
            item.audioCodec === first.audioCodec &&
            item.audioSampleRate === first.audioSampleRate &&
            item.audioChannels === first.audioChannels
        );
    });
}

export function buildMergeConcatList(paths: readonly string[]): string {
    return paths
        .map((path) => {
            return `file '${path.replaceAll("'", "'\\''")}'`;
        })
        .join('\n');
}

export interface MergeCopyCommand {
    listPath: string;
    output: string;
    format: MergeVideoFormat;
}

export function buildMergeCopyArgs(command: MergeCopyCommand): string[] {
    return [
        '-hide_banner',
        '-nostdin',
        '-y',
        '-v',
        'error',
        '-stats',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        command.listPath,
        '-c',
        'copy',
        ...(command.format === 'mp4' ? ['-movflags', '+faststart'] : []),
        command.output
    ];
}

function evenDimension(value: number, fallback: number): number {
    const chosen = value > 0 ? Math.floor(value) : fallback;
    return Math.max(2, chosen - (chosen % 2));
}

function targetFpsOf(items: readonly MergeMedia[]): number {
    const firstValid = items.find((item) => {
        return item.fps >= 1 && item.fps <= 120;
    });
    return firstValid !== undefined ? Number(firstValid.fps.toFixed(3)) : DEFAULT_FPS;
}

function reencodeCodecArgs(format: MergeVideoFormat, includeAudio: boolean): string[] {
    if (format === 'webm') {
        return ['-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '32', '-row-mt', '1', ...(includeAudio ? ['-c:a', 'libopus', '-b:a', '128k'] : [])];
    }
    const base = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', ...(includeAudio ? ['-c:a', 'aac', '-b:a', '192k'] : [])];
    return format === 'mp4' ? [...base, '-movflags', '+faststart'] : base;
}

export interface MergeReencodeCommand {
    items: readonly MergeMedia[];
    output: string;
    format: MergeVideoFormat;
    threads: number;
}

export function buildMergeReencodeArgs(command: MergeReencodeCommand): string[] {
    const firstWithSize = command.items.find((item) => {
        return item.width > 0 && item.height > 0;
    });
    const width = evenDimension(firstWithSize?.width ?? 0, DEFAULT_WIDTH);
    const height = evenDimension(firstWithSize?.height ?? 0, DEFAULT_HEIGHT);
    const fps = targetFpsOf(command.items);
    const includeAudio = command.items.some((item) => {
        return item.hasAudio;
    });

    const inputArgs: string[] = [];
    const filterSteps: string[] = [];
    const concatInputs: string[] = [];

    command.items.forEach((item, index) => {
        inputArgs.push('-i', item.path);
        filterSteps.push(
            `[${index}:v:0]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},format=yuv420p,setpts=PTS-STARTPTS[v${index}]`
        );
        if (includeAudio) {
            if (item.hasAudio) {
                filterSteps.push(`[${index}:a:0]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=PTS-STARTPTS[a${index}]`);
            } else {
                const duration = Number(Math.max(0.1, item.durationSeconds).toFixed(3));
                filterSteps.push(`anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration=${duration},asetpts=PTS-STARTPTS[a${index}]`);
            }
            concatInputs.push(`[v${index}][a${index}]`);
        } else {
            concatInputs.push(`[v${index}]`);
        }
    });

    const concatSuffix = includeAudio
        ? `concat=n=${command.items.length}:v=1:a=1[vout][aout]`
        : `concat=n=${command.items.length}:v=1:a=0[vout]`;
    filterSteps.push(`${concatInputs.join('')}${concatSuffix}`);

    return [
        '-hide_banner',
        '-nostdin',
        '-y',
        '-v',
        'error',
        '-stats',
        ...inputArgs,
        '-filter_complex',
        filterSteps.join(';'),
        '-map',
        '[vout]',
        ...(includeAudio ? ['-map', '[aout]'] : []),
        ...reencodeCodecArgs(command.format, includeAudio),
        '-threads',
        String(Math.max(1, Math.floor(command.threads))),
        command.output
    ];
}

function sanitizeMergeStem(name: string): string {
    return Array.from(name, (character) => {
        return character.charCodeAt(0) < 32 ? '_' : character;
    })
        .join('')
        .replace(/[\\/:*?"<>|]/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^\.+|[. ]+$/g, '')
        .slice(0, 120);
}

export function defaultMergeOutputName(firstMediaName: string): string {
    const cleaned = sanitizeMergeStem(firstMediaName);
    return cleaned.length > 0 ? `${cleaned} - merged` : 'merged';
}

export function resolveMergeOutputStem(requestedName: string | undefined, firstMediaName: string): string {
    const trimmed = typeof requestedName === 'string' ? requestedName.trim() : '';
    if (trimmed.length === 0) {
        return defaultMergeOutputName(firstMediaName);
    }
    const stripped = trimmed.replace(/\.(mp4|mkv|webm)$/i, '');
    const cleaned = sanitizeMergeStem(stripped);
    return cleaned.length > 0 ? cleaned : defaultMergeOutputName(firstMediaName);
}
