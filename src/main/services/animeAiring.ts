import type { AnimeAiringStatus } from '@shared/anime';
import type { AnimeAiringState, AnimeDb } from './animeDb';
import { searchVariants } from './animeCovers';
import { ANILIST_URL, SCHEDULE_TIMEOUT_MS, ScheduleFetchError, type ScheduleFetchOptions } from './animeSchedule';
import { comparableTitle } from './animeSourceMatch';

// Whether the releases of the anime of the library are over, from AniList: the library does not know it, and an anime that ended need not be
// looked at for new episodes. An anime is matched to the one of AniList by its title (the title must be one of the names AniList gives, so a
// season is not taken for another), and from then on AniList is asked about it by its id.

// How many titles are searched in one request, and how many ids are asked about in one.
export const SEARCH_BATCH = 15;
export const REFRESH_BATCH = 50;
// How many answers AniList gives for each title that is searched: the right one is not always the first.
export const SEARCH_CANDIDATES = 5;
// An anime AniList had nothing sure about is searched again after this long; one that was matched and has not ended is asked about again
// after this long (one that ended is not asked about again).
export const UNMATCHED_RETRY_MS = 7 * 24 * 60 * 60 * 1000;
export const REFRESH_AFTER_MS = 3 * 60 * 60 * 1000;
// The requests go one after the other, a second apart (AniList limits how many it answers in a minute).
export const REQUEST_INTERVAL_MS = 1000;

const FINISHED = ['FINISHED', 'CANCELLED'];
const ONGOING = ['RELEASING', 'NOT_YET_RELEASED', 'HIATUS'];

interface Candidate {
    id: number;
    status: AnimeAiringStatus | null;
    names: string[];
}

type Json = Record<string, unknown>;

function asRecord(value: unknown): Json | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : null;
}

export function statusOf(value: unknown): AnimeAiringStatus | null {
    if (typeof value !== 'string') {
        return null;
    }
    if (FINISHED.includes(value)) {
        return 'finished';
    }
    return ONGOING.includes(value) ? 'ongoing' : null;
}

function candidateOf(media: unknown): Candidate | null {
    const record = asRecord(media);
    const id = record?.id;
    if (record === null || typeof id !== 'number' || !Number.isInteger(id)) {
        return null;
    }
    const title = asRecord(record.title);
    const synonyms = Array.isArray(record.synonyms) ? record.synonyms : [];
    const names = [title?.romaji, title?.english, title?.native, ...synonyms].filter((name): name is string => {
        return typeof name === 'string' && name.trim().length > 0;
    });
    return { id, status: statusOf(record.status), names };
}

// The query that searches `count` titles at once: one answer for each, named m0, m1…
export function searchQuery(count: number): string {
    const variables = Array.from({ length: count }, (_value, position) => {
        return `$s${position}: String`;
    }).join(', ');
    const fields = Array.from({ length: count }, (_value, position) => {
        return `m${position}: Page(perPage: ${SEARCH_CANDIDATES}) { media(search: $s${position}, type: ANIME, sort: SEARCH_MATCH) { id status title { romaji english native } synonyms } }`;
    }).join(' ');
    return `query (${variables}) { ${fields} }`;
}

export const REFRESH_QUERY = `query ($ids: [Int], $perPage: Int) {
  Page(perPage: $perPage) {
    media(id_in: $ids, type: ANIME) { id status }
  }
}`;

function chunks<T>(items: readonly T[], size: number): T[][] {
    const groups: T[][] = [];
    for (let start = 0; start < items.length; start += size) {
        groups.push(items.slice(start, start + size));
    }
    return groups;
}

function wait(milliseconds: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
    });
}

export interface AnimeAiringDependencies extends ScheduleFetchOptions {
    db: Pick<AnimeDb, 'airingStates' | 'saveAiring'>;
    now?: () => number;
    sleep?: (milliseconds: number) => Promise<void>;
    // What is known about the releases of some anime changed (told after each request that kept something).
    onChange?: () => void;
}

