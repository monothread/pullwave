import type { DownloadInfo, LiveStreamInfo, PostProcessEvent, ProgressInfo, StreamSource } from '@shared/types';

export const PROGRESS_PREFIX = 'CYBERPROG|';
export const FILE_PREFIX = 'CYBERFILE|';
export const INFO_PREFIX = 'CYBERINFO|';
export const POSTPROCESS_PREFIX = 'CYBERPP|';
export const STREAM_PREFIX = 'CYBERSTREAM|';

export const PROGRESS_TEMPLATE = `download:${PROGRESS_PREFIX}%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s|%(progress.downloaded_bytes)s|%(progress.elapsed)s|%(info.is_live)s|%(info.title)s`;
// Printed when each post-processor starts and finishes. Unlike its own `[Merger]`-style lines it also works in quiet mode.
export const POSTPROCESS_TEMPLATE = `postprocess:${POSTPROCESS_PREFIX}%(progress.status)s|%(progress.postprocessor)s`;
// Printed right before each download starts: tells whether it is a live stream and where the file is being written.
export const INFO_PRINT_TEMPLATE = `before_dl:${INFO_PREFIX}%(is_live)s|%(filename)s`;
// Printed right after it: where the stream can be fetched from, as JSON (the app records the live streams of this kind itself).
export const STREAM_PRINT_TEMPLATE = `before_dl:${STREAM_PREFIX}%(.{is_live,protocol,url,http_headers,requested_formats})j`;
export const FILE_PRINT_TEMPLATE = `after_move:${FILE_PREFIX}%(filepath)s`;

const NOT_AVAILABLE_VALUES = new Set(['NA', 'N/A', 'Unknown', 'Unknown B/s']);

function cleanValue(value: string): string {
    const trimmed = value.trim();
    return NOT_AVAILABLE_VALUES.has(trimmed) ? '' : trimmed;
}

export function parseProgressLine(line: string): ProgressInfo | null {
    if (!line.startsWith(PROGRESS_PREFIX)) {
        return null;
    }
    const [percentPart = '', speedPart = '', etaPart = '', bytesPart = '', elapsedPart = '', livePart = '', ...titleParts] = line
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
        live: livePart.trim() === 'True'
    };
}

function parseNumber(value: string): number | null {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
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

// The renditions of the stream (the video and the audio apart, or the one that has both) and whether it is live; null when the line is
// not about a stream the app can read.
export function parseStreamLine(line: string): LiveStreamInfo | null {
    if (!line.startsWith(STREAM_PREFIX)) {
        return null;
    }
    let data: unknown;
    try {
        data = JSON.parse(line.slice(STREAM_PREFIX.length));
    } catch {
        return null;
    }
    if (!isRecord(data)) {
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
