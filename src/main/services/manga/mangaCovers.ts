import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { localCoverUrl, type MangaRecord } from '@shared/manga';
import { detectImageType } from './imageType';
import { fromStoredAddress } from './serverAddress';

export const COVER_TIMEOUT_MS = 15_000;
export const MAX_COVER_BYTES = 8 * 1024 * 1024;
export const FINGERPRINT_LENGTH = 12;

export interface CoverDatabase {
    getManga: (id: number) => MangaRecord | null;
    coverHash: (mangaId: number) => string | null;
    setCoverHash: (mangaId: number, hash: string | null) => void;
    coverless: () => MangaRecord[];
}

export interface MangaCoversDependencies {
    directory: string;
    db: CoverDatabase;
    baseUrl: () => string | null;
    fetchImpl?: typeof fetch;
    fallback?: { find: (title: string) => Promise<string | null> };
}

function isWebAddress(address: string): boolean {
    return /^https?:\/\//i.test(address);
}

function sha256(bytes: Uint8Array): string {
    return createHash('sha256').update(bytes).digest('hex');
}

export class MangaCovers {
    private readonly fetchImpl: typeof fetch;
    private readonly running = new Map<number, Promise<boolean>>();
    private readonly failed = new Set<number>();
    private backfilling: Promise<boolean> | null = null;
    private readonly onDisk = new Map<string, boolean>();

    constructor(private readonly deps: MangaCoversDependencies) {
        this.fetchImpl = deps.fetchImpl ?? fetch;
    }

    pathOf(mangaId: number): string {
        return join(this.deps.directory, String(mangaId));
    }

    fileOf(mangaId: number): string | null {
        const path = this.pathOf(mangaId);
        return this.deps.db.coverHash(mangaId) !== null && this.isOnDisk(mangaId) ? path : null;
    }

    urlOf(mangaId: number): string | null {
        const hash = this.deps.db.coverHash(mangaId);
        return hash !== null && this.isOnDisk(mangaId) ? localCoverUrl(mangaId, hash.slice(0, FINGERPRINT_LENGTH)) : null;
    }

    private isOnDisk(mangaId: number): boolean {
        const path = this.pathOf(mangaId);
        const known = this.onDisk.get(path);
        if (known !== undefined) {
            return known;
        }
        const found = existsSync(path);
        this.onDisk.set(path, found);
        return found;
    }

    async read(path: string): Promise<Buffer> {
        try {
            return await readFile(path);
        } catch (error) {
            this.onDisk.set(path, false);
            throw error;
        }
    }

    refresh(mangaId: number): Promise<boolean> {
        const current = this.running.get(mangaId);
        if (current !== undefined) {
            return current;
        }
        const job = this.download(mangaId).finally(() => {
            this.running.delete(mangaId);
        });
        this.running.set(mangaId, job);
        return job;
    }

    private async download(mangaId: number): Promise<boolean> {
        const manga = this.deps.db.getManga(mangaId);
        if (manga === null) {
            return false;
        }
        const address = fromStoredAddress(manga.thumbnailUrl, this.deps.baseUrl());
        if (address === null && manga.thumbnailUrl?.startsWith('/') === true) {
            return false;
        }
        const fromSource = address !== null && isWebAddress(address);
        if (!fromSource && this.deps.fallback === undefined) {
            return this.fail(mangaId);
        }
        const bytes = (fromSource ? await this.image(address) : null) ?? (await this.fallbackImage(manga.title));
        if (bytes === null) {
            return this.fail(mangaId);
        }
        this.failed.delete(mangaId);
        const hash = sha256(bytes);
        if (hash === this.deps.db.coverHash(mangaId) && this.isOnDisk(mangaId)) {
            return false;
        }
        this.write(mangaId, bytes);
        this.deps.db.setCoverHash(mangaId, hash);
        return true;
    }

    private async image(address: string): Promise<Uint8Array | null> {
        try {
            const response = await this.fetchImpl(address, { signal: AbortSignal.timeout(COVER_TIMEOUT_MS) });
            if (!response.ok) {
                return null;
            }
            const bytes = new Uint8Array(await response.arrayBuffer());
            return bytes.length === 0 || bytes.length > MAX_COVER_BYTES || detectImageType(bytes) === null ? null : bytes;
        } catch {
            return null;
        }
    }

    private async fallbackImage(title: string): Promise<Uint8Array | null> {
        if (this.deps.fallback === undefined) {
            return null;
        }
        try {
            const address = await this.deps.fallback.find(title);
            return address !== null && isWebAddress(address) ? await this.image(address) : null;
        } catch {
            return null;
        }
    }

    private fail(mangaId: number): boolean {
        this.failed.add(mangaId);
        return false;
    }

    private write(mangaId: number, bytes: Uint8Array): void {
        mkdirSync(this.deps.directory, { recursive: true });
        const path = this.pathOf(mangaId);
        const partial = `${path}.part`;
        writeFileSync(partial, bytes);
        renameSync(partial, path);
        this.onDisk.set(path, true);
    }

    private get missing(): MangaRecord[] {
        return this.deps.db.coverless().filter((manga) => {
            return !this.failed.has(manga.id);
        });
    }

    get needsServer(): boolean {
        return this.missing.some((manga) => {
            return manga.thumbnailUrl?.startsWith('/') === true;
        });
    }

    pending(serverRunning: boolean): boolean {
        return this.missing.some((manga) => {
            return serverRunning || manga.thumbnailUrl?.startsWith('/') !== true;
        });
    }

    backfill(): Promise<boolean> {
        if (this.backfilling !== null) {
            return this.backfilling;
        }
        const job = this.takeAll().finally(() => {
            this.backfilling = null;
        });
        this.backfilling = job;
        return job;
    }

    private async takeAll(): Promise<boolean> {
        let changed = false;
        for (const manga of this.deps.db.coverless()) {
            if (this.failed.has(manga.id)) {
                continue;
            }
            changed = (await this.refresh(manga.id)) || changed;
        }
        return changed;
    }

    remove(mangaId: number): void {
        rmSync(this.pathOf(mangaId), { force: true });
        rmSync(`${this.pathOf(mangaId)}.part`, { force: true });
        this.onDisk.set(this.pathOf(mangaId), false);
        this.failed.delete(mangaId);
    }
}
