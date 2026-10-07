import {
    AUDIO_FORMATS,
    BROWSERS,
    DEFAULT_SETTINGS,
    LANGUAGE_SETTINGS,
    CONCURRENT_DOWNLOADS,
    MAX_LIVE_END_CHECK_SECONDS,
    MAX_TITLE_LENGTH,
    MIN_LIVE_END_CHECK_SECONDS,
    MIN_TITLE_LENGTH,
    RESOLUTIONS,
    START_TABS,
    THEMES,
    VIDEO_CONTAINERS
} from '@shared/constants';
import { ANIME_AUDIOS, ANIME_QUALITIES, ANIME_SUBTITLE_SETTINGS, TRANSLATION_LANGUAGES } from '@shared/anime';
import { LLM_PROVIDER_IDS, SPEECH_PROVIDER_IDS } from '@shared/llm';
import type { DownloadOptions, Settings } from '@shared/types';

const RATE_LIMIT_PATTERN = /^\d+(\.\d+)?[KkMmGg]?$/;

function pickEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
    return allowed.find((candidate) => {
        return candidate === value;
    }) ?? fallback;
}

function pickBoolean(value: unknown, fallback: boolean): boolean {
    return typeof value === 'boolean' ? value : fallback;
}

function pickString(value: unknown, fallback: string): string {
    return typeof value === 'string' ? value.trim() : fallback;
}

function pickClampedInteger(value: unknown, min: number, max: number, fallback: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return fallback;
    }
    return Math.min(max, Math.max(min, Math.round(value)));
}

function pickRateLimit(value: unknown): string {
    const candidate = pickString(value, '');
    return RATE_LIMIT_PATTERN.test(candidate) ? candidate : '';
}

