import { isAbsolute, relative, resolve } from 'node:path';
import type { DownloadJob, DownloadPart, DownloadPartKind } from '@shared/types';
import type { RequestExtras } from './ytdlpArgsBuilder';
import { JsonStore } from './jsonStore';
import { sanitizeDownloadOptions } from './settingsSanitizer';

export interface PausedDownload {
    job: DownloadJob;
    extras: Omit<RequestExtras, 'resumedPart'>;
    outputPaths: string[];
}

export interface PausedStorage {
    load: () => PausedDownload[];
    save: (downloads: PausedDownload[]) => void;
}

function isText(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
}

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

export function readParts(raw: unknown): DownloadPart[] | null {
    if (!Array.isArray(raw) || raw.length < 2) {
        return null;
    }
    const parts = raw.map(readPart);
    return parts.every((part): part is DownloadPart => {
        return part !== null;
    }) ? parts : null;
}

export function readExtras(raw: unknown): PausedDownload['extras'] {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        return {};
    }
    const entry = raw as Record<string, unknown>;
    const options = sanitizeDownloadOptions(entry.options);
    return {
        ...(isShortText(entry.downloadDir) && isAbsolute(entry.downloadDir) ? { downloadDir: entry.downloadDir } : {}),
        ...(Object.keys(options).length > 0 ? { options } : {})
    };
}

export function keepInside(paths: readonly string[], directory: string): string[] {
    const root = resolve(directory);
    return paths.filter((path) => {
        const inside = relative(root, resolve(path));
        return isAbsolute(path) && inside.length > 0 && !inside.startsWith('..') && !isAbsolute(inside);
    });
}

export function readPausedDownload(raw: unknown): PausedDownload | null {
    const entry = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
    const job = (typeof entry.job === 'object' && entry.job !== null ? entry.job : {}) as Record<string, unknown>;
    if (!isText(job.id) || !isText(job.url) || !isNumber(job.percent) || !isNumber(job.createdAt)) {
        return null;
    }
    const trimmedUrl = job.url.trim();
    if (trimmedUrl.length === 0) {
        return null;
    }
    const extras = readExtras(entry.extras);
    const outputPaths = (Array.isArray(entry.outputPaths) ? entry.outputPaths : []).filter(isShortText);
    return {
        job: {
            id: job.id,
            url: trimmedUrl,
            status: 'paused',
            title: typeof job.title === 'string' ? job.title : null,
            percent: Math.min(100, Math.max(0, job.percent)),
            speed: '',
            eta: '',
            filePath: null,
            error: null,
            createdAt: job.createdAt,
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
            thumbnail: null,
            parts: readParts(job.parts)
        },
        extras,
        outputPaths
    };
}

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
