import type { MangaToolUpdateResult, MangaToolVersions, ToolVersionInfo } from '@shared/manga';
import type { ToolSpec, ToolState } from '@shared/tools';
import { fetchLatestFlareSolverr, writeSelectedFlareSolverr } from '../tools/flaresolverrUpdate';
import { clearSelectedSuwayomi, fetchLatestSuwayomi, writeSelectedSuwayomi } from '../tools/suwayomiUpdate';
import { suwayomiReleaseSpec, suwayomiSpec } from '../tools/suwayomiRelease';

export interface ToolUpdatesHelper {
    readonly version: string;
    switchTo: (version: string) => Promise<ToolState>;
}

export interface ToolUpdatesDependencies {
    platform: NodeJS.Platform;
    arch: string;
    // The program that runs now, and the files that keep which release is used from the next time the app opens.
    currentSpec: ToolSpec | null;
    suwayomiFile: string;
    flaresolverrFile: string;
    // Downloads a release without taking away the version that runs (see `ToolInstaller.install`).
    install: (spec: ToolSpec) => Promise<ToolState>;
    // The helper for Cloudflare when the app runs one (null: none, or the user runs their own).
    helper: () => ToolUpdatesHelper | null;
    // Called once the helper runs another version (the server that runs is told to use it).
    helperChanged: () => Promise<void>;
    fetchImpl?: typeof fetch;
}

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

// Looks for newer versions of the server and of the helper, and moves to them when the user asks: the latest release of each project.
// The server is downloaded beside the one that runs and used from the next time the app opens; the helper is switched at once.
export class MangaToolUpdates {
    private downloaded: string | null = null;
    private updating = false;

    constructor(private readonly deps: ToolUpdatesDependencies) {}

    private get bundledVersion(): string {
        return suwayomiSpec(this.deps.platform, this.deps.arch)?.version ?? '';
    }

    private get currentVersion(): string {
        return this.deps.currentSpec?.version ?? '';
    }

    async check(): Promise<MangaToolVersions> {
        const [suwayomi, flaresolverr] = await Promise.all([this.checkServer(), this.checkHelper()]);
        return {
            suwayomi: {
                ...suwayomi,
                chosen: this.currentVersion !== this.bundledVersion,
                bundled: this.bundledVersion,
                restartNeeded: this.downloaded !== null && this.downloaded !== this.currentVersion
            },
            flaresolverr
        };
    }

    private async checkServer(): Promise<ToolVersionInfo> {
        try {
            const release = await fetchLatestSuwayomi(this.deps.platform, this.deps.arch, this.deps.fetchImpl);
            return { current: this.currentVersion, latest: release?.version ?? null, error: null, updatable: release !== null && release.version !== this.currentVersion && release.version !== this.downloaded };
        } catch (error) {
            return { current: this.currentVersion, latest: null, error: messageOf(error), updatable: false };
        }
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

    async updateServer(): Promise<MangaToolUpdateResult> {
        if (this.updating) {
            return { ok: false, reason: 'busy', message: null };
        }
        this.updating = true;
        try {
            const release = await fetchLatestSuwayomi(this.deps.platform, this.deps.arch, this.deps.fetchImpl);
            const spec = release === null ? null : suwayomiReleaseSpec(this.deps.platform, this.deps.arch, release);
            if (release === null || spec === null) {
                return { ok: false, reason: 'unsupported', message: null };
            }
            if (release.version === this.currentVersion) {
                return { ok: false, reason: 'current', message: null };
            }
            const state = await this.deps.install(spec);
            if (state.status !== 'ready') {
                return { ok: false, reason: 'failed', message: state.error?.message ?? null };
            }
            writeSelectedSuwayomi(this.deps.suwayomiFile, release);
            this.downloaded = release.version;
            return { ok: true, version: release.version };
        } catch (error) {
            return { ok: false, reason: 'failed', message: messageOf(error) };
        } finally {
            this.updating = false;
        }
    }

    // Goes back to the version the app ships with, from the next time the app opens.
    resetServer(): void {
        clearSelectedSuwayomi(this.deps.suwayomiFile);
        this.downloaded = this.bundledVersion;
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
