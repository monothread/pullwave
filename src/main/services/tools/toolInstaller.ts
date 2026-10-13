import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ToolError, ToolErrorCode, ToolId, ToolSpec, ToolState } from '@shared/tools';
import { extractArchive } from './archiveExtract';
import { downloadFile, ToolDownloadError } from './toolDownload';

export const MARKER_FILE = '.pullwave-tool.json';
// How much of the whole job the download is (the rest is the check and the unpacking).
export const DOWNLOAD_SHARE = 85;
const EXTRACT_PERCENT = 90;

export interface ToolInstallerDependencies {
    // <userData>/tools
    rootDirectory: string;
    download?: typeof downloadFile;
    extract?: typeof extractArchive;
    onState?: (state: ToolState) => void;
}

// Looks at what was unpacked before it takes its place (it runs the program, reads the script...) and throws, with the reason, when it is not
// what it should be.
export type InstallVerifier = (directory: string) => Promise<void>;

interface Marker {
    id: string;
    version: string;
    sha256: string;
}

class InstallFailure extends Error {
    constructor(
        readonly code: ToolErrorCode,
        message: string
    ) {
        super(message);
    }
}

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function isDiskError(error: unknown): boolean {
    const code = (error as { code?: unknown } | null)?.code;
    return code === 'ENOSPC' || code === 'EACCES' || code === 'EPERM' || code === 'EROFS' || code === 'EDQUOT';
}

// Puts a program the app needs on the disk: downloads the archive the publisher lists, checks it against the checksum that is
// pinned in the app, unpacks it beside its place and only then moves it in, so what is there is whole or not there at all.
export class ToolInstaller {
    private readonly states = new Map<ToolId, ToolState>();
    private readonly running = new Map<ToolId, Promise<ToolState>>();

    constructor(private readonly deps: ToolInstallerDependencies) {}

    directoryOf(spec: ToolSpec): string {
        return join(this.deps.rootDirectory, spec.id, spec.version);
    }

    pathOf(spec: ToolSpec, relativePath: string): string {
        return join(this.directoryOf(spec), relativePath);
    }

    isReady(spec: ToolSpec): boolean {
        const marker = this.readMarker(spec);
        return marker !== null && marker.version === spec.version && marker.sha256 === spec.sha256 && existsSync(this.pathOf(spec, spec.entry));
    }

    // What is known about a program right now: what its install is doing, otherwise whether it is there.
    stateOf(spec: ToolSpec): ToolState {
        const current = this.states.get(spec.id);
        if (current !== undefined && current.status !== 'ready' && current.status !== 'missing') {
            return { ...current };
        }
        return this.isReady(spec) ? this.baseState(spec, 'ready', 100) : (current ?? this.baseState(spec, 'missing', 0));
    }

    // Installs the program (nothing happens when it is there). Asking again while it goes on waits for the same install.
    // `keepOthers` leaves the versions that are there (the one that runs is not taken away while it runs; `removeOthers` does it later).
    // `verify` looks at the unpacked program before it is put in its place: when it throws, nothing is installed.
    install(spec: ToolSpec, signal?: AbortSignal, keepOthers = false, verify?: InstallVerifier): Promise<ToolState> {
        const existing = this.running.get(spec.id);
        if (existing !== undefined) {
            return existing;
        }
        const job = this.run(spec, signal, keepOthers, verify).finally(() => {
            this.running.delete(spec.id);
        });
        this.running.set(spec.id, job);
        return job;
    }

    private async run(spec: ToolSpec, signal: AbortSignal | undefined, keepOthers: boolean, verify?: InstallVerifier): Promise<ToolState> {
        if (this.isReady(spec)) {
            return this.publish(spec, 'ready', 100);
        }
        const folder = join(this.deps.rootDirectory, spec.id);
        const archive = join(folder, `download-${spec.version}.part`);
        const staging = join(folder, `staging-${spec.version}`);
        try {
            await this.fetchArchive(spec, archive, signal);
            await this.unpack(spec, archive, staging, verify);
            this.complete(spec, staging, folder, keepOthers);
            return this.publish(spec, 'ready', 100);
        } catch (error) {
            rmSync(staging, { recursive: true, force: true });
            rmSync(archive, { force: true });
            if (signal?.aborted === true) {
                return this.publish(spec, 'missing', 0);
            }
            return this.publish(spec, 'error', 0, this.toToolError(error));
        }
    }

