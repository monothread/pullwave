import type { MangaToolUpdateResult, MangaToolVersions, ToolVersionInfo } from '@shared/manga';
import type { ToolState } from '@shared/tools';
import { fetchLatestFlareSolverr, writeSelectedFlareSolverr } from '../tools/flaresolverrUpdate';

export interface ToolUpdatesHelper {
    readonly version: string;
    switchTo: (version: string) => Promise<ToolState>;
}

export interface ToolUpdatesDependencies {
    // The file that keeps which version of the helper is used from the next time the app opens.
    flaresolverrFile: string;
    // The helper for Cloudflare when the app runs one (null: none, or the user runs their own).
    helper: () => ToolUpdatesHelper | null;
    // Called once the helper runs another version (the server that runs is told to use it).
    helperChanged: () => Promise<void>;
    fetchImpl?: typeof fetch;
}

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

// Looks for a newer helper for Cloudflare (the latest release of FlareSolverr) and moves to it when the user asks: it is switched at once. The
// manga server is not updated from the app: it stays at the version the app ships with (see suwayomiRelease.ts), which a release of the app
// moves after it was tried.
export class MangaToolUpdates {
    private updating = false;

    constructor(private readonly deps: ToolUpdatesDependencies) {}

    async check(): Promise<MangaToolVersions> {
        return { flaresolverr: await this.checkHelper() };
    }

    private async checkHelper(): Promise<ToolVersionInfo | null> {
        const helper = this.deps.helper();
        if (helper === null) {
            return null;
        }
        try {
            const latest = await fetchLatestFlareSolverr(this.deps.fetchImpl);
            return { current: helper.version, latest, error: null, updatable: latest !== helper.version };
        } catch (error) {
            return { current: helper.version, latest: null, error: messageOf(error), updatable: false };
        }
    }

    async updateHelper(): Promise<MangaToolUpdateResult> {
        const helper = this.deps.helper();
        if (helper === null) {
            return { ok: false, reason: 'not-installed', message: null };
        }
        if (this.updating) {
            return { ok: false, reason: 'busy', message: null };
        }
        this.updating = true;
        try {
            const latest = await fetchLatestFlareSolverr(this.deps.fetchImpl);
            if (latest === helper.version) {
                return { ok: false, reason: 'current', message: null };
            }
            const state = await helper.switchTo(latest);
            if (state.status !== 'ready' || helper.version !== latest) {
                return { ok: false, reason: 'failed', message: state.error?.message ?? null };
            }
            writeSelectedFlareSolverr(this.deps.flaresolverrFile, latest);
            await this.deps.helperChanged();
            return { ok: true, version: latest };
        } catch (error) {
            return { ok: false, reason: 'failed', message: messageOf(error) };
        } finally {
            this.updating = false;
        }
    }
}
