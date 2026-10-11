import type {
    ExtensionAction,
    MangaHelperProblem,
    MangaDetailsWithChapters,
    MangaError,
    MangaExtension,
    MangaExtensionStore,
    MangaFilter,
    MangaListing,
    MangaListRequest,
    MangaPreferenceChange,
    MangaResult,
    MangaServerStatus,
    MangaSource,
    MangaSourcePreference,
    MangaStatusInfo
} from '@shared/manga';
import type { ToolSpec, ToolState } from '@shared/tools';
import { SuwayomiApiError, type SuwayomiClient } from './suwayomiClient';

export interface ServerControl {
    ensureRunning: () => Promise<string>;
    stop: () => Promise<void>;
    readonly status: MangaServerStatus;
    readonly error: string | null;
    readonly baseUrl: string | null;
}

export interface ToolControl {
    isReady: (spec: ToolSpec) => boolean;
    install: (spec: ToolSpec) => Promise<ToolState>;
    stateOf: (spec: ToolSpec) => ToolState;
}

// The program that gets past the check of Cloudflare (FlareSolverr, which runs in Docker).
export interface HelperControl {
    // Checks that Docker is there and pulls the image if it is not.
    prepare: () => Promise<ToolState>;
    // Stops it and removes its image.
    remove: () => Promise<void>;
    stop: () => Promise<void>;
    readonly state: ToolState;
    readonly status: MangaServerStatus;
    readonly failure: MangaHelperProblem | null;
}

export interface MangaServiceDependencies {
    // The program that runs the extensions on this system (null where there is none).
    spec: ToolSpec | null;
    // The program that gets past the check of Cloudflare (null where there is none).
    helper?: HelperControl | null;
    // The address of a FlareSolverr the user runs, when they gave one: the app runs none then.
    externalHelper?: () => string | null;
    // Whether the user installed the helper (it is not installed by itself); installed when this is not given.
    helperEnabled?: () => boolean;
    // The address of the helper (started if it is ready and does not run), or null when there is none to use.
    helperUrl?: () => Promise<string | null>;
    tool: ToolControl;
    server: ServerControl;
    client: () => SuwayomiClient;
    // A server that is already running (the end-to-end tests): nothing is downloaded and nothing is started.
    externalBaseUrl?: string | null;
}

const NOT_INSTALLED = 'The manga server is not installed yet';
const NOT_AVAILABLE = 'The manga section is not available on this system';

export function toMangaError(error: unknown): MangaError {
    if (error instanceof SuwayomiApiError) {
        return { code: error.code, message: error.message };
    }
    return { code: 'UNKNOWN', message: error instanceof Error ? error.message : String(error) };
}

// What the rest of the app asks of the manga side: it hides whether the program is there, whether the server runs, and turns every
// failure into an answer the screen can show.
export class MangaService {
    constructor(private readonly deps: MangaServiceDependencies) {}

    get supported(): boolean {
        return this.deps.externalBaseUrl != null || this.deps.spec !== null;
    }

    get baseUrl(): string | null {
        return this.deps.externalBaseUrl ?? this.deps.server.baseUrl;
    }

    status(): MangaStatusInfo {
        const { spec, helper, tool, server, externalBaseUrl } = this.deps;
        if (externalBaseUrl != null) {
            return { supported: true, tool: null, helper: null, helperProblem: null, helperExternal: false, server: 'running', serverError: null };
        }
        const helperExternal = this.externalHelper() !== null;
        const usesHelper = helper != null && !helperExternal && this.helperEnabled();
        return {
            supported: spec !== null,
            tool: spec === null ? null : tool.stateOf(spec),
            helper: usesHelper ? helper.state : null,
            helperProblem: usesHelper ? helper.failure : null,
            helperExternal,
            server: server.status,
            serverError: server.error
        };
    }

    private helperEnabled(): boolean {
        return this.deps.helperEnabled?.() ?? true;
    }

    private externalHelper(): string | null {
        const address = this.deps.externalHelper?.() ?? '';
        return address.length > 0 ? address : null;
    }

    // Downloads the program that is not there (done when the app opens, and again by hand after a failure) and prepares the one that gets
    // past Cloudflare (Docker, with its image). Answers with the state of the first, which is the one that is needed.
    async install(): Promise<ToolState | null> {
        const { spec, helper, tool, externalBaseUrl } = this.deps;
        if (spec === null || externalBaseUrl != null) {
            return null;
        }
        const state = await tool.install(spec);
        if (helper != null && this.externalHelper() === null && this.helperEnabled()) {
            await helper.prepare();
        }
        await this.applyHelper();
        return state;
    }

    // Installs the helper for Cloudflare (the user asked for it in the settings): Docker is checked and the image is pulled.
    async installHelper(): Promise<void> {
        await this.deps.helper?.prepare();
        await this.applyHelper();
    }

