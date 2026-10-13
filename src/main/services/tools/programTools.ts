import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROGRAM_IDS, type ProgramId, type ToolError, type ToolSpec, type ToolState } from '@shared/tools';
import type { AniPatchName, ProgramInfo, ProgramResetResult, ProgramsStatus, ProgramUpdateResult, ProgramVersionInfo, ProgramVersions } from '@shared/programs';
import type { extractArchive } from './archiveExtract';
import {
    defaultLatestDependencies,
    latestAniCli,
    latestDeno,
    latestFfmpeg,
    latestYtdlp,
    LookupError,
    MAX_SIZES,
    type LatestDependencies
} from './programLatest';
import {
    aniCliSpec,
    denoSpec,
    FFMPEG_ASSETS,
    ffmpegSpec,
    isProgramVersion,
    pinnedSpec,
    programPlatform,
    ytdlpSpec,
    type ProgramPlatform
} from './programSpecs';
import type { downloadFile } from './toolDownload';
import { ToolInstaller, type InstallVerifier } from './toolInstaller';

// The programs the app downloads for itself: the video downloader's (yt-dlp, deno, ffmpeg) and the anime section's (ani-cli, busybox, curl).
// Each one is installed once, on the first run, in a folder of its own inside the data folder of the app (so none of the user's own programs
// is ever picked up by mistake), and can be moved to the latest version from the settings. The version chosen is remembered in a small file;
// what the file says is checked before it is used, and the address of the download is always built here from it.

export const SELECTED_SUFFIX = '-selected.json';
// How many programs are downloaded at the same time.
export const PREPARE_CONCURRENCY = 2;
const RUN_TIMEOUT_MS = 20_000;

export type RunProgram = (file: string, args: string[]) => Promise<{ ok: boolean; output: string }>;

export function defaultRunProgram(file: string, args: string[]): Promise<{ ok: boolean; output: string }> {
    return new Promise((resolve) => {
        execFile(file, args, { timeout: RUN_TIMEOUT_MS }, (error, stdout, stderr) => {
            resolve({ ok: error === null, output: `${stdout}${stderr}`.trim() || (error?.message ?? '') });
        });
    });
}

export interface ProgramToolsDependencies {
    // <data folder>/tools
    rootDirectory: string;
    platform?: NodeJS.Platform;
    arch?: string;
    // The path the user chose for a program in the settings ('' for none): nothing is downloaded for a program that has one.
    customPath?: (id: ProgramId) => string;
    // Told every time what the install of a program the app runs is doing.
    onState?: (state: ToolState) => void;
    // Told what the download of an update is doing (kept apart: while it goes on, the program that is installed still works).
    onUpdateState?: (state: ToolState) => void;
    download?: typeof downloadFile;
    extract?: typeof extractArchive;
    latest?: LatestDependencies;
    run?: RunProgram;
}

// What is written about the version that was chosen: enough to build its spec again.
export interface Selected {
    version: string;
    sha256: string;
    sizeBytes: number;
    // The name of the file of the release (ffmpeg on Linux).
    asset?: string;
}

const UPDATABLE: readonly ProgramId[] = ['ytdlp', 'deno', 'ffmpeg', 'anicli'];

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function runWithLimit<T>(items: readonly T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
    let next = 0;
    const worker = async (): Promise<void> => {
        while (next < items.length) {
            const item = items[next] as T;
            next += 1;
            await task(item);
        }
    };
    return Promise.all(
        Array.from({ length: Math.min(limit, items.length) }, () => {
            return worker();
        })
    ).then(() => {
        return undefined;
    });
}

export class ProgramTools {
    private readonly installer: ToolInstaller;
    private readonly updater: ToolInstaller;
    // Why a program that has no version to install yet (ffmpeg, before its first look for the latest) could not be installed.
    private readonly failures = new Map<ProgramId, ToolError>();
    private readonly updating = new Set<ProgramId>();
    private readonly platform: NodeJS.Platform;
    private readonly arch: string;

    constructor(private readonly deps: ProgramToolsDependencies) {
        this.platform = deps.platform ?? process.platform;
        this.arch = deps.arch ?? process.arch;
        const common = { rootDirectory: deps.rootDirectory, download: deps.download, extract: deps.extract };
        this.installer = new ToolInstaller({ ...common, onState: deps.onState });
        this.updater = new ToolInstaller({ ...common, onState: deps.onUpdateState });
    }

    // The system the programs are made for, or null.
    get system(): ProgramPlatform | null {
        return programPlatform(this.platform, this.arch);
    }

