import { createHash } from 'node:crypto';
import type { ProgramId, ToolSpec } from '@shared/tools';
import { patchReport, REQUIRED_PATCHES, type PatchName } from '../aniPatches';
import { parseAniCliVersion } from '../aniVersion';
import { verifyYtdlpSums } from '../ytdlpSignature';
import {
    aniCliSpec,
    ANICLI_RAW_URL,
    ANICLI_VERSION,
    denoSpec,
    DENO_ASSETS,
    DENO_RELEASES_URL,
    DENO_VERSION,
    ffmpegSpec,
    FFMPEG_ASSETS,
    FFMPEG_CHECKSUMS,
    FFMPEG_DOWNLOAD_URL,
    FFMPEG_RELEASE_API,
    YTDLP_ASSETS,
    YTDLP_RELEASES_URL,
    YTDLP_VERSION,
    ytdlpSpec,
    type ProgramPlatform
} from './programSpecs';

// Looks up, for each program that can be updated, the latest version its publisher has (what the update in the settings installs, and what
// ffmpeg is installed from on the first run), and makes the spec of it: the address is built here from what the answer says and the checksum
// comes from the publisher, so what the network gives is only a name, a size and a hash.

export const YTDLP_RELEASE_API = 'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest';
export const DENO_RELEASE_API = 'https://api.github.com/repos/denoland/deno/releases/latest';
export const ANICLI_COMMIT_API = 'https://api.github.com/repos/pystardust/ani-cli/commits/master';
const YTDLP_CHECKSUMS = 'SHA2-256SUMS';
const YTDLP_SIGNATURE = 'SHA2-256SUMS.sig';

// How much a program may weigh, and the script of ani-cli: something far bigger than a release is not one.
export const MAX_SIZES: Record<ProgramId, number> = {
    ytdlp: 100_000_000,
    deno: 150_000_000,
    ffmpeg: 400_000_000,
    anicli: 500_000,
    busybox: 20_000_000,
    curl: 40_000_000
};
export const MAX_TEXT_BYTES = 1_000_000;
export const MAX_SIGNATURE_BYTES = 65_536;
export const TEXT_TIMEOUT_MS = 30_000;
const USER_AGENT = 'pullwave';

// Why a look for the latest version did not give one. The reason is what the screen turns into words; the message is for the details.
export type LookupReason = 'no-release' | 'signature' | 'checksum' | 'invalid' | 'patches' | 'failed';

export class LookupError extends Error {
    constructor(
        readonly reason: LookupReason,
        message: string,
        // The changes of the app that do not fit ani-cli (for the reason `patches`).
        readonly patches: readonly PatchName[] = []
    ) {
        super(message);
    }
}

export interface LatestDependencies {
    fetchText: (url: string) => Promise<string>;
    // The bytes of a file, refusing one that is bigger than `maxBytes`.
    fetchBuffer: (url: string, maxBytes: number) => Promise<Buffer>;
    // The size of a file, from its headers (nothing is downloaded).
    fetchSize: (url: string) => Promise<number>;
    // Whether the signature is a good one of the checksums of yt-dlp, made by the key of its project.
    verifySums: (sums: Buffer, signature: Buffer) => Promise<boolean>;
}

async function fetchOk(url: string, init: RequestInit = {}): Promise<Response> {
    const response = await fetch(url, { ...init, headers: { 'User-Agent': USER_AGENT }, redirect: 'follow', signal: AbortSignal.timeout(TEXT_TIMEOUT_MS) });
    if (!response.ok) {
        throw new Error(`Request failed (${String(response.status)}) for ${url}`);
    }
    return response;
}

export const defaultLatestDependencies: LatestDependencies = {
    fetchText: async (url) => {
        return (await fetchOk(url)).text();
    },
    fetchBuffer: async (url, maxBytes) => {
        const response = await fetchOk(url);
        if (Number(response.headers.get('content-length') ?? 0) > maxBytes) {
            throw new LookupError('invalid', `The answer of ${url} is too large`);
        }
        const data = Buffer.from(await response.arrayBuffer());
        if (data.length > maxBytes) {
            throw new LookupError('invalid', `The answer of ${url} is too large`);
        }
        return data;
    },
    fetchSize: async (url) => {
        const size = Number((await fetchOk(url, { method: 'HEAD' })).headers.get('content-length') ?? 0);
        if (!Number.isFinite(size) || size <= 0) {
            throw new LookupError('no-release', `${url} does not say how big it is`);
        }
        return size;
    },
    verifySums: verifyYtdlpSums
};

