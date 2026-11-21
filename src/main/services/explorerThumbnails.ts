import { createHash } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { mkdir, readdir, rename, rm, stat, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { EXPLORER_MEDIA_SCHEME, type ExplorerEntry, type ExplorerMediaRoute, type ExplorerPreviewResponse } from '@shared/explorer';
import { createConcurrencyLimit, type ConcurrencyLimit } from './concurrencyLimit';
import type { RunFfmpeg } from './cutService';

export const EXPLORER_THUMB_WIDTH = 320;
export const EXPLORER_THUMB_SEEK_SECONDS = 2;
export const DEFAULT_MAX_CACHE_FILES = 400;
export const DEFAULT_THUMB_MAX_AGE_MS = 30 * 60 * 1000;
export const DEFAULT_PRUNE_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_THUMB_CONCURRENCY = 2;

export interface ExplorerThumbnailsDependencies {
    runFfmpeg: () => RunFfmpeg | null;
    cacheDirectory: string;
    previewDirectory: string;
    concurrency?: number;
    maxCacheFiles?: number;
    maxAgeMs?: number;
    pruneIntervalMs?: number;
    now?: () => number;
}

export function explorerMediaUrl(route: ExplorerMediaRoute, id: number): string {
    return `${EXPLORER_MEDIA_SCHEME}://${route}/${String(id)}`;
}

export function thumbnailCacheKey(path: string, modifiedAt: number, sizeBytes: number): string {
    return createHash('sha256').update(`${path}\0${String(modifiedAt)}\0${String(sizeBytes)}`).digest('hex');
}

export function buildExplorerThumbArgs(input: string, output: string, seekSeconds: number): string[] {
    const seek = seekSeconds > 0 ? ['-ss', String(seekSeconds)] : [];
    return [
        '-hide_banner',
        '-nostdin',
        '-y',
        '-v',
        'error',
        ...seek,
        '-i',
        input,
        '-map',
        '0:v:0',
        '-frames:v',
        '1',
        '-vf',
        `scale=${String(EXPLORER_THUMB_WIDTH)}:-2`,
        '-q:v',
        '5',
        output
    ];
}

export function buildExplorerPreviewArgs(entry: Pick<ExplorerEntry, 'path' | 'kind'>, output: string): string[] {
    const codecs =
        entry.kind === 'video'
            ? ['-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '26', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart']
            : ['-vn', '-map', '0:a:0', '-c:a', 'aac', '-b:a', '192k'];
    return ['-hide_banner', '-nostdin', '-y', '-v', 'error', '-i', entry.path, ...codecs, output];
}

async function fileHasBytes(path: string): Promise<boolean> {
    try {
        const info = await stat(path);
        return info.isFile() && info.size > 0;
    } catch {
        return false;
    }
}

interface ActivePreview {
    id: number;
    key: string;
    path: string;
}

interface InFlightThumbnail {
    promise: Promise<string | null>;
    controller: AbortController;
}

export class ExplorerThumbnails {
    private readonly limit: ConcurrencyLimit;
    private readonly inFlight = new Map<string, InFlightThumbnail>();
    private activePreview: ActivePreview | null = null;
    private previewInFlightKey: string | null = null;
    private generation = 0;
    private thumbController = new AbortController();
    private previewController: AbortController | null = null;
    private pruneTimer: ReturnType<typeof setInterval> | null = null;
    private nextId = 1;
    private tempCounter = 1;
    private pruning = false;
    private pruneQueued = false;

    constructor(private readonly deps: ExplorerThumbnailsDependencies) {
        this.limit = createConcurrencyLimit(deps.concurrency ?? DEFAULT_THUMB_CONCURRENCY);
        this.removePreviewDir();
        this.removeCacheDir();
        const intervalMs = deps.pruneIntervalMs ?? DEFAULT_PRUNE_INTERVAL_MS;
        if (intervalMs > 0) {
            this.pruneTimer = setInterval(() => {
                this.schedulePrune();
            }, intervalMs);
            this.pruneTimer.unref();
        }
    }

    cancelPending(): void {
        this.generation += 1;
        this.thumbController.abort();
        this.thumbController = new AbortController();
        for (const item of this.inFlight.values()) {
            item.controller.abort();
        }
        this.inFlight.clear();
    }

    cancelPreview(): void {
        this.previewController?.abort();
        this.previewController = null;
        this.previewInFlightKey = null;
    }

    resolvePreview(id: number): string | null {
        return this.activePreview !== null && this.activePreview.id === id ? this.activePreview.path : null;
    }

    async evict(entry: Pick<ExplorerEntry, 'path' | 'modifiedAt' | 'sizeBytes'>): Promise<void> {
        const key = thumbnailCacheKey(entry.path, entry.modifiedAt, entry.sizeBytes);
        const target = join(this.deps.cacheDirectory, `${key}.jpg`);
        const pending = this.inFlight.get(key);
        if (pending !== undefined) {
            this.inFlight.delete(key);
            pending.controller.abort();
        }
        await rm(target, { force: true }).catch(() => {
            return undefined;
        });
        if (this.previewInFlightKey === key) {
            this.cancelPreview();
        }
        if (this.activePreview !== null && this.activePreview.key === key) {
            const previewPath = this.activePreview.path;
            this.activePreview = null;
            this.cancelPreview();
            await rm(previewPath, { force: true }).catch(() => {
                return undefined;
            });
        }
    }

    async thumbnail(entry: Pick<ExplorerEntry, 'path' | 'kind' | 'modifiedAt' | 'sizeBytes'>): Promise<string | null> {
        if (entry.kind !== 'video') {
            return null;
        }
        const generation = this.generation;
        const batchSignal = this.thumbController.signal;
        const key = thumbnailCacheKey(entry.path, entry.modifiedAt, entry.sizeBytes);
        const target = join(this.deps.cacheDirectory, `${key}.jpg`);
        if (await this.hasFreshThumbnail(target)) {
            return target;
        }
        if (batchSignal.aborted || generation !== this.generation) {
            return null;
        }
        const existing = this.inFlight.get(key);
        if (existing !== undefined) {
            return existing.promise;
        }
        const itemController = new AbortController();
        const promise = this.generateThumbnail(entry.path, target, generation, itemController.signal).finally(() => {
            if (this.inFlight.get(key)?.promise === promise) {
                this.inFlight.delete(key);
            }
        });
        this.inFlight.set(key, { promise, controller: itemController });
        return promise;
    }

    async preview(entry: Pick<ExplorerEntry, 'path' | 'kind' | 'modifiedAt' | 'sizeBytes'>): Promise<ExplorerPreviewResponse> {
        const key = thumbnailCacheKey(entry.path, entry.modifiedAt, entry.sizeBytes);
        if (this.activePreview !== null && this.activePreview.key === key && (await fileHasBytes(this.activePreview.path))) {
            return { ok: true, url: explorerMediaUrl('preview', this.activePreview.id), converted: true };
        }
        const runFfmpeg = this.deps.runFfmpeg();
        if (runFfmpeg === null) {
            return { ok: false, reason: 'no-ffmpeg' };
        }
        this.previewController?.abort();
        const controller = new AbortController();
        this.previewController = controller;
        this.previewInFlightKey = key;
        const id = this.takeId();
        const extension = entry.kind === 'video' ? '.mp4' : '.m4a';
        const output = join(this.deps.previewDirectory, `preview-${String(id)}${extension}`);
        try {
            mkdirSync(this.deps.previewDirectory, { recursive: true });
        } catch {
            if (this.previewController === controller) {
                this.previewController = null;
                this.previewInFlightKey = null;
            }
            return { ok: false, reason: 'failed' };
        }
        const outcome = await runFfmpeg({ args: buildExplorerPreviewArgs(entry, output), signal: controller.signal });
        if (this.previewController === controller) {
            this.previewController = null;
            this.previewInFlightKey = null;
        }
        if (controller.signal.aborted) {
            await rm(output, { force: true }).catch(() => {
                return undefined;
            });
            return { ok: false, reason: 'cancelled' };
        }
        if (outcome.code === null) {
            await rm(output, { force: true }).catch(() => {
                return undefined;
            });
            return { ok: false, reason: 'no-ffmpeg' };
        }
        if (outcome.code !== 0 || !(await fileHasBytes(output))) {
            await rm(output, { force: true }).catch(() => {
                return undefined;
            });
            return { ok: false, reason: 'failed' };
        }
        const previous = this.activePreview;
        this.activePreview = { id, key, path: output };
        if (previous !== null && previous.path !== output) {
            await rm(previous.path, { force: true }).catch(() => {
                return undefined;
            });
        }
        return { ok: true, url: explorerMediaUrl('preview', id), converted: true };
    }

    dispose(): void {
        if (this.pruneTimer !== null) {
            clearInterval(this.pruneTimer);
            this.pruneTimer = null;
        }
        this.cancelPending();
        this.cancelPreview();
        this.activePreview = null;
        this.removePreviewDir();
        this.removeCacheDir();
    }

    private currentNow(): number {
        return this.deps.now ? this.deps.now() : Date.now();
    }

    private isExpired(mtimeMs: number): boolean {
        const maxAge = this.deps.maxAgeMs ?? DEFAULT_THUMB_MAX_AGE_MS;
        if (maxAge <= 0) {
            return false;
        }
        return this.currentNow() - mtimeMs > maxAge;
    }

    private async hasFreshThumbnail(path: string): Promise<boolean> {
        try {
            const info = await stat(path);
            if (!info.isFile() || info.size <= 0) {
                return false;
            }
            if (this.isExpired(info.mtimeMs)) {
                await rm(path, { force: true }).catch(() => {
                    return undefined;
                });
                return false;
            }
            return true;
        } catch {
            return false;
        }
    }

    private async generateThumbnail(videoPath: string, target: string, generation: number, signal: AbortSignal): Promise<string | null> {
        return this.limit(async () => {
            if (signal.aborted || generation !== this.generation) {
                return null;
            }
            if (await this.hasFreshThumbnail(target)) {
                return target;
            }
            const runFfmpeg = this.deps.runFfmpeg();
            if (runFfmpeg === null) {
                return null;
            }
            try {
                await mkdir(this.deps.cacheDirectory, { recursive: true });
            } catch {
                return null;
            }
            const temp = join(this.deps.cacheDirectory, `.tmp-${String(this.tempCounter)}.jpg`);
            this.tempCounter += 1;
            const first = await runFfmpeg({ args: buildExplorerThumbArgs(videoPath, temp, EXPLORER_THUMB_SEEK_SECONDS), signal });
            let ready = !signal.aborted && first.code === 0 && (await fileHasBytes(temp));
            if (!ready && !signal.aborted && first.code !== null) {
                const retry = await runFfmpeg({ args: buildExplorerThumbArgs(videoPath, temp, 0), signal });
                ready = !signal.aborted && retry.code === 0 && (await fileHasBytes(temp));
            }
            if (!ready || signal.aborted || generation !== this.generation) {
                await rm(temp, { force: true }).catch(() => {
                    return undefined;
                });
                return null;
            }
            try {
                await rename(temp, target);
                if (this.deps.now !== undefined) {
                    const stampSeconds = this.deps.now() / 1000;
                    await utimes(target, stampSeconds, stampSeconds).catch(() => {
                        return undefined;
                    });
                }
            } catch {
                await rm(temp, { force: true }).catch(() => {
                    return undefined;
                });
                return (await this.hasFreshThumbnail(target)) ? target : null;
            }
            this.schedulePrune();
            return target;
        });
    }

    private schedulePrune(): void {
        if (this.pruning) {
            this.pruneQueued = true;
            return;
        }
        this.pruning = true;
        void this.pruneCache().finally(() => {
            this.pruning = false;
            if (this.pruneQueued) {
                this.pruneQueued = false;
                this.schedulePrune();
            }
        });
    }

    private async pruneCache(): Promise<void> {
        const max = this.deps.maxCacheFiles ?? DEFAULT_MAX_CACHE_FILES;
        try {
            const names = (await readdir(this.deps.cacheDirectory)).filter((name) => {
                return name.endsWith('.jpg') && !name.startsWith('.tmp-');
            });
            if (names.length === 0) {
                return;
            }
            const entries = await Promise.all(
                names.map(async (name) => {
                    const full = join(this.deps.cacheDirectory, name);
                    const info = await stat(full).catch(() => {
                        return null;
                    });
                    return { full, info };
                })
            );
            const expired: string[] = [];
            const fresh: Array<{ full: string; mtimeMs: number }> = [];
            for (const entry of entries) {
                if (entry.info === null || !entry.info.isFile() || entry.info.size <= 0 || this.isExpired(entry.info.mtimeMs)) {
                    expired.push(entry.full);
                } else {
                    fresh.push({ full: entry.full, mtimeMs: entry.info.mtimeMs });
                }
            }
            const toRemove = [...expired];
            if (fresh.length > max) {
                fresh.sort((a, b) => {
                    return a.mtimeMs - b.mtimeMs;
                });
                const overflow = fresh.slice(0, fresh.length - max);
                for (const item of overflow) {
                    toRemove.push(item.full);
                }
            }
            if (toRemove.length > 0) {
                await Promise.all(
                    toRemove.map((fullPath) => {
                        return rm(fullPath, { force: true }).catch(() => {
                            return undefined;
                        });
                    })
                );
            }
        } catch {
            return undefined;
        }
    }

    private takeId(): number {
        const id = this.nextId;
        this.nextId += 1;
        return id;
    }

    private removePreviewDir(): void {
        try {
            rmSync(this.deps.previewDirectory, { recursive: true, force: true });
        } catch {
            return undefined;
        }
    }

    private removeCacheDir(): void {
        try {
            rmSync(this.deps.cacheDirectory, { recursive: true, force: true });
        } catch {
            return undefined;
        }
    }
}
