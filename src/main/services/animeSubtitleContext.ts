import { searchVariants } from './animeCovers';
import { ANILIST_URL } from './animeSchedule';
import { comparableTitle } from './animeSourceMatch';

export const CONTEXT_TIMEOUT_MS = 5000;
export const MAX_CHARACTERS = 15;
export const MAX_SYNOPSIS_LENGTH = 360;
const SEARCH_CANDIDATES = 5;
const MIN_SENTENCE_CUT = 120;

export interface AnimeCharacter {
    full: string;
    native: string | null;
}

export interface AnimeSubtitleContext {
    title: string;
    nativeTitle: string | null;
    synopsis: string | null;
    characters: AnimeCharacter[];
}

export interface AnimeSubtitleContextLookup {
    title: string | null;
    anilistId?: number | null;
}

export interface AnimeSubtitleContextOptions {
    url?: string;
    fetchFn?: typeof fetch;
    timeoutMs?: number;
}

export const CONTEXT_BY_ID_QUERY = `query ($id: Int!) {
  Media(id: $id, type: ANIME) {
    title { romaji english native }
    description(asHtml: false)
    characters(sort: [ROLE, RELEVANCE], perPage: ${MAX_CHARACTERS}) {
      nodes {
        name { full native }
      }
    }
  }
}`;

export const CONTEXT_BY_SEARCH_QUERY = `query ($search: String!) {
  Page(perPage: ${SEARCH_CANDIDATES}) {
    media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
      title { romaji english native }
      synonyms
      description(asHtml: false)
      characters(sort: [ROLE, RELEVANCE], perPage: ${MAX_CHARACTERS}) {
        nodes {
          name { full native }
        }
      }
    }
  }
}`;

type Json = Record<string, unknown>;

const HTML_ENTITIES: Record<string, string> = {
    '&quot;': '"',
    '&#039;': "'",
    '&#39;': "'",
    '&#x27;': "'",
    '&apos;': "'",
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&mdash;': '—',
    '&ndash;': '–',
    '&hellip;': '...',
    '&nbsp;': ' '
};

const ENTITY_PATTERN = /&(?:quot|#0?39|#x27|apos|amp|lt|gt|mdash|ndash|hellip|nbsp);/gi;

function asRecord(value: unknown): Json | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : null;
}

