import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import type { BinarySource, Settings } from '@shared/types';

export const YTDLP_COMMAND = 'yt-dlp';
export const FFMPEG_COMMAND = 'ffmpeg';

export function executableName(command: string, platform: NodeJS.Platform = process.platform): string {
    return platform === 'win32' ? `${command}.exe` : command;
}

export interface BinaryLocations {
    bundledDir: string;
    userBinDir: string;
}

export interface ResolvedBinary {
    path: string;
    source: BinarySource;
}

export class BinaryResolver {
    constructor(
        private readonly locations: BinaryLocations,
        private readonly exists: (path: string) => boolean = existsSync,
        private readonly platform: NodeJS.Platform = process.platform
    ) {}

    get userYtdlpPath(): string {
        return join(this.locations.userBinDir, executableName(YTDLP_COMMAND, this.platform));
    }

    // The yt-dlp that ships with the app, whether it is there or not.
    get bundledYtdlpPath(): string {
        return join(this.locations.bundledDir, executableName(YTDLP_COMMAND, this.platform));
    }

    // Whether the yt-dlp that ships with the app is there.
    hasBundledYtdlp(): boolean {
        return this.exists(this.bundledYtdlpPath);
    }

    // Whether an update saved its own yt-dlp (the one the app then prefers to the bundled one).
    hasUpdatedYtdlp(): boolean {
        return this.exists(this.userYtdlpPath);
    }

    get userBinDir(): string {
        return this.locations.userBinDir;
    }

    ytdlp(settings: Settings): ResolvedBinary {
        if (settings.ytdlpPath.length > 0) {
            return { path: settings.ytdlpPath, source: 'custom' };
        }
        if (this.exists(this.userYtdlpPath)) {
            return { path: this.userYtdlpPath, source: 'updated' };
        }
        const bundledPath = join(this.locations.bundledDir, executableName(YTDLP_COMMAND, this.platform));
        if (this.exists(bundledPath)) {
            return { path: bundledPath, source: 'bundled' };
        }
        return { path: YTDLP_COMMAND, source: 'system' };
    }

    ffmpeg(settings: Settings): ResolvedBinary {
        if (settings.ffmpegPath.length > 0) {
            return { path: settings.ffmpegPath, source: 'custom' };
        }
        const bundledPath = join(this.locations.bundledDir, executableName(FFMPEG_COMMAND, this.platform));
        if (this.exists(bundledPath)) {
            return { path: bundledPath, source: 'bundled' };
        }
        return { path: FFMPEG_COMMAND, source: 'system' };
    }

    ffmpegLocation(settings: Settings): string | null {
        const resolved = this.ffmpeg(settings);
        if (resolved.source === 'custom') {
            return resolved.path;
        }
        return resolved.source === 'bundled' ? this.locations.bundledDir : null;
    }

    spawnEnv(baseEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
        if (!this.exists(this.locations.bundledDir)) {
            return baseEnv;
        }
        // On Windows the variable is usually spelled "Path"; adding a second "PATH" key would be ignored.
        const pathKey =
            Object.keys(baseEnv).find((key) => {
                return key.toLowerCase() === 'path';
            }) ?? 'PATH';
        const currentPath = baseEnv[pathKey] ?? '';
        const pathValue = currentPath.length > 0 ? `${this.locations.bundledDir}${delimiter}${currentPath}` : this.locations.bundledDir;
        return { ...baseEnv, [pathKey]: pathValue };
    }
}
