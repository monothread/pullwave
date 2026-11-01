import type { StoredCover } from './animeDb';
import { ANILIST_URL, SCHEDULE_TIMEOUT_MS, type ScheduleFetchOptions } from './animeSchedule';
import { CoverChain, searchVariants } from './covers/coverChain';
import { AniListCoverProvider, type CoverProvider } from './covers/coverProviders';
import { COVER_ATTEMPTS, CoverFetchError, MAX_RETRY_WAIT_MS, PoliteClient } from './covers/politeClient';

export { COVER_ATTEMPTS, CoverFetchError, MAX_RETRY_WAIT_MS, searchVariants };

// The cover of an anime is found by its name: the source of the anime does not give one, AniList does (and, when it has none, the services
// of `fallbacks`). The requests to AniList go one after the other, a second apart, each with the names asked for together (see
// AniListCoverProvider). AniList limits how many it answers in a minute (30 for now, 90 normally): when it refuses (429) the requests wait
// as long as it asks for before the same one is made again.
export const COVER_INTERVAL_MS = 1000;
// An anime that has no cover is asked for again when it is shown, at most this often.
export const MISSING_COVER_RETRY_MS = 3_600_000;

function keyOf(title: string): string {
    return title.trim().toLowerCase();
}

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
    // How the program waits (the tests make it instant), how far apart the requests to AniList are, and how long the names asked for are
    // gathered before a request goes.
    sleep?: (milliseconds: number) => Promise<void>;
    intervalMs?: number;
    batchWindowMs?: number;
    // The services asked, one after the other, when AniList has no cover for a title (none by default).
    fallbacks?: readonly CoverProvider[];
}

function localMidnight(): number {
    return new Date().setHours(0, 0, 0, 0);
}

// Finds the cover of an anime by its title (null when neither AniList nor the fallbacks have one) and keeps it, so the next run starts with it. A cover that was
// last checked before today is shown as it is while it is checked again once, in the background: if AniList gives another address it
// replaces the old one (and `onChange` tells), and if it gives none or cannot be reached the old one stays. A failure to reach AniList
// for a title that was never found (and that no fallback has a cover for) rejects with a CoverFetchError and keeps nothing, so the next ask
// tries again.
export class AnimeCoverService {
    private readonly known = new Map<string, StoredCover>();
    private readonly pending = new Map<string, Promise<string | null>>();
    // What was already checked again in this run, so a failure is not tried again every time a card is shown.
    private readonly refreshed = new Set<string>();
    // When the cover of a title that has none was last asked for again in this run, so a title shown over and over does not ask each time.
    private readonly missingTried = new Map<string, number>();
    private readonly chain: CoverChain;

    constructor(private readonly deps: CoverServiceDependencies = {}) {
        const aniList = new AniListCoverProvider(
            new PoliteClient({ service: 'AniList', intervalMs: deps.intervalMs ?? COVER_INTERVAL_MS, fetchFn: deps.fetchFn, timeoutMs: deps.timeoutMs ?? SCHEDULE_TIMEOUT_MS, sleep: deps.sleep }),
            deps.url ?? ANILIST_URL,
            deps.batchWindowMs
        );
        this.chain = new CoverChain('anime', [aniList, ...(deps.fallbacks ?? [])]);
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

    // The cover of the first service that has one: AniList, then the fallbacks.
    private ask(title: string): Promise<string | null> {
        return this.chain.find(title);
    }
}
