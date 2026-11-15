#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
    chmodSync,
    copyFileSync,
    cpSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    renameSync,
    rmSync,
    writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);

function option(name) {
    return args.find((arg) => {
        return arg.startsWith(`--${name}=`);
    })?.split('=')[1];
}

const FORCE = args.includes('--force');
const PLATFORM = option('platform') ?? process.platform;
const BIN_DIR = option('out') ? resolve(option('out')) : join(ROOT, 'resources', 'bin');
const LIB_DIR = join(BIN_DIR, '..', 'lib');
const FFMPEG_SOURCE_MARKER = join(BIN_DIR, '.ffmpeg-source');

const YTDLP_BASE = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download';
const DENO_BASE = 'https://github.com/denoland/deno/releases/latest/download';

const TARGETS = {
    linux: {
        ytdlpAsset: 'yt-dlp_linux',
        ytdlpFile: 'yt-dlp',
        denoArchive: 'deno-x86_64-unknown-linux-gnu.zip',
        denoFile: 'deno',
        ffmpegUrl: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n9.0-latest-linux64-gpl-shared-9.0.tar.xz',
        ffmpegHash: { algorithm: 'sha256', checksumsUrl: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/checksums.sha256', length: 64 },
        ffmpegFiles: ['ffmpeg', 'ffprobe'],
        ffmpegLibraries: true
    },
    win32: {
        ytdlpAsset: 'yt-dlp.exe',
        ytdlpFile: 'yt-dlp.exe',
        denoArchive: 'deno-x86_64-pc-windows-msvc.zip',
        denoFile: 'deno.exe',
        ffmpegUrl: 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip',
        ffmpegHash: { algorithm: 'sha256', suffix: '.sha256', length: 64 },
        ffmpegFiles: ['ffmpeg.exe', 'ffprobe.exe'],
        ffmpegLibraries: false
    }
};

const TARGET = TARGETS[PLATFORM];
if (!TARGET) {
    console.error(`Unsupported platform "${PLATFORM}". Use linux or win32.`);
    process.exit(1);
}

const ANI_DIR = join(BIN_DIR, 'ani');
const ANI_MARKER = join(ANI_DIR, '.sources');
const ANI_CLI_SOURCE = {
    url: 'https://raw.githubusercontent.com/pystardust/ani-cli/8527f185a12c6b5d0247a30b2217000dd65457fe/ani-cli',
    sha256: '24ada974b567789da4ea51f9f92ec5b975b43fc0e999543f9053bcf5a628105c'
};
const BUSYBOX_W32_BASE = 'https://frippery.org/files/busybox';
const ANI_TOOLS = {
    linux: {
        busybox: {
            url: 'https://busybox.net/downloads/binaries/1.35.0-x86_64-linux-musl/busybox',
            sha256: '6e123e7f3202a8c1e9b1f94d8941580a25135382b99e8d3e34fb858bba311348'
        },
        busyboxFile: 'busybox',
        curl: {
            url: 'https://github.com/stunnel/static-curl/releases/download/8.22.0/curl-linux-x86_64-musl-8.22.0.tar.xz',
            sha256: 'dfb02460ba2abe513087538f12a3cf79b74b64a5ea3787ce8ac0cdb11251f884'
        },
        curlFile: 'curl'
    },
    win32: {
        busybox: {
            url: `${BUSYBOX_W32_BASE}/busybox-w64u-FRP-6075-g169694ebd.exe`,
            sha256: '6e263d154d8548d1eb936f65d1d8312c80df31c45974e48d6335e4dcc0f4f34c',
            publishedSums: `${BUSYBOX_W32_BASE}/SHA256SUM`,
            publishedName: 'busybox-w64u-FRP-6075-g169694ebd.exe'
        },
        busyboxFile: 'busybox.exe',
        curl: {
            url: 'https://github.com/stunnel/static-curl/releases/download/8.22.0/curl-windows-x86_64-8.22.0.tar.xz',
            sha256: '8a57d1a52ea246f50be9e3f24a1d539d4fd23884405efbe18c6eb44eaf8ca524'
        },
        curlFile: 'curl.exe'
    }
};
const ANI = ANI_TOOLS[PLATFORM];
const ANI_SOURCES = { aniCli: ANI_CLI_SOURCE, busybox: ANI.busybox, curl: ANI.curl };
const ANI_FILES = ['ani-cli', ANI.busyboxFile, ANI.curlFile];

async function download(url) {
    const response = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'pullwave-build' } });
    if (!response.ok) {
        throw new Error(`Download failed (${response.status}): ${url}`);
    }
    return Buffer.from(await response.arrayBuffer());
}

function digest(algorithm, data) {
    return createHash(algorithm).update(data).digest('hex');
}

function verify(algorithm, data, expected, label) {
    const actual = digest(algorithm, data);
    if (actual !== expected.toLowerCase()) {
        throw new Error(`${label}: ${algorithm} mismatch (expected ${expected}, got ${actual})`);
    }
}