function asText(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

export function cleanSynopsis(raw: unknown): string | null {
    if (typeof raw !== 'string') {
        return null;
    }
    const stripped = raw
        .replace(/~![\s\S]*?!~/g, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/__([^_]+)__/g, '$1')
        .replace(/(^|[\s([{"'])_([^_\n]+)_(?=$|[\s.,!?;:)\]}"'])/g, '$1$2')
        .replace(ENTITY_PATTERN, (entity) => {
            return HTML_ENTITIES[entity.toLowerCase()] ?? entity;
        })
        .replace(/\s*\(Source:[^)]*\)\s*$/i, '')
        .replace(/\s+/g, ' ')
        .trim();
    if (stripped.length === 0) {
        return null;
    }
    if (stripped.length <= MAX_SYNOPSIS_LENGTH) {
        return stripped;
    }
    const searchSlice = stripped.slice(0, MAX_SYNOPSIS_LENGTH + 1);
    const sentenceEnd = Math.max(searchSlice.lastIndexOf('. '), searchSlice.lastIndexOf('! '), searchSlice.lastIndexOf('? '));
    if (sentenceEnd >= MIN_SENTENCE_CUT && sentenceEnd < MAX_SYNOPSIS_LENGTH) {
        return stripped.slice(0, sentenceEnd + 1);
    }
    const slice = stripped.slice(0, MAX_SYNOPSIS_LENGTH);
    const wordEnd = slice.lastIndexOf(' ');
    return `${(wordEnd > 0 ? slice.slice(0, wordEnd) : slice).trimEnd()}...`;
}

function parseCharacters(raw: unknown): AnimeCharacter[] {
    const nodes = asRecord(raw)?.nodes;
    if (!Array.isArray(nodes)) {
        return [];
    }
    const seen = new Set<string>();
    const characters: AnimeCharacter[] = [];
    for (const node of nodes) {
        const name = asRecord(asRecord(node)?.name);
        const full = asText(name?.full);
        if (full === null) {
            continue;
        }
        const key = full.toLowerCase();
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        characters.push({ full, native: asText(name?.native) });
        if (characters.length >= MAX_CHARACTERS) {
            break;
        }
    }
    return characters;
}

function mediaNamesOf(media: Json): string[] {
    const title = asRecord(media.title);
    const synonyms = Array.isArray(media.synonyms) ? media.synonyms : [];
    return [title?.romaji, title?.english, title?.native, ...synonyms].filter((name): name is string => {
        return typeof name === 'string' && name.trim().length > 0;
    });
}

export function parseMediaContext(raw: unknown): AnimeSubtitleContext | null {
    const media = asRecord(raw);
    if (media === null) {
        return null;
    }
    const titles = asRecord(media.title);
    const title = asText(titles?.english) ?? asText(titles?.romaji) ?? asText(titles?.native);
    if (title === null) {
        return null;
    }
    const nativeTitle = asText(titles?.native);
    return {
        title,
        nativeTitle: nativeTitle !== null && nativeTitle !== title ? nativeTitle : null,
        synopsis: cleanSynopsis(media.description),
        characters: parseCharacters(media.characters)
    };
}

export function formatSeriesContext(context: AnimeSubtitleContext): string {
    const titleLine = context.nativeTitle === null ? `Series: ${context.title}` : `Series: ${context.title} (${context.nativeTitle})`;
    const lines = [titleLine];
    if (context.synopsis !== null) {
        lines.push(`Premise: ${context.synopsis}`);
    }
    if (context.characters.length > 0) {
        const names = context.characters.map((character) => {
            return character.native !== null && character.native !== character.full ? `${character.full} (${character.native})` : character.full;
        });
        lines.push(`Characters: ${names.join(', ')}`);
    }
    return lines.join('\n');
}

function cacheKeyOf(lookup: AnimeSubtitleContextLookup): string | null {
    if (typeof lookup.anilistId === 'number' && Number.isInteger(lookup.anilistId) && lookup.anilistId > 0) {
        return `id:${lookup.anilistId}`;
    }
    if (lookup.title === null) {
        return null;
    }
    const normalized = comparableTitle(lookup.title);
    return normalized.length > 0 ? `title:${normalized}` : null;
}

type QueryOutcome = { ok: true; context: AnimeSubtitleContext | null } | { ok: false };

interface InFlightLookup {
    promise: Promise<AnimeSubtitleContext | null>;
    cancel: () => void;
    waiters: number;
}

function waitWithSignal(inFlight: InFlightLookup, signal?: AbortSignal): Promise<AnimeSubtitleContext | null> {
    inFlight.waiters += 1;
    if (signal === undefined) {
        return inFlight.promise.finally(() => {
            inFlight.waiters -= 1;
        });
    }
    return new Promise((resolve) => {
        let settled = false;
        const onAbort = (): void => {
            if (settled) {
                return;
            }
            settled = true;
            inFlight.waiters -= 1;
            if (inFlight.waiters <= 0) {
                inFlight.cancel();
            }
            resolve(null);
        };
        signal.addEventListener('abort', onAbort, { once: true });
        void inFlight.promise.then((result) => {
            if (settled) {
                return;
            }
            settled = true;
            signal.removeEventListener('abort', onAbort);
            inFlight.waiters -= 1;
            resolve(result);
        });
    });
}

export class AnimeSubtitleContextService {
    private readonly cache = new Map<string, AnimeSubtitleContext | null>();
    private readonly pending = new Map<string, InFlightLookup>();

    constructor(private readonly options: AnimeSubtitleContextOptions = {}) {}

    async resolve(lookup: AnimeSubtitleContextLookup, signal?: AbortSignal): Promise<AnimeSubtitleContext | null> {
        if (signal?.aborted === true) {
            return null;
        }
        const key = cacheKeyOf(lookup);
        if (key === null) {
            return null;
        }
        if (this.cache.has(key)) {
            return this.cache.get(key) ?? null;
        }
        const existing = this.pending.get(key);
        if (existing !== undefined) {
            return waitWithSignal(existing, signal);
        }
        const controller = new AbortController();
        const inFlight: InFlightLookup = {
            promise: Promise.resolve(null),
            cancel: () => {
                if (this.pending.get(key) === inFlight) {
                    this.pending.delete(key);
                }
                controller.abort();
            },
            waiters: 0
        };
        inFlight.promise = this.fetchContext(lookup, controller.signal)
            .then((outcome) => {
                if (outcome.ok) {
                    this.cache.set(key, outcome.context);
                    return outcome.context;
                }
                return null;
            })
            .finally(() => {
                if (this.pending.get(key) === inFlight) {
                    this.pending.delete(key);
                }
            });
        this.pending.set(key, inFlight);
        return waitWithSignal(inFlight, signal);
    }

    private async fetchContext(lookup: AnimeSubtitleContextLookup, signal: AbortSignal): Promise<QueryOutcome> {
        if (typeof lookup.anilistId === 'number' && Number.isInteger(lookup.anilistId) && lookup.anilistId > 0) {
            const data = await this.ask(CONTEXT_BY_ID_QUERY, { id: lookup.anilistId }, signal);
            if (data === null) {
                return { ok: false };
            }
            return { ok: true, context: parseMediaContext(data.Media) };
        }
        if (lookup.title === null) {
            return { ok: true, context: null };
        }
        const search = searchVariants(lookup.title).at(-1) ?? lookup.title.trim();
        const data = await this.ask(CONTEXT_BY_SEARCH_QUERY, { search }, signal);
        if (data === null) {
            return { ok: false };
        }
        const items = asRecord(data.Page)?.media;
        if (!Array.isArray(items)) {
            return { ok: true, context: null };
        }
        const wanted = comparableTitle(lookup.title);
        const matched = items.find((item) => {
            const record = asRecord(item);
            if (record === null) {
                return false;
            }
            return mediaNamesOf(record).some((name) => {
                return comparableTitle(name) === wanted;
            });
        });
        return { ok: true, context: matched === undefined ? null : parseMediaContext(matched) };
    }

    private async ask(query: string, variables: Record<string, unknown>, signal: AbortSignal): Promise<Json | null> {
        const timeout = AbortSignal.timeout(this.options.timeoutMs ?? CONTEXT_TIMEOUT_MS);
        const combined = AbortSignal.any([signal, timeout]);
        try {
            const response = await (this.options.fetchFn ?? fetch)(this.options.url ?? ANILIST_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({ query, variables }),
                signal: combined
            });
            if (!response.ok) {
                return null;
            }
            const body = (await response.json()) as unknown;
            const record = asRecord(body);
            if (Array.isArray(record?.errors) && record.errors.length > 0) {
                return null;
            }
            return asRecord(record?.data);
        } catch {
            return null;
        }
    }
}
