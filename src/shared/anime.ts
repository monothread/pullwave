import type { LlmError, SpeechTranslatesTo } from './llm';
import type { ErrorDetails } from './errorDetails';
import type { DownloadPart, DownloadPartKind } from './types';

export interface AnimeSearchResult {
    index: number;
    title: string;
    sourceId?: string;
    unconfirmed?: boolean;
}

export type AniErrorCode =
    | 'NO_RESULTS'
    | 'BLOCKED'
    | 'NETWORK'
    | 'NO_SOURCES'
    | 'EPISODE_NOT_RELEASED'
    | 'INVALID_SELECTION'
    | 'BINARY_MISSING'
    | 'UNKNOWN';

export interface AniError {
    code: AniErrorCode;
    raw: string;
    details?: ErrorDetails;
}

export interface AniDownloadProgress {
    percent: number;
    totalBytes: number | null;
    speed: string | null;
    eta: string | null;
}

export interface AniPartStart {
    kinds: DownloadPartKind[];
    index: number;
}

export type AniRunResult<T> = { status: 'done'; value: T } | { status: 'error'; error: AniError } | { status: 'cancelled' };

export const ANIME_QUALITIES = ['best', '1080p', '720p', '480p', '360p', 'worst'] as const;
export type AnimeQuality = (typeof ANIME_QUALITIES)[number];
export const DEFAULT_ANIME_QUALITY_SETTING: AnimeQuality = 'best';

export const ANIME_SUBTITLE_LANGUAGES = ['English', 'Portuguese', 'Spanish', 'French', 'German', 'Italian', 'Russian'] as const;
export const ANIME_SUBTITLE_SETTINGS = ['auto', 'default', ...ANIME_SUBTITLE_LANGUAGES] as const;
export type AnimeSubtitleSetting = (typeof ANIME_SUBTITLE_SETTINGS)[number];

export type AnimeEpisodeStatus = 'idle' | 'queued' | 'downloading' | 'paused' | 'done' | 'error' | 'cancelled';

export const ANIME_AIRING_STATUSES = ['finished', 'ongoing'] as const;
export type AnimeAiringStatus = (typeof ANIME_AIRING_STATUSES)[number];
export const ANIME_AIRING_OVERRIDES = ['complete', 'ongoing'] as const;
export type AnimeAiringOverride = (typeof ANIME_AIRING_OVERRIDES)[number];

export interface AnimeAiring {
    status: AnimeAiringStatus | null;
    override: AnimeAiringOverride | null;
    complete: boolean;
}

export function isAnimeComplete(status: AnimeAiringStatus | null, override: AnimeAiringOverride | null): boolean {
    return override === null ? status === 'finished' : override === 'complete';
}

export interface AnimeRecord {
    id: number;
    title: string;
    query: string;
    searchIndex: number;
    sourceId: string | null;
    createdAt: number;
    series: string | null;
    season: number | null;
    seasonName: string | null;
    airing: AnimeAiring;
}

export interface AnimeEpisodeRecord {
    id: number;
    animeId: number;
    number: string;
    status: AnimeEpisodeStatus;
    filePath: string | null;
    sizeBytes: number | null;
    error: AniError | null;
    positionSeconds: number;
    durationSeconds: number;
    watched: boolean;
    downloadedAt: number | null;
    addedAt: number | null;
    fileMissing: boolean;
    noAudio: boolean;
}

export interface AnimeHistoryEntry {
    id: number;
    title: string;
    query: string;
    searchIndex: number;
    episode: string | null;
    openedAt: number;
    watchedAt: number | null;
}

export interface AnimeHistoryRequest {
    title: string;
    query: string;
    index: number;
    episode: string | null;
}

export interface LibraryAnime extends AnimeRecord {
    episodes: AnimeEpisodeRecord[];
}

export interface AnimeJob {
    episodeId: number;
    animeId: number;
    animeTitle: string;
    episode: string;
    status: 'queued' | 'running' | 'paused' | 'done' | 'error' | 'cancelled';
    percent: number;
    speed: string;
    eta: string;
    error: AniError | null;
    parts: DownloadPart[] | null;
    postProcess: string | null;
    postProcessSteps: string[];
}