function extractHash(text, length) {
    const match = new RegExp(`\\b[0-9a-fA-F]{${length}}\\b`).exec(text);
    if (!match) {
        throw new Error(`No ${length}-character checksum found in: ${text.slice(0, 80)}`);
    }
    return match[0];
}

function isPresent(...names) {
    return !FORCE && names.every((name) => {
        return existsSync(join(BIN_DIR, name));
    });
}

function extractZip(archivePath, destination) {
    mkdirSync(destination, { recursive: true });
    if (process.platform === 'win32') {
        const systemTar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
        execFileSync(existsSync(systemTar) ? systemTar : 'tar', ['-xf', archivePath, '-C', destination]);
        return;
    }
    execFileSync('unzip', ['-o', '-q', archivePath, '-d', destination]);
}

function extractTarXz(archivePath, destination) {
    mkdirSync(destination, { recursive: true });
    if (process.platform === 'win32') {
        const systemTar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
        execFileSync(existsSync(systemTar) ? systemTar : 'tar', ['-xf', archivePath, '-C', destination]);
        return;
    }
    execFileSync('tar', ['-xJf', archivePath, '-C', destination]);
}

function findFile(directory, fileName) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const fullPath = join(directory, entry.name);
        if (entry.isFile() && entry.name === fileName) {
            return fullPath;
        }
        if (entry.isDirectory()) {
            const found = findFile(fullPath, fileName);
            if (found) {
                return found;
            }
        }
    }
    return null;
}

function findDirectory(directory, name) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (!entry.isDirectory()) {
            continue;
        }
        const fullPath = join(directory, entry.name);
        const found = entry.name === name ? fullPath : findDirectory(fullPath, name);
        if (found) {
            return found;
        }
    }
    return null;
}

function installFile(source, name) {
    const target = join(BIN_DIR, name);
    copyFileSync(source, target);
    chmodSync(target, 0o755);
}

async function fetchYtdlp() {
    if (isPresent(TARGET.ytdlpFile)) {
        return;
    }
    console.log(`> yt-dlp (${TARGET.ytdlpAsset})`);
    const sums = (await download(`${YTDLP_BASE}/SHA2-256SUMS`)).toString('utf-8');
    const expected = sums.split('\n').map((line) => {
        return line.trim().split(/\s+/);
    }).find(([, name]) => {
        return name === TARGET.ytdlpAsset;
    });
    if (!expected) {
        throw new Error(`${TARGET.ytdlpAsset} not found in SHA2-256SUMS`);
    }
    const binary = await download(`${YTDLP_BASE}/${TARGET.ytdlpAsset}`);
    verify('sha256', binary, expected[0], 'yt-dlp');
    const target = join(BIN_DIR, TARGET.ytdlpFile);
    writeFileSync(`${target}.tmp`, binary);
    chmodSync(`${target}.tmp`, 0o755);
    renameSync(`${target}.tmp`, target);
}

async function fetchDeno(workDir) {
    if (isPresent(TARGET.denoFile)) {
        return;
    }
    console.log('> deno');
    const expected = extractHash((await download(`${DENO_BASE}/${TARGET.denoArchive}.sha256sum`)).toString('utf-8'), 64);
    const archive = await download(`${DENO_BASE}/${TARGET.denoArchive}`);
    verify('sha256', archive, expected, 'deno');
    const archivePath = join(workDir, 'deno.zip');
    writeFileSync(archivePath, archive);
    const extracted = join(workDir, 'deno');
    extractZip(archivePath, extracted);
    const binary = findFile(extracted, TARGET.denoFile);
    if (!binary) {
        throw new Error(`${TARGET.denoFile} not found in the deno archive`);
    }
    installFile(binary, TARGET.denoFile);
}

function isFfmpegCurrent() {
    const sameSource = existsSync(FFMPEG_SOURCE_MARKER) && readFileSync(FFMPEG_SOURCE_MARKER, 'utf-8').trim() === TARGET.ffmpegUrl;
    const hasLibraries = !TARGET.ffmpegLibraries || existsSync(LIB_DIR);
    return isPresent(...TARGET.ffmpegFiles) && sameSource && hasLibraries;
}

async function expectedFfmpegHash() {
    const { checksumsUrl, suffix, length } = TARGET.ffmpegHash;
    if (checksumsUrl) {
        const fileName = TARGET.ffmpegUrl.split('/').pop();
        const line = (await download(checksumsUrl)).toString('utf-8').split('\n').find((candidate) => {
            return candidate.trim().endsWith(fileName);
        });
        if (!line) {
            throw new Error(`${fileName} is not listed in ${checksumsUrl} (the build may have been renamed or removed)`);
        }
        return extractHash(line, length);
    }
    return extractHash((await download(`${TARGET.ffmpegUrl}${suffix}`)).toString('utf-8'), length);
}

