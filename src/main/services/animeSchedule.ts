import type { AniError, AnimeScheduleEntry, AnimeScheduleRequest, AnimeScheduleResponse } from '@shared/anime';

// The episodes that air in a stretch of time, as AniList lists them (its GraphQL API needs no key).

export const ANILIST_URL = 'https://graphql.anilist.co';
export const SCHEDULE_PAGE_SIZE = 50;
// A week has a few hundred episodes at most: this only keeps a broken answer (that always says there is another page) from looping.
export const SCHEDULE_MAX_PAGES = 20;
export const SCHEDULE_TIMEOUT_MS = 15000;
// What is a series of episodes: films and specials are left out.
export const SCHEDULE_FORMATS: readonly string[] = ['TV', 'TV_SHORT', 'ONA', 'OVA'];
export const SCHEDULE_COUNTRY = 'JP';
// The names an anime is looked for by, besides its own: the first ones are the most likely to be the one the source uses.
export const MAX_SYNONYMS = 4;

export const SCHEDULE_QUERY = `query ($start: Int!, $end: Int!, $page: Int!, $perPage: Int!) {
  Page(page: $page, perPage: $perPage) {
    pageInfo { hasNextPage }
    airingSchedules(airingAt_greater: $start, airingAt_lesser: $end, sort: TIME) {
      episode
      airingAt
      media {
        id
        format
        countryOfOrigin
        isAdult
        title { romaji english }
        synonyms
        coverImage { large }
      }
    }
  }
}`;

// How long what AniList said is trusted: a day.
export const SCHEDULE_CACHE_MS = 24 * 60 * 60 * 1000;

// Where the listings are kept (see AnimeDb): the episodes of a stretch if one that covers it is still fresh, and a new listing.
export interface ScheduleCache {
    find: (from: number, to: number) => AnimeScheduleEntry[] | null;
    save: (from: number, to: number, entries: AnimeScheduleEntry[]) => void;
}

export interface ScheduleFetchOptions {
    url?: string;
    fetchFn?: typeof fetch;
    timeoutMs?: number;
}

// The answer could not be had: the network failed, AniList refused, or what came back was not what was asked for.
export class ScheduleFetchError extends Error {}

type Json = Record<string, unknown>;

function asRecord(value: unknown): Json | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : null;
}

function asText(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function asInteger(value: unknown): number | null {
    return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

function uniqueNames(names: ReadonlyArray<string | null>): string[] {
    const seen = new Set<string>();
    const unique: string[] = [];
    names.forEach((name) => {
        if (name !== null && !seen.has(name.toLowerCase())) {
            seen.add(name.toLowerCase());
            unique.push(name);
        }
    });
    return unique;
}

// One item of `airingSchedules`; null when it is not an episode of a series made in Japan (or it is not shaped as expected).
export function parseScheduleEntry(raw: unknown): AnimeScheduleEntry | null {
    const item = asRecord(raw);
    const media = asRecord(item?.media);
    const titles = asRecord(media?.title);
    const episode = asInteger(item?.episode);
    const airingAt = asInteger(item?.airingAt);
    const anilistId = asInteger(media?.id);
    if (item === null || media === null || episode === null || airingAt === null || anilistId === null || episode < 1) {
        return null;
    }
    const format = asText(media.format);
    if (format === null || !SCHEDULE_FORMATS.includes(format) || media.countryOfOrigin !== SCHEDULE_COUNTRY || media.isAdult === true) {
        return null;
    }
    const romaji = asText(titles?.romaji);
    const english = asText(titles?.english);
    const synonyms = (Array.isArray(media.synonyms) ? media.synonyms : [])
        .map(asText)
        .filter((synonym) => {
            return synonym !== null;
        })
        .slice(0, MAX_SYNONYMS);
    // The title shown is the english one when there is one, and it is the first name the search tries.
    const title = english ?? romaji;
    const names = uniqueNames([title, romaji, english, ...synonyms]);
    if (title === null) {
        return null;
    }
    return { anilistId, title, english, romaji, names, episode, airingAt, coverUrl: asText(asRecord(media.coverImage)?.large) };
}

interface SchedulePage {
    episodes: AnimeScheduleEntry[];
    hasNextPage: boolean;
}

function parsePage(body: unknown): SchedulePage {
    const page = asRecord(asRecord(asRecord(body)?.data)?.Page);
    const items = page?.airingSchedules;
    if (page === null || !Array.isArray(items)) {
        throw new ScheduleFetchError('AniList answered with something that is not a schedule.');
    }
    const episodes = items.flatMap((item) => {
        const parsed = parseScheduleEntry(item);
        return parsed === null ? [] : [parsed];
    });
    return { episodes, hasNextPage: asRecord(page.pageInfo)?.hasNextPage === true };
}

async function fetchPage(startOfDay: number, endOfDay: number, page: number, options: ScheduleFetchOptions): Promise<SchedulePage> {
    const fetchFn = options.fetchFn ?? fetch;
    let response: Response;
    try {
        response = await fetchFn(options.url ?? ANILIST_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ query: SCHEDULE_QUERY, variables: { start: startOfDay, end: endOfDay, page, perPage: SCHEDULE_PAGE_SIZE } }),
            signal: AbortSignal.timeout(options.timeoutMs ?? SCHEDULE_TIMEOUT_MS)
        });
    } catch (error) {
        throw new ScheduleFetchError(`AniList could not be reached: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!response.ok) {
        throw new ScheduleFetchError(`AniList answered with status ${response.status}.`);
    }
    let body: unknown;
    try {
        body = await response.json();
    } catch {
        throw new ScheduleFetchError('AniList answered with something that is not JSON.');
    }
    return parsePage(body);
}

// The episodes that air between the two moments (seconds since the epoch, both left out), in the order they air.
export async function fetchAiringSchedule(startOfDay: number, endOfDay: number, options: ScheduleFetchOptions = {}): Promise<AnimeScheduleEntry[]> {
    const episodes: AnimeScheduleEntry[] = [];
    for (let page = 1; page <= SCHEDULE_MAX_PAGES; page += 1) {
        const current = await fetchPage(startOfDay, endOfDay, page, options);
        episodes.push(...current.episodes);
        if (!current.hasNextPage) {
            break;
        }
    }
    return episodes;
}

const FETCH_FAILED: AniError['code'] = 'NETWORK';

// The episodes that air in the stretch of the request (its first moment included), in the order they air, or what went wrong. What was
// listed in the last day is answered from the cache; `refresh` asks AniList again (and keeps the new answer).
export async function loadSchedule(request: AnimeScheduleRequest, options: ScheduleFetchOptions & { cache?: ScheduleCache } = {}): Promise<AnimeScheduleResponse> {
    if (!request.refresh) {
        const cached = options.cache?.find(request.from, request.to) ?? null;
        if (cached !== null) {
            return { ok: true, entries: cached };
        }
    }
    try {
        // The limits of AniList are exclusive: the first moment of the stretch is asked from one second before.
        const entries = await fetchAiringSchedule(request.from - 1, request.to, options);
        options.cache?.save(request.from, request.to, entries);
        return { ok: true, entries };
    } catch (error) {
        return { ok: false, error: { code: FETCH_FAILED, raw: error instanceof ScheduleFetchError ? error.message : String(error) } };
    }
}
