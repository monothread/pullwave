import { join } from 'node:path';
import type { DownloadOptions, Settings } from '@shared/types';
import { FILE_PRINT_TEMPLATE, INFO_PRINT_TEMPLATE, POSTPROCESS_TEMPLATE, PROGRESS_TEMPLATE, STREAM_PRINT_TEMPLATE, THUMBNAIL_PRINT_TEMPLATE } from './progressParser';

const FILENAME_BYTE_LIMIT = '240';
const LIVE_WAIT_SECONDS = '30';
const LIVE_ONLY_FILTER = 'is_live';

export interface RequestExtras {
    downloadDir?: string;
    resumedPart?: number;
    options?: DownloadOptions;
}

export function splitArguments(input: string): string[] {
    const tokens: string[] = [];
    const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
    let match = pattern.exec(input);
    while (match !== null) {
        tokens.push(match[1] ?? match[2] ?? match[3] ?? '');
        match = pattern.exec(input);
    }
    return tokens;
}

function buildOutputTemplate(settings: Settings, extras: RequestExtras): string {
    const part = extras.resumedPart === undefined ? '' : ` (part ${extras.resumedPart})`;
    return `%(title).${settings.maxTitleLength}s [%(id)s]${part}.%(ext)s`;
}

function buildLiveArgs(settings: Settings, extras: RequestExtras): string[] {
    if (extras.resumedPart !== undefined) {
        return ['--match-filter', LIVE_ONLY_FILTER];
    }
    const args: string[] = [];
    if (settings.waitForLive) {
        args.push('--no-quiet', '--wait-for-video', LIVE_WAIT_SECONDS);
    }
    if (settings.liveFromStart) {
        args.push('--live-from-start', '--downloader-args', 'ffmpeg_i:-live_start_index 0');
    }
    return args;
}

function buildFormatArgs(settings: Settings): string[] {
    if (settings.audioOnly) {
        return ['-f', 'ba/b', '-x', '--audio-format', settings.audioFormat];
    }
    const heightFilter = settings.maxResolution === 'best' ? '' : `[height<=${settings.maxResolution}]`;
    return ['-f', `bv*${heightFilter}+ba/b${heightFilter}`, '--merge-output-format', settings.videoContainer];
}

function cookiesSource(settings: Settings): string {
    const { cookiesBrowser, cookiesBrowserDir, cookiesProfile } = settings;
    if (cookiesBrowserDir.length > 0) {
        return `${cookiesBrowser}:${cookiesProfile.length > 0 ? join(cookiesBrowserDir, cookiesProfile) : cookiesBrowserDir}`;
    }
    return cookiesProfile.length > 0 ? `${cookiesBrowser}:${cookiesProfile}` : cookiesBrowser;
}

function buildCookieArgs(settings: Settings): string[] {
    if (!settings.useBrowserCookies) {
        return [];
    }
    return ['--cookies-from-browser', cookiesSource(settings)];
}

function buildSubtitleArgs(settings: Settings): string[] {
    if (!settings.writeSubtitles) {
        return [];
    }
    const args = ['--sub-langs', settings.subtitleLangs.length > 0 ? settings.subtitleLangs : 'all'];
    args.push(settings.embedSubtitles ? '--embed-subs' : '--write-subs');
    if (settings.autoSubtitles) {
        args.push('--write-auto-subs');
    }
    return args;
}

function buildOptionalArgs(settings: Settings, ffmpegLocation: string | null): string[] {
    const args: string[] = [];
    if (settings.restrictFilenames) {
        args.push('--restrict-filenames');
    }
    if (settings.rateLimit.length > 0) {
        args.push('-r', settings.rateLimit);
    }
    if (ffmpegLocation !== null) {
        args.push('--ffmpeg-location', ffmpegLocation);
    }
    if (settings.jsRuntime.length > 0) {
        args.push('--js-runtimes', settings.jsRuntime);
    }
    return args;
}

export function buildYtdlpArgs(
    url: string,
    settings: Settings,
    defaultDownloadDir: string,
    ffmpegLocation: string | null = null,
    extras: RequestExtras = {}
): string[] {
    const downloadDir = extras.downloadDir ?? (settings.downloadDir.length > 0 ? settings.downloadDir : defaultDownloadDir);
    return [
        '--newline',
        '--no-colors',
        '--progress',
        '--no-simulate',
        '--progress-template',
        PROGRESS_TEMPLATE,
        '--progress-template',
        POSTPROCESS_TEMPLATE,
        '--print',
        FILE_PRINT_TEMPLATE,
        '--print',
        INFO_PRINT_TEMPLATE,
        '--print',
        STREAM_PRINT_TEMPLATE,
        '--print',
        THUMBNAIL_PRINT_TEMPLATE,
        '-P',
        downloadDir,
        '-o',
        buildOutputTemplate(settings, extras),
        '--trim-filenames',
        FILENAME_BYTE_LIMIT,
        settings.downloadPlaylist ? '--yes-playlist' : '--no-playlist',
        ...buildFormatArgs(settings),
        ...buildLiveArgs(settings, extras),
        ...buildCookieArgs(settings),
        ...buildSubtitleArgs(settings),
        ...buildOptionalArgs(settings, ffmpegLocation),
        ...splitArguments(settings.extraArgs),
        '--',
        url
    ];
}