interface ReleaseAsset {
    name: string;
    size: number;
}

interface Release {
    tag: string | null;
    assets: ReleaseAsset[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// A release of GitHub as far as the lookups need it: its tag and the name and size of each file.
function readRelease(text: string): Release {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        throw new LookupError('invalid', 'The answer is not a release');
    }
    if (!isRecord(parsed)) {
        throw new LookupError('invalid', 'The answer is not a release');
    }
    const assets = Array.isArray(parsed['assets']) ? parsed['assets'] : [];
    return {
        tag: typeof parsed['tag_name'] === 'string' ? parsed['tag_name'] : null,
        assets: assets.flatMap((asset: unknown) => {
            return isRecord(asset) && typeof asset['name'] === 'string' && typeof asset['size'] === 'number' ? [{ name: asset['name'], size: asset['size'] }] : [];
        })
    };
}

function sizeOf(release: Release, name: string, id: ProgramId): number {
    const size = release.assets.find((asset) => {
        return asset.name === name;
    })?.size;
    if (size === undefined || !Number.isFinite(size) || size <= 0 || size > MAX_SIZES[id]) {
        throw new LookupError('no-release', `The release has no ${name} of a size that can be installed`);
    }
    return size;
}

// The hash a line of a list of checksums gives for a file ("<hash>  <name>", or "<hash> *<name>").
export function checksumOf(list: string, name: string): string | null {
    for (const line of list.split('\n')) {
        const match = /^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/.exec(line.trim());
        if (match?.[2] === name) {
            return (match[1] as string).toLowerCase();
        }
    }
    return null;
}

// The only 64-digit hash in a file of one checksum: a bare hash, "<hash>  <name>", or the table of PowerShell's Get-FileHash.
export function singleChecksum(text: string): string | null {
    const match = /\b[0-9a-fA-F]{64}\b/.exec(text);
    return match === null ? null : match[0].toLowerCase();
}

async function fetchSignature(deps: LatestDependencies, url: string): Promise<Buffer | null> {
    try {
        return await deps.fetchBuffer(url, MAX_SIGNATURE_BYTES);
    } catch {
        return null;
    }
}

// yt-dlp: the latest release, whose list of checksums has to be signed by the project before a hash in it is worth anything.
export async function latestYtdlp(platform: ProgramPlatform, deps: LatestDependencies = defaultLatestDependencies): Promise<ToolSpec> {
    const release = readRelease(await deps.fetchText(YTDLP_RELEASE_API));
    if (release.tag === null || !YTDLP_VERSION.test(release.tag)) {
        throw new LookupError('no-release', 'The latest release of yt-dlp has no version the app knows');
    }
    const asset = YTDLP_ASSETS[platform];
    const size = sizeOf(release, asset, 'ytdlp');
    const sums = await deps.fetchBuffer(`${YTDLP_RELEASES_URL}/${release.tag}/${YTDLP_CHECKSUMS}`, MAX_TEXT_BYTES);
    const signature = await fetchSignature(deps, `${YTDLP_RELEASES_URL}/${release.tag}/${YTDLP_SIGNATURE}`);
    if (signature === null || !(await deps.verifySums(sums, signature))) {
        throw new LookupError('signature', 'The checksums of the release are not signed by the yt-dlp project');
    }
    const sha256 = checksumOf(sums.toString('utf-8'), asset);
    if (sha256 === null) {
        throw new LookupError('checksum', `The checksums of the release do not list ${asset}`);
    }
    return ytdlpSpec(release.tag, sha256, size, platform);
}

// deno: the latest release, with the checksum the project publishes beside the file.
export async function latestDeno(platform: ProgramPlatform, deps: LatestDependencies = defaultLatestDependencies): Promise<ToolSpec> {
    const release = readRelease(await deps.fetchText(DENO_RELEASE_API));
    if (release.tag === null || !DENO_VERSION.test(release.tag)) {
        throw new LookupError('no-release', 'The latest release of deno has no version the app knows');
    }
    const asset = DENO_ASSETS[platform];
    const size = sizeOf(release, asset, 'deno');
    if (
        !release.assets.some((candidate) => {
            return candidate.name === `${asset}.sha256sum`;
        })
    ) {
        throw new LookupError('checksum', `The release does not publish the checksum of ${asset}`);
    }
    const sha256 = singleChecksum(await deps.fetchText(`${DENO_RELEASES_URL}/${release.tag}/${asset}.sha256sum`));
    if (sha256 === null) {
        throw new LookupError('checksum', `The checksum of ${asset} is not in the file the project publishes`);
    }
    return denoSpec(release.tag, sha256, size, platform);
}

function branchOf(platform: ProgramPlatform, name: string): [number, number] {
    const match = FFMPEG_ASSETS[platform].exec(name);
    return [Number(match?.[1] ?? 0), Number(match?.[2] ?? 0)];
}

// ffmpeg: the latest build, the newest numbered branch of the GPL shared build of BtbN for the system, with the checksum of its list.
export async function latestFfmpeg(platform: ProgramPlatform, deps: LatestDependencies = defaultLatestDependencies): Promise<ToolSpec> {
    const release = readRelease(await deps.fetchText(FFMPEG_RELEASE_API));
    const candidates = release.assets
        .filter((asset) => {
            return FFMPEG_ASSETS[platform].test(asset.name);
        })
        .sort((first, second) => {
            const [firstMajor, firstMinor] = branchOf(platform, first.name);
            const [secondMajor, secondMinor] = branchOf(platform, second.name);
            return secondMajor - firstMajor || secondMinor - firstMinor;
        });
    const newest = candidates[0];
    if (newest === undefined) {
        throw new LookupError('no-release', 'The release has no build of ffmpeg for this system');
    }
    const size = sizeOf(release, newest.name, 'ffmpeg');
    const sha256 = checksumOf(await deps.fetchText(`${FFMPEG_DOWNLOAD_URL}/${FFMPEG_CHECKSUMS}`), newest.name);
    if (sha256 === null) {
        throw new LookupError('checksum', `The list of checksums does not have ${newest.name}`);
    }
    const spec = ffmpegSpec(platform, newest.name, sha256, size);
    if (spec === null) {
        throw new LookupError('no-release', 'The release has no build of ffmpeg for this system');
    }
    return spec;
}

export function looksLikeAniCli(script: string): boolean {
    return script.startsWith('#!/bin/sh') && Buffer.byteLength(script) <= MAX_SIZES.anicli && parseAniCliVersion(script) !== null;
}

export function unfitPatches(script: string): PatchName[] {
    const report = patchReport(script);
    return (Object.keys(report) as PatchName[]).filter((name) => {
        return !report[name];
    });
}

export interface LatestAniCli {
    spec: ToolSpec;
    // The version the script says it is (5.1.4).
    version: string;
    // The changes of the app that do not fit the script and are not essential: the script works, without them.
    unfit: PatchName[];
}

// ani-cli: the script at the head of the master branch, asked for by its commit so the address is a fixed one. It is not worth anything unless
// it looks like ani-cli and the changes of the app that the app cannot do without still fit it. The script has no checksum published, so the
// one of the file as it came is the one the install checks (the file of a commit does not change).
export async function latestAniCli(deps: LatestDependencies = defaultLatestDependencies): Promise<LatestAniCli> {
    let commit: unknown;
    try {
        commit = (JSON.parse(await deps.fetchText(ANICLI_COMMIT_API)) as { sha?: unknown }).sha;
    } catch (error) {
        if (error instanceof SyntaxError) {
            throw new LookupError('invalid', 'The answer is not a commit');
        }
        throw error;
    }
    if (typeof commit !== 'string' || !ANICLI_VERSION.test(commit)) {
        throw new LookupError('no-release', 'The latest commit of ani-cli has no hash the app knows');
    }
    const bytes = await deps.fetchBuffer(`${ANICLI_RAW_URL}/${commit}/ani-cli`, MAX_SIZES.anicli);
    const script = bytes.toString('utf-8');
    if (!looksLikeAniCli(script)) {
        throw new LookupError('invalid', 'The file is not ani-cli');
    }
    const unfit = unfitPatches(script);
    const required = unfit.filter((name) => {
        return REQUIRED_PATCHES.includes(name);
    });
    if (required.length > 0) {
        throw new LookupError('patches', `The changes of the app do not fit this ani-cli: ${required.join(', ')}`, required);
    }
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    return { spec: aniCliSpec(commit, sha256, bytes.length), version: parseAniCliVersion(script) ?? '', unfit };
}
