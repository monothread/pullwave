import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ToolState } from '@shared/tools';
import { MangaToolUpdates, type ToolUpdatesHelper } from '@main/services/manga/mangaToolUpdates';
import { FLARESOLVERR_LATEST_URL } from '@main/services/tools/flaresolverrUpdate';
import { cleanTempDirs, makeTempDir } from '../../../helpers/tempDir';

afterEach(() => {
    cleanTempDirs();
});

// Answers the latest release of FlareSolverr; every address it is asked is kept.
function fakeFetch(options: { flaresolverr?: string; fail?: boolean } = {}): { impl: typeof fetch; urls: string[] } {
    const urls: string[] = [];
    const impl = vi.fn((input: string | URL | Request) => {
        urls.push(String(input));
        if (options.fail === true) {
            return Promise.reject(new Error('offline'));
        }
        return Promise.resolve(new Response(JSON.stringify({ tag_name: options.flaresolverr ?? 'v9.9.9' })));
    }) as unknown as typeof fetch;
    return { impl, urls };
}

function setup(options: { helper?: ToolUpdatesHelper | null; fetch?: Parameters<typeof fakeFetch>[0] } = {}) {
    const dir = makeTempDir();
    const flaresolverrFile = join(dir, 'flaresolverr-selected.json');
    const changed = { count: 0 };
    const network = fakeFetch(options.fetch);
    const updates = new MangaToolUpdates({
        flaresolverrFile,
        helper: () => {
            return options.helper ?? null;
        },
        helperChanged: () => {
            changed.count += 1;
            return Promise.resolve();
        },
        fetchImpl: network.impl
    });
    return { updates, changed, flaresolverrFile, urls: network.urls };
}

function makeHelper(version = 'v3.5.2', result: ToolState | null = null): ToolUpdatesHelper & { switched: string[] } {
    const switched: string[] = [];
    const helper = {
        version,
        switched,
        switchTo: vi.fn((next: string) => {
            switched.push(next);
            if (result === null || result.status === 'ready') {
                helper.version = next;
            }
            return Promise.resolve(result ?? { id: 'flaresolverr' as const, status: 'ready' as const, version: next, bytesDone: 0, bytesTotal: 0, percent: 100, error: null });
        })
    };
    return helper;
}

describe('MangaToolUpdates check', () => {
    it('looks only at the helper: the manga server is not updated from the app', async () => {
        const { updates, urls } = setup({ helper: makeHelper('v3.5.2') });
        expect(await updates.check()).toEqual({ flaresolverr: { current: 'v3.5.2', latest: 'v9.9.9', error: null, updatable: true } });
        expect(urls).toEqual([FLARESOLVERR_LATEST_URL]);
    });

    it('says there is no update when the latest is the one that runs', async () => {
        const { updates } = setup({ helper: makeHelper('v9.9.9') });
        expect(await updates.check()).toEqual({ flaresolverr: { current: 'v9.9.9', latest: 'v9.9.9', error: null, updatable: false } });
    });

    it('says why the latest version could not be found, without failing', async () => {
        const { updates } = setup({ fetch: { fail: true }, helper: makeHelper() });
        expect(await updates.check()).toEqual({ flaresolverr: { current: 'v3.5.2', latest: null, error: 'offline', updatable: false } });
    });

    it('asks nothing when the app runs no helper', async () => {
        const { updates, urls } = setup();
        expect(await updates.check()).toEqual({ flaresolverr: null });
        expect(urls).toEqual([]);
    });
});

describe('MangaToolUpdates updating the helper', () => {
    it('switches to the latest version at once, keeps it for the next time and tells the server', async () => {
        const helper = makeHelper('v3.5.2');
        const { updates, changed, flaresolverrFile } = setup({ helper });
        await expect(updates.updateHelper()).resolves.toEqual({ ok: true, version: 'v9.9.9' });
        expect(helper.switched).toEqual(['v9.9.9']);
        expect(JSON.parse(readFileSync(flaresolverrFile, 'utf-8'))).toEqual({ version: 'v9.9.9' });
        expect(changed.count).toBe(1);
    });

    it('does nothing when it runs the latest version already', async () => {
        const helper = makeHelper('v9.9.9');
        const { updates, flaresolverrFile } = setup({ helper });
        await expect(updates.updateHelper()).resolves.toEqual({ ok: false, reason: 'current', message: null });
        expect(helper.switched).toEqual([]);
        expect(existsSync(flaresolverrFile)).toBe(false);
    });

    it('says it is not installed when the app runs none', async () => {
        const { updates } = setup();
        await expect(updates.updateHelper()).resolves.toEqual({ ok: false, reason: 'not-installed', message: null });
    });

    it('keeps the old version and says why when the new image cannot be had', async () => {
        const helper = makeHelper('v3.5.2', { id: 'flaresolverr', status: 'error', version: 'v3.5.2', bytesDone: 0, bytesTotal: 0, percent: 0, error: { code: 'DOWNLOAD_FAILED', message: 'manifest unknown' } });
        const { updates, changed, flaresolverrFile } = setup({ helper });
        await expect(updates.updateHelper()).resolves.toEqual({ ok: false, reason: 'failed', message: 'manifest unknown' });
        expect(existsSync(flaresolverrFile)).toBe(false);
        expect(changed.count).toBe(0);
    });

    it('says it failed, without words, when the switch fails without saying why', async () => {
        const helper = makeHelper('v3.5.2', { id: 'flaresolverr', status: 'error', version: 'v3.5.2', bytesDone: 0, bytesTotal: 0, percent: 0, error: null });
        const { updates } = setup({ helper });
        await expect(updates.updateHelper()).resolves.toEqual({ ok: false, reason: 'failed', message: null });
    });

    it('says why when the latest version cannot be found', async () => {
        const { updates } = setup({ helper: makeHelper(), fetch: { fail: true } });
        await expect(updates.updateHelper()).resolves.toEqual({ ok: false, reason: 'failed', message: 'offline' });
    });

    it('does not start a second update while one is going on', async () => {
        let release: () => void = () => {
            return undefined;
        };
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const helper = makeHelper('v3.5.2');
        const switchTo = helper.switchTo;
        helper.switchTo = vi.fn(async (next: string) => {
            await gate;
            return switchTo(next);
        });
        const { updates } = setup({ helper });
        const first = updates.updateHelper();
        await expect(updates.updateHelper()).resolves.toEqual({ ok: false, reason: 'busy', message: null });
        release();
        await expect(first).resolves.toEqual({ ok: true, version: 'v9.9.9' });
        await expect(updates.updateHelper()).resolves.toEqual({ ok: false, reason: 'current', message: null });
    });
});
