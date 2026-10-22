import { join } from 'node:path';
import type { DownloadOptions, Settings } from '@shared/types';
import { FILE_PRINT_TEMPLATE, INFO_PRINT_TEMPLATE, POSTPROCESS_TEMPLATE, PROGRESS_TEMPLATE, STREAM_PRINT_TEMPLATE } from './progressParser';

const FILENAME_BYTE_LIMIT = '240';
const LIVE_WAIT_SECONDS = '30';
const LIVE_ONLY_FILTER = 'is_live';

// What a download found by the stream finder needs to reach the stream as the page itself would have.
export interface RequestExtras {
    referer?: string;
    userAgent?: string;
    cookie?: string;
    title?: string;
    // Folder for this download only; replaces the one in the settings.
    downloadDir?: string;
    // Force the IP family the address is bound to.
    ipFamily?: 4 | 6;
    // The page the stream was found on; used to look for a fresh address, never passed to yt-dlp.
    pageUrl?: string;
    // A new attempt to record a live stream that came back: the file gets a part number, the recording does not start over
    // and yt-dlp skips the video unless it is live.
    resumedPart?: number;
    // Settings chosen for this download only; they replace the ones in the settings.
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

const INVALID_FILENAME_CHARACTERS = new Set(['\\', '/', ':', '*', '?', '"', '<', '>', '|']);

function replaceInvalidCharacters(title: string): string {
    return Array.from(title, (character) => {
        return character.charCodeAt(0) < 32 || INVALID_FILENAME_CHARACTERS.has(character) ? ' ' : character;
    }).join('');
}

// A title taken from a web page goes into an output template: "%" must be escaped and path separators removed.
export function escapeTitleForTemplate(title: string, maxLength: number): string {
    return replaceInvalidCharacters(title)
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maxLength)
        .trim()
        .replace(/%/g, '%%');
}

function buildOutputTemplate(settings: Settings, extras: RequestExtras): string {
    const title = extras.title ? escapeTitleForTemplate(extras.title, settings.maxTitleLength) : '';
    const part = extras.resumedPart === undefined ? '' : ` (part ${extras.resumedPart})`;
    return title.length > 0 ? `${title} [%(id)s]${part}.%(ext)s` : `%(title).${settings.maxTitleLength}s [%(id)s]${part}.%(ext)s`;
}

// Live streams. "From the start" is honoured where the site allows it: yt-dlp's own option (YouTube, Twitch) and, for
// HLS recorded through ffmpeg, starting at the first segment the playlist still offers (the whole broadcast when the
// broadcaster keeps it, as in DVR/EVENT playlists). While waiting for a scheduled stream yt-dlp must not be quiet,
// otherwise its "[wait]" lines are hidden and the app cannot tell that it is waiting.
function buildLiveArgs(settings: Settings, extras: RequestExtras): string[] {
    if (extras.resumedPart !== undefined) {
        // A stream that came back is recorded from now on, and only when it really is live.
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

function buildRequestArgs(extras: RequestExtras): string[] {
    const args: string[] = [];
    if (extras.referer) {
        args.push('--referer', extras.referer);
    }
    if (extras.userAgent) {
        args.push('--user-agent', extras.userAgent);
    }
    if (extras.cookie) {
        args.push('--add-header', `Cookie:${extras.cookie}`);
    }
    if (extras.ipFamily) {
        args.push(extras.ipFamily === 6 ? '--force-ipv6' : '--force-ipv4');
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

// BROWSER[:PROFILE] where PROFILE is a profile name or, for a browser found in a custom place, the folder to read from.
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
    // --embed-subs already downloads the author's subtitles and then deletes the files; an explicit --write-subs would keep them.
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
        ...buildRequestArgs(extras),
        ...splitArguments(settings.extraArgs),
        '--',
        url
    ];
}
