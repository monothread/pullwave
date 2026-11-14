import { isAbsolute, relative, resolve } from 'node:path';
import type { DownloadJob, DownloadPart, DownloadPartKind } from '@shared/types';
import type { RequestExtras } from './ytdlpArgsBuilder';
import { JsonStore } from './jsonStore';
import { sanitizeDownloadOptions } from './settingsSanitizer';

// What is kept of a download that was paused, so it is still there (and can go on from its partial files) after the app is closed:
// the card, how it was asked for (without the cookie of the page: nothing of a session goes to the disk) and where its files are.
export interface PausedDownload {
    job: DownloadJob;
    extras: Omit<RequestExtras, 'cookie' | 'resumedPart'>;
    outputPaths: string[];
}

export interface PausedStorage {
    load: () => PausedDownload[];
    save: (downloads: PausedDownload[]) => void;
}

function isText(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
}

// What a text kept for a download may weigh: far more than any address or name, so only a file that was not written by the app is cut.
const MAX_TEXT_LENGTH = 4096;

function isShortText(value: unknown): value is string {
    return isText(value) && value.length <= MAX_TEXT_LENGTH;
}

function isNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

const PART_KINDS: readonly DownloadPartKind[] = ['video', 'audio', 'other'];

function readPart(raw: unknown): DownloadPart | null {
    const part = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
    const kind = PART_KINDS.find((known) => {
        return known === part.kind;
    });
    if (kind === undefined || !isNumber(part.percent)) {
        return null;
    }
    return { kind, percent: Math.min(100, Math.max(0, part.percent)) };
}

// The bars of the parts of a paused download (the video and the audio that are apart), or null when it has none or what the file says of
// them is not a list of two parts or more that can all be read.
export function readParts(raw: unknown): DownloadPart[] | null {
    if (!Array.isArray(raw) || raw.length < 2) {
        return null;
    }
    const parts = raw.map(readPart);
    return parts.every((part): part is DownloadPart => {
        return part !== null;
    }) ? parts : null;
}

// How a download was asked for, keeping only the fields it can have and with values it can have: the file may be edited, or from another
// version, and what is read here ends in the arguments of yt-dlp. The cookie and the part number are never read, even if they are there.
export function readExtras(raw: unknown): PausedDownload['extras'] {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        return {};
    }
    const entry = raw as Record<string, unknown>;
    const options = sanitizeDownloadOptions(entry.options);
    return {
        ...(isShortText(entry.referer) ? { referer: entry.referer } : {}),
        ...(isShortText(entry.userAgent) ? { userAgent: entry.userAgent } : {}),
        ...(isShortText(entry.title) ? { title: entry.title } : {}),
        ...(isShortText(entry.downloadDir) && isAbsolute(entry.downloadDir) ? { downloadDir: entry.downloadDir } : {}),
        ...(entry.ipFamily === 4 || entry.ipFamily === 6 ? { ipFamily: entry.ipFamily } : {}),
        ...(isShortText(entry.pageUrl) ? { pageUrl: entry.pageUrl } : {}),
        ...(Object.keys(options).length > 0 ? { options } : {})
    };
}

// The files that are inside the folder the download goes to: what the file says is not trusted to point anywhere else, because what is
// kept of them is deleted when the download is cancelled.
export function keepInside(paths: readonly string[], directory: string): string[] {
    const root = resolve(directory);
    return paths.filter((path) => {
        const inside = relative(root, resolve(path));
        return isAbsolute(path) && inside.length > 0 && !inside.startsWith('..') && !isAbsolute(inside);
    });
}

// A download read from the file, or null when it is not one (the file may be edited, or from another version).
export function readPausedDownload(raw: unknown): PausedDownload | null {
    const entry = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
    const job = (typeof entry.job === 'object' && entry.job !== null ? entry.job : {}) as Record<string, unknown>;
    if (!isText(job.id) || !isText(job.url) || !isNumber(job.percent) || !isNumber(job.createdAt)) {
        return null;
    }
    const extras = readExtras(entry.extras);
    const outputPaths = (Array.isArray(entry.outputPaths) ? entry.outputPaths : []).filter(isShortText);
    return {
        job: {
            id: job.id,
            url: job.url,
            status: 'paused',
            title: typeof job.title === 'string' ? job.title : null,
            percent: Math.min(100, Math.max(0, job.percent)),
            speed: '',
            eta: '',
            filePath: null,
            error: null,
            createdAt: job.createdAt,
            pageUrl: typeof job.pageUrl === 'string' ? job.pageUrl : null,
            live: false,
            elapsedSeconds: 0,
            downloadedBytes: 0,
            hasPartial: false,
            customized: job.customized === true,
            waitingForLive: false,
            endCheck: null,
            merging: false,
            saving: false,
            postProcess: null,
            postProcessSteps: [],
            // The pictures are kept in memory only: a download paused in an earlier run of the app gets its picture again when it goes on.
            thumbnail: null,
            parts: readParts(job.parts)
        },
        extras,
        outputPaths
    };
}

// The paused downloads in a file. A file that cannot be read or written is not a reason to stop: a pause then only lasts while the app
// is open, as it did before.
export class PausedStore implements PausedStorage {
    private readonly store: JsonStore<unknown[]>;

    constructor(filePath: string) {
        this.store = new JsonStore<unknown[]>(filePath, []);
    }

    load(): PausedDownload[] {
        const raw = this.store.read();
        return (Array.isArray(raw) ? raw : []).flatMap((entry) => {
            const read = readPausedDownload(entry);
            return read === null ? [] : [read];
        });
    }

    save(downloads: PausedDownload[]): void {
        try {
            this.store.write(downloads);
        } catch {
            return;
        }
    }
}
