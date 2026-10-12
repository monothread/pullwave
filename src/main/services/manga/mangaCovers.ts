import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { localCoverUrl, type MangaRecord } from '@shared/manga';
import { detectImageType } from './imageType';
import { fromStoredAddress } from './serverAddress';

// The covers of the mangas of the library are kept in the data folder, one file for each manga, so the library shows them with no server
// and no network. A cover that fails to come is left as it was: the old one is not thrown away until a new one is in its place.

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
    // The address of the server of the moment (null while it is not running).
    baseUrl: () => string | null;
    fetchImpl?: typeof fetch;
}

function sha256(bytes: Uint8Array): string {
    return createHash('sha256').update(bytes).digest('hex');
}

export class MangaCovers {
    private readonly fetchImpl: typeof fetch;
    private readonly running = new Map<number, Promise<boolean>>();
    // The covers that did not come: they are not asked for again until the app opens again.
    private readonly failed = new Set<number>();
    private backfilling: Promise<boolean> | null = null;

    constructor(private readonly deps: MangaCoversDependencies) {
        this.fetchImpl = deps.fetchImpl ?? fetch;
    }

    pathOf(mangaId: number): string {
        return join(this.deps.directory, String(mangaId));
    }

    // The file with the cover of the manga, when one is kept.
    fileOf(mangaId: number): string | null {
        const path = this.pathOf(mangaId);
        return this.deps.db.coverHash(mangaId) !== null && existsSync(path) ? path : null;
    }

    // The address the window shows the cover with, when one is kept.
    urlOf(mangaId: number): string | null {
        const hash = this.deps.db.coverHash(mangaId);
        return hash !== null && existsSync(this.pathOf(mangaId)) ? localCoverUrl(mangaId, hash.slice(0, FINGERPRINT_LENGTH)) : null;
    }

    read(path: string): Promise<Buffer> {
        return Promise.resolve(readFileSync(path));
    }

    // Takes the cover from where the manga says it is. True when what is kept changed (a new image, or the first one).
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
        const address = manga === null ? null : fromStoredAddress(manga.thumbnailUrl, this.deps.baseUrl());
        if (address === null || !/^https?:\/\//i.test(address)) {
            return false;
        }
        try {
            const response = await this.fetchImpl(address, { signal: AbortSignal.timeout(COVER_TIMEOUT_MS) });
            if (!response.ok) {
                return this.fail(mangaId);
            }
            const bytes = new Uint8Array(await response.arrayBuffer());
            if (bytes.length === 0 || bytes.length > MAX_COVER_BYTES || detectImageType(bytes) === null) {
                return this.fail(mangaId);
            }
            this.failed.delete(mangaId);
            const hash = sha256(bytes);
            if (hash === this.deps.db.coverHash(mangaId) && existsSync(this.pathOf(mangaId))) {
                return false;
            }
            this.write(mangaId, bytes);
            this.deps.db.setCoverHash(mangaId, hash);
            return true;
        } catch {
            return this.fail(mangaId);
        }
    }

    private fail(mangaId: number): boolean {
        this.failed.add(mangaId);
        return false;
    }

    // Written beside, then renamed, so the cover is whole or not there.
    private write(mangaId: number, bytes: Uint8Array): void {
        mkdirSync(this.deps.directory, { recursive: true });
        const path = this.pathOf(mangaId);
        const partial = `${path}.part`;
        writeFileSync(partial, bytes);
        renameSync(partial, path);
    }

    private get missing(): MangaRecord[] {
        return this.deps.db.coverless().filter((manga) => {
            return !this.failed.has(manga.id);
        });
    }

    // Whether any cover that is still to be taken is a path of the server, which has to be running to give it.
    get needsServer(): boolean {
        return this.missing.some((manga) => {
            return manga.thumbnailUrl?.startsWith('/') === true;
        });
    }

    // Whether there are covers to take now: the ones that are paths of the server need it to be running.
    pending(serverRunning: boolean): boolean {
        return this.missing.some((manga) => {
            return serverRunning || manga.thumbnailUrl?.startsWith('/') !== true;
        });
    }

    // Takes the covers the library has none of, one after the other. True when any was kept.
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

    // The manga left the library: its cover goes.
    remove(mangaId: number): void {
        rmSync(this.pathOf(mangaId), { force: true });
        rmSync(`${this.pathOf(mangaId)}.part`, { force: true });
        this.failed.delete(mangaId);
    }
}
