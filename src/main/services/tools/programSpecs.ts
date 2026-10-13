import type { ProgramId, ToolSpec } from '@shared/tools';

// The programs the app downloads on its first run: where each one comes from, for each system, and how it is unpacked. The ones that are
// pinned here (the version the app was made with) are the base: they are what is installed when nothing newer was chosen. yt-dlp, deno, ani-cli
// and ffmpeg can be moved to the latest one from the update in the settings; busybox and curl stay at their version. ffmpeg has no base: the
// build it was made with is not kept anywhere (the builds of the publishers are rolling), so the first run takes the latest one.

export type ProgramPlatform = 'linux' | 'win32';

export function programPlatform(platform: NodeJS.Platform, arch: string): ProgramPlatform | null {
    return arch === 'x64' && (platform === 'linux' || platform === 'win32') ? platform : null;
}

export function executableName(command: string, platform: ProgramPlatform): string {
    return platform === 'win32' ? `${command}.exe` : command;
}

const RAW = { format: 'raw', stripComponents: 0, exclude: [] } as const;

// ----- yt-dlp -----

export const YTDLP_RELEASES_URL = 'https://github.com/yt-dlp/yt-dlp/releases/download';
export const YTDLP_ASSETS: Record<ProgramPlatform, string> = { linux: 'yt-dlp_linux', win32: 'yt-dlp.exe' };
// The versions of yt-dlp are dates: 2026.08.19, and 2026.08.19.1 for a second one that day.
export const YTDLP_VERSION = /^\d{4}\.\d{2}\.\d{2}(?:\.\d+)?$/;

export function ytdlpSpec(version: string, sha256: string, sizeBytes: number, platform: ProgramPlatform): ToolSpec {
    const file = executableName('yt-dlp', platform);
    return { id: 'ytdlp', version, url: `${YTDLP_RELEASES_URL}/${version}/${YTDLP_ASSETS[platform]}`, sha256, sizeBytes, ...RAW, executables: [file], entry: file };
}

// ----- deno (yt-dlp runs the JavaScript the sites ask of it with it) -----

export const DENO_RELEASES_URL = 'https://github.com/denoland/deno/releases/download';
export const DENO_ASSETS: Record<ProgramPlatform, string> = { linux: 'deno-x86_64-unknown-linux-gnu.zip', win32: 'deno-x86_64-pc-windows-msvc.zip' };
export const DENO_VERSION = /^v\d{1,3}\.\d{1,3}\.\d{1,3}$/;

export function denoSpec(version: string, sha256: string, sizeBytes: number, platform: ProgramPlatform): ToolSpec {
    const file = executableName('deno', platform);
    return { id: 'deno', version, url: `${DENO_RELEASES_URL}/${version}/${DENO_ASSETS[platform]}`, sha256, sizeBytes, format: 'zip', stripComponents: 0, exclude: [], executables: [file], entry: file };
}

// ----- ffmpeg (and ffprobe, which comes with it) -----

export const FFMPEG_RELEASE_API = 'https://api.github.com/repos/BtbN/FFmpeg-Builds/releases/tags/latest';
export const FFMPEG_DOWNLOAD_URL = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest';
export const FFMPEG_CHECKSUMS = 'checksums.sha256';
// The GPL build with shared libraries, from the same release of BtbN on both systems: the static one stops on MPEG-TS and HLS (it is what yt-dlp
// joins the pieces of a live stream with). The name carries the numbered branch (n9.0), which changes now and then.
export const FFMPEG_ASSETS: Record<ProgramPlatform, RegExp> = {
    linux: /^ffmpeg-n(\d{1,3})\.(\d{1,3})-latest-linux64-gpl-shared-\d{1,3}\.\d{1,3}\.tar\.xz$/,
    win32: /^ffmpeg-n(\d{1,3})\.(\d{1,3})-latest-win64-gpl-shared-\d{1,3}\.\d{1,3}\.zip$/
};
// The builds are rolling: the version is the start of the checksum of the file, which changes with every build.
export const FFMPEG_VERSION = /^latest-[0-9a-f]{12}$/;

export function ffmpegVersionOf(sha256: string): string {
    return `latest-${sha256.slice(0, 12)}`;
}

// `asset` is the name of the file in the release of BtbN.
export function ffmpegSpec(platform: ProgramPlatform, asset: string, sha256: string, sizeBytes: number): ToolSpec | null {
    if (!FFMPEG_ASSETS[platform].test(asset)) {
        return null;
    }
    const linux = platform === 'linux';
    return {
        id: 'ffmpeg',
        version: ffmpegVersionOf(sha256),
        url: `${FFMPEG_DOWNLOAD_URL}/${asset}`,
        sha256,
        sizeBytes,
        format: linux ? 'tar.xz' : 'zip',
        stripComponents: 1,
        exclude: linux ? ['include'] : [],
        executables: linux ? ['bin/ffmpeg', 'bin/ffprobe'] : ['bin/ffmpeg.exe', 'bin/ffprobe.exe'],
        entry: linux ? 'bin/ffmpeg' : 'bin/ffmpeg.exe'
    };
}

// ----- ani-cli (a script: it runs on the busybox below, and does its requests with the curl below) -----

export const ANICLI_RAW_URL = 'https://raw.githubusercontent.com/pystardust/ani-cli';
// A commit of the master branch.
export const ANICLI_VERSION = /^[0-9a-f]{40}$/;

