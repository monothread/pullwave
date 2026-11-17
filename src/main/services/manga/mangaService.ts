import type {
    ExtensionAction,
    MangaHelperProblem,
    MangaChapter,
    MangaDetailsWithChapters,
    MangaError,
    MangaExtension,
    MangaExtensionStore,
    ComponentHealth,
    MangaFilter,
    MangaHealth,
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
import { describeError } from '../errorDetails';
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

export interface HelperControl {
    prepare: () => Promise<ToolState>;
    remove: () => Promise<void>;
    stop: () => Promise<void>;
    readonly state: ToolState;
    readonly status: MangaServerStatus;
    readonly failure: MangaHelperProblem | null;
    readonly baseUrl: string | null;
    readonly version: string;
    ensureRunning: () => Promise<string>;
}

export interface MangaServiceDependencies {
    spec: ToolSpec | null;
    helper?: HelperControl | null;
    externalHelper?: () => string | null;
    helperEnabled?: () => boolean;
    helperUrl?: () => Promise<string | null>;
    tool: ToolControl;
    server: ServerControl;
    client: () => SuwayomiClient;
    externalBaseUrl?: string | null;
}

export const PROBE_TIMEOUT_MS = 4000;

export async function probeHelper(address: string, external: boolean, version: string | null = null): Promise<ComponentHealth> {
    try {
        const response = await fetch(`${address}/`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
        if (!response.ok) {
            return { state: 'unhealthy', version, message: `It answered ${String(response.status)}`, external };
        }
        const body = (await response.json().catch(() => {return null})) as { version?: unknown } | null;
        const reported = typeof body?.version === 'string' && body.version.length > 0 ? body.version.slice(0, 40) : null;
        return { state: 'healthy', version: reported ?? version, message: null, external };
    } catch (error) {
        return { state: 'unhealthy', version, message: error instanceof Error ? error.message : String(error), external };
    }
}

const NOT_INSTALLED = 'The manga server is not installed yet';
const NOT_AVAILABLE = 'The manga section is not available on this system';

export function toMangaError(error: unknown): MangaError {
    if (error instanceof SuwayomiApiError) {
        return { code: error.code, message: error.message, details: describeError(error, error.known) };
    }
    return { code: 'UNKNOWN', message: error instanceof Error ? error.message : String(error), details: describeError(error) };
}

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

    async health(start: boolean): Promise<MangaHealth> {
        const [server, helper] = await Promise.all([this.serverHealth(start), this.helperHealth(start)]);
        return { server, helper };
    }

    async restartPrograms(): Promise<MangaHealth> {
        const { server, helper, externalBaseUrl } = this.deps;
        if (externalBaseUrl == null) {
            await Promise.all([server.stop(), helper?.stop()]);
        }
        const health = await this.health(true);
        await this.applyHelper();
        return health;
    }

    private async serverHealth(start: boolean): Promise<ComponentHealth> {
        const { spec, tool, server, externalBaseUrl } = this.deps;
        const base = { version: null, message: null, external: false };
        if (externalBaseUrl == null) {
            if (spec === null || !tool.isReady(spec)) {
                return { ...base, state: 'not-installed' };
            }
            if (server.status === 'starting') {
                return { ...base, state: 'starting' };
            }
            if (server.status === 'error' && !start) {
                return { ...base, state: 'unhealthy', message: server.error };
            }
            if (server.status === 'stopped' && !start) {
                return { ...base, state: 'stopped' };
            }
        }
        try {
            return { ...base, state: 'healthy', version: await this.deps.client().serverVersion() };
        } catch (error) {
            return { ...base, state: 'unhealthy', message: toMangaError(error).message };
        }
    }

    private async helperHealth(start: boolean): Promise<ComponentHealth | null> {
        const { helper } = this.deps;
        const own = this.externalHelper();
        if (own !== null) {
            return probeHelper(own, true);
        }
        if (helper == null || !this.helperEnabled()) {
            return null;
        }
        const base = { version: helper.version, message: null, external: false };
        if (start && (helper.failure !== null || helper.state.status === 'error')) {
            await helper.prepare();
        }
        if (helper.failure !== null) {
            return { ...base, state: 'unhealthy', message: helper.failure.message };
        }
        const { status } = helper.state;
        if (status === 'downloading' || status === 'verifying' || status === 'extracting') {
            return { ...base, state: 'starting' };
        }
        if (status !== 'ready') {
            return { ...base, state: status === 'error' ? 'unhealthy' : 'not-installed', message: helper.state.error?.message ?? null };
        }
        if (helper.status === 'starting') {
            return { ...base, state: 'starting' };
        }
        if (helper.status === 'running' && helper.baseUrl !== null) {
            const probed = await probeHelper(helper.baseUrl, false, helper.version);
            if (probed.state === 'healthy' || !start) {
                return probed;
            }
            await helper.stop();
        }
        if (!start) {
            return { ...base, state: 'stopped' };
        }
        try {
            return await probeHelper(await helper.ensureRunning(), false, helper.version);
        } catch (error) {
            return { ...base, state: 'unhealthy', message: error instanceof Error ? error.message : String(error) };
        }
    }

    private externalHelper(): string | null {
        const address = this.deps.externalHelper?.() ?? '';
        return address.length > 0 ? address : null;
    }

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

    async installHelper(): Promise<void> {
        await this.deps.helper?.prepare();
        await this.applyHelper();
    }

    async removeHelper(): Promise<void> {
        await this.deps.helper?.remove();
        await this.applyHelper();
    }

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

    warmUp(): void {
        this.requireServer().catch(() => {
            return undefined;
        });
    }

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

    chaptersByIds(chapterRemoteIds: readonly number[]): Promise<MangaResult<MangaChapter[]>> {
        return this.call((client) => {
            return client.chaptersByIds(chapterRemoteIds);
        });
    }

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
