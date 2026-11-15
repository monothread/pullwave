import type { StoredCover } from './animeDb';
import { ANILIST_URL, SCHEDULE_TIMEOUT_MS, type ScheduleFetchOptions } from './animeSchedule';
import { CoverChain, searchVariants } from './covers/coverChain';
import { AniListCoverProvider, type CoverProvider } from './covers/coverProviders';
import { COVER_ATTEMPTS, CoverFetchError, MAX_RETRY_WAIT_MS, PoliteClient } from './covers/politeClient';

export { COVER_ATTEMPTS, CoverFetchError, MAX_RETRY_WAIT_MS, searchVariants };

export const COVER_INTERVAL_MS = 1000;
export const MISSING_COVER_RETRY_MS = 3_600_000;

function keyOf(title: string): string {
    return title.trim().toLowerCase();
}

export interface CoverServiceDependencies extends ScheduleFetchOptions {
    store?: {
        get: (key: string) => StoredCover | null;
        save: (key: string, url: string | null) => void;
    };
    now?: () => number;
    startOfToday?: () => number;
    missingRetryMs?: number;
    onChange?: (title: string, url: string) => void;
    sleep?: (milliseconds: number) => Promise<void>;
    intervalMs?: number;
    batchWindowMs?: number;
    fallbacks?: readonly CoverProvider[];
}

function localMidnight(): number {
    return new Date().setHours(0, 0, 0, 0);
}

export class AnimeCoverService {
    private readonly known = new Map<string, StoredCover>();
    private readonly pending = new Map<string, Promise<string | null>>();
    private readonly refreshed = new Set<string>();
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
                const kept = url ?? stored.url;
                this.remember(key, kept);
                if (url !== null && url !== stored.url) {
                    this.deps.onChange?.(title, url);
                }
            })
            .catch(() => {
                return undefined;
            });
    }

    private ask(title: string): Promise<string | null> {
        return this.chain.find(title);
    }
}
