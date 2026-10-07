// Types of the anime section (ani-cli). It exists on Linux and Windows.
import type { LlmError } from './llm';

export type AnimeAudio = 'sub' | 'dub';

export interface AnimeSearchResult {
    // Position in the result list of that exact search: ani-cli selects an entry by it (`-S <index>`).
    index: number;
    title: string;
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
    // What ani-cli (or the system) reported, without terminal control codes.
    raw: string;
}

export interface AniDownloadProgress {
    percent: number;
    totalBytes: number | null;
    speed: string | null;
    eta: string | null;
}

export type AniRunResult<T> = { status: 'done'; value: T } | { status: 'error'; error: AniError } | { status: 'cancelled' };

export const ANIME_QUALITIES = ['best', '1080p', '720p', '480p', '360p', 'worst'] as const;
export type AnimeQuality = (typeof ANIME_QUALITIES)[number];
export const ANIME_AUDIOS: readonly AnimeAudio[] = ['sub', 'dub'];
export const DEFAULT_ANIME_QUALITY_SETTING: AnimeQuality = 'best';

// Which subtitles to take: the language of the app, what ani-cli picks by itself, or one language (the name the source
// gives it).
export const ANIME_SUBTITLE_LANGUAGES = ['English', 'Portuguese', 'Spanish', 'French', 'German', 'Italian', 'Russian'] as const;
export const ANIME_SUBTITLE_SETTINGS = ['auto', 'default', ...ANIME_SUBTITLE_LANGUAGES] as const;
export type AnimeSubtitleSetting = (typeof ANIME_SUBTITLE_SETTINGS)[number];

// An episode in the library. `queued` and `downloading` only live while the app is open: after a restart what was
// unfinished is marked `error`.
// `idle` is an episode the anime has in the library that was not downloaded (yet).
export type AnimeEpisodeStatus = 'idle' | 'queued' | 'downloading' | 'paused' | 'done' | 'error' | 'cancelled';

export interface AnimeRecord {
    id: number;
    title: string;
    // What was searched and the position of the anime in that search: they are how ani-cli finds it again.
    query: string;
    searchIndex: number;
    audio: AnimeAudio;
    createdAt: number;
    // The seasons of one anime are separate entries in the source: the user joins them with a series name and a season number
    // (both set or both null).
    series: string | null;
    // Where the anime goes among the others of its series (1 or more); it only orders them.
    season: number | null;
    // The name the anime is shown with inside its series, instead of "SEASON N"; it is not used to order.
    seasonName: string | null;
}

export interface AnimeEpisodeRecord {
    id: number;
    animeId: number;
    number: string;
    status: AnimeEpisodeStatus;
    filePath: string | null;
    sizeBytes: number | null;
    // What went wrong with the last attempt.
    error: AniError | null;
    positionSeconds: number;
    durationSeconds: number;
    watched: boolean;
    downloadedAt: number | null;
    // The episode is in the library as downloaded but its file is not on the disk any more (filled in when the library is listed).
    fileMissing: boolean;
}

// An anime the viewer opened or watched, kept apart from the library: it covers what was only searched or streamed too. The same
// title and audio is one entry, moved to the top each time it is opened.
export interface AnimeHistoryEntry {
    id: number;
    title: string;
    // What was searched and the position of the anime in that search: they are how ani-cli finds it again.
    query: string;
    searchIndex: number;
    audio: AnimeAudio;
    // The last episode watched; null when it was only opened.
    episode: string | null;
    openedAt: number;
}

export interface AnimeHistoryRequest {
    title: string;
    query: string;
    index: number;
    audio: AnimeAudio;
    episode: string | null;
}

export interface LibraryAnime extends AnimeRecord {
    episodes: AnimeEpisodeRecord[];
}

export interface AnimeJob {
    // The id of the episode it downloads.
    episodeId: number;
    animeId: number;
    animeTitle: string;
    episode: string;
    status: 'queued' | 'running' | 'paused' | 'done' | 'error' | 'cancelled';
    percent: number;
    speed: string;
    eta: string;
    error: AniError | null;
}

// Which ani-cli is in use: where it is, which version it says it is and where it comes from.
export interface AniCliInfo {
    found: boolean;
    path: string;
    version: string | null;
    source: 'custom' | 'updated' | 'bundled';
}

