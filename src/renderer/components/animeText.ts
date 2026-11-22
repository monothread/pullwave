import type { AniError, AniErrorCode, AnimeAudioCheckSummary, AnimeEpisodeRecord, AnimeEpisodeStatus, AnimeHistoryEntry, AnimeJob, LibraryAnime } from '@shared/anime';
import type { MessageKey, Translator } from '@shared/i18n';
import { foldSeries, MAX_SEASON } from '@shared/series';
import { groupByZonedDay, isSameZonedDay, machineTimeZone, startOfZonedDay } from '@shared/timezone';
import { codedErrorReport, type ErrorReport } from './errorReport';

export const MIN_RESUME_SECONDS = 5;
export const END_MARGIN_SECONDS = 30;
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

export function animeErrorReport(t: Translator, error: AniError): ErrorReport {
    return codedErrorReport(t(animeErrorKey(error.code)), error, error.raw);
}

export function animeStatusKey(status: AnimeEpisodeStatus | AnimeJob['status']): MessageKey {
    return STATUS_KEYS[status];
}

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

export interface PlayableEpisode {
    anime: LibraryAnime;
    episode: AnimeEpisodeRecord;
}

function downloadedEpisodes(anime: LibraryAnime): AnimeEpisodeRecord[] {
    return anime.episodes.filter((episode) => {
        return episode.status === 'done';
    });
}

function seasonsOfSeries(library: readonly LibraryAnime[], anime: LibraryAnime): LibraryAnime[] {
    if (anime.series === null || anime.season === null) {
        return [anime];
    }
    const series = anime.series;
    return library
        .filter((candidate) => {
            return candidate.season !== null && candidate.series !== null && foldSeries(candidate.series) === foldSeries(series);
        })
        .sort((first, second) => {
            return (first.season ?? 0) - (second.season ?? 0) || first.id - second.id;
        });
}

function adjacentDownloadedEpisode(library: readonly LibraryAnime[], anime: LibraryAnime, current: AnimeEpisodeRecord, direction: 1 | -1): PlayableEpisode | null {
    const position = anime.episodes.findIndex((episode) => {
        return episode.id === current.id;
    });
    if (position === -1) {
        return null;
    }
    const adjacent = anime.episodes[position + direction];
    if (adjacent !== undefined) {
        return adjacent.status === 'done' ? { anime, episode: adjacent } : null;
    }
    const seasons = seasonsOfSeries(library, anime);
    const seasonPosition = seasons.findIndex((season) => {
        return season.id === anime.id;
    });
    const neighbours = direction === 1 ? seasons.slice(seasonPosition + 1) : seasons.slice(0, seasonPosition).reverse();
    for (const season of neighbours) {
        const episodes = downloadedEpisodes(season);
        const episode = direction === 1 ? episodes[0] : episodes[episodes.length - 1];
        if (episode !== undefined) {
            return { anime: season, episode };
        }
    }
    return null;
}

export function nextDownloadedEpisode(library: readonly LibraryAnime[], anime: LibraryAnime, current: AnimeEpisodeRecord): PlayableEpisode | null {
    return adjacentDownloadedEpisode(library, anime, current, 1);
}

export function previousDownloadedEpisode(library: readonly LibraryAnime[], anime: LibraryAnime, current: AnimeEpisodeRecord): PlayableEpisode | null {
    return adjacentDownloadedEpisode(library, anime, current, -1);
}

function isUnwatchedFile(episode: AnimeEpisodeRecord): boolean {
    return episode.status === 'done' && !episode.watched && !episode.fileMissing;
}

export function episodeToResume(library: readonly LibraryAnime[], anime: LibraryAnime, episodeNumber: string): PlayableEpisode | null {
    const current = anime.episodes.find((episode) => {
        return episode.number === episodeNumber;
    });
    if (current === undefined) {
        return null;
    }
    if (isUnwatchedFile(current)) {
        return { anime, episode: current };
    }
    const next = nextDownloadedEpisode(library, anime, current);
    return next !== null && isUnwatchedFile(next.episode) ? next : null;
}

export interface ContinueTarget {
    playable: PlayableEpisode;
    started: boolean;
}

function hasStartedWatching(anime: LibraryAnime): boolean {
    return anime.episodes.some((episode) => {
        return episode.watched || episode.positionSeconds > 0;
    });
}

export function seasonContinueTarget(library: readonly LibraryAnime[], anime: LibraryAnime, history: readonly AnimeHistoryEntry[]): ContinueTarget | null {
    const lastSeen = history.find((entry) => {
        return entry.title === anime.title && entry.episode !== null;
    });
    const resumed = lastSeen === undefined || lastSeen.episode === null ? null : episodeToResume(library, anime, lastSeen.episode);
    if (resumed !== null) {
        return { playable: resumed, started: true };
    }
    const firstUnwatched = anime.episodes.find(isUnwatchedFile);
    if (firstUnwatched === undefined) {
        return null;
    }
    return { playable: { anime, episode: firstUnwatched }, started: lastSeen !== undefined || hasStartedWatching(anime) };
}

