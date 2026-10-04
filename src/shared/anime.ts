// Types of the anime section (ani-cli). It exists on Linux and Windows.

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

// A subtitle file of a downloaded episode: the one ani-cli picked, the others the source offered, or one the user loaded.
export type AnimeSubtitleKind = 'default' | 'source' | 'imported';

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