    // Removes the helper (the user asked for it in the settings): the container is stopped and the image removed.
    async removeHelper(): Promise<void> {
        await this.deps.helper?.remove();
        await this.applyHelper();
    }

    // The server may have started before the helper was there (opening the section is enough to start it): once the helper is ready the
    // server that runs is told to use it. A server that is not running reads it from its settings when it starts.
    // Also done when the user changes the address of their own FlareSolverr.
    async applyHelper(): Promise<void> {
        if (this.deps.server.status !== 'running' || this.deps.helperUrl === undefined) {
            return;
        }
        try {
            await this.deps.client().setFlareSolverr(await this.deps.helperUrl());
        } catch {
            // The sites behind Cloudflare keep answering that the bypass is off; nothing else is affected.
        }
    }

    // The address of the server, started if it does not run. Fails when the program has not been downloaded yet.
    async requireServer(): Promise<string> {
        const { spec, tool, server, externalBaseUrl } = this.deps;
        if (externalBaseUrl != null) {
            return externalBaseUrl;
        }
        if (spec === null) {
            throw new Error(NOT_AVAILABLE);
        }
        if (!tool.isReady(spec)) {
            throw new Error(NOT_INSTALLED);
        }
        return server.ensureRunning();
    }

    // Starts the server in the background so what is asked next does not wait for it.
    warmUp(): void {
        this.requireServer().catch(() => {
            return undefined;
        });
    }

    // Whether the server or the container of the helper is up (the app waits for them to end before it quits).
    get hasProcessesToEnd(): boolean {
        return this.deps.server.status !== 'stopped' || (this.deps.helper != null && this.deps.helper.status !== 'stopped');
    }

    async shutdown(): Promise<void> {
        await Promise.all([this.deps.server.stop(), this.deps.helper?.stop()]);
    }

    stores(): Promise<MangaResult<MangaExtensionStore[]>> {
        return this.call((client) => {
            return client.stores();
        });
    }

    addStore(indexUrl: string): Promise<MangaResult<MangaExtensionStore>> {
        return this.call((client) => {
            return client.addStore(indexUrl);
        });
    }

    removeStore(indexUrl: string): Promise<MangaResult<null>> {
        return this.call(async (client) => {
            await client.removeStore(indexUrl);
            return null;
        });
    }

    extensions(refresh: boolean): Promise<MangaResult<MangaExtension[]>> {
        return this.call((client) => {
            return refresh ? client.refreshExtensions() : client.extensions();
        });
    }

    changeExtension(pkgName: string, action: ExtensionAction): Promise<MangaResult<null>> {
        return this.call(async (client) => {
            await client.changeExtension(pkgName, action);
            return null;
        });
    }

    // Updates every installed extension that has an update, and answers with how many there were.
    updateAllExtensions(): Promise<MangaResult<number>> {
        return this.call(async (client) => {
            const outdated = (await client.extensions())
                .filter((extension) => {
                    return extension.isInstalled && extension.hasUpdate;
                })
                .map((extension) => {
                    return extension.pkgName;
                });
            if (outdated.length > 0) {
                await client.updateExtensions(outdated);
            }
            return outdated.length;
        });
    }

    sources(): Promise<MangaResult<MangaSource[]>> {
        return this.call((client) => {
            return client.sources();
        });
    }

    sourcePreferences(sourceId: string): Promise<MangaResult<MangaSourcePreference[]>> {
        return this.call((client) => {
            return client.sourcePreferences(sourceId);
        });
    }

    sourceFilters(sourceId: string): Promise<MangaResult<MangaFilter[]>> {
        return this.call((client) => {
            return client.sourceFilters(sourceId);
        });
    }

    setSourcePreference(change: MangaPreferenceChange): Promise<MangaResult<MangaSourcePreference[]>> {
        return this.call((client) => {
            return client.setSourcePreference(change);
        });
    }

    list(request: MangaListRequest): Promise<MangaResult<MangaListing>> {
        return this.call((client) => {
            return client.list(request);
        });
    }

    details(remoteId: number): Promise<MangaResult<MangaDetailsWithChapters>> {
        return this.call((client) => {
            return client.mangaWithChapters(remoteId);
        });
    }

    // The addresses of the pages of a chapter (used by the downloads, which handle the failure themselves).
    pagesOf(chapterRemoteId: number): Promise<string[]> {
        return this.deps.client().chapterPages(chapterRemoteId);
    }

    private async call<T>(operation: (client: SuwayomiClient) => Promise<T>): Promise<MangaResult<T>> {
        try {
            return { ok: true, value: await operation(this.deps.client()) };
        } catch (error) {
            return { ok: false, error: toMangaError(error) };
        }
    }
}