// Keeps up to date what the library knows about the releases of its anime. `sync` matches the anime that were never matched (or were not
// matched a week ago) to AniList and asks about the ones that were matched and have not ended; it rejects when AniList cannot be reached or
// refuses, after keeping what it had already got.
export class AnimeAiringService {
    constructor(private readonly deps: AnimeAiringDependencies) {}

    async sync(): Promise<void> {
        const now = (this.deps.now ?? Date.now)();
        const states = this.deps.db.airingStates();
        const toMatch = states.filter((state) => {
            return state.anilistId === null && (state.checkedAt === null || now - state.checkedAt >= UNMATCHED_RETRY_MS);
        });
        const toRefresh = states.filter((state) => {
            return state.anilistId !== null && state.status !== 'finished' && (state.checkedAt === null || now - state.checkedAt >= REFRESH_AFTER_MS);
        });
        let requests = 0;
        for (const group of chunks(toMatch, SEARCH_BATCH)) {
            await this.pause(requests);
            requests += 1;
            await this.match(group);
        }
        for (const group of chunks(toRefresh, REFRESH_BATCH)) {
            await this.pause(requests);
            requests += 1;
            await this.refresh(group);
        }
    }

    private async pause(requests: number): Promise<void> {
        if (requests > 0) {
            await (this.deps.sleep ?? wait)(REQUEST_INTERVAL_MS);
        }
    }

    private async match(group: readonly AnimeAiringState[]): Promise<void> {
        const variables: Record<string, string> = {};
        group.forEach((state, position) => {
            variables[`s${position}`] = searchVariants(state.title).at(-1) ?? state.title;
        });
        const data = await this.ask(searchQuery(group.length), variables);
        group.forEach((state, position) => {
            const media = asRecord(data[`m${position}`])?.media;
            const candidates = (Array.isArray(media) ? media : []).flatMap((item) => {
                const candidate = candidateOf(item);
                return candidate === null ? [] : [candidate];
            });
            const wanted = comparableTitle(state.title);
            const found = wanted.length === 0 ? undefined : candidates.find((candidate) => {
                return candidate.names.some((name) => {
                    return comparableTitle(name) === wanted;
                });
            });
            this.deps.db.saveAiring(state.id, found?.id ?? null, found?.status ?? null);
        });
        this.deps.onChange?.();
    }

    private async refresh(group: readonly AnimeAiringState[]): Promise<void> {
        const ids = group.map((state) => {
            return state.anilistId as number;
        });
        const data = await this.ask(REFRESH_QUERY, { ids, perPage: ids.length });
        const media = asRecord(data.Page)?.media;
        const statuses = new Map<number, AnimeAiringStatus | null>();
        (Array.isArray(media) ? media : []).forEach((item) => {
            const candidate = candidateOf(item);
            if (candidate !== null) {
                statuses.set(candidate.id, candidate.status);
            }
        });
        let kept = 0;
        group.forEach((state) => {
            const id = state.anilistId as number;
            // An anime AniList does not give back keeps what it had: nothing is concluded from the silence.
            if (statuses.has(id)) {
                this.deps.db.saveAiring(state.id, id, statuses.get(id) ?? state.status);
                kept += 1;
            }
        });
        if (kept > 0) {
            this.deps.onChange?.();
        }
    }

    private async ask(query: string, variables: Record<string, unknown>): Promise<Json> {
        let response: Response;
        try {
            response = await (this.deps.fetchFn ?? fetch)(this.deps.url ?? ANILIST_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({ query, variables }),
                signal: AbortSignal.timeout(this.deps.timeoutMs ?? SCHEDULE_TIMEOUT_MS)
            });
        } catch (error) {
            throw new ScheduleFetchError(`AniList could not be reached: ${error instanceof Error ? error.message : String(error)}`);
        }
        if (!response.ok) {
            throw new ScheduleFetchError(`AniList answered ${response.status}.`);
        }
        let body: unknown;
        try {
            body = await response.json();
        } catch {
            throw new ScheduleFetchError('AniList did not answer with JSON.');
        }
        const data = asRecord(asRecord(body)?.data);
        if (data === null) {
            throw new ScheduleFetchError('AniList answered with no data.');
        }
        return data;
    }
}
