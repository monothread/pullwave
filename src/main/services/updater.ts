import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import type { Settings, UpdateResult } from '@shared/types';
import type { BinaryResolver } from './binaryResolver';
import { translateMain } from './language';
import { verifyYtdlpSums } from './ytdlpSignature';

const UPDATE_TIMEOUT_MS = 120000;
const RELEASE_API_URL = 'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest';
const RELEASE_DOWNLOAD_URL = 'https://github.com/yt-dlp/yt-dlp/releases/download';
const ASSET_NAMES: Partial<Record<NodeJS.Platform, string>> = { linux: 'yt-dlp_linux', win32: 'yt-dlp.exe' };
const CHECKSUMS_NAME = 'SHA2-256SUMS';
const SIGNATURE_NAME = 'SHA2-256SUMS.sig';
const USER_AGENT = 'pullwave';

// How long a request may take and how much it may bring: a stalled connection does not hold the update forever, and something far bigger
// than a release (a binary is a few tens of megabytes) is not one.
export const TEXT_TIMEOUT_MS = 30000;
export const BINARY_TIMEOUT_MS = 300000;
export const MAX_TEXT_BYTES = 1_000_000;
export const MAX_SIGNATURE_BYTES = 65_536;
export const MAX_BINARY_BYTES = 200_000_000;

export type UpdateExecFn = (file: string, args: string[]) => Promise<{ ok: boolean; output: string }>;

export interface UpdaterDependencies {
    exec: UpdateExecFn;
    fetchText: (url: string) => Promise<string>;
    // The bytes of a file, refusing one that is bigger than `maxBytes`.
    fetchBuffer: (url: string, maxBytes: number) => Promise<Buffer>;
    // Whether the signature file is a good signature of the checksums file, made by the key of the yt-dlp project.
    verifySums: (sums: Buffer, signature: Buffer) => Promise<boolean>;
}

export function defaultUpdateExec(file: string, args: string[]): Promise<{ ok: boolean; output: string }> {
    return new Promise((resolve) => {
        execFile(file, args, { timeout: UPDATE_TIMEOUT_MS }, (error, stdout, stderr) => {
            resolve({ ok: error === null, output: `${stdout}${stderr}`.trim() || (error?.message ?? '') });
        });
    });
}

async function fetchOk(url: string, timeoutMs: number): Promise<Response> {
    const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) {
        throw new Error(`Request failed (${response.status}) for ${url}`);
    }
    return response;
}

export const defaultUpdaterDependencies: UpdaterDependencies = {
    exec: defaultUpdateExec,
    fetchText: async (url) => {
        return (await fetchOk(url, TEXT_TIMEOUT_MS)).text();
    },
    fetchBuffer: async (url, maxBytes) => {
        const response = await fetchOk(url, BINARY_TIMEOUT_MS);
        if (Number(response.headers.get('content-length') ?? 0) > maxBytes) {
            throw new Error(translateMain('ytdlp.tooLarge'));
        }
        const data = Buffer.from(await response.arrayBuffer());
        if (data.length > maxBytes) {
            throw new Error(translateMain('ytdlp.tooLarge'));
        }
        return data;
    },
    verifySums: verifyYtdlpSums
};

export function parseChecksum(checksums: string, fileName: string): string | null {
    for (const line of checksums.split('\n')) {
        const [hash, name] = line.trim().split(/\s+/);
        if (name === fileName && hash) {
            return hash.toLowerCase();
        }
    }
    return null;
}

function sha256(data: Buffer): string {
    return createHash('sha256').update(data).digest('hex');
}

async function readVersion(exec: UpdateExecFn, path: string): Promise<string | null> {
    const result = await exec(path, ['--version']);
    return result.ok && result.output.length > 0 ? result.output.trim() : null;
}

// The numbers of a yt-dlp version (they are dates: 2026.08.19, and 2026.08.19.1 for a second one that day), or null when it is not one.
function versionNumbers(version: string): number[] | null {
    const match = /^(\d{4})\.(\d{2})\.(\d{2})(?:\.(\d+))?/.exec(version.trim());
    return match === null ? null : [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4] ?? 0)];
}

// Positive when the first version is newer than the second, negative when it is older, 0 when they are the same; null when either is not
// a version this knows how to compare.
export function compareYtdlpVersions(first: string, second: string): number | null {
    const left = versionNumbers(first);
    const right = versionNumbers(second);
    if (left === null || right === null) {
        return null;
    }
    for (let index = 0; index < left.length; index += 1) {
        const difference = (left[index] as number) - (right[index] as number);
        if (difference !== 0) {
            return difference;
        }
    }
    return 0;
}

// Fetches the signature of the checksums, or null when it cannot be had (a release without one is not trusted).
async function fetchSignature(deps: UpdaterDependencies, url: string): Promise<Buffer | null> {
    try {
        return await deps.fetchBuffer(url, MAX_SIGNATURE_BYTES);
    } catch {
        return null;
    }
}

