import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MANGA_PAGE_SCHEME } from '@shared/manga';
import { detectImageType } from './imageType';
import { fromStoredAddress, toStoredAddress } from './serverAddress';

// The icons of the sources are kept in the data folder, so the list of sources shows them with no wait. An icon that is not kept yet is shown
// from the server and taken in the background; one that is kept is shown from the folder and asked for once more in each run of the app, in
// case the source changed it (the new one is shown the next time).

export const ICON_TIMEOUT_MS = 15_000;
export const MAX_ICON_BYTES = 1024 * 1024;
export const ICON_KEY_LENGTH = 24;

export interface MangaIconsDependencies {
    directory: string;
    // The address of the server of the moment (null while it is not running).
    baseUrl: () => string | null;
    fetchImpl?: typeof fetch;
}

// `pullwave-manga://icon/<key>`; null for anything else.
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
    // The icons that were asked for in this run (once each).
    private readonly asked = new Set<string>();

    constructor(private readonly deps: MangaIconsDependencies) {
        this.fetchImpl = deps.fetchImpl ?? fetch;
    }

    // The name an icon is kept under: it comes from where the server has it (the port left out), so it is the same in every run.
    keyOf(stored: string): string {
        return createHash('sha256').update(stored).digest('hex').slice(0, ICON_KEY_LENGTH);
    }

    fileOf(key: string): string | null {
        const path = join(this.deps.directory, key);
        return existsSync(path) ? path : null;
    }

    read(path: string): Promise<Buffer> {
        return Promise.resolve(readFileSync(path));
    }

    // The address to show an icon with: the one that is kept when there is one, otherwise the one the server gives. Either way the icon is
    // asked for in the background once in each run.
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
        } catch {
            return;
        }
    }
}
