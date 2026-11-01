import { PoliteClient, readJson } from './politeClient';

// The services the cover of an anime or a manga is looked for in, by its name. Each one answers with the address of the picture, or null
// when it does not know the title; a failure to ask rejects with a CoverFetchError (see PoliteClient). Jikan (MyAnimeList) was left out: its
// server refused the connections (it reset them or let them time out), so every title it was asked for waited for nothing.

export type CoverKind = 'anime' | 'manga';

export interface CoverProvider {
    readonly name: string;
    find: (title: string, kind: CoverKind) => Promise<string | null>;
}

export const ANILIST_COVER_URL = 'https://graphql.anilist.co';
export const KITSU_URL = 'https://kitsu.io/api/edge';
export const MANGADEX_URL = 'https://api.mangadex.org';
export const MANGADEX_UPLOADS_URL = 'https://uploads.mangadex.org';
// How many results of a search are looked at for one whose name is the title (the services search loosely, the first is not always it).
export const SEARCH_RESULTS = 5;

// AniList answers 30 requests a minute (90 normally): the names asked for together go in one request, this many at most. A name it does not
// know is an empty page, not an error, so it does not spoil the others (with Media, one unknown name made the whole request a 404).
export const ANILIST_BATCH_SIZE = 25;
// How long the names asked for are gathered before the request goes (the covers of a screen are asked for together).
export const ANILIST_BATCH_WINDOW_MS = 50;

// The covers of anime or mangas, found by their names (`$s0`, `$s1`...): AniList gives its best match for each, under `a0`, `a1`...
export function coverQuery(kind: CoverKind, count: number): string {
    const type = kind === 'anime' ? 'ANIME' : 'MANGA';
    const variables = Array.from({ length: count }, (_, index) => {
        return `$s${String(index)}: String`;
    }).join(', ');
    const pages = Array.from({ length: count }, (_, index) => {
        return `  a${String(index)}: Page(perPage: 1) { media(search: $s${String(index)}, type: ${type}) { coverImage { large } } }`;
    }).join('\n');
    return `query (${variables}) {\n${pages}\n}`;
}

type Json = Record<string, unknown>;

function asObject(value: unknown): Json | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : null;
}

function asList(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

function at(value: unknown, ...path: string[]): unknown {
    return path.reduce<unknown>((current, key) => {
        return asObject(current)?.[key];
    }, value);
}

// The first of these that is a text that is not empty, trimmed.
function firstText(...values: unknown[]): string | null {
    for (const value of values) {
        if (typeof value === 'string' && value.trim().length > 0) {
            return value.trim();
        }
    }
    return null;
}

function texts(values: unknown[]): string[] {
    return values.filter((value): value is string => {
        return typeof value === 'string';
    });
}

// A name as it is compared: without accents, signs or spaces, in lowercase ("Kaguya-sama: Love Is War" and "kaguya sama love is war" are
// the same).
export function comparableTitle(title: string): string {
    return title
        .normalize('NFKD')
        .replace(/\p{M}/gu, '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]/gu, '');
}

// The first result that has the title among its names, and what is taken from it; null when none has it.
export function pickByTitle<T>(results: readonly T[], title: string, namesOf: (result: T) => string[], pick: (result: T) => string | null): string | null {
    const wanted = comparableTitle(title);
    if (wanted.length === 0) {
        return null;
    }
    for (const result of results) {
        const named = namesOf(result).some((name) => {
            return comparableTitle(name) === wanted;
        });
        const picked = named ? pick(result) : null;
        if (picked !== null) {
            return picked;
        }
    }
    return null;
}

const JSON_HEADERS = { Accept: 'application/json' };

interface PendingSearch {
    title: string;
    resolve: (url: string | null) => void;
    reject: (error: unknown) => void;
}

// The names asked for are gathered a moment and asked for together, in one request (see ANILIST_BATCH_SIZE); each name gets its own answer.
export class AniListCoverProvider implements CoverProvider {
    readonly name = 'AniList';
    private readonly pending: Record<CoverKind, PendingSearch[]> = { anime: [], manga: [] };
    private readonly timers: Record<CoverKind, ReturnType<typeof setTimeout> | null> = { anime: null, manga: null };

    constructor(
        private readonly client: PoliteClient,
        private readonly url: string = ANILIST_COVER_URL,
        private readonly windowMs: number = ANILIST_BATCH_WINDOW_MS
    ) {}

    find(title: string, kind: CoverKind): Promise<string | null> {
        return new Promise((resolve, reject) => {
            this.pending[kind].push({ title, resolve, reject });
            if (this.pending[kind].length >= ANILIST_BATCH_SIZE) {
                this.flush(kind);
            } else {
                this.schedule(kind);
            }
        });
    }

    private schedule(kind: CoverKind): void {
        if (this.timers[kind] === null) {
            this.timers[kind] = setTimeout(() => {
                this.flush(kind);
            }, this.windowMs);
        }
    }

    // Sends the names gathered (as many as a request takes); the ones left wait for the next.
    private flush(kind: CoverKind): void {
        const timer = this.timers[kind];
        if (timer !== null) {
            clearTimeout(timer);
            this.timers[kind] = null;
        }
        const batch = this.pending[kind].splice(0, ANILIST_BATCH_SIZE);
        if (this.pending[kind].length > 0) {
            this.schedule(kind);
        }
        void this.send(kind, batch);
    }

    private async send(kind: CoverKind, batch: readonly PendingSearch[]): Promise<void> {
        const names = [
            ...new Set(
                batch.map((search) => {
                    return search.title;
                })
            )
        ];
        try {
            const response = await this.client.request(this.url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...JSON_HEADERS },
                body: JSON.stringify({ query: coverQuery(kind, names.length), variables: searchVariables(names) })
            });
            const body = await readJson(response);
            batch.forEach((search) => {
                const page = at(body, 'data', `a${String(names.indexOf(search.title))}`, 'media');
                search.resolve(firstText(at(asList(page)[0], 'coverImage', 'large')));
            });
        } catch (error) {
            batch.forEach((search) => {
                search.reject(error);
            });
        }
    }
}

