import { PoliteClient, readJson } from './politeClient';

export type CoverKind = 'anime' | 'manga';

export interface CoverProvider {
    readonly name: string;
    find: (title: string, kind: CoverKind) => Promise<string | null>;
}

export const ANILIST_COVER_URL = 'https://graphql.anilist.co';
export const KITSU_URL = 'https://kitsu.io/api/edge';
export const MANGADEX_URL = 'https://api.mangadex.org';
export const MANGADEX_UPLOADS_URL = 'https://uploads.mangadex.org';
export const SEARCH_RESULTS = 5;

export const ANILIST_BATCH_SIZE = 25;
export const ANILIST_BATCH_WINDOW_MS = 50;

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

export function comparableTitle(title: string): string {
    return title
        .normalize('NFKD')
        .replace(/\p{M}/gu, '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]/gu, '');
}

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