export interface AnimeStatus {
    // The section exists on Linux and Windows.
    supported: boolean;
    // The files ani-cli needs are in place.
    available: boolean;
    // The ani-cli in use; null where the section does not exist.
    aniCli: AniCliInfo | null;
}

export type AnimeSearchResponse = { ok: true; results: AnimeSearchResult[] } | { ok: false; error: AniError };
export type AnimeEpisodesResponse = { ok: true; episodes: string[] } | { ok: false; error: AniError };

export interface AnimeDownloadRequest {
    title: string;
    query: string;
    index: number;
    audio: AnimeAudio;
    episodes: string[];
    // The series and season the anime is saved under; null leaves it as it is.
    series?: string | null;
    season?: number | null;
    // The name it is shown with in the series; undefined leaves it as it is.
    seasonName?: string | null;
}

// An episode that airs: the anime it belongs to, when it airs and a cover to tell the anime by.
export interface AnimeScheduleEntry {
    anilistId: number;
    title: string;
    // The two names AniList gives the anime (either can be missing): the availability in the source is checked by both, the english first.
    english: string | null;
    romaji: string | null;
    // Every name the anime is known by, without repeating any (the title first): they are what the anime is looked up by in the search.
    names: string[];
    episode: number;
    // In seconds since the epoch.
    airingAt: number;
    coverUrl: string | null;
}

// What the availability of an anime of the schedule is checked by: its id and its two names.
export type AnimeAvailabilityTarget = Pick<AnimeScheduleEntry, 'anilistId' | 'english' | 'romaji'>;

// Whether the source has the anime of the schedule: `available` with the name that found it (the english one when both do), the number of
// the result and its title; `unavailable` when no name found it; `unknown` when it could not be checked (nothing was kept of it).
export type AnimeAvailability =
    | { anilistId: number; state: 'available'; query: string; index: number; title: string }
    | { anilistId: number; state: 'unavailable' | 'unknown' };

// The stretch of time to list, in seconds since the epoch: from its first moment up to (not including) the end. What was listed in the
// last day is answered from what is kept, unless `refresh` asks AniList again.
export interface AnimeScheduleRequest {
    from: number;
    to: number;
    refresh: boolean;
}

export type AnimeScheduleResponse = { ok: true; entries: AnimeScheduleEntry[] } | { ok: false; error: AniError };

// The cover of an anime turned out to be another one when it was checked again: the new address, by the title it was asked for.
export interface AnimeCoverUpdate {
    title: string;
    url: string;
}

// `suggested` is the first season number the series does not have (the last one plus one), to give the one that was taken.
export type AnimeSeriesResponse = { ok: true } | { ok: false; reason: 'invalid' } | { ok: false; reason: 'season-taken'; suggested: number };

// What it takes to put an anime in the library with all its episodes, none of them downloaded.
export interface AnimeAddRequest {
    title: string;
    query: string;
    index: number;
    audio: AnimeAudio;
    // Every episode the source lists for it.
    episodes: string[];
    // The series and season it goes under; the name it is shown with in the series (null: none).
    series: string | null;
    season: number | null;
    seasonName: string | null;
}

// `busy` is the time the anime folder is being migrated.
export type AnimeAddResponse = { ok: true; anime: LibraryAnime } | { ok: false; reason: 'invalid' | 'busy' } | { ok: false; reason: 'season-taken'; suggested: number };

// Renaming a series changes it for all the anime that are in it. When the name is one that another series has already, the seasons of
// both are one series from then on, so a season number that both have is refused: `anime` is the one that clashes, with the season that
// is taken, and `suggested` is the first season number the other series does not have.
export type AnimeRenameSeriesResponse =
    | { ok: true }
    | { ok: false; reason: 'invalid' }
    | { ok: false; reason: 'season-taken'; anime: string; season: number; suggested: number };

export type AnimeDownloadResponse = { ok: true; anime: LibraryAnime } | { ok: false; message: string };

export interface AnimeProgressUpdate {
    episodeId: number;
    positionSeconds: number;
    durationSeconds: number;
    watched: boolean;
}

export const ANIME_MEDIA_SCHEME = 'pullwave-media';
export type AnimeMediaKind = 'episode' | 'subtitle';

// Where the player gets a video (or its subtitles) from: the main process serves the file of that episode.
export function animeMediaUrl(kind: AnimeMediaKind, episodeId: number, trackId = ''): string {
    const base = `${ANIME_MEDIA_SCHEME}://${kind}/${episodeId}`;
    return trackId.length > 0 ? `${base}/${encodeURIComponent(trackId)}` : base;
}