    get rootDirectory(): string {
        return this.deps.rootDirectory;
    }

    // ----- the version that was chosen -----

    private selectedPath(id: ProgramId): string {
        return join(this.deps.rootDirectory, `${id}${SELECTED_SUFFIX}`);
    }

    readSelected(id: ProgramId): Selected | null {
        if (!UPDATABLE.includes(id)) {
            return null;
        }
        let parsed: unknown;
        try {
            parsed = JSON.parse(readFileSync(this.selectedPath(id), 'utf-8'));
        } catch {
            return null;
        }
        if (!isRecord(parsed)) {
            return null;
        }
        const { version, sha256, sizeBytes, asset } = parsed;
        if (typeof version !== 'string' || !isProgramVersion(id, version) || typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) {
            return null;
        }
        if (typeof sizeBytes !== 'number' || !Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_SIZES[id]) {
            return null;
        }
        if (asset !== undefined && (typeof asset !== 'string' || this.system === null || !FFMPEG_ASSETS[this.system].test(asset))) {
            return null;
        }
        return asset === undefined ? { version, sha256, sizeBytes } : { version, sha256, sizeBytes, asset };
    }

    private writeSelected(id: ProgramId, spec: ToolSpec): void {
        const selected: Selected = { version: spec.version, sha256: spec.sha256, sizeBytes: spec.sizeBytes };
        if (id === 'ffmpeg') {
            selected.asset = spec.url.slice(spec.url.lastIndexOf('/') + 1);
        }
        mkdirSync(this.deps.rootDirectory, { recursive: true });
        const temporary = `${this.selectedPath(id)}.part`;
        writeFileSync(temporary, JSON.stringify(selected), 'utf-8');
        renameSync(temporary, this.selectedPath(id));
    }

    private clearSelected(id: ProgramId): void {
        rmSync(this.selectedPath(id), { force: true });
    }

    private fromSelected(id: ProgramId, selected: Selected): ToolSpec | null {
        const system = this.system;
        if (system === null) {
            return null;
        }
        switch (id) {
            case 'ytdlp':
                return ytdlpSpec(selected.version, selected.sha256, selected.sizeBytes, system);
            case 'deno':
                return denoSpec(selected.version, selected.sha256, selected.sizeBytes, system);
            case 'anicli':
                return aniCliSpec(selected.version, selected.sha256, selected.sizeBytes);
            case 'ffmpeg':
                return ffmpegSpec(system, selected.asset ?? '', selected.sha256, selected.sizeBytes);
            default:
                return null;
        }
    }

    // The version the app uses: the one that was chosen, otherwise the one the app was made with (ffmpeg has none until it is installed).
    chosenSpec(id: ProgramId): ToolSpec | null {
        const selected = this.readSelected(id);
        const spec = selected === null ? null : this.fromSelected(id, selected);
        return spec ?? pinnedSpec(id, this.platform, this.arch);
    }

    // ----- what is installed -----

    private custom(id: ProgramId): boolean {
        return (this.deps.customPath?.(id) ?? '') !== '';
    }

    private emptyState(id: ProgramId, status: ToolState['status'], error: ToolError | null = null): ToolState {
        return { id, status, version: null, bytesDone: 0, bytesTotal: 0, percent: 0, error };
    }

    stateOf(id: ProgramId): ToolState {
        if (this.system === null) {
            return this.emptyState(id, 'error', { code: 'UNSUPPORTED_PLATFORM', message: `The program is not made for ${this.platform} ${this.arch}` });
        }
        const spec = this.chosenSpec(id);
        if (spec === null) {
            const failure = this.failures.get(id);
            return failure === undefined ? this.emptyState(id, 'missing') : this.emptyState(id, 'error', failure);
        }
        return this.installer.stateOf(spec);
    }

    // The folder of the version that is installed, null while it is not.
    directoryOf(id: ProgramId): string | null {
        const spec = this.chosenSpec(id);
        return spec !== null && this.installer.isReady(spec) ? this.installer.directoryOf(spec) : null;
    }

    // The file of the program (or another one of the same install, like ffprobe) when it is installed, otherwise null.
    pathOf(id: ProgramId, relativePath?: string): string | null {
        const spec = this.chosenSpec(id);
        return spec !== null && this.installer.isReady(spec) ? this.installer.pathOf(spec, relativePath ?? spec.entry) : null;
    }