export const ANIME_JOIN_STEP = 'Merger';

export interface AniCliInfo {
    found: boolean;
    path: string;
    version: string | null;
    source: 'custom' | 'installed';
}

export interface AnimeStatus {
    supported: boolean;
    available: boolean;
    aniCli: AniCliInfo | null;
}

export const MAX_SEARCH_RESULTS = 120;

export interface AnimeSearchListing {
    results: AnimeSearchResult[];
    hasNextPage: boolean;
    limited: boolean;
}

export type AnimeSearchResponse = ({ ok: true } & AnimeSearchListing) | { ok: false; error: AniError };
export type AnimeEpisodesResponse = { ok: true; episodes: string[] } | { ok: false; error: AniError };

export interface AnimeDownloadRequest {
    title: string;
    query: string;
    index: number;
    sourceId?: string | null;
    episodes: string[];
    series?: string | null;
    season?: number | null;
    seasonName?: string | null;
}

export interface AnimeScheduleEntry {
    anilistId: number;
    title: string;
    english: string | null;
    romaji: string | null;
    names: string[];
    episode: number;
    airingAt: number;
    coverUrl: string | null;
}

export interface AnimeScheduleRequest {
    from: number;
    to: number;
    refresh: boolean;
}

export type AnimeScheduleResponse = { ok: true; entries: AnimeScheduleEntry[] } | { ok: false; error: AniError };

export interface AnimeCoverUpdate {
    title: string;
    url: string;
}

export type AnimeSeriesResponse = { ok: true } | { ok: false; reason: 'invalid' } | { ok: false; reason: 'season-taken'; suggested: number };

export interface AnimeAddRequest {
    title: string;
    query: string;
    index: number;
    sourceId?: string | null;
    episodes: string[];
    series: string | null;
    season: number | null;
    seasonName: string | null;
}

export type AnimeAddResponse = { ok: true; anime: LibraryAnime } | { ok: false; reason: 'invalid' | 'busy' } | { ok: false; reason: 'season-taken'; suggested: number };

export type AnimeRenameSeriesResponse =
    | { ok: true }
    | { ok: false; reason: 'invalid' }
    | { ok: false; reason: 'season-taken'; anime: string; season: number; suggested: number };

export type AnimeDownloadResponse = { ok: true; anime: LibraryAnime } | { ok: false; message: string };

export const MAX_AUTO_DOWNLOAD_EPISODES = 24;

export const ANIME_ARRIVAL_ORIGINS = ['auto', 'manual'] as const;
export type AnimeArrivalOrigin = (typeof ANIME_ARRIVAL_ORIGINS)[number];

export interface AnimeUpdateEntry {
    id: number;
    animeId: number;
    animeTitle: string;
    episodeId: number;
    episodeNumber: string;
    foundAt: number;
    origin: AnimeArrivalOrigin;
    status: AnimeEpisodeStatus;
}

export interface AnimeNewEpisodes {
    count: number;
    titles: string[];
    notDownloaded: string[];
}

export interface AnimeCheckError {
    code: 'NOT_FOUND' | 'UNKNOWN';
    message: string;
}

export interface AnimeCheckState {
    running: boolean;
    origin: AnimeArrivalOrigin | null;
    done: number;
    total: number;
    current: string | null;
}

export const IDLE_CHECK_STATE: AnimeCheckState = { running: false, origin: null, done: 0, total: 0, current: null };

export type AnimeCheckResponse =
    | { ok: true; count: number; titles: string[]; notDownloaded: string[]; failed: number; skipped: number }
    | { ok: false; error: AnimeCheckError };

export interface AnimeProgressUpdate {
    episodeId: number;
    positionSeconds: number;
    durationSeconds: number;
    watched: boolean;
}

export const ANIME_MEDIA_SCHEME = 'pullwave-media';
export type AnimeMediaKind = 'episode' | 'subtitle';

export function animeMediaUrl(kind: AnimeMediaKind, episodeId: number, trackId = ''): string {
    const base = `${ANIME_MEDIA_SCHEME}://${kind}/${episodeId}`;
    return trackId.length > 0 ? `${base}/${encodeURIComponent(trackId)}` : base;
}

