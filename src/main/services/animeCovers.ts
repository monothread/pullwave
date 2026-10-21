import type { StoredCover } from './animeDb';
import { ANILIST_URL, SCHEDULE_TIMEOUT_MS, type ScheduleFetchOptions } from './animeSchedule';

// The cover of an anime, found by its name: the source of the anime does not give one, AniList does.
export const COVER_QUERY = `query ($search: String!) {
  Media(search: $search, type: ANIME) {
    coverImage { large }
  }
}`;
// The requests go one after the other, a second apart. AniList limits how many it answers in a minute (30 for now, 90 normally): when it
// refuses (429) the requests wait as long as it asks for before the same one is made again.
export const COVER_INTERVAL_MS = 1000;
export const MAX_RETRY_WAIT_MS = 90_000;
export const COVER_ATTEMPTS = 3;
// An anime that has no cover is asked for again when it is shown, at most this often.
export const MISSING_COVER_RETRY_MS = 3_600_000;
const TOO_MANY_REQUESTS_STATUS = 429;
const NOT_FOUND_STATUS = 404;

function coverOf(body: unknown): string | null {
    const media = (body as { data?: { Media?: { coverImage?: { large?: unknown } } } } | null)?.data?.Media;
    const large = media?.coverImage?.large;
    return typeof large === 'string' && large.trim().length > 0 ? large.trim() : null;
}

const PARENTHESES = /\s*[([][^)\]]*[)\]]/g;
const NUMBER_WITH_D = /(\d)D\b/g;

// The names to look an anime up by, from the one the source gives to simpler ones: AniList finds neither "Name (Mini Anime)" (the
// qualifier is the source's) nor "2.5D Name" (it writes 2.5), but finds "Name" and "2.5 Name".
export function searchVariants(title: string): string[] {
    const withoutQualifier = title.replace(PARENTHESES, '').trim();
    const simplified = withoutQualifier.replace(NUMBER_WITH_D, '$1').trim();
    return [...new Set([title.trim(), withoutQualifier, simplified])].filter((variant) => {
        return variant.length > 0;
    });
}

function keyOf(title: string): string {
    return title.trim().toLowerCase();
}

// The cover could not be asked for (AniList was not reached or refused): unlike an anime that has none, this is not remembered.
export class CoverFetchError extends Error {}

// Where the covers are kept between runs (see AnimeDb) and what the service does when one changes.
export interface CoverServiceDependencies extends ScheduleFetchOptions {
    store?: {
        get: (key: string) => StoredCover | null;
        save: (key: string, url: string | null) => void;
    };
    // The moment now, and the one the current day started at, in milliseconds.
    now?: () => number;
    startOfToday?: () => number;
    // How long before a title that has no cover is asked for again (an hour by default).
    missingRetryMs?: number;
    // A cover that was checked again and turned out to be another one, or that was found for a title that had none.
    onChange?: (title: string, url: string) => void;
    // How the program waits (the tests make it instant) and how far apart the requests are.
    sleep?: (milliseconds: number) => Promise<void>;
    intervalMs?: number;
}

function wait(milliseconds: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
    });
}

function localMidnight(): number {
    return new Date().setHours(0, 0, 0, 0);
}

// Finds the cover of an anime by its title (null when AniList has none) and keeps it, so the next run starts with it. A cover that was
// last checked before today is shown as it is while it is checked again once, in the background: if AniList gives another address it
// replaces the old one (and `onChange` tells), and if it gives none or cannot be reached the old one stays. A failure to reach AniList
// for a title that was never found rejects with a CoverFetchError and keeps nothing, so the next ask tries again.
export class AnimeCoverService {
    private readonly known = new Map<string, StoredCover>();
    private readonly pending = new Map<string, Promise<string | null>>();
    // What was already checked again in this run, so a failure is not tried again every time a card is shown.
    private readonly refreshed = new Set<string>();
    // When the cover of a title that has none was last asked for again in this run, so a title shown over and over does not ask each time.
    private readonly missingTried = new Map<string, number>();
    // The requests take turns: each one is let go once the one before it and the interval have passed.
    private turns: Promise<void> = Promise.resolve();
    private readonly intervalMs: number;

    constructor(private readonly deps: CoverServiceDependencies = {}) {
        this.intervalMs = deps.intervalMs ?? COVER_INTERVAL_MS;
    }

