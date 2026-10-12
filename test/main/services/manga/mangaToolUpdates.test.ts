import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ToolState } from '@shared/tools';
import { MangaToolUpdates, type ToolUpdatesHelper } from '@main/services/manga/mangaToolUpdates';
import { SUWAYOMI_VERSION, suwayomiSpec } from '@main/services/tools/suwayomiRelease';
import { cleanTempDirs, makeTempDir } from '../../../helpers/tempDir';

afterEach(() => {
    cleanTempDirs();
});

const HASH = 'c'.repeat(64);
const BASE = 'https://github.com/Suwayomi/Suwayomi-Server/releases/download/v9.0.0';
const LINUX = 'Suwayomi-Server-v9.0.0-linux-x64.tar.gz';

function ready(version: string): ToolState {
    return { id: 'suwayomi', status: 'ready', version, bytesDone: 0, bytesTotal: 0, percent: 100, error: null };
}

// Answers the latest release of each project.
function fakeFetch(options: { suwayomi?: string; flaresolverr?: string; fail?: boolean } = {}): typeof fetch {
    return vi.fn((input: string | URL | Request) => {
        const url = String(input);
        if (options.fail === true) {
            return Promise.reject(new Error('offline'));
        }
        if (url.includes('Suwayomi-Server/releases/latest')) {
            const tag = options.suwayomi ?? 'v9.0.0';
            return Promise.resolve(
                new Response(
                    JSON.stringify({
                        tag_name: tag,
                        assets: [
                            { name: `Suwayomi-Server-${tag}-linux-x64.tar.gz`, size: 350_000_000, browser_download_url: `${BASE.replace('v9.0.0', tag)}/Suwayomi-Server-${tag}-linux-x64.tar.gz` },
                            { name: 'Checksums.sha256', size: 400, browser_download_url: `${BASE.replace('v9.0.0', tag)}/Checksums.sha256` }
                        ]
                    })
                )
            );
        }
        if (url.endsWith('Checksums.sha256')) {
            const tag = options.suwayomi ?? 'v9.0.0';
            return Promise.resolve(new Response(`${HASH}  Suwayomi-Server-${tag}-linux-x64.tar.gz\n`));
        }
        return Promise.resolve(new Response(JSON.stringify({ tag_name: options.flaresolverr ?? 'v9.9.9' })));
    }) as unknown as typeof fetch;
}

function setup(options: { helper?: ToolUpdatesHelper | null; install?: (spec: unknown) => Promise<ToolState>; fetch?: Parameters<typeof fakeFetch>[0]; currentVersion?: string } = {}) {
    const dir = makeTempDir();
    const suwayomiFile = join(dir, 'suwayomi-selected.json');
    const flaresolverrFile = join(dir, 'flaresolverr-selected.json');
    const installs: unknown[] = [];
    const changed = { count: 0 };
    const current = options.currentVersion === undefined ? suwayomiSpec('linux', 'x64')! : { ...suwayomiSpec('linux', 'x64')!, version: options.currentVersion };
    const updates = new MangaToolUpdates({
        platform: 'linux',
        arch: 'x64',
        currentSpec: current,
        suwayomiFile,
        flaresolverrFile,
        install: (spec) => {
            installs.push(spec);
            return options.install === undefined ? Promise.resolve(ready((spec as { version: string }).version)) : options.install(spec);
        },
        helper: () => {
            return options.helper ?? null;
        },
        helperChanged: () => {
            changed.count += 1;
            return Promise.resolve();
        },
        fetchImpl: fakeFetch(options.fetch)
    });
    return { updates, installs, changed, suwayomiFile, flaresolverrFile };
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
    it('says the version that runs, the latest one found, and that there is an update', async () => {
        const { updates } = setup();
        const versions = await updates.check();
        expect(versions.suwayomi).toEqual({ current: SUWAYOMI_VERSION, latest: 'v9.0.0', error: null, updatable: true, chosen: false, bundled: SUWAYOMI_VERSION, restartNeeded: false });
        expect(versions.flaresolverr).toBeNull();
    });

    it('says there is no update when the latest is the one that runs', async () => {
        const { updates } = setup({ fetch: { suwayomi: SUWAYOMI_VERSION } });
        expect((await updates.check()).suwayomi).toMatchObject({ latest: SUWAYOMI_VERSION, updatable: false });
    });

    it('says the version that runs was chosen by an update, when it is not the one the app ships with', async () => {
        const { updates } = setup({ currentVersion: 'v8.0.0' });
        expect((await updates.check()).suwayomi).toMatchObject({ current: 'v8.0.0', chosen: true, bundled: SUWAYOMI_VERSION });
    });

    it('says why the latest version could not be found, without failing', async () => {
        const { updates } = setup({ fetch: { fail: true }, helper: makeHelper() });
        const versions = await updates.check();
        expect(versions.suwayomi).toMatchObject({ current: SUWAYOMI_VERSION, latest: null, error: 'offline', updatable: false });
        expect(versions.flaresolverr).toEqual({ current: 'v3.5.2', latest: null, error: 'offline', updatable: false });
    });

    it('looks at the helper only when the app runs one, and says whether it can be updated', async () => {
        const { updates } = setup({ helper: makeHelper('v3.5.2') });
        expect((await updates.check()).flaresolverr).toEqual({ current: 'v3.5.2', latest: 'v9.9.9', error: null, updatable: true });
        const same = setup({ helper: makeHelper('v9.9.9') });
        expect((await same.updates.check()).flaresolverr).toMatchObject({ updatable: false });
    });
});