// A subtitle file of a downloaded episode: the one ani-cli picked, the others the source offered, one the user loaded, one made from
// the audio of the episode, or one a language model translated from another.
export type AnimeSubtitleKind = 'default' | 'source' | 'imported' | 'generated' | 'translated';

export interface AnimeSubtitleTrack {
    // What identifies it among the subtitles of the episode (empty for the one ani-cli picked).
    id: string;
    label: string;
    kind: AnimeSubtitleKind;
}

// What importing a folder of anime did: the episodes it added to the library, the ones whose file it pointed to a new place, the
// ones that were already there, and the videos it could not tell the episode of.
export interface AnimeImportSummary {
    added: number;
    relinked: number;
    skipped: number;
    ignored: number;
}

// An anime that is not inside the folder of the settings is not accepted: `folder` is the one all the anime have to be in.
export type AnimeImportResponse = ({ ok: true } & AnimeImportSummary) | { ok: false; reason: 'cancelled' } | { ok: false; reason: 'outside'; folder: string };

// How far the copy of the files into the new folder is: the files that were copied out of all the ones that have to be.
export interface AnimeMigrationProgress {
    done: number;
    total: number;
}

// Why the folder of the anime was not migrated: the user gave up, a download or another migration is running, the folder
// chosen is the current one or is inside it, a file of the new folder is in the way, or something failed while copying (what was
// copied is then removed and nothing changes).
export type AnimeMigrationFailure = 'cancelled' | 'busy' | 'same' | 'inside' | 'conflict' | 'failed';

export type AnimeMigrationResponse =
    | { ok: true; episodes: number; files: number; destination: string }
    | { ok: false; reason: AnimeMigrationFailure };

export const MAX_SUBTITLE_BYTES = 5 * 1024 * 1024;

export type AnimeSubtitleImportResponse =
    | { ok: true; tracks: AnimeSubtitleTrack[]; imported: AnimeSubtitleTrack }
    | { ok: false; reason: 'cancelled' | 'unsupported' | 'too-large' | 'unreadable' | 'missing' };

// What checking an episode for subtitles it does not have yet came to: the labels of the ones that were added (none when the source
// offers no others), and the subtitles the episode has now.
export type AnimeSubtitleCheckResponse =
    | { ok: true; added: string[]; tracks: AnimeSubtitleTrack[] }
    | { ok: false; reason: 'missing' }
    | { ok: false; reason: 'failed'; error: AniError };

// The languages a subtitle can be translated into (the name a language model understands; it is also the label of the new track).
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

// A subtitle of an episode to translate: `trackId` is the one to start from (null lets the app pick, the English one when it has it).
export interface SubtitleTranslateRequest {
    episodeId: number;
    trackId: string | null;
    language: TranslationLanguage;
}

// Why a subtitle was not translated: the episode or the subtitle is not there, the settings have no token, no model or (for a
// provider of one's own) no address, the file cannot be read, is too big or has no cues, the episode is being translated already, or the user cancelled.
export type SubtitleTranslateFailure = 'missing' | 'no-source' | 'no-token' | 'no-model' | 'no-address' | 'unreadable' | 'too-large' | 'empty' | 'busy' | 'cancelled';

export type SubtitleTranslateResponse =
    | { ok: true; tracks: AnimeSubtitleTrack[]; translated: AnimeSubtitleTrack }
    | { ok: false; reason: SubtitleTranslateFailure }
    | { ok: false; reason: 'failed'; error: LlmError };

export interface SubtitleEstimateRequest {
    episodeId: number;
    trackId: string | null;
}

// What translating a subtitle takes, before it is asked for: the cues, the requests it makes and about how many tokens they use
// (what is sent and what comes back).
export type SubtitleEstimateResponse =
    | { ok: true; cues: number; batches: number; approxTokens: number }
    | { ok: false; reason: Extract<SubtitleTranslateFailure, 'missing' | 'no-source' | 'unreadable' | 'too-large' | 'empty'> };

// Translates the subtitle of every one of these episodes, one after the other.
export interface SubtitleTranslateManyRequest {
    episodeIds: number[];
    language: TranslationLanguage;
}

export type SubtitleTranslationStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled';

// How the translation of the subtitle of an episode is going: the cues translated out of all of them; `reason` says why it failed.
export interface SubtitleTranslationJob {
    episodeId: number;
    language: TranslationLanguage;
    status: SubtitleTranslationStatus;
    done: number;
    total: number;
    reason: string | null;
}