export function nextListedEpisode(episodes: readonly string[], current: string): string | null {
    const position = episodes.indexOf(current);
    return position === -1 ? null : (episodes[position + 1] ?? null);
}

export function isWatched(positionSeconds: number, durationSeconds: number): boolean {
    return durationSeconds > 0 && positionSeconds / durationSeconds >= WATCHED_RATIO;
}

export function downloadedCount(anime: LibraryAnime): number {
    return anime.episodes.filter((episode) => {
        return episode.status === 'done';
    }).length;
}

export function seriesNames(library: readonly LibraryAnime[]): string[] {
    const names = new Map<string, string>();
    library.forEach((anime) => {
        if (anime.series !== null && !names.has(foldSeries(anime.series))) {
            names.set(foldSeries(anime.series), anime.series);
        }
    });
    return [...names.values()].sort(compareNames);
}

export function seasonLabel(anime: LibraryAnime, t: Translator): string {
    return anime.seasonName ?? t('anime.series.season', { number: anime.season ?? 1 });
}

export interface LibraryGroup {
    key: string;
    series: string;
    entries: LibraryAnime[];
}

export type LibraryProblemKind = 'no-audio' | 'file-missing' | 'unreadable';

export interface LibraryProblem {
    animeId: number;
    animeTitle: string;
    episodeId: number;
    episode: string;
    kind: LibraryProblemKind;
}

export interface AudioReport {
    summary: AnimeAudioCheckSummary;
    downloaded: number;
    problems: LibraryProblem[];
}

export function downloadedEpisodeCount(library: readonly LibraryAnime[]): number {
    return library.reduce((total, anime) => {
        return (
            total +
            anime.episodes.filter((episode) => {
                return episode.status === 'done';
            }).length
        );
    }, 0);
}

export function isRepairable(problem: LibraryProblem): boolean {
    return problem.kind === 'unreadable';
}

export function libraryProblems(library: readonly LibraryAnime[], unreadableIds: readonly number[] = []): LibraryProblem[] {
    return library.flatMap((anime) => {
        return anime.episodes.flatMap((episode): LibraryProblem[] => {
            if (episode.status !== 'done') {
                return [];
            }
            const kind = problemKind(episode, unreadableIds);
            return kind === null ? [] : [{ animeId: anime.id, animeTitle: anime.title, episodeId: episode.id, episode: episode.number, kind }];
        });
    });
}

function problemKind(episode: AnimeEpisodeRecord, unreadableIds: readonly number[]): LibraryProblemKind | null {
    if (episode.fileMissing) {
        return 'file-missing';
    }
    if (episode.noAudio) {
        return 'no-audio';
    }
    return unreadableIds.includes(episode.id) ? 'unreadable' : null;
}

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
            return (first.season ?? 0) - (second.season ?? 0) || first.id - second.id;
        });
    });
    return groups.sort((first, second) => {
        return compareNames(first.series, second.series);
    });
}

export function compareNames(first: string, second: string): number {
    return first.localeCompare(second, undefined, { sensitivity: 'base', numeric: true });
}

export function libraryEntry(library: readonly LibraryAnime[], title: string): LibraryAnime | null {
    return (
        library.find((candidate) => {
            return candidate.title === title;
        }) ?? null
    );
}

export function downloadedAnime(library: readonly LibraryAnime[], title: string): LibraryAnime | null {
    const found = library.find((candidate) => {
        return candidate.title === title;
    });
    return found && downloadedCount(found) > 0 ? found : null;
}

function foldText(text: string): string {
    return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

export function matchesSearch(title: string, search: string): boolean {
    const wanted = foldText(search.trim());
    return wanted.length === 0 || foldText(title).includes(wanted);
}

export function activeJobCount(jobs: readonly AnimeJob[]): number {
    return jobs.filter((job) => {
        return job.status === 'queued' || job.status === 'running';
    }).length;
}

export function groupByDay<T>(entries: readonly T[], timeOf: (entry: T) => number, timeZone: string = machineTimeZone()): Array<{ day: number; entries: T[] }> {
    return groupByZonedDay(entries, timeOf, timeZone);
}

export function startOfDay(time: number, timeZone: string = machineTimeZone()): number {
    return startOfZonedDay(time, timeZone);
}

export function isNewEpisode(episode: Pick<AnimeEpisodeRecord, 'addedAt'>, now: number = Date.now(), timeZone: string = machineTimeZone()): boolean {
    return episode.addedAt !== null && isSameZonedDay(episode.addedAt, now, timeZone);
}

export function newEpisodeCount(anime: Pick<LibraryAnime, 'episodes'>, now: number = Date.now(), timeZone: string = machineTimeZone()): number {
    return anime.episodes.filter((episode) => {
        return isNewEpisode(episode, now, timeZone);
    }).length;
}

export function nextFreeOrder(used: readonly number[]): number {
    return Math.max(0, ...used) + 1;
}

export function orderFor(used: readonly number[], wanted: number): number {
    const next = nextFreeOrder(used);
    return used.includes(wanted) && next <= MAX_SEASON ? next : wanted;
}
