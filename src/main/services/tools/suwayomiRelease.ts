import type { ToolSpec } from '@shared/tools';

// The version of Suwayomi-Server the app runs, with the checksums its release publishes (Checksums.sha256). The app does not
// run any other one: moving to a newer release means changing this file.
export const SUWAYOMI_VERSION = 'v2.4.2366';
// Dropped when unpacking: a browser engine for a window the app never opens (it would triple the size on the disk).
const EXCLUDE = ['electron'];

// What a release of Suwayomi-Server is, for one system: the file it publishes there and what has to be there once it is unpacked.
const LAYOUT = {
    linux: { suffix: 'linux-x64.tar.gz', format: 'tar.gz', java: 'jre/bin/java' },
    win32: { suffix: 'windows-x64.zip', format: 'zip', java: 'jre/bin/java.exe' }
} as const;

export interface SuwayomiRelease {
    version: string;
    sha256: string;
    sizeBytes: number;
}

// The name of the file a release publishes for a system, or null where there is none.
export function suwayomiAssetName(platform: NodeJS.Platform, arch: string, version: string): string | null {
    const layout = arch === 'x64' ? LAYOUT[platform as keyof typeof LAYOUT] : undefined;
    return layout === undefined ? null : `Suwayomi-Server-${version}-${layout.suffix}`;
}

// The program to install for a release of Suwayomi-Server. The address is always built here, from the version, so nothing that is read
// from the network or from the disk can point it anywhere else.
export function suwayomiReleaseSpec(platform: NodeJS.Platform, arch: string, release: SuwayomiRelease): ToolSpec | null {
    const layout = arch === 'x64' ? LAYOUT[platform as keyof typeof LAYOUT] : undefined;
    const name = suwayomiAssetName(platform, arch, release.version);
    if (layout === undefined || name === null) {
        return null;
    }
    return {
        id: 'suwayomi',
        version: release.version,
        url: `https://github.com/Suwayomi/Suwayomi-Server/releases/download/${release.version}/${name}`,
        sha256: release.sha256,
        sizeBytes: release.sizeBytes,
        format: layout.format,
        stripComponents: 1,
        exclude: EXCLUDE,
        executables: [layout.java],
        entry: 'bin/Suwayomi-Server.jar'
    };
}

const PINNED: Record<'linux' | 'win32', SuwayomiRelease> = {
    linux: { version: SUWAYOMI_VERSION, sha256: '7a469f8c820e65305f795d61f1776c783919884531497b587bdff898a7e0fa73', sizeBytes: 337_841_487 },
    win32: { version: SUWAYOMI_VERSION, sha256: 'b955f374a8d94b8d1c2750ae28fa7eb2066b479957561b5ba9cf8ac993c8fc13', sizeBytes: 343_828_201 }
};

// The release for this system, or null where there is none (the app runs the manga section on Linux and Windows, 64 bits).
export function suwayomiSpec(platform: NodeJS.Platform, arch: string): ToolSpec | null {
    if (arch !== 'x64' || (platform !== 'linux' && platform !== 'win32')) {
        return null;
    }
    return suwayomiReleaseSpec(platform, arch, PINNED[platform]);
}
