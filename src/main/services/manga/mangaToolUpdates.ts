import type { MangaToolUpdateResult, MangaToolVersions, ToolVersionInfo } from '@shared/manga';
import type { ToolState } from '@shared/tools';
import { fetchLatestFlareSolverr, writeSelectedFlareSolverr } from '../tools/flaresolverrUpdate';

export interface ToolUpdatesHelper {
    readonly version: string;
    switchTo: (version: string) => Promise<ToolState>;
}

export interface ToolUpdatesDependencies {
    flaresolverrFile: string;
    helper: () => ToolUpdatesHelper | null;
    helperChanged: () => Promise<void>;
    fetchImpl?: typeof fetch;
}

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

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