    find(title: string): Promise<string | null> {
        const key = keyOf(title);
        const stored = this.known.get(key) ?? this.deps.store?.get(key) ?? null;
        if (stored !== null) {
            this.known.set(key, stored);
            if (stored.url === null) {
                this.retryMissing(title.trim(), key, stored);
            } else {
                this.refreshIfOld(title.trim(), key, stored);
            }
            return Promise.resolve(stored.url);
        }
        const inFlight = this.pending.get(key);
        if (inFlight !== undefined) {
            return inFlight;
        }
        const started = this.ask(title.trim())
            .then((url) => {
                this.remember(key, url);
                return url;
            })
            .finally(() => {
                this.pending.delete(key);
            });
        this.pending.set(key, started);
        return started;
    }

    private remember(key: string, url: string | null): void {
        this.deps.store?.save(key, url);
        this.known.set(key, { url, checkedAt: (this.deps.now ?? Date.now)() });
    }

    // A title that has no cover is asked for again in the background, once an hour at most (counted from the last time it was asked for,
    // whether or not AniList could be reached): the one that is kept is what is shown meanwhile, and `onChange` tells when one is found.
    private retryMissing(title: string, key: string, stored: StoredCover): void {
        const now = (this.deps.now ?? Date.now)();
        const lastAsked = Math.max(stored.checkedAt, this.missingTried.get(key) ?? 0);
        if (now - lastAsked < (this.deps.missingRetryMs ?? MISSING_COVER_RETRY_MS)) {
            return;
        }
        this.missingTried.set(key, now);
        void this.ask(title)
            .then((url) => {
                this.remember(key, url);
                if (url !== null) {
                    this.deps.onChange?.(title, url);
                }
            })
            .catch(() => {
                // AniList could not be reached: there is still none, and it is asked again an hour from now.
                return undefined;
            });
    }

    private refreshIfOld(title: string, key: string, stored: StoredCover): void {
        if (stored.checkedAt >= (this.deps.startOfToday ?? localMidnight)() || this.refreshed.has(key)) {
            return;
        }
        this.refreshed.add(key);
        void this.ask(title)
            .then((url) => {
                // None found now does not take away the one that was found before; it only counts as checked.
                const kept = url ?? stored.url;
                this.remember(key, kept);
                if (url !== null && url !== stored.url) {
                    this.deps.onChange?.(title, url);
                }
            })
            .catch(() => {
                // AniList could not be reached: the cover that is kept stays, and today's check is not counted as done.
                return undefined;
            });
    }

    private sleep(milliseconds: number): Promise<void> {
        return (this.deps.sleep ?? wait)(milliseconds);
    }

    // Waits for the turn of a request; the next one is let go an interval after this one.
    private async takeTurn(): Promise<void> {
        const mine = this.turns;
        this.turns = mine.then(() => {
            return this.sleep(this.intervalMs);
        });
        await mine;
    }

    // Everything after this one waits too: AniList asked to be left alone for a while.
    private holdTurns(milliseconds: number): void {
        this.turns = this.turns.then(() => {
            return this.sleep(milliseconds);
        });
    }

    // The cover of the first name that AniList knows; a failure to reach it (not an anime it does not know) stops the search.
    private async ask(title: string): Promise<string | null> {
        for (const name of searchVariants(title)) {
            const answer = await this.askAbout(name);
            if (answer !== 'unknown') {
                return answer;
            }
        }
        return null;
    }

    private async askAbout(name: string): Promise<string | null | 'unknown'> {
        for (let attempt = 1; attempt <= COVER_ATTEMPTS; attempt += 1) {
            await this.takeTurn();
            const response = await this.post(name);
            if (response.status === TOO_MANY_REQUESTS_STATUS && attempt < COVER_ATTEMPTS) {
                this.holdTurns(Math.min(Number(response.headers.get('retry-after')) * 1000 || this.intervalMs, MAX_RETRY_WAIT_MS));
                continue;
            }
            if (response.status === NOT_FOUND_STATUS) {
                return 'unknown';
            }
            if (!response.ok) {
                throw new CoverFetchError(`AniList answered with status ${response.status}.`);
            }
            return coverOf(await response.json().catch(() => {
                return null;
            })) ?? 'unknown';
        }
        throw new CoverFetchError('AniList did not answer.');
    }

    private async post(name: string): Promise<Response> {
        try {
            return await (this.deps.fetchFn ?? fetch)(this.deps.url ?? ANILIST_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({ query: COVER_QUERY, variables: { search: name } }),
                signal: AbortSignal.timeout(this.deps.timeoutMs ?? SCHEDULE_TIMEOUT_MS)
            });
        } catch (error) {
            throw new CoverFetchError(`AniList could not be reached: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}
