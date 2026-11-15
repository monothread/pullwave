import { AniListCoverProvider, KitsuCoverProvider, MangaDexCoverProvider, type CoverKind, type CoverProvider } from './coverProviders';
import { CoverFetchError, PoliteClient } from './politeClient';

export const FALLBACK_INTERVAL_MS = 1000;
export const FALLBACK_TIMEOUT_MS = 6000;

const PARENTHESES = /\s*[([][^)\]]*[)\]]/g;
const NUMBER_WITH_D = /(\d)D\b/g;

export function searchVariants(title: string): string[] {
    const withoutQualifier = title.replace(PARENTHESES, '').trim();
    const simplified = withoutQualifier.replace(NUMBER_WITH_D, '$1').trim();
    return [...new Set([title.trim(), withoutQualifier, simplified])].filter((variant) => {
        return variant.length > 0;
    });
}

const SUBTITLE_SEPARATOR = ': ';

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