function searchVariables(names: readonly string[]): Record<string, string> {
    return Object.fromEntries(
        names.map((name, index) => {
            return [`s${String(index)}`, name];
        })
    );
}

export class KitsuCoverProvider implements CoverProvider {
    readonly name = 'Kitsu';

    constructor(
        private readonly client: PoliteClient,
        private readonly url: string = KITSU_URL
    ) {}

    async find(title: string, kind: CoverKind): Promise<string | null> {
        const query = new URLSearchParams({ 'filter[text]': title, 'page[limit]': String(SEARCH_RESULTS), [`fields[${kind}]`]: 'canonicalTitle,titles,abbreviatedTitles,posterImage' });
        const response = await this.client.request(`${this.url}/${kind}?${query.toString()}`, { headers: { Accept: 'application/vnd.api+json' } });
        return pickByTitle(
            asList(at(await readJson(response), 'data')),
            title,
            (result) => {
                return texts([at(result, 'attributes', 'canonicalTitle'), ...Object.values(asObject(at(result, 'attributes', 'titles')) ?? {}), ...asList(at(result, 'attributes', 'abbreviatedTitles'))]);
            },
            (result) => {
                const poster = at(result, 'attributes', 'posterImage');
                return firstText(at(poster, 'large'), at(poster, 'original'), at(poster, 'medium'));
            }
        );
    }
}

// Only mangas. Its pictures cannot be shown from its own address (it refuses them to other sites): the app downloads them, as it does with
// every cover of a manga.
export class MangaDexCoverProvider implements CoverProvider {
    readonly name = 'MangaDex';

    constructor(
        private readonly client: PoliteClient,
        private readonly url: string = MANGADEX_URL,
        private readonly uploadsUrl: string = MANGADEX_UPLOADS_URL
    ) {}

    async find(title: string, kind: CoverKind): Promise<string | null> {
        if (kind !== 'manga') {
            return null;
        }
        const query = new URLSearchParams({ title, limit: String(SEARCH_RESULTS) });
        query.append('includes[]', 'cover_art');
        const response = await this.client.request(`${this.url}/manga?${query.toString()}`, { headers: JSON_HEADERS });
        return pickByTitle(
            asList(at(await readJson(response), 'data')),
            title,
            (result) => {
                return texts([...Object.values(asObject(at(result, 'attributes', 'title')) ?? {}), ...asList(at(result, 'attributes', 'altTitles')).flatMap((entry) => {
                    return Object.values(asObject(entry) ?? {});
                })]);
            },
            (result) => {
                const id = firstText(at(result, 'id'));
                const cover = asList(at(result, 'relationships')).find((relation) => {
                    return at(relation, 'type') === 'cover_art';
                });
                const fileName = firstText(at(cover, 'attributes', 'fileName'));
                return id === null || fileName === null ? null : `${this.uploadsUrl}/covers/${encodeURIComponent(id)}/${encodeURIComponent(fileName)}.512.jpg`;
            }
        );
    }
}
