import type { ToolSpec } from '@shared/tools';

export const SUWAYOMI_VERSION = 'v2.4.2366';
export const SUWAYOMI_SELECTED_FILE = 'suwayomi-selected.json';
const EXCLUDE = ['electron'];

const LAYOUT = {
    linux: { suffix: 'linux-x64.tar.gz', format: 'tar.gz', java: 'jre/bin/java' },
    win32: { suffix: 'windows-x64.zip', format: 'zip', java: 'jre/bin/java.exe' }
} as const;

export interface SuwayomiRelease {
    version: string;
    sha256: string;
    sizeBytes: number;
}

export function suwayomiAssetName(platform: NodeJS.Platform, arch: string, version: string): string | null {
    const layout = arch === 'x64' ? LAYOUT[platform as keyof typeof LAYOUT] : undefined;
    return layout === undefined ? null : `Suwayomi-Server-${version}-${layout.suffix}`;
}

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

export function suwayomiSpec(platform: NodeJS.Platform, arch: string): ToolSpec | null {
    if (arch !== 'x64' || (platform !== 'linux' && platform !== 'win32')) {
        return null;
    }
    return suwayomiReleaseSpec(platform, arch, PINNED[platform]);
}
