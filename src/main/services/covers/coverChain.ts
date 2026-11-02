import { AniListCoverProvider, KitsuCoverProvider, MangaDexCoverProvider, type CoverKind, type CoverProvider } from './coverProviders';
import { CoverFetchError, PoliteClient } from './politeClient';

// The cover of a title, looked for in one service after the other until one has it.

// How far apart the requests to each of the services that are tried when the first one has no cover go.
export const FALLBACK_INTERVAL_MS = 1000;
// How long a request to one of them may take: a service that does not answer must not hold the covers of a screen for long.
export const FALLBACK_TIMEOUT_MS = 6000;

const PARENTHESES = /\s*[([][^)\]]*[)\]]/g;
const NUMBER_WITH_D = /(\d)D\b/g;

// The names to look a title up by, from the one the source gives to simpler ones: the services find neither "Name (Mini Anime)" (the
// qualifier is the source's) nor "2.5D Name" (they write 2.5), but find "Name" and "2.5 Name".
export function searchVariants(title: string): string[] {
    const withoutQualifier = title.replace(PARENTHESES, '').trim();
    const simplified = withoutQualifier.replace(NUMBER_WITH_D, '$1').trim();
    return [...new Set([title.trim(), withoutQualifier, simplified])].filter((variant) => {
        return variant.length > 0;
    });
}

const SUBTITLE_SEPARATOR = ': ';

// The names the covers are looked up by: the ones of `searchVariants` and, for an anime, last of all, the name without its subtitle
// ("Name: Another Part" is found as "Name", the series it belongs to, when the services have no cover for the part itself).
export function coverSearchNames(kind: CoverKind, title: string): string[] {
    const names = searchVariants(title);
    const simplest = names.at(-1);
    if (kind !== 'anime' || simplest === undefined) {
        return names;
    }
    const series = simplest.split(SUBTITLE_SEPARATOR)[0]?.trim() ?? '';
    return series.length > 0 && !names.includes(series) ? [...names, series] : names;
}

function asCoverError(error: unknown): CoverFetchError {
    return error instanceof CoverFetchError ? error : new CoverFetchError(error instanceof Error ? error.message : String(error));
}

export class CoverChain {
    constructor(
        private readonly kind: CoverKind,
        private readonly providers: readonly CoverProvider[]
    ) {}

    // The cover of the first service that has one (null when none has). A service that cannot be asked is passed over; when none had a
    // cover and any could not be asked, the first failure is what rejects (a title is only known to have no cover when they all said so).
    async find(title: string): Promise<string | null> {
        let failure: CoverFetchError | null = null;
        for (const provider of this.providers) {
            try {
                const url = await this.askProvider(provider, title);
                if (url !== null) {
                    return url;
                }
            } catch (error) {
                failure ??= asCoverError(error);
            }
        }
        if (failure !== null) {
            throw failure;
        }
        return null;
    }

    // The cover of the first name the service knows; a failure to ask it (not a title it does not know) stops the names.
    private async askProvider(provider: CoverProvider, title: string): Promise<string | null> {
        for (const name of coverSearchNames(this.kind, title)) {
            const url = await provider.find(name, this.kind);
            if (url !== null) {
                return url;
            }
        }
        return null;
    }
}

export interface FallbackOptions {
    // One address that stands in for every service (the end-to-end tests point it at a fake server, or at nothing): each service is a path
    // under it (/anilist, /kitsu, /mangadex, /mangadex-uploads).
    baseUrl?: string;
    fetchFn?: typeof fetch;
    timeoutMs?: number;
    sleep?: (milliseconds: number) => Promise<void>;
    intervalMs?: number;
}

function clientFor(service: string, options: FallbackOptions): PoliteClient {
    return new PoliteClient({ service, intervalMs: options.intervalMs ?? FALLBACK_INTERVAL_MS, fetchFn: options.fetchFn, timeoutMs: options.timeoutMs ?? FALLBACK_TIMEOUT_MS, sleep: options.sleep });
}

function under(options: FallbackOptions, path: string): string | undefined {
    return options.baseUrl === undefined ? undefined : `${options.baseUrl.replace(/\/+$/, '')}/${path}`;
}

// The services tried after the first one: for an anime (AniList is the first) Kitsu; for a manga (the source is the first) AniList,
// MangaDex and then Kitsu.
export function fallbackProviders(kind: CoverKind, options: FallbackOptions = {}): CoverProvider[] {
    const kitsu = new KitsuCoverProvider(clientFor('Kitsu', options), under(options, 'kitsu'));
    if (kind === 'anime') {
        return [kitsu];
    }
    return [
        new AniListCoverProvider(clientFor('AniList', options), under(options, 'anilist')),
        new MangaDexCoverProvider(clientFor('MangaDex', options), under(options, 'mangadex'), under(options, 'mangadex-uploads')),
        kitsu
    ];
}
