import type { ToolSpec } from '@shared/tools';

// The version of Suwayomi-Server the app runs, with the checksums its release publishes (Checksums.sha256). The app does not
// run any other one: moving to a newer release means changing this file.
export const SUWAYOMI_VERSION = 'v2.4.2366';
const BASE = `https://github.com/Suwayomi/Suwayomi-Server/releases/download/${SUWAYOMI_VERSION}`;
// Dropped when unpacking: a browser engine for a window the app never opens (it would triple the size on the disk).
const EXCLUDE = ['electron'];

const LINUX_X64: ToolSpec = {
    id: 'suwayomi',
    version: SUWAYOMI_VERSION,
    url: `${BASE}/Suwayomi-Server-${SUWAYOMI_VERSION}-linux-x64.tar.gz`,
    sha256: '7a469f8c820e65305f795d61f1776c783919884531497b587bdff898a7e0fa73',
    sizeBytes: 337_841_487,
    format: 'tar.gz',
    stripComponents: 1,
    exclude: EXCLUDE,
    executables: ['jre/bin/java'],
    entry: 'bin/Suwayomi-Server.jar'
};

const WINDOWS_X64: ToolSpec = {
    id: 'suwayomi',
    version: SUWAYOMI_VERSION,
    url: `${BASE}/Suwayomi-Server-${SUWAYOMI_VERSION}-windows-x64.zip`,
    sha256: 'b955f374a8d94b8d1c2750ae28fa7eb2066b479957561b5ba9cf8ac993c8fc13',
    sizeBytes: 343_828_201,
    format: 'zip',
    stripComponents: 1,
    exclude: EXCLUDE,
    executables: ['jre/bin/java.exe'],
    entry: 'bin/Suwayomi-Server.jar'
};

// The release for this system, or null where there is none (the app runs the manga section on Linux and Windows, 64 bits).
export function suwayomiSpec(platform: NodeJS.Platform, arch: string): ToolSpec | null {
    if (arch !== 'x64') {
        return null;
    }
    if (platform === 'linux') {
        return LINUX_X64;
    }
    return platform === 'win32' ? WINDOWS_X64 : null;
}
