import { delimiter, dirname } from 'node:path';
import type { ProgramId } from '@shared/tools';
import type { BinarySource, Settings } from '@shared/types';

export const YTDLP_COMMAND = 'yt-dlp';
export const FFMPEG_COMMAND = 'ffmpeg';

export function executableName(command: string, platform: NodeJS.Platform = process.platform): string {
    return platform === 'win32' ? `${command}.exe` : command;
}

// The programs the app installed in its own folder (see ProgramTools), as the resolver needs them.
export interface InstalledPrograms {
    // The file of the program, null while it is not installed.
    pathOf: (id: ProgramId, relativePath?: string) => string | null;
    // Where the file will be once the program is installed (null while its version is not known).
    expectedPathOf: (id: ProgramId, relativePath?: string) => string | null;
}

export interface ResolvedBinary {
    path: string;
    source: BinarySource;
}

// Which yt-dlp and ffmpeg to run: the path the user chose in the settings, otherwise the one the app installed. A program of the system is
// never taken by mistake (it would be one of another version than the one the app was made and tested with). While the program is not
// installed its place is given anyway, so that running it fails with "not found" and the screen can say the program is missing.
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

    // What yt-dlp is told as --ffmpeg-location: the file the user chose, or the folder of the install (ffmpeg and ffprobe are in it). Null
    // while ffmpeg is not installed.
    ffmpegLocation(settings: Settings): string | null {
        const resolved = this.ffmpeg(settings);
        if (resolved.source === 'custom') {
            return resolved.path;
        }
        const installed = this.programs.pathOf('ffmpeg');
        return installed === null ? null : dirname(installed);
    }

    // The folders of the programs that others run (yt-dlp runs deno and ffprobe, which is beside ffmpeg), put in front of PATH for what the
    // app starts, so they are found there and nothing else on the system is taken instead.
    spawnEnv(baseEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
        const folders = (['deno', 'ffmpeg'] as const).flatMap((id) => {
            const path = this.programs.pathOf(id);
            return path === null ? [] : [dirname(path)];
        });
        if (folders.length === 0) {
            return baseEnv;
        }
        // On Windows the variable is usually spelled "Path"; adding a second "PATH" key would be ignored.
        const pathKey =
            Object.keys(baseEnv).find((key) => {
                return key.toLowerCase() === 'path';
            }) ?? 'PATH';
        const currentPath = baseEnv[pathKey] ?? '';
        const front = folders.join(delimiter);
        return { ...baseEnv, [pathKey]: currentPath.length > 0 ? `${front}${delimiter}${currentPath}` : front };
    }
}
