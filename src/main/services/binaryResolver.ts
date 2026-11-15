import { delimiter, dirname } from 'node:path';
import type { ProgramId } from '@shared/tools';
import type { BinarySource, Settings } from '@shared/types';

export const YTDLP_COMMAND = 'yt-dlp';
export const FFMPEG_COMMAND = 'ffmpeg';

export function executableName(command: string, platform: NodeJS.Platform = process.platform): string {
    return platform === 'win32' ? `${command}.exe` : command;
}

export interface InstalledPrograms {
    pathOf: (id: ProgramId, relativePath?: string) => string | null;
    expectedPathOf: (id: ProgramId, relativePath?: string) => string | null;
}

export interface ResolvedBinary {
    path: string;
    source: BinarySource;
}

export class BinaryResolver {
    constructor(private readonly programs: InstalledPrograms) {}

    private installed(id: ProgramId): ResolvedBinary {
        return { path: this.programs.pathOf(id) ?? this.programs.expectedPathOf(id) ?? '', source: 'installed' };
    }

    ytdlp(settings: Settings): ResolvedBinary {
        return settings.ytdlpPath.length > 0 ? { path: settings.ytdlpPath, source: 'custom' } : this.installed('ytdlp');
    }

    ffmpeg(settings: Settings): ResolvedBinary {
        return settings.ffmpegPath.length > 0 ? { path: settings.ffmpegPath, source: 'custom' } : this.installed('ffmpeg');
    }

    ffmpegLocation(settings: Settings): string | null {
        const resolved = this.ffmpeg(settings);
        if (resolved.source === 'custom') {
            return resolved.path;
        }
        const installed = this.programs.pathOf('ffmpeg');
        return installed === null ? null : dirname(installed);
    }

    spawnEnv(baseEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
        const folders = (['deno', 'ffmpeg'] as const).flatMap((id) => {
            const path = this.programs.pathOf(id);
            return path === null ? [] : [dirname(path)];
        });
        if (folders.length === 0) {
            return baseEnv;
        }
        const pathKey =
            Object.keys(baseEnv).find((key) => {
                return key.toLowerCase() === 'path';
            }) ?? 'PATH';
        const currentPath = baseEnv[pathKey] ?? '';
        const front = folders.join(delimiter);
        return { ...baseEnv, [pathKey]: currentPath.length > 0 ? `${front}${delimiter}${currentPath}` : front };
    }
}
