import type { DownloadInfo, DownloadPartKind, FormatPart, LiveStreamInfo, PostProcessEvent, ProgressInfo, StreamSource } from '@shared/types';

export const PROGRESS_PREFIX = 'CYBERPROG|';
export const FILE_PREFIX = 'CYBERFILE|';
export const INFO_PREFIX = 'CYBERINFO|';
export const POSTPROCESS_PREFIX = 'CYBERPP|';
export const STREAM_PREFIX = 'CYBERSTREAM|';
export const THUMBNAIL_PREFIX = 'CYBERTHUMB|';

// The format of the part being downloaded comes before the title, which may have a | in it and so is last.
export const PROGRESS_TEMPLATE = `download:${PROGRESS_PREFIX}%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s|%(progress.downloaded_bytes)s|%(progress.elapsed)s|%(info.is_live)s|%(info.format_id)s|%(info.title)s`;
// Printed when each post-processor starts and finishes. Unlike its own `[Merger]`-style lines it also works in quiet mode.
export const POSTPROCESS_TEMPLATE = `postprocess:${POSTPROCESS_PREFIX}%(progress.status)s|%(progress.postprocessor)s`;
// Printed right before each download starts: tells whether it is a live stream and where the file is being written.
export const INFO_PRINT_TEMPLATE = `before_dl:${INFO_PREFIX}%(is_live)s|%(filename)s`;
// Printed right after it: where the stream can be fetched from, as JSON (the app records the live streams of this kind itself).
export const STREAM_PRINT_TEMPLATE = `before_dl:${STREAM_PREFIX}%(.{is_live,protocol,url,http_headers,requested_formats})j`;
export const FILE_PRINT_TEMPLATE = `after_move:${FILE_PREFIX}%(filepath)s`;
// Printed right before each download starts: the address of the picture of the video (NA when the site gives none).
export const THUMBNAIL_PRINT_TEMPLATE = `before_dl:${THUMBNAIL_PREFIX}%(thumbnail)s`;

const NOT_AVAILABLE_VALUES = new Set(['NA', 'N/A', 'Unknown', 'Unknown B/s']);

function cleanValue(value: string): string {
    const trimmed = value.trim();
    return NOT_AVAILABLE_VALUES.has(trimmed) ? '' : trimmed;
}

export function parseProgressLine(line: string): ProgressInfo | null {
    if (!line.startsWith(PROGRESS_PREFIX)) {
        return null;
    }
    const [percentPart = '', speedPart = '', etaPart = '', bytesPart = '', elapsedPart = '', livePart = '', formatPart = '', ...titleParts] = line
        .slice(PROGRESS_PREFIX.length)
        .split('|');
    const percent = parseFloat(percentPart);
    return {
        percent: Number.isFinite(percent) ? percent : 0,
        speed: cleanValue(speedPart),
        eta: cleanValue(etaPart),
        title: cleanValue(titleParts.join('|')),
        downloadedBytes: parseNumber(bytesPart),
        elapsedSeconds: parseNumber(elapsedPart),
        live: livePart.trim() === 'True',
        formatId: cleanValue(formatPart)
    };
}

function parseNumber(value: string): number | null {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
}

// The address of the picture of the video, or null when the line is another one or the site gives no picture (only http and https).
export function parseThumbnailLine(line: string): string | null {
    if (!line.startsWith(THUMBNAIL_PREFIX)) {
        return null;
    }
    const address = line.slice(THUMBNAIL_PREFIX.length).trim();
    try {
        const { protocol } = new URL(address);
        return protocol === 'https:' || protocol === 'http:' ? address : null;
    } catch {
        return null;
    }
}