export function sanitizeSettings(input: unknown): Settings {
    const raw = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
    const defaults = DEFAULT_SETTINGS;
    return {
        downloadDir: pickString(raw.downloadDir, defaults.downloadDir),
        useBrowserCookies: pickBoolean(raw.useBrowserCookies, defaults.useBrowserCookies),
        cookiesBrowser: pickEnum(raw.cookiesBrowser, BROWSERS, defaults.cookiesBrowser),
        cookiesBrowserDir: pickString(raw.cookiesBrowserDir, defaults.cookiesBrowserDir),
        cookiesProfile: pickString(raw.cookiesProfile, defaults.cookiesProfile),
        maxResolution: pickEnum(raw.maxResolution, RESOLUTIONS, defaults.maxResolution),
        videoContainer: pickEnum(raw.videoContainer, VIDEO_CONTAINERS, defaults.videoContainer),
        audioOnly: pickBoolean(raw.audioOnly, defaults.audioOnly),
        audioFormat: pickEnum(raw.audioFormat, AUDIO_FORMATS, defaults.audioFormat),
        maxTitleLength: pickClampedInteger(raw.maxTitleLength, MIN_TITLE_LENGTH, MAX_TITLE_LENGTH, defaults.maxTitleLength),
        deletePartialsOnFailure: pickBoolean(raw.deletePartialsOnFailure, defaults.deletePartialsOnFailure),
        restrictFilenames: pickBoolean(raw.restrictFilenames, defaults.restrictFilenames),
        downloadPlaylist: pickBoolean(raw.downloadPlaylist, defaults.downloadPlaylist),
        writeSubtitles: pickBoolean(raw.writeSubtitles, defaults.writeSubtitles),
        subtitleLangs: pickString(raw.subtitleLangs, defaults.subtitleLangs),
        autoSubtitles: pickBoolean(raw.autoSubtitles, defaults.autoSubtitles),
        embedSubtitles: pickBoolean(raw.embedSubtitles, defaults.embedSubtitles),
        rateLimit: pickRateLimit(raw.rateLimit),
        maxConcurrent: CONCURRENT_DOWNLOADS,
        ytdlpPath: pickString(raw.ytdlpPath, defaults.ytdlpPath),
        ffmpegPath: pickString(raw.ffmpegPath, defaults.ffmpegPath),
        jsRuntime: pickString(raw.jsRuntime, defaults.jsRuntime),
        checkUpdatesOnStart: pickBoolean(raw.checkUpdatesOnStart, defaults.checkUpdatesOnStart),
        closeToTray: pickBoolean(raw.closeToTray, defaults.closeToTray),
        liveFromStart: pickBoolean(raw.liveFromStart, defaults.liveFromStart),
        waitForLive: pickBoolean(raw.waitForLive, defaults.waitForLive),
        verifyLiveEnd: pickBoolean(raw.verifyLiveEnd, defaults.verifyLiveEnd),
        verifyLiveEndSeconds: pickClampedInteger(raw.verifyLiveEndSeconds, MIN_LIVE_END_CHECK_SECONDS, MAX_LIVE_END_CHECK_SECONDS, defaults.verifyLiveEndSeconds),
        theme: pickEnum(raw.theme, THEMES, defaults.theme),
        language: pickEnum(raw.language, LANGUAGE_SETTINGS, defaults.language),
        startTab: pickEnum(raw.startTab, START_TABS, defaults.startTab),
        extraArgs: pickString(raw.extraArgs, defaults.extraArgs),
        animeDownloadDir: pickString(raw.animeDownloadDir, defaults.animeDownloadDir),
        animeQuality: pickEnum(raw.animeQuality, ANIME_QUALITIES, defaults.animeQuality),
        animeAudio: pickEnum(raw.animeAudio, ANIME_AUDIOS, defaults.animeAudio),
        animeSubtitles: pickEnum(raw.animeSubtitles, ANIME_SUBTITLE_SETTINGS, defaults.animeSubtitles),
        translateProvider: pickEnum(raw.translateProvider, LLM_PROVIDER_IDS, defaults.translateProvider),
        translateModel: pickString(raw.translateModel, defaults.translateModel),
        translateBaseUrl: pickString(raw.translateBaseUrl, defaults.translateBaseUrl),
        translateLanguage: pickEnum(raw.translateLanguage, TRANSLATION_LANGUAGES, defaults.translateLanguage),
        transcribeProvider: pickEnum(raw.transcribeProvider, SPEECH_PROVIDER_IDS, defaults.transcribeProvider),
        transcribeModel: pickString(raw.transcribeModel, defaults.transcribeModel),
        transcribeBaseUrl: pickString(raw.transcribeBaseUrl, defaults.transcribeBaseUrl)
    };
}

const OPTION_KEYS = ['maxResolution', 'videoContainer', 'audioOnly', 'audioFormat', 'liveFromStart', 'waitForLive', 'verifyLiveEnd', 'verifyLiveEndSeconds'] as const;

function isOneOf(allowed: readonly string[], value: unknown): boolean {
    return typeof value === 'string' && allowed.includes(value);
}

function isOptionValid(key: (typeof OPTION_KEYS)[number], value: unknown): boolean {
    switch (key) {
        case 'maxResolution':
            return isOneOf(RESOLUTIONS, value);
        case 'videoContainer':
            return isOneOf(VIDEO_CONTAINERS, value);
        case 'audioFormat':
            return isOneOf(AUDIO_FORMATS, value);
        case 'verifyLiveEndSeconds':
            return typeof value === 'number' && Number.isFinite(value);
        default:
            return typeof value === 'boolean';
    }
}

// The options a download may carry: only the known fields with valid values; anything else (or nothing) follows the settings.
export function sanitizeDownloadOptions(input: unknown): DownloadOptions {
    if (typeof input !== 'object' || input === null) {
        return {};
    }
    const raw = input as Record<string, unknown>;
    const options: Record<string, unknown> = {};
    OPTION_KEYS.forEach((key) => {
        if (!(key in raw) || !isOptionValid(key, raw[key])) {
            return;
        }
        options[key] = key === 'verifyLiveEndSeconds' ? pickClampedInteger(raw[key], MIN_LIVE_END_CHECK_SECONDS, MAX_LIVE_END_CHECK_SECONDS, DEFAULT_SETTINGS.verifyLiveEndSeconds) : raw[key];
    });
    return options as DownloadOptions;
}
