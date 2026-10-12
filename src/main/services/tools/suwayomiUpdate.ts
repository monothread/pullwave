import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ToolSpec } from '@shared/tools';
import { suwayomiAssetName, suwayomiReleaseSpec, suwayomiSpec, type SuwayomiRelease } from './suwayomiRelease';

// Looking for a newer Suwayomi-Server, always the latest release of its project, and remembering which one the app runs.

export const SUWAYOMI_LATEST_URL = 'https://api.github.com/repos/Suwayomi/Suwayomi-Server/releases/latest';
export const CHECKSUMS_ASSET = 'Checksums.sha256';
// What is read from the network is cut to this size before it is looked at.
export const MAX_ANSWER_BYTES = 2 * 1024 * 1024;
export const LOOKUP_TIMEOUT_MS = 20_000;
// A release is not taken for a program that is far bigger than the ones the project publishes.
export const MAX_RELEASE_BYTES = 1.5 * 1024 * 1024 * 1024;

const VERSION_PATTERN = /^v\d{1,3}\.\d{1,3}\.\d{1,6}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export class UpdateLookupError extends Error {}

interface ReleaseAsset {
    name: string;
    size: number;
    url: string;
}

function text(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

export function isVersionTag(value: unknown): value is string {
    return typeof value === 'string' && VERSION_PATTERN.test(value);
}

async function readLimited(response: Response): Promise<string> {
    const body = await response.text();
    if (body.length > MAX_ANSWER_BYTES) {
        throw new UpdateLookupError('The answer is too big');
    }
    return body;
}

export async function getText(url: string, fetchImpl: typeof fetch, accept: string): Promise<string> {
    let response: Response;
    try {
        response = await fetchImpl(url, { headers: { Accept: accept, 'User-Agent': 'pullwave' }, signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) });
    } catch (error) {
        throw new UpdateLookupError(error instanceof Error ? error.message : String(error));
    }
    if (!response.ok) {
        throw new UpdateLookupError(`The server answered ${String(response.status)}`);
    }
    return readLimited(response);
}

function parseAssets(value: unknown): ReleaseAsset[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.flatMap((item: unknown) => {
        const raw = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>;
        const size = raw['size'];
        return typeof size === 'number' && Number.isFinite(size) ? [{ name: text(raw['name']), size, url: text(raw['browser_download_url']) }] : [];
    });
}

// The checksum a release lists for a file ("<hash>  <name>" or "<hash> *<name>" on each line).
export function checksumOf(listing: string, fileName: string): string | null {
    for (const line of listing.split(/\r?\n/)) {
        const match = /^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/.exec(line);
        if (match !== null && match[2] === fileName) {
            return match[1]!.toLowerCase();
        }
    }
    return null;
}

// The latest release of Suwayomi-Server for this system, with the checksum the project publishes beside it; null where there is no
// program for this system.
export async function fetchLatestSuwayomi(platform: NodeJS.Platform, arch: string, fetchImpl: typeof fetch = fetch): Promise<SuwayomiRelease | null> {
    const answer: unknown = JSON.parse(await getText(SUWAYOMI_LATEST_URL, fetchImpl, 'application/vnd.github+json'));
    const raw = (typeof answer === 'object' && answer !== null ? answer : {}) as Record<string, unknown>;
    const version = raw['tag_name'];
    if (!isVersionTag(version)) {
        throw new UpdateLookupError('The latest release has a version that is not understood');
    }
    const wanted = suwayomiAssetName(platform, arch, version);
    if (wanted === null) {
        return null;
    }
    const assets = parseAssets(raw['assets']);
    const file = assets.find((asset) => {
        return asset.name === wanted;
    });
    const checksums = assets.find((asset) => {
        return asset.name === CHECKSUMS_ASSET;
    });
    if (file === undefined || checksums === undefined) {
        throw new UpdateLookupError('The latest release has no program for this system or no checksums');
    }
    if (file.size <= 0 || file.size > MAX_RELEASE_BYTES) {
        throw new UpdateLookupError('The program of the latest release has an unlikely size');
    }
    if (!checksums.url.startsWith(`https://github.com/Suwayomi/Suwayomi-Server/releases/download/${version}/`)) {
        throw new UpdateLookupError('The checksums are not where the release says they are');
    }
    const sha256 = checksumOf(await getText(checksums.url, fetchImpl, 'text/plain'), wanted);
    if (sha256 === null || !SHA256_PATTERN.test(sha256)) {
        throw new UpdateLookupError('The checksums do not list the program for this system');
    }
    return { version, sha256, sizeBytes: file.size };
}

// ----- Which version the app runs -----

interface Selected {
    version: string;
    sha256: string;
    sizeBytes: number;
}

// The release the user chose to update to, as it was kept; null when there is none or what was kept is not valid. The address of the
// download is not kept: it is built from the version.
export function readSelectedSuwayomi(file: string, platform: NodeJS.Platform, arch: string): ToolSpec | null {
    try {
        const raw = JSON.parse(readFileSync(file, 'utf-8')) as Partial<Selected>;
        if (!isVersionTag(raw.version) || typeof raw.sha256 !== 'string' || !SHA256_PATTERN.test(raw.sha256) || typeof raw.sizeBytes !== 'number' || !(raw.sizeBytes > 0) || raw.sizeBytes > MAX_RELEASE_BYTES) {
            return null;
        }
        return suwayomiReleaseSpec(platform, arch, { version: raw.version, sha256: raw.sha256, sizeBytes: raw.sizeBytes });
    } catch {
        return null;
    }
}

// Keeps the release the app runs from the next time it opens (written beside, then renamed, so it is whole or not there).
export function writeSelectedSuwayomi(file: string, release: SuwayomiRelease): void {
    mkdirSync(dirname(file), { recursive: true });
    const partial = `${file}.part`;
    writeFileSync(partial, JSON.stringify({ version: release.version, sha256: release.sha256, sizeBytes: release.sizeBytes }), 'utf-8');
    renameSync(partial, file);
}

// Goes back to the version the app ships with.
export function clearSelectedSuwayomi(file: string): void {
    rmSync(file, { force: true });
}

// The program the app runs: the release the user updated to when there is one, otherwise the one the app ships with.
export function chosenSuwayomiSpec(file: string, platform: NodeJS.Platform, arch: string): ToolSpec | null {
    return readSelectedSuwayomi(file, platform, arch) ?? suwayomiSpec(platform, arch);
}