    // Where the file will be once the program is installed (the version that is chosen), whether or not it is there; null for ffmpeg before
    // its version is known.
    expectedPathOf(id: ProgramId, relativePath?: string): string | null {
        const spec = this.chosenSpec(id);
        return spec === null ? null : this.installer.pathOf(spec, relativePath ?? spec.entry);
    }

    isReady(id: ProgramId): boolean {
        return this.pathOf(id) !== null;
    }

    status(): ProgramsStatus {
        const programs: ProgramInfo[] = PROGRAM_IDS.map((id) => {
            return { id, state: this.stateOf(id), custom: this.custom(id), directory: this.directoryOf(id) };
        });
        return { supported: this.system !== null, programs };
    }

    // ----- installing -----

    // What looks at a program once it is unpacked, before it is put in its place: it has to run (a script has to be one the shell accepts).
    private verifierFor(spec: ToolSpec): InstallVerifier {
        const run = this.deps.run ?? defaultRunProgram;
        return async (directory) => {
            const file = join(directory, spec.entry);
            if (spec.id === 'anicli') {
                // The shell is the one that is installed; without it there is nothing to check with (the script was looked at already).
                const shell = this.pathOf('busybox');
                if (shell !== null && !(await run(shell, ['sh', '-n', file])).ok) {
                    throw new Error('The shell does not accept the script of ani-cli');
                }
                return;
            }
            const args: Record<Exclude<ProgramId, 'anicli'>, string[]> = { ytdlp: ['--version'], deno: ['--version'], ffmpeg: ['-version'], busybox: ['true'], curl: ['--version'] };
            const result = await run(file, args[spec.id as Exclude<ProgramId, 'anicli'>]);
            if (!result.ok) {
                throw new Error(`The program does not run: ${result.output}`);
            }
        };
    }

    // The version of ffmpeg to install the first time: the latest one (there is no other: the builds are rolling).
    private async firstSpec(id: ProgramId): Promise<ToolSpec | null> {
        const system = this.system;
        if (id !== 'ffmpeg' || system === null) {
            return null;
        }
        try {
            const { spec } = await this.lookup(id);
            this.writeSelected(id, spec);
            this.failures.delete(id);
            return spec;
        } catch (error) {
            const failure: ToolError = {
                code: error instanceof LookupError && error.reason !== 'failed' ? 'INVALID' : 'DOWNLOAD_FAILED',
                message: messageOf(error)
            };
            this.failures.set(id, failure);
            this.deps.onState?.(this.emptyState(id, 'error', failure));
            return null;
        }
    }

    // Installs the version that is chosen (nothing happens when it is there). It is also what TRY AGAIN does after a failure.
    async install(id: ProgramId): Promise<ToolState> {
        if (this.system === null) {
            return this.stateOf(id);
        }
        let spec = this.chosenSpec(id);
        // The builds of ffmpeg are rolling: what a failure left chosen may be gone, so it is looked up again.
        if (id === 'ffmpeg' && (spec === null || !this.installer.isReady(spec))) {
            spec = (await this.firstSpec(id)) ?? spec;
        }
        if (spec === null) {
            return this.stateOf(id);
        }
        this.failures.delete(id);
        return this.installer.install(spec, undefined, true, this.verifierFor(spec));
    }

    // Takes away what is installed of the program and installs it again (for a program that no longer runs, or is damaged).
    async reinstall(id: ProgramId): Promise<ToolState> {
        const spec = this.chosenSpec(id);
        if (spec !== null) {
            rmSync(this.installer.directoryOf(spec), { recursive: true, force: true });
        }
        return this.install(id);
    }

    // Takes the other versions away (best effort: one that is in use cannot be deleted on Windows, and goes at the next start).
    private tidy(id: ProgramId): void {
        const spec = this.chosenSpec(id);
        if (spec !== null && this.installer.isReady(spec)) {
            try {
                this.installer.removeOthers(spec);
            } catch {
                // It is tried again the next time.
            }
        }
    }

    // Installs what is missing, two at a time (the ones the user gave a path for are left out), when the app opens.
    async prepare(ids: readonly ProgramId[] = PROGRAM_IDS): Promise<void> {
        if (this.system === null) {
            return;
        }
        const wanted = ids.filter((id) => {
            return !this.custom(id);
        });
        await runWithLimit(wanted, PREPARE_CONCURRENCY, async (id) => {
            const state = await this.install(id);
            if (state.status === 'ready') {
                this.tidy(id);
            }
        });
    }

    // ----- the latest version -----