    private async fetchArchive(spec: ToolSpec, archive: string, signal?: AbortSignal): Promise<void> {
        this.publish(spec, 'downloading', 0);
        const download = this.deps.download ?? downloadFile;
        const result = await download({
            url: spec.url,
            destination: archive,
            expectedBytes: spec.sizeBytes,
            signal,
            onProgress: (progress) => {
                const share = progress.bytesTotal > 0 ? progress.bytesDone / progress.bytesTotal : 0;
                this.publish(spec, 'downloading', Math.min(DOWNLOAD_SHARE, Math.floor(share * DOWNLOAD_SHARE)), null, progress.bytesDone, progress.bytesTotal);
            }
        });
        this.publish(spec, 'verifying', DOWNLOAD_SHARE);
        if (result.sha256 !== spec.sha256) {
            throw new InstallFailure('HASH_MISMATCH', 'The downloaded file does not match the checksum the app expects');
        }
    }

    private async unpack(spec: ToolSpec, archive: string, staging: string, verify?: InstallVerifier): Promise<void> {
        this.publish(spec, 'extracting', EXTRACT_PERCENT);
        rmSync(staging, { recursive: true, force: true });
        if (spec.format === 'raw') {
            // Nothing to unpack: the file is the program, and it goes where the spec says.
            const target = join(staging, spec.entry);
            mkdirSync(dirname(target), { recursive: true });
            copyFileSync(archive, target);
        } else {
            const extract = this.deps.extract ?? extractArchive;
            await extract(spec.format, archive, { destination: staging, stripComponents: spec.stripComponents, exclude: spec.exclude });
        }
        spec.executables.forEach((relativePath) => {
            const path = join(staging, relativePath);
            if (!existsSync(path)) {
                throw new InstallFailure('INCOMPLETE', `The archive does not have ${relativePath}`);
            }
            if (process.platform !== 'win32') {
                chmodSync(path, 0o755);
            }
        });
        if (!existsSync(join(staging, spec.entry))) {
            throw new InstallFailure('INCOMPLETE', `The archive does not have ${spec.entry}`);
        }
        if (verify !== undefined) {
            try {
                await verify(staging);
            } catch (error) {
                throw new InstallFailure('INVALID', messageOf(error));
            }
        }
        const marker: Marker = { id: spec.id, version: spec.version, sha256: spec.sha256 };
        writeFileSync(join(staging, MARKER_FILE), JSON.stringify(marker), 'utf-8');
    }

    // The staged folder takes the place of the final one in a single rename, and the other versions go.
    private complete(spec: ToolSpec, staging: string, folder: string, keepOthers: boolean): void {
        const final = this.directoryOf(spec);
        rmSync(final, { recursive: true, force: true });
        renameSync(staging, final);
        rmSync(join(folder, `download-${spec.version}.part`), { force: true });
        if (!keepOthers) {
            this.removeOthers(spec);
        }
    }

    // Takes away the versions of the program that are not this one (the folders of the other versions, nothing else).
    removeOthers(spec: ToolSpec): void {
        const folder = join(this.deps.rootDirectory, spec.id);
        let entries;
        try {
            entries = readdirSync(folder, { withFileTypes: true });
        } catch {
            return;
        }
        entries.forEach((entry) => {
            if (entry.isDirectory() && entry.name !== spec.version && !entry.name.startsWith('staging-')) {
                rmSync(join(folder, entry.name), { recursive: true, force: true });
            }
        });
    }

    private readMarker(spec: ToolSpec): Marker | null {
        try {
            return JSON.parse(readFileSync(this.pathOf(spec, MARKER_FILE), 'utf-8')) as Marker;
        } catch {
            return null;
        }
    }

    private toToolError(error: unknown): ToolError {
        if (error instanceof InstallFailure) {
            return { code: error.code, message: error.message };
        }
        if (error instanceof ToolDownloadError) {
            return { code: 'DOWNLOAD_FAILED', message: error.message };
        }
        if (isDiskError(error)) {
            return { code: 'DISK', message: messageOf(error) };
        }
        return { code: 'EXTRACT_FAILED', message: messageOf(error) };
    }

    private baseState(spec: ToolSpec, status: ToolState['status'], percent: number): ToolState {
        return { id: spec.id, status, version: spec.version, bytesDone: 0, bytesTotal: 0, percent, error: null };
    }

    private publish(spec: ToolSpec, status: ToolState['status'], percent: number, error: ToolError | null = null, bytesDone = 0, bytesTotal = 0): ToolState {
        const state: ToolState = { id: spec.id, status, version: spec.version, bytesDone, bytesTotal, percent, error };
        this.states.set(spec.id, state);
        this.deps.onState?.({ ...state });
        return state;
    }
}