describe('MangaToolUpdates updating the server', () => {
    it('downloads the latest release beside the one that runs, keeps it for the next time and says a restart is needed', async () => {
        const { updates, installs, suwayomiFile } = setup();
        await expect(updates.updateServer()).resolves.toEqual({ ok: true, version: 'v9.0.0' });
        expect(installs).toEqual([
            expect.objectContaining({ id: 'suwayomi', version: 'v9.0.0', url: `${BASE}/${LINUX}`, sha256: HASH, sizeBytes: 350_000_000 })
        ]);
        expect(JSON.parse(readFileSync(suwayomiFile, 'utf-8'))).toEqual({ version: 'v9.0.0', sha256: HASH, sizeBytes: 350_000_000 });
        const versions = await updates.check();
        expect(versions.suwayomi).toMatchObject({ restartNeeded: true, updatable: false });
    });

    it('does nothing when the latest release is the one that runs', async () => {
        const { updates, installs, suwayomiFile } = setup({ fetch: { suwayomi: SUWAYOMI_VERSION } });
        await expect(updates.updateServer()).resolves.toEqual({ ok: false, reason: 'current', message: null });
        expect(installs).toEqual([]);
        expect(existsSync(suwayomiFile)).toBe(false);
    });

    it('keeps the old version and says why when the download fails', async () => {
        const { updates, suwayomiFile } = setup({
            install: () => {
                return Promise.resolve({ ...ready('v9.0.0'), status: 'error', error: { code: 'HASH_MISMATCH', message: 'The downloaded file does not match' } });
            }
        });
        await expect(updates.updateServer()).resolves.toEqual({ ok: false, reason: 'failed', message: 'The downloaded file does not match' });
        expect(existsSync(suwayomiFile)).toBe(false);
        expect((await updates.check()).suwayomi.restartNeeded).toBe(false);
    });

    it('says why when the latest release cannot be found, or the install throws', async () => {
        await expect(setup({ fetch: { fail: true } }).updates.updateServer()).resolves.toEqual({ ok: false, reason: 'failed', message: 'offline' });
        const throwing = setup({
            install: () => {
                return Promise.reject(new Error('disk'));
            }
        });
        await expect(throwing.updates.updateServer()).resolves.toEqual({ ok: false, reason: 'failed', message: 'disk' });
    });

    it('does not start a second update while one is going on', async () => {
        let finish: (state: ToolState) => void = () => {
            return undefined;
        };
        const { updates, installs } = setup({
            install: () => {
                return new Promise((resolve) => {
                    finish = resolve;
                });
            }
        });
        const first = updates.updateServer();
        await vi.waitFor(() => {
            expect(installs).toHaveLength(1);
        });
        await expect(updates.updateServer()).resolves.toEqual({ ok: false, reason: 'busy', message: null });
        finish(ready('v9.0.0'));
        await expect(first).resolves.toEqual({ ok: true, version: 'v9.0.0' });
    });

    it('goes back to the version the app ships with from the next time, and says a restart is needed when another version runs', async () => {
        const { updates, suwayomiFile } = setup({ currentVersion: 'v8.0.0' });
        await updates.updateServer();
        expect(existsSync(suwayomiFile)).toBe(true);
        updates.resetServer();
        expect(existsSync(suwayomiFile)).toBe(false);
        expect((await updates.check()).suwayomi).toMatchObject({ restartNeeded: true, chosen: true });
    });

    it('needs no restart to go back when the version that runs is the one the app ships with', async () => {
        const { updates } = setup();
        updates.resetServer();
        expect((await updates.check()).suwayomi.restartNeeded).toBe(false);
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

    it('says why when the latest version cannot be found', async () => {
        const { updates } = setup({ helper: makeHelper(), fetch: { fail: true } });
        await expect(updates.updateHelper()).resolves.toEqual({ ok: false, reason: 'failed', message: 'offline' });
    });
});
