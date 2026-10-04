import type { AniErrorCode, AnimeAudio, AnimeEpisodeRecord, AnimeEpisodeStatus, AnimeJob, LibraryAnime } from '@shared/anime';
import type { MessageKey, Translator } from '@shared/i18n';
import { foldSeries } from '@shared/series';

// An episode is only offered to resume when a bit was watched and it is not about to end.
export const MIN_RESUME_SECONDS = 5;
export const END_MARGIN_SECONDS = 30;
// Past this share of the episode it counts as watched.
export const WATCHED_RATIO = 0.75;

const ERROR_KEYS: Record<AniErrorCode, MessageKey> = {
    NO_RESULTS: 'anime.error.NO_RESULTS',
    BLOCKED: 'anime.error.BLOCKED',
    NETWORK: 'anime.error.NETWORK',
    NO_SOURCES: 'anime.error.NO_SOURCES',
    EPISODE_NOT_RELEASED: 'anime.error.EPISODE_NOT_RELEASED',
    INVALID_SELECTION: 'anime.error.INVALID_SELECTION',
    BINARY_MISSING: 'anime.error.BINARY_MISSING',
    UNKNOWN: 'anime.error.UNKNOWN'
};

const STATUS_KEYS: Record<AnimeEpisodeStatus | AnimeJob['status'], MessageKey> = {
    idle: 'anime.status.idle',
    queued: 'anime.status.queued',
    downloading: 'anime.status.downloading',
    running: 'anime.status.downloading',
    paused: 'anime.status.paused',
    done: 'anime.status.done',
    error: 'anime.status.error',
    cancelled: 'anime.status.cancelled'
};

export function animeErrorKey(code: AniErrorCode): MessageKey {
    return ERROR_KEYS[code];
}

export function animeStatusKey(status: AnimeEpisodeStatus | AnimeJob['status']): MessageKey {
    return STATUS_KEYS[status];
}

// Where to resume an episode, or null to start it from the beginning.
export function resumePosition(episode: AnimeEpisodeRecord): number | null {
    const { positionSeconds, durationSeconds, watched } = episode;
    if (watched || positionSeconds < MIN_RESUME_SECONDS) {
        return null;
    }
    if (durationSeconds > 0 && positionSeconds > durationSeconds - END_MARGIN_SECONDS) {
        return null;
    }
    return positionSeconds;
}

// The episode next to this one in the library (after it for 1, before it for -1), if it is already downloaded.
function adjacentDownloadedEpisode(anime: LibraryAnime, current: AnimeEpisodeRecord, direction: 1 | -1): AnimeEpisodeRecord | null {
    const position = anime.episodes.findIndex((episode) => {
        return episode.id === current.id;
    });
    const adjacent = position === -1 ? undefined : anime.episodes[position + direction];
    return adjacent?.status === 'done' ? adjacent : null;
}

// The episode that follows in the library, if it is already downloaded.
export function nextDownloadedEpisode(anime: LibraryAnime, current: AnimeEpisodeRecord): AnimeEpisodeRecord | null {
    return adjacentDownloadedEpisode(anime, current, 1);
}

// The episode that comes before in the library, if it is already downloaded.
export function previousDownloadedEpisode(anime: LibraryAnime, current: AnimeEpisodeRecord): AnimeEpisodeRecord | null {
    return adjacentDownloadedEpisode(anime, current, -1);
}

export function isWatched(positionSeconds: number, durationSeconds: number): boolean {
    return durationSeconds > 0 && positionSeconds / durationSeconds >= WATCHED_RATIO;
}

export function downloadedCount(anime: LibraryAnime): number {
    return anime.episodes.filter((episode) => {
        return episode.status === 'done';
    }).length;
}

// The names of the series the library has, each once, in alphabetical order.
export function seriesNames(library: readonly LibraryAnime[]): string[] {
    const names = new Map<string, string>();
    library.forEach((anime) => {
        if (anime.series !== null && !names.has(foldSeries(anime.series))) {
            names.set(foldSeries(anime.series), anime.series);
        }
    });
    return [...names.values()].sort(compareNames);
}

// The label of an anime inside its series: the name the user gave it, otherwise "SEASON N" from its place in the series (the first
// one for an anime that was never joined to a series).
export function seasonLabel(anime: LibraryAnime, t: Translator): string {
    return anime.seasonName ?? t('anime.series.season', { number: anime.season ?? 1 });
}

// One card of the library: a series with its seasons in order. Every anime is in one: an anime that was never joined to a series
// is the only season of a series with its own title.
export interface LibraryGroup {
    key: string;
    // The name of the series.
    series: string;
    entries: LibraryAnime[];
}

// Joins the animes of the library that are seasons of one series (the same name, whatever the case or the accents); an anime that
// has no series is a series of its own, with its title as name. The cards are in alphabetical order and the seasons of a series by
// their place in it.
export function groupLibrary(library: readonly LibraryAnime[]): LibraryGroup[] {
    const groups: LibraryGroup[] = [];
    const bySeries = new Map<string, LibraryGroup>();
    library.forEach((anime) => {
        if (anime.series === null || anime.season === null) {
            groups.push({ key: `anime-${anime.id}`, series: anime.title, entries: [anime] });
            return;
        }
        const key = foldSeries(anime.series);
        const found = bySeries.get(key);
        if (found) {
            found.entries.push(anime);
            return;
        }
        const created: LibraryGroup = { key: `series-${key}`, series: anime.series, entries: [anime] };
        bySeries.set(key, created);
        groups.push(created);
    });
    groups.forEach((group) => {
        group.entries.sort((first, second) => {
            return (first.season ?? 0) - (second.season ?? 0) || first.audio.localeCompare(second.audio);
        });
    });
    return groups.sort((first, second) => {
        return compareNames(first.series, second.series);
    });
}

// Alphabetical order for names: no matter the case or the accents, and numbers by their value ("Naruto 2" before "Naruto 10").
export function compareNames(first: string, second: string): number {
    return first.localeCompare(second, undefined, { sensitivity: 'base', numeric: true });
}

// The anime of the library that has this title and audio, downloaded or not.
export function libraryEntry(library: readonly LibraryAnime[], title: string, audio: AnimeAudio): LibraryAnime | null {
    return (
        library.find((candidate) => {
            return candidate.title === title && candidate.audio === audio;
        }) ?? null
    );
}

// The anime of the library that has this title and audio, when at least one of its episodes is downloaded.
export function downloadedAnime(library: readonly LibraryAnime[], title: string, audio: AnimeAudio): LibraryAnime | null {
    const found = library.find((candidate) => {
        return candidate.title === title && candidate.audio === audio;
    });
    return found && downloadedCount(found) > 0 ? found : null;
}

function foldText(text: string): string {
    return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

// Whether a title matches what was typed in the search of the library: no matter the case or the accents, and an empty search
// matches everything.
export function matchesSearch(title: string, search: string): boolean {
    const wanted = foldText(search.trim());
    return wanted.length === 0 || foldText(title).includes(wanted);
}

// The downloads that are happening or waiting: what the button of the downloads screen counts.
export function activeJobCount(jobs: readonly AnimeJob[]): number {
    return jobs.filter((job) => {
        return job.status === 'queued' || job.status === 'running';
    }).length;
}
