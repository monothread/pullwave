import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { PROGRAM_IDS, type ProgramId } from '../../src/shared/tools';
import { ffmpegSpec, ffmpegVersionOf, pinnedSpec, programPlatform } from '../../src/main/services/tools/programSpecs';
import { MARKER_FILE } from '../../src/main/services/tools/toolInstaller';

// The app downloads yt-dlp, deno, ffmpeg, ani-cli, busybox and curl the first time it opens. The end-to-end tests do not download anything:
// they start the app with PULLWAVE_NO_TOOLS=1 (it does not go looking for them) and PULLWAVE_TOOLS_DIR pointing at a folder where the
// programs are already "installed" (linked, or copied on Windows, from resources/bin, which `node scripts/fetch-binaries.mjs` fills for the
// tests that need the real ones; what is not there is a script that does nothing).

const ROOT = resolve(__dirname, '../..');
const SOURCE_DIR = join(ROOT, 'resources', 'bin');
const FFMPEG_ASSETS = { linux: 'ffmpeg-n9.0-latest-linux64-gpl-shared-9.0.tar.xz', win32: 'ffmpeg-n9.0-latest-win64-gpl-shared-9.0.zip' } as const;
const FFMPEG_SHA256 = 'f'.repeat(64);
const WIN32 = process.platform === 'win32';
const EXE = WIN32 ? '.exe' : '';

// Where the real file of each file of a program is, when the tests have it.
function sourceOf(file: string): string {
    const names: Record<string, string> = {
        'yt-dlp': join(SOURCE_DIR, `yt-dlp${EXE}`),
        'yt-dlp.exe': join(SOURCE_DIR, 'yt-dlp.exe'),
        deno: join(SOURCE_DIR, `deno${EXE}`),
        'deno.exe': join(SOURCE_DIR, 'deno.exe'),
        'bin/ffmpeg': join(SOURCE_DIR, 'ffmpeg'),
        'bin/ffprobe': join(SOURCE_DIR, 'ffprobe'),
        'bin/ffmpeg.exe': join(SOURCE_DIR, 'ffmpeg.exe'),
        'bin/ffprobe.exe': join(SOURCE_DIR, 'ffprobe.exe'),
        'ani-cli': join(SOURCE_DIR, 'ani', 'ani-cli'),
        busybox: join(SOURCE_DIR, 'ani', 'busybox'),
        'busybox.exe': join(SOURCE_DIR, 'ani', 'busybox.exe'),
        curl: join(SOURCE_DIR, 'ani', 'curl'),
        'curl.exe': join(SOURCE_DIR, 'ani', 'curl.exe')
    };
    return names[file] ?? '';
}

function exists(path: string): boolean {
    try {
        lstatSync(path);
        return true;
    } catch {
        return false;
    }
}

function putFile(source: string, destination: string): void {
    if (exists(destination)) {
        return;
    }
    mkdirSync(dirname(destination), { recursive: true });
    if (source !== '' && existsSync(source)) {
        if (WIN32) {
            copyFileSync(source, destination);
        } else {
            symlinkSync(source, destination);
        }
        return;
    }
    writeFileSync(destination, '#!/bin/sh\nexit 0\n');
    chmodSync(destination, 0o755);
}

export interface ProgramsDirectory {
    // Where the folder of the programs is (PULLWAVE_TOOLS_DIR).
    directory: string;
}

// Puts every program (or only `only`) into `directory` as if the app had downloaded it.
export function installPrograms(directory: string, only: readonly ProgramId[] = PROGRAM_IDS): ProgramsDirectory {
    const system = programPlatform(process.platform, process.arch);
    mkdirSync(directory, { recursive: true });
    if (system === null) {
        return { directory };
    }
    for (const id of only) {
        const spec =
            id === 'ffmpeg'
                ? ffmpegSpec(system, FFMPEG_ASSETS[system], FFMPEG_SHA256, 1)
                : pinnedSpec(id, process.platform, process.arch);
        if (spec === null) {
            continue;
        }
        const folder = join(directory, spec.id, spec.version);
        for (const file of spec.executables) {
            putFile(sourceOf(file), join(folder, file));
        }
        writeFileSync(join(folder, MARKER_FILE), JSON.stringify({ id: spec.id, version: spec.version, sha256: spec.sha256 }));
        if (id === 'ffmpeg') {
            writeFileSync(join(directory, 'ffmpeg-selected.json'), JSON.stringify({ version: ffmpegVersionOf(FFMPEG_SHA256), sha256: FFMPEG_SHA256, sizeBytes: 1, asset: FFMPEG_ASSETS[system] }));
        }
    }
    return { directory };
}

// The environment that makes the app use the programs of `directory` and not go looking for others.
export function programsEnv(directory: string): Record<string, string> {
    return { PULLWAVE_TOOLS_DIR: directory, PULLWAVE_NO_TOOLS: '1' };
}

// Installs every program in a new folder inside `workDir` and gives the environment for it.
export function installedProgramsEnv(workDir: string): Record<string, string> {
    const { directory } = installPrograms(join(workDir, 'tools'));
    return programsEnv(directory);
}

// The environment of the app for a test that gives it no other variable: the one of the test, with the programs installed.
export function appEnv(workDir: string): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [name, value] of Object.entries(process.env)) {
        if (value !== undefined) {
            env[name] = value;
        }
    }
    return { ...env, ...installedProgramsEnv(workDir) };
}