export function aniCliSpec(commit: string, sha256: string, sizeBytes: number): ToolSpec {
    return { id: 'anicli', version: commit, url: `${ANICLI_RAW_URL}/${commit}/ani-cli`, sha256, sizeBytes, ...RAW, executables: ['ani-cli'], entry: 'ani-cli' };
}

// ----- busybox (the shell and the small programs ani-cli calls) and curl (its requests) -----

const BUSYBOX_W32_URL = 'https://frippery.org/files/busybox';
const CURL_URL = 'https://github.com/stunnel/static-curl/releases/download/8.22.0';

// ----- what is pinned: the version of each program the app was made with -----

const PINNED: Record<Exclude<ProgramId, 'ffmpeg'>, Record<ProgramPlatform, ToolSpec>> = {
    ytdlp: {
        linux: ytdlpSpec('2026.08.19', '58162f9bfdc27458ea47bfcb311cf47028f17d8154a8bf7d689861d46399230a', 40_446_224, 'linux'),
        win32: ytdlpSpec('2026.08.19', '66674953fe251b89f4d08c5f0e35e0728679bd67ab3d7d05c0562af101dd3e7a', 17_840_399, 'win32')
    },
    deno: {
        linux: denoSpec('v2.9.7', 'c6527f24f4b16031d3ae4fa9f658d5f11534c8d84ce7dc8502420280919c3490', 41_596_794, 'linux'),
        win32: denoSpec('v2.9.7', 'a0c3101b4158d1dfb7d6a78a7bf0f3de80c96bb423c152beec8beb22786f2238', 42_630_221, 'win32')
    },
    anicli: {
        // Version 5.1.4: the latest tagged release is much older.
        linux: aniCliSpec('3ad53631ef2433b0c26e25ab011a5b149706c120', '32ae0965b7abb102ab85f381411b980d1a9196f06bf2756d48fef16695b41d47', 29_772),
        win32: aniCliSpec('3ad53631ef2433b0c26e25ab011a5b149706c120', '32ae0965b7abb102ab85f381411b980d1a9196f06bf2756d48fef16695b41d47', 29_772)
    },
    busybox: {
        // busybox.net publishes no checksums, so the hash of the file is pinned here.
        linux: {
            id: 'busybox',
            version: '1.35.0',
            url: 'https://busybox.net/downloads/binaries/1.35.0-x86_64-linux-musl/busybox',
            sha256: '6e123e7f3202a8c1e9b1f94d8941580a25135382b99e8d3e34fb858bba311348',
            sizeBytes: 1_131_168,
            ...RAW,
            executables: ['busybox'],
            entry: 'busybox'
        },
        // busybox-w32, the 64-bit Unicode build (Windows 10 1903 or newer).
        win32: {
            id: 'busybox',
            version: 'FRP-6075-g169694ebd',
            url: `${BUSYBOX_W32_URL}/busybox-w64u-FRP-6075-g169694ebd.exe`,
            sha256: '6e263d154d8548d1eb936f65d1d8312c80df31c45974e48d6335e4dcc0f4f34c',
            sizeBytes: 675_840,
            ...RAW,
            executables: ['busybox.exe'],
            entry: 'busybox.exe'
        }
    },
    curl: {
        linux: {
            id: 'curl',
            version: '8.22.0',
            url: `${CURL_URL}/curl-linux-x86_64-musl-8.22.0.tar.xz`,
            sha256: 'dfb02460ba2abe513087538f12a3cf79b74b64a5ea3787ce8ac0cdb11251f884',
            sizeBytes: 4_142_376,
            format: 'tar.xz',
            stripComponents: 0,
            exclude: [],
            executables: ['curl'],
            entry: 'curl'
        },
        win32: {
            id: 'curl',
            version: '8.22.0',
            url: `${CURL_URL}/curl-windows-x86_64-8.22.0.tar.xz`,
            sha256: '8a57d1a52ea246f50be9e3f24a1d539d4fd23884405efbe18c6eb44eaf8ca524',
            sizeBytes: 3_516_016,
            format: 'tar.xz',
            stripComponents: 0,
            exclude: [],
            executables: ['curl.exe'],
            entry: 'curl.exe'
        }
    }
};

// The version of the program the app was made with, for this system. Null for ffmpeg (it has none) and for a system the programs are not
// made for.
export function pinnedSpec(id: ProgramId, platform: NodeJS.Platform, arch: string): ToolSpec | null {
    const system = programPlatform(platform, arch);
    if (system === null || id === 'ffmpeg') {
        return null;
    }
    return PINNED[id][system];
}

// Whether the text can be the version of the program (the names of the folders of the versions are made of them, so this also keeps a
// version from being a path).
export function isProgramVersion(id: ProgramId, version: string): boolean {
    switch (id) {
        case 'ytdlp':
            return YTDLP_VERSION.test(version);
        case 'deno':
            return DENO_VERSION.test(version);
        case 'ffmpeg':
            return FFMPEG_VERSION.test(version);
        case 'anicli':
            return ANICLI_VERSION.test(version);
        case 'busybox':
        case 'curl':
            return /^[A-Za-z0-9][A-Za-z0-9._-]{0,40}$/.test(version);
    }
}