    private async lookup(id: ProgramId): Promise<{ spec: ToolSpec; unfit: AniPatchName[] }> {
        const system = this.system as ProgramPlatform;
        const deps = this.deps.latest ?? defaultLatestDependencies;
        switch (id) {
            case 'ytdlp':
                return { spec: await latestYtdlp(system, deps), unfit: [] };
            case 'deno':
                return { spec: await latestDeno(system, deps), unfit: [] };
            case 'ffmpeg':
                return { spec: await latestFfmpeg(system, deps), unfit: [] };
            case 'anicli': {
                const found = await latestAniCli(deps);
                return { spec: found.spec, unfit: found.unfit };
            }
            default:
                throw new LookupError('no-release', 'This program has no newer version');
        }
    }

    private async versionInfo(id: ProgramId): Promise<ProgramVersionInfo> {
        const chosen = this.chosenSpec(id);
        const base = pinnedSpec(id, this.platform, this.arch);
        const info: ProgramVersionInfo = {
            id,
            current: chosen?.version ?? null,
            latest: null,
            updatable: false,
            base: base?.version ?? null,
            chosen: base !== null && chosen !== null && chosen.version !== base.version,
            error: null,
            errorMessage: null,
            unfit: []
        };
        if (this.system === null || !UPDATABLE.includes(id) || this.custom(id)) {
            return info;
        }
        try {
            const found = await this.lookup(id);
            info.latest = found.spec.version;
            info.updatable = found.spec.version !== info.current;
            info.unfit = found.unfit;
        } catch (error) {
            info.error = error instanceof LookupError ? error.reason : 'failed';
            info.errorMessage = messageOf(error);
        }
        return info;
    }

    // Looks, for every program, at the latest version the publisher has.
    async check(): Promise<ProgramVersions> {
        const infos = await Promise.all(
            PROGRAM_IDS.map((id) => {
                return this.versionInfo(id);
            })
        );
        return Object.fromEntries(
            infos.map((info) => {
                return [info.id, info];
            })
        ) as ProgramVersions;
    }

    // Downloads the latest version beside the one that is installed (which keeps working), checks that it runs, and only then makes it the one
    // that is used. When anything fails the one that was there stays.
    async update(id: ProgramId): Promise<ProgramUpdateResult> {
        if (this.system === null || !UPDATABLE.includes(id)) {
            return { ok: false, reason: 'unsupported', message: 'This program has no newer version to move to' };
        }
        if (this.custom(id)) {
            return { ok: false, reason: 'custom', message: 'A program chosen in the settings is not looked after by the app' };
        }
        if (this.updating.has(id)) {
            return { ok: false, reason: 'busy', message: 'An update of this program is going on' };
        }
        this.updating.add(id);
        try {
            let found;
            try {
                found = await this.lookup(id);
            } catch (error) {
                return error instanceof LookupError
                    ? { ok: false, reason: 'lookup', message: error.message, lookup: error.reason }
                    : { ok: false, reason: 'failed', message: messageOf(error) };
            }
            const current = this.chosenSpec(id);
            if (current !== null && current.version === found.spec.version && this.installer.isReady(current)) {
                return { ok: false, reason: 'current', message: current.version };
            }
            const state = await this.updater.install(found.spec, undefined, true, this.verifierFor(found.spec));
            if (state.status !== 'ready') {
                return { ok: false, reason: 'failed', message: state.error?.message ?? 'The update could not be installed' };
            }
            this.writeSelected(id, found.spec);
            this.failures.delete(id);
            this.deps.onState?.({ ...state, id });
            this.tidy(id);
            return { ok: true, version: found.spec.version };
        } catch (error) {
            return { ok: false, reason: 'failed', message: messageOf(error) };
        } finally {
            this.updating.delete(id);
        }
    }

    // Goes back to the version the app was made with: what the update chose is forgotten (and that version is installed if it is not there).
    async reset(id: ProgramId): Promise<ProgramResetResult> {
        if (this.system === null) {
            return { ok: false, reason: 'unsupported', message: 'The programs are not made for this system' };
        }
        if (this.custom(id)) {
            return { ok: false, reason: 'custom', message: 'A program chosen in the settings is not looked after by the app' };
        }
        if (pinnedSpec(id, this.platform, this.arch) === null || this.readSelected(id) === null) {
            return { ok: false, reason: 'none', message: 'There is no other version chosen' };
        }
        this.clearSelected(id);
        const state = await this.install(id);
        if (state.status !== 'ready') {
            return { ok: false, reason: 'failed', message: state.error?.message ?? 'The version of the app could not be installed' };
        }
        this.tidy(id);
        return { ok: true };
    }
}
