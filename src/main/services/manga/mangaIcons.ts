import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MANGA_PAGE_SCHEME } from '@shared/manga';
import { detectImageType } from './imageType';
import { fromStoredAddress, toStoredAddress } from './serverAddress';

export const ICON_TIMEOUT_MS = 15_000;
export const MAX_ICON_BYTES = 1024 * 1024;
export const ICON_KEY_LENGTH = 24;

export interface MangaIconsDependencies {
    directory: string;
    baseUrl: () => string | null;
    fetchImpl?: typeof fetch;
}

export function parseIconUrl(url: string): { key: string } | null {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return null;
    }
    const match = /^\/([0-9a-f]{24})$/.exec(parsed.pathname);
    return parsed.protocol === `${MANGA_PAGE_SCHEME}:` && parsed.hostname === 'icon' && match !== null ? { key: match[1]! } : null;
}

export class MangaIcons {
    private readonly fetchImpl: typeof fetch;
    private readonly asked = new Set<string>();
    private readonly onDisk = new Map<string, boolean>();

    constructor(private readonly deps: MangaIconsDependencies) {
        this.fetchImpl = deps.fetchImpl ?? fetch;
    }

    keyOf(stored: string): string {
        return createHash('sha256').update(stored).digest('hex').slice(0, ICON_KEY_LENGTH);
    }

    fileOf(key: string): string | null {
        const path = join(this.deps.directory, key);
        let found = this.onDisk.get(path);
        if (found === undefined) {
            found = existsSync(path);
            this.onDisk.set(path, found);
        }
        return found ? path : null;
    }

    async read(path: string): Promise<Buffer> {
        try {
            return await readFile(path);
        } catch (error) {
            this.onDisk.set(path, false);
            throw error;
        }
    }

    present(address: string | null): string | null {
        if (address === null) {
            return null;
        }
        const stored = toStoredAddress(address, this.deps.baseUrl());
        if (stored === null) {
            return address;
        }
        const key = this.keyOf(stored);
        if (!this.asked.has(key)) {
            this.asked.add(key);
            void this.download(stored, key);
        }
        return this.fileOf(key) === null ? address : `${MANGA_PAGE_SCHEME}://icon/${key}`;
    }

    private async download(stored: string, key: string): Promise<void> {
        const address = fromStoredAddress(stored, this.deps.baseUrl());
        if (address === null || !/^https?:\/\//i.test(address)) {
            this.asked.delete(key);
            return;
        }
        try {
            const response = await this.fetchImpl(address, { signal: AbortSignal.timeout(ICON_TIMEOUT_MS) });
            if (!response.ok) {
                return;
            }
            const bytes = new Uint8Array(await response.arrayBuffer());
            if (bytes.length === 0 || bytes.length > MAX_ICON_BYTES || detectImageType(bytes) === null) {
                return;
            }
            mkdirSync(this.deps.directory, { recursive: true });
            const path = join(this.deps.directory, key);
            const partial = `${path}.part`;
            writeFileSync(partial, bytes);
            renameSync(partial, path);
            this.onDisk.set(path, true);
        } catch {
            return;
        }
    }
}