async function downloadLatest(
    resolver: BinaryResolver,
    settings: Settings,
    deps: UpdaterDependencies,
    assetName: string
): Promise<UpdateResult> {
    const release = JSON.parse(await deps.fetchText(RELEASE_API_URL)) as { tag_name?: string };
    const tag = release.tag_name;
    if (!tag) {
        return { ok: false, output: translateMain('ytdlp.noRelease') };
    }
    const currentVersion = await readVersion(deps.exec, resolver.ytdlp(settings).path);
    if (currentVersion === tag) {
        return { ok: true, output: translateMain('ytdlp.upToDate', { tag }) };
    }
    // The list of hashes has to be signed by the yt-dlp project before the hash of the binary in it is worth anything.
    const checksums = await deps.fetchBuffer(`${RELEASE_DOWNLOAD_URL}/${tag}/${CHECKSUMS_NAME}`, MAX_TEXT_BYTES);
    const signature = await fetchSignature(deps, `${RELEASE_DOWNLOAD_URL}/${tag}/${SIGNATURE_NAME}`);
    if (signature === null || !(await deps.verifySums(checksums, signature))) {
        return { ok: false, output: translateMain('ytdlp.signatureFailed') };
    }
    const expected = parseChecksum(checksums.toString('utf-8'), assetName);
    if (expected === null) {
        return { ok: false, output: translateMain('ytdlp.checksumFailed') };
    }
    const binary = await deps.fetchBuffer(`${RELEASE_DOWNLOAD_URL}/${tag}/${assetName}`, MAX_BINARY_BYTES);
    if (sha256(binary) !== expected) {
        return { ok: false, output: translateMain('ytdlp.checksumFailed') };
    }
    mkdirSync(resolver.userBinDir, { recursive: true });
    const temporaryPath = `${resolver.userYtdlpPath}.tmp`;
    writeFileSync(temporaryPath, binary);
    chmodSync(temporaryPath, 0o755);
    // The one in use is only replaced by a binary that runs.
    if ((await readVersion(deps.exec, temporaryPath)) === null) {
        rmSync(temporaryPath, { force: true });
        return { ok: false, output: translateMain('ytdlp.newBinaryFailed') };
    }
    renameSync(temporaryPath, resolver.userYtdlpPath);
    return { ok: true, output: translateMain('ytdlp.updated', { from: currentVersion ?? translateMain('ytdlp.versionUnknown'), tag }) };
}

export async function updateYtdlp(
    settings: Settings,
    resolver: BinaryResolver,
    deps: UpdaterDependencies = defaultUpdaterDependencies,
    platform: NodeJS.Platform = process.platform
): Promise<UpdateResult> {
    if (settings.ytdlpPath.length > 0) {
        return deps.exec(settings.ytdlpPath, ['-U']);
    }
    const assetName = ASSET_NAMES[platform];
    if (!assetName) {
        return { ok: false, output: translateMain('ytdlp.unsupportedPlatform', { platform }) };
    }
    try {
        return await downloadLatest(resolver, settings, deps, assetName);
    } catch (error) {
        return { ok: false, output: error instanceof Error ? error.message : translateMain('update.failed') };
    }
}

// Goes back to the yt-dlp that ships with the app: the one an update saved is deleted, and the resolver finds the bundled one again.
export function resetYtdlp(resolver: BinaryResolver): UpdateResult {
    if (!resolver.hasUpdatedYtdlp()) {
        return { ok: false, output: translateMain('ytdlp.noUpdatedCopy') };
    }
    rmSync(resolver.userYtdlpPath, { force: true });
    return { ok: true, output: translateMain('ytdlp.resetDone') };
}

// An update saved its own yt-dlp, and the resolver prefers it to the bundled one for good. When the app then comes with a newer yt-dlp (or
// the saved one no longer runs) the bundled one is the better one, so the saved one is deleted. Returns whether it was. A yt-dlp the user
// chose in the settings, or one whose version cannot be compared, is left alone.
export async function discardOutdatedUpdate(
    settings: Settings,
    resolver: BinaryResolver,
    deps: Pick<UpdaterDependencies, 'exec'> = defaultUpdaterDependencies
): Promise<boolean> {
    if (settings.ytdlpPath.length > 0 || !resolver.hasUpdatedYtdlp() || !resolver.hasBundledYtdlp()) {
        return false;
    }
    const bundledVersion = await readVersion(deps.exec, resolver.bundledYtdlpPath);
    if (bundledVersion === null) {
        return false;
    }
    const updatedVersion = await readVersion(deps.exec, resolver.userYtdlpPath);
    const bundledIsNewer = updatedVersion !== null && (compareYtdlpVersions(bundledVersion, updatedVersion) ?? 0) > 0;
    if (updatedVersion !== null && !bundledIsNewer) {
        return false;
    }
    rmSync(resolver.userYtdlpPath, { force: true });
    return true;
}