export function episodeVideoUrl(episodeId: number, opening: number): string {
    return `${animeMediaUrl('episode', episodeId)}?v=${opening}`;
}

export type AnimeSubtitleKind = 'default' | 'source' | 'imported' | 'generated' | 'translated';

export interface AnimeSubtitleTrack {
    id: string;
    label: string;
    kind: AnimeSubtitleKind;
}

export interface AnimeImportSummary {
    added: number;
    relinked: number;
    skipped: number;
    ignored: number;
}

export type AnimeImportResponse = ({ ok: true } & AnimeImportSummary) | { ok: false; reason: 'cancelled' } | { ok: false; reason: 'outside'; folder: string };

export interface AnimeAudioCheckSummary {
    checked: number;
    withoutAudio: number;
    unreadable: number;
    unreadableIds: number[];
    missing: number;
}

export interface AnimeRepairSummary {
    repaired: number;
    failed: number;
    skipped: number;
}

export type AnimeRepairResponse = ({ ok: true } & AnimeRepairSummary) | { ok: false; reason: 'busy' | 'unsupported' };

export type AnimeAudioCheckResponse = ({ ok: true } & AnimeAudioCheckSummary) | { ok: false; reason: 'busy' | 'unsupported' };

export interface AnimeMigrationProgress {
    done: number;
    total: number;
}

export type AnimeMigrationFailure = 'cancelled' | 'busy' | 'same' | 'inside' | 'conflict' | 'failed';

export type AnimeMigrationResponse =
    | { ok: true; episodes: number; files: number; destination: string }
    | { ok: false; reason: AnimeMigrationFailure };

export const MAX_SUBTITLE_BYTES = 5 * 1024 * 1024;

export type AnimeSubtitleImportResponse =
    | { ok: true; tracks: AnimeSubtitleTrack[]; imported: AnimeSubtitleTrack }
    | { ok: false; reason: 'cancelled' | 'unsupported' | 'too-large' | 'unreadable' | 'missing' };

export type AnimeSubtitleCheckResponse =
    | { ok: true; added: string[]; tracks: AnimeSubtitleTrack[] }
    | { ok: false; reason: 'missing' }
    | { ok: false; reason: 'failed'; error: AniError };

export const TRANSLATION_LANGUAGES = [
    'Portuguese (Brazil)',
    'Portuguese',
    'Spanish',
    'English',
    'French',
    'German',
    'Italian',
    'Russian',
    'Japanese',
    'Chinese',
    'Korean',
    'Arabic',
    'Turkish',
    'Indonesian'
] as const;
export type TranslationLanguage = (typeof TRANSLATION_LANGUAGES)[number];
export const DEFAULT_TRANSLATION_LANGUAGE: TranslationLanguage = 'Portuguese (Brazil)';

export interface SubtitleTranslateRequest {
    episodeId: number;
    trackId: string | null;
    language: TranslationLanguage;
    replace?: boolean;
}

export type SubtitleTranslateFailure = 'missing' | 'no-source' | 'no-token' | 'no-model' | 'no-address' | 'unreadable' | 'too-large' | 'empty' | 'busy' | 'exists' | 'cancelled';

export type SubtitleTranslateResponse =
    | { ok: true; tracks: AnimeSubtitleTrack[]; translated: AnimeSubtitleTrack }
    | { ok: false; reason: SubtitleTranslateFailure }
    | { ok: false; reason: 'failed'; error: LlmError };

export interface SubtitleEstimateRequest {
    episodeId: number;
    trackId: string | null;
}

export type SubtitleEstimateResponse =
    | { ok: true; cues: number; batches: number; approxTokens: number }
    | { ok: false; reason: Extract<SubtitleTranslateFailure, 'missing' | 'no-source' | 'unreadable' | 'too-large' | 'empty'> };

export interface SubtitleTranslateManyRequest {
    episodeIds: number[];
    language: TranslationLanguage;
}

export interface SubtitleTranslatableResponse {
    language: TranslationLanguage;
    episodeIds: number[];
}

export type SubtitleTranslationStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled' | 'skipped';

export interface SubtitleTranslationJob {
    episodeId: number;
    language: TranslationLanguage;
    status: SubtitleTranslationStatus;
    done: number;
    total: number;
    reason: string | null;
}