export function parseInfoLine(line: string): DownloadInfo | null {
    if (!line.startsWith(INFO_PREFIX)) {
        return null;
    }
    const [livePart = '', ...pathParts] = line.slice(INFO_PREFIX.length).split('|');
    const filePath = pathParts.join('|').trim();
    return filePath.length > 0 ? { live: livePart.trim() === 'True', filePath } : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toHeaders(value: unknown): Record<string, string> {
    if (!isRecord(value)) {
        return {};
    }
    return Object.fromEntries(
        Object.entries(value).filter((entry): entry is [string, string] => {
            return typeof entry[1] === 'string';
        })
    );
}

function toSource(value: unknown, fallbackHeaders: Record<string, string>): StreamSource | null {
    if (!isRecord(value) || typeof value['url'] !== 'string' || typeof value['protocol'] !== 'string') {
        return null;
    }
    const headers = toHeaders(value['http_headers']);
    return { url: value['url'], protocol: value['protocol'], headers: Object.keys(headers).length > 0 ? headers : fallbackHeaders };
}

// What yt-dlp printed about the stream about to be downloaded, or null when the line is another one or is not an object.
function streamDataOf(line: string): Record<string, unknown> | null {
    if (!line.startsWith(STREAM_PREFIX)) {
        return null;
    }
    try {
        const data: unknown = JSON.parse(line.slice(STREAM_PREFIX.length));
        return isRecord(data) ? data : null;
    } catch {
        return null;
    }
}

// The renditions of the stream (the video and the audio apart, or the one that has both) and whether it is live; null when the line is
// not about a stream the app can read.
export function parseStreamLine(line: string): LiveStreamInfo | null {
    const data = streamDataOf(line);
    if (data === null) {
        return null;
    }
    const headers = toHeaders(data['http_headers']);
    const requested = Array.isArray(data['requested_formats']) ? data['requested_formats'] : [data];
    const sources = requested.map((format) => {
        return toSource(format, headers);
    });
    if (sources.length === 0 || sources.includes(null)) {
        return null;
    }
    return { live: data['is_live'] === true, sources: sources.filter((source): source is StreamSource => {
        return source !== null;
    }) };
}

function isPositiveNumber(value: unknown): boolean {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

// A codec yt-dlp knows the format has ('none' says it has none of that kind; a missing one says nothing).
function isKnownCodec(value: unknown): boolean {
    return typeof value === 'string' && value.length > 0 && value !== 'none';
}

// What a format holds: the sound when it has no picture, the picture when it has no sound (or a size of picture and no codec of sound the site
// says), something else otherwise (both, or codecs the site does not say).
function partKindOf(format: Record<string, unknown>): DownloadPartKind {
    if (format['vcodec'] === 'none' || format['resolution'] === 'audio only') {
        return 'audio';
    }
    if (format['acodec'] === 'none' || (isPositiveNumber(format['height']) && !isKnownCodec(format['acodec']))) {
        return 'video';
    }
    return 'other';
}

function toFormatPart(value: unknown): FormatPart | null {
    if (!isRecord(value) || typeof value['format_id'] !== 'string' || value['format_id'].length === 0) {
        return null;
    }
    return { formatId: value['format_id'], kind: partKindOf(value) };
}

// The formats yt-dlp is about to download one after the other for a video (the video and the audio when they are apart), in their order,
// from the same line as the stream; null when the line is another one, or the video is a single format, or a format has no name.
export function parseFormatPartsLine(line: string): FormatPart[] | null {
    const data = streamDataOf(line);
    if (data === null || !Array.isArray(data['requested_formats']) || data['requested_formats'].length < 2) {
        return null;
    }
    const parts = data['requested_formats'].map(toFormatPart);
    return parts.includes(null) ? null : parts.filter((part): part is FormatPart => {
        return part !== null;
    });
}

export function parsePostProcessLine(line: string): PostProcessEvent | null {
    if (!line.startsWith(POSTPROCESS_PREFIX)) {
        return null;
    }
    const [statusPart = '', ...processorParts] = line.slice(POSTPROCESS_PREFIX.length).split('|');
    const status = statusPart.trim();
    const processor = cleanValue(processorParts.join('|'));
    if ((status !== 'started' && status !== 'finished') || processor.length === 0) {
        return null;
    }
    return { status, processor };
}

// yt-dlp prints "[wait] ..." lines (only when it is not quiet) while it waits for a scheduled live stream to start.
export const WAIT_PREFIX = '[wait]';

export function isWaitLine(line: string): boolean {
    return line.startsWith(WAIT_PREFIX);
}

export function parseFileLine(line: string): string | null {
    if (!line.startsWith(FILE_PREFIX)) {
        return null;
    }
    const filePath = line.slice(FILE_PREFIX.length).trim();
    return filePath.length > 0 ? filePath : null;
}