// The languages the audio of an episode can be in, to make its subtitle (the name is also the label of the new track, and the code is
// what the service of speech to text is told).
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

// The audio of an episode is cut in parts of this many seconds, each one a request to the service (they take files of a limited size).
export const SPEECH_PART_SECONDS = 600;

// Making the subtitle of an episode from its audio: `audioLanguage` is the one that is spoken and `language` the one of the subtitle that
// is wanted (the only one that is saved). When they are the same the audio is only transcribed; when the wanted one is English the audio can
// be translated into it at once (any language, for a service that can); otherwise the transcription is translated afterwards.
export interface SubtitleGenerateRequest {
    episodeId: number;
    audioLanguage: TranscriptionLanguage;
    language: TranslationLanguage;
}

// How the subtitle is made: by transcribing the audio, by having the audio translated into English at once, or by transcribing it and
// translating the text afterwards.
export type SubtitleGeneratePlan = 'transcribe' | 'direct' | 'transcribe-translate';

// Whether the audio is spoken in the language of the subtitle that is wanted (Brazilian Portuguese is Portuguese, spoken).
export function isSpokenLanguage(audioLanguage: TranscriptionLanguage, language: TranslationLanguage): boolean {
    return audioLanguage === language || (audioLanguage === 'Portuguese' && language === 'Portuguese (Brazil)');
}

// How the subtitle is made, given what the speech service can write the audio in at once: only English (the protocol of OpenAI, the default)
// or any language (Gemini).
export function generatePlanOf(audioLanguage: TranscriptionLanguage, language: TranslationLanguage, translatesTo: 'english' | 'any' = 'english'): SubtitleGeneratePlan {
    if (isSpokenLanguage(audioLanguage, language)) {
        return 'transcribe';
    }
    return translatesTo === 'any' || language === 'English' ? 'direct' : 'transcribe-translate';
}

// Why a subtitle was not made: the episode is not there, the settings have no token, no model or (for a service of one's own) no
// address (of the speech to text, or of the translation that the plan needs), the video has no audio or nothing was said, the audio could not be taken out of the video, the file could not be saved,
// the episode is being worked on already, or the user cancelled.
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

// What making the subtitle takes, before it is asked for: how long the audio is, in how many parts (requests) it goes and about how many
// bytes that is (the audio is sent as mono MP3 of 32 kbps).
export type SubtitleGenerateEstimateResponse =
    | { ok: true; seconds: number; parts: number; approxBytes: number }
    | { ok: false; reason: Extract<SubtitleGenerateFailure, 'missing' | 'no-audio' | 'extract-failed'> };

// What the subtitle is going through: the audio is taken out of the video, its parts are sent to the service (which gives back the text),
// the text is translated, and the subtitle is saved.
export type SubtitleGenerationPhase = 'extracting' | 'sending' | 'translating' | 'saving';

// How making the subtitle of an episode is going. `done` out of `total` counts what the phase works on: the parts of the audio that were
// sent and answered, the lines that were translated. Once it started it also says how it is made (`plan`, which can change when the direct
// translation is refused) and, while the parts are sent, how many bytes of audio were sent out of all of them. `reason` says why it failed.
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

export const ANIME_STREAM_SCHEME = 'pullwave-stream';

export interface AnimeStreamRequest {
    query: string;
    index: number;
    audio: AnimeAudio;
    episode: string;
}

// A subtitle of a stream: the language the source names it by (the screen writes it in its own language) and where the player gets it
// from (through the app, like the video).
export interface AnimeStreamSubtitle {
    id: string;
    label: string;
    url: string;
}

// What the player needs to watch an episode without downloading it: the addresses go through the app, which adds what the source asks
// of a request (the referer).
export interface AnimeStream {
    sessionId: string;
    url: string;
    // The subtitle ani-cli picked (the language of the app, when the source has it).
    subtitleUrl: string | null;
    // Every subtitle the source offers, in the order it gives them; empty when this copy of ani-cli does not report them.
    subtitles: AnimeStreamSubtitle[];
}

export type AnimeStreamResponse = { ok: true; stream: AnimeStream } | { ok: false; error: AniError };

// The anime section needs a POSIX shell and a few tools that ship with the app for these systems.
export function isAnimeSupported(platform: string): boolean {
    return platform === 'linux' || platform === 'win32';
}