export type AutoTranslateOffReason = 'quota' | 'token' | 'model' | 'setup';

export const TRANSCRIPTION_LANGUAGES = [
    'Japanese',
    'English',
    'Chinese',
    'Korean',
    'Spanish',
    'Portuguese',
    'French',
    'German',
    'Italian',
    'Russian',
    'Arabic',
    'Turkish',
    'Indonesian'
] as const;
export type TranscriptionLanguage = (typeof TRANSCRIPTION_LANGUAGES)[number];
export const DEFAULT_TRANSCRIPTION_LANGUAGE: TranscriptionLanguage = 'Japanese';

export const TRANSCRIPTION_LANGUAGE_CODES: Record<TranscriptionLanguage, string> = {
    Japanese: 'ja',
    English: 'en',
    Chinese: 'zh',
    Korean: 'ko',
    Spanish: 'es',
    Portuguese: 'pt',
    French: 'fr',
    German: 'de',
    Italian: 'it',
    Russian: 'ru',
    Arabic: 'ar',
    Turkish: 'tr',
    Indonesian: 'id'
};

export const SPEECH_PART_SECONDS = 600;

export interface SubtitleGenerateRequest {
    episodeId: number;
    audioLanguage: TranscriptionLanguage;
    language: TranslationLanguage;
}

export type SubtitleGeneratePlan = 'transcribe' | 'direct' | 'transcribe-translate';

export function isSpokenLanguage(audioLanguage: TranscriptionLanguage, language: TranslationLanguage): boolean {
    return audioLanguage === language || (audioLanguage === 'Portuguese' && language === 'Portuguese (Brazil)');
}

export function generatePlanOf(audioLanguage: TranscriptionLanguage, language: TranslationLanguage, translatesTo: SpeechTranslatesTo = 'english'): SubtitleGeneratePlan {
    if (isSpokenLanguage(audioLanguage, language)) {
        return 'transcribe';
    }
    if (translatesTo === 'none') {
        return 'transcribe-translate';
    }
    return translatesTo === 'any' || language === 'English' ? 'direct' : 'transcribe-translate';
}

export type SubtitleGenerateFailure =
    | 'missing'
    | 'no-token'
    | 'no-model'
    | 'no-address'
    | 'no-translation-token'
    | 'no-translation-model'
    | 'no-translation-address'
    | 'no-audio'
    | 'no-speech'
    | 'extract-failed'
    | 'unreadable'
    | 'busy'
    | 'cancelled';

export type SubtitleGenerateResponse =
    | { ok: true; tracks: AnimeSubtitleTrack[]; generated: AnimeSubtitleTrack }
    | { ok: false; reason: SubtitleGenerateFailure }
    | { ok: false; reason: 'failed'; error: LlmError };

export type SubtitleGenerateEstimateResponse =
    | { ok: true; seconds: number; parts: number; approxBytes: number }
    | { ok: false; reason: Extract<SubtitleGenerateFailure, 'missing' | 'no-audio' | 'extract-failed'> };

export type SubtitleGenerationPhase = 'extracting' | 'sending' | 'translating' | 'saving';

export interface SubtitleGenerationJob {
    episodeId: number;
    language: TranslationLanguage;
    status: SubtitleTranslationStatus;
    done: number;
    total: number;
    reason: string | null;
    phase?: SubtitleGenerationPhase;
    plan?: SubtitleGeneratePlan;
    sentBytes?: number;
    totalBytes?: number;
}

export interface SubtitleJobs {
    translations: SubtitleTranslationJob[];
    generations: SubtitleGenerationJob[];
}

export const ANIME_STREAM_SCHEME = 'pullwave-stream';

export interface AnimeStreamRequest {
    query: string;
    index: number;
    episode: string;
}

export interface AnimeStreamSubtitle {
    id: string;
    label: string;
    url: string;
}

export interface AnimeStream {
    sessionId: string;
    url: string;
    subtitleUrl: string | null;
    subtitles: AnimeStreamSubtitle[];
}

export type AnimeStreamResponse = { ok: true; stream: AnimeStream } | { ok: false; error: AniError };

export function isAnimeSupported(platform: string): boolean {
    return platform === 'linux' || platform === 'win32';
}