async function fetchFfmpeg(workDir) {
    if (isFfmpegCurrent()) {
        return;
    }
    console.log('> ffmpeg + ffprobe');
    const { algorithm } = TARGET.ffmpegHash;
    const expected = await expectedFfmpegHash();
    const archive = await download(TARGET.ffmpegUrl);
    verify(algorithm, archive, expected, 'ffmpeg');
    const isZip = TARGET.ffmpegUrl.endsWith('.zip');
    const archivePath = join(workDir, isZip ? 'ffmpeg.zip' : 'ffmpeg.tar.xz');
    writeFileSync(archivePath, archive);
    const extracted = join(workDir, 'ffmpeg');
    if (isZip) {
        extractZip(archivePath, extracted);
    } else {
        mkdirSync(extracted, { recursive: true });
        execFileSync('tar', ['-xJf', archivePath, '-C', extracted]);
    }
    for (const name of TARGET.ffmpegFiles) {
        const binary = findFile(extracted, name);
        if (!binary) {
            throw new Error(`${name} not found in the ffmpeg archive`);
        }
        installFile(binary, name);
    }
    if (TARGET.ffmpegLibraries) {
        const libraries = findDirectory(extracted, 'lib');
        if (!libraries) {
            throw new Error('lib folder not found in the ffmpeg archive');
        }
        rmSync(LIB_DIR, { recursive: true, force: true });
        cpSync(libraries, LIB_DIR, { recursive: true, verbatimSymlinks: true });
    }
    const license = findFile(extracted, 'GPLv3.txt') ?? findFile(extracted, 'LICENSE.txt') ?? findFile(extracted, 'LICENSE');
    if (license) {
        copyFileSync(license, join(BIN_DIR, 'ffmpeg-GPLv3.txt'));
    }
    writeFileSync(FFMPEG_SOURCE_MARKER, `${TARGET.ffmpegUrl}\n`);
}

function expectedAniMarker() {
    return `${Object.values(ANI_SOURCES).map((source) => {
        return source.sha256;
    }).join('\n')}\n`;
}

function isAniCurrent() {
    const sameSources = existsSync(ANI_MARKER) && readFileSync(ANI_MARKER, 'utf-8') === expectedAniMarker();
    return !FORCE && sameSources && ANI_FILES.every((name) => {
        return existsSync(join(ANI_DIR, name));
    });
}

async function fetchVerified(source, label) {
    const data = await download(source.url);
    verify('sha256', data, source.sha256, label);
    return data;
}

async function crossCheckPublishedHash(source, label) {
    if (!source.publishedSums) {
        return;
    }
    const line = (await download(source.publishedSums)).toString('utf-8').split('\n').find((candidate) => {
        return candidate.trim().endsWith(source.publishedName);
    });
    if (!line) {
        console.warn(`${label}: not listed in ${source.publishedSums} any more; trusting the pinned hash`);
        return;
    }
    if (extractHash(line, 64).toLowerCase() !== source.sha256) {
        throw new Error(`${label}: the checksum published at ${source.publishedSums} differs from the pinned one`);
    }
}

async function fetchAniTools(workDir) {
    if (isAniCurrent()) {
        return;
    }
    console.log('> ani-cli + busybox + curl');
    mkdirSync(ANI_DIR, { recursive: true });
    writeFileSync(join(workDir, 'ani-cli'), await fetchVerified(ANI_SOURCES.aniCli, 'ani-cli'));
    writeFileSync(join(workDir, ANI.busyboxFile), await fetchVerified(ANI_SOURCES.busybox, 'busybox'));
    await crossCheckPublishedHash(ANI_SOURCES.busybox, 'busybox');
    const curlArchive = join(workDir, 'curl.tar.xz');
    writeFileSync(curlArchive, await fetchVerified(ANI_SOURCES.curl, 'curl'));
    const extracted = join(workDir, 'curl');
    extractTarXz(curlArchive, extracted);
    const curl = findFile(extracted, ANI.curlFile);
    if (!curl) {
        throw new Error(`${ANI.curlFile} not found in the static-curl archive`);
    }
    for (const [source, name] of [[join(workDir, 'ani-cli'), 'ani-cli'], [join(workDir, ANI.busyboxFile), ANI.busyboxFile], [curl, ANI.curlFile]]) {
        const target = join(ANI_DIR, name);
        copyFileSync(source, target);
        chmodSync(target, 0o755);
    }
    writeFileSync(ANI_MARKER, expectedAniMarker());
}

async function main() {
    mkdirSync(BIN_DIR, { recursive: true });
    const workDir = mkdtempSync(join(tmpdir(), 'pullwave-bin-'));
    try {
        await fetchYtdlp();
        await fetchDeno(workDir);
        await fetchFfmpeg(workDir);
        await fetchAniTools(workDir);
        console.log(`Binaries for ${PLATFORM} ready in ${BIN_DIR}`);
    } finally {
        rmSync(workDir, { recursive: true, force: true });
    }
}

main().catch((error) => {
    console.error(error.message);
    process.exit(1);
});
