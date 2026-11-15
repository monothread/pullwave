import {
    IDLE_CHECK_STATE,
    MAX_AUTO_DOWNLOAD_EPISODES,
    type AniRunResult,
    type AnimeArrivalOrigin,
    type AnimeCheckResponse,
    type AnimeCheckState,
    type AnimeNewEpisodes,
    type AnimeSearchResult,
    type LibraryAnime
} from '@shared/anime';
import type { AnimeDb } from './animeDb';
import { resolveResult } from './animeSourceMatch';

export const CHECK_INTERVAL_MS = 3 * 60 * 60 * 1000;
export const FIRST_CHECK_DELAY_MS = 2 * 60 * 1000;
export const RETRY_BASE_MS = 60 * 60 * 1000;
export const BACKOFF_LIMIT_MS = 6 * 60 * 60 * 1000;

export interface AnimeUpdateCheckerDependencies {
    db: Pick<AnimeDb, 'list' | 'getLibraryAnime' | 'hasEpisodesBaseline' | 'registerEpisodesBaseline' | 'registerNewEpisodes' | 'updateSearchIndex'>;
    search: (query: string, atLeast?: number) => Promise<AniRunResult<AnimeSearchResult[]>>;
    episodes: (query: string, index: number) => Promise<AniRunResult<string[]>>;
    isEnabled: () => boolean;
    autoDownload?: () => boolean;
    download?: (animeId: number, episodes: string[]) => void;
    onNewEpisodes: (news: AnimeNewEpisodes) => void;
    onLibraryChanged: () => void;
    onProgress?: (state: AnimeCheckState) => void;
    beforeCheck?: () => Promise<void>;
    lastCheck?: { read: () => number | null; write: (time: number) => void };
    now?: () => number;
    firstDelayMs?: number;
    intervalMs?: number;
    retryMs?: number;
}

type Outcome = { kind: 'checked' } | { kind: 'skipped' } | { kind: 'failed'; blocked: boolean; message: string };

type Answer<T> = { ok: true; value: T } | { ok: false; outcome: Outcome };

function answerOf<T>(result: AniRunResult<T>): Answer<T> {
    if (result.status === 'done') {
        return { ok: true, value: result.value };
    }
    if (result.status === 'cancelled') {
        return { ok: false, outcome: { kind: 'failed', blocked: false, message: 'The look for new episodes was cancelled.' } };
    }
    if (result.error.code === 'NO_RESULTS') {
        return { ok: false, outcome: { kind: 'skipped' } };
    }
    return { ok: false, outcome: { kind: 'failed', blocked: result.error.code === 'BLOCKED', message: result.error.raw } };
}

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export class AnimeUpdateChecker {
    private first: ReturnType<typeof setTimeout> | null = null;
    private next: ReturnType<typeof setTimeout> | null = null;
    private running: Promise<AnimeCheckResponse> | null = null;
    private stopped = false;
    private failedRuns = 0;
    private progress: AnimeCheckState = IDLE_CHECK_STATE;

    constructor(private readonly deps: AnimeUpdateCheckerDependencies) {}

    start(): void {
        this.stopped = false;
        if (this.first !== null || this.next !== null) {
            return;
        }
        this.first = setTimeout(() => {
            this.first = null;
            void this.runScheduled();
        }, this.firstDelayMs());
    }

    private interval(): number {
        return this.deps.intervalMs ?? CHECK_INTERVAL_MS;
    }

    private now(): number {
        return (this.deps.now ?? Date.now)();
    }

    private firstDelayMs(): number {
        const usual = this.deps.firstDelayMs ?? FIRST_CHECK_DELAY_MS;
        const last = this.deps.lastCheck?.read() ?? null;
        if (last === null || !Number.isFinite(last) || last > this.now()) {
            return usual;
        }
        return Math.max(usual, last + this.interval() - this.now());
    }

    stop(): void {
        this.stopped = true;
        if (this.first !== null) {
            clearTimeout(this.first);
            this.first = null;
        }
        if (this.next !== null) {
            clearTimeout(this.next);
            this.next = null;
        }
    }

    state(): AnimeCheckState {
        return this.progress;
    }

    private report(state: AnimeCheckState): void {
        this.progress = state;
        this.deps.onProgress?.(state);
    }

    nextDelayMs(): number {
        if (this.failedRuns === 0) {
            return this.interval();
        }
        return Math.min((this.deps.retryMs ?? RETRY_BASE_MS) * 2 ** (this.failedRuns - 1), BACKOFF_LIMIT_MS, this.interval());
    }

    private async runScheduled(): Promise<void> {
        await this.checkNow('auto');
        if (!this.stopped) {
            this.next = setTimeout(() => {
                this.next = null;
                void this.runScheduled();
            }, this.deps.isEnabled() ? this.nextDelayMs() : Math.min(this.deps.retryMs ?? RETRY_BASE_MS, this.interval()));
        }
    }

    checkNow(origin: AnimeArrivalOrigin = 'auto'): Promise<AnimeCheckResponse> {
        this.running ??= this.run(origin).finally(() => {
            this.running = null;
        });
        return this.running;
    }

    async checkAnime(animeId: number): Promise<AnimeCheckResponse> {
        const anime = this.deps.db.getLibraryAnime(animeId);
        if (anime === null) {
            return { ok: false, error: { code: 'NOT_FOUND', message: 'The anime is not in the library.' } };
        }
        const news = this.emptyNews();
        const outcome = await this.attempt(anime, 'manual', news);
        if (outcome.kind === 'failed') {
            return { ok: false, error: { code: 'UNKNOWN', message: outcome.message } };
        }
        this.tell(news);
        return { ok: true, count: news.count, titles: news.titles, notDownloaded: news.notDownloaded, failed: 0, skipped: outcome.kind === 'skipped' ? 1 : 0 };
    }

    private emptyNews(): AnimeNewEpisodes {
        return { count: 0, titles: [], notDownloaded: [] };
    }

    private async run(origin: AnimeArrivalOrigin): Promise<AnimeCheckResponse> {
        const news = this.emptyNews();
        if (origin === 'auto' && !this.deps.isEnabled()) {
            return { ok: true, count: 0, titles: [], notDownloaded: [], failed: 0, skipped: 0 };
        }
        let asked = 0;
        let failed = 0;
        let skipped = 0;
        let blocked = false;
        try {
            if (this.deps.beforeCheck !== undefined) {
                this.report({ running: true, origin, done: 0, total: 0, current: null });
                await this.deps.beforeCheck().catch(() => {
                    return undefined;
                });
            }
            const library = this.deps.db.list().filter((anime) => {
                return !anime.airing.complete;
            });
            if (library.length > 0) {
                this.report({ running: true, origin, done: 0, total: library.length, current: (library[0] as LibraryAnime).title });
            }
            for (const [position, anime] of library.entries()) {
                if (this.stopped) {
                    break;
                }
                if (asked > 0) {
                    this.report({ running: true, origin, done: position, total: library.length, current: anime.title });
                }
                asked += 1;
                const outcome = await this.attempt(anime, origin, news);
                if (outcome.kind === 'skipped') {
                    skipped += 1;
                } else if (outcome.kind === 'failed') {
                    failed += 1;
                    if (outcome.blocked) {
                        blocked = true;
                        skipped += library.length - position - 1;
                        break;
                    }
                }
            }
        } finally {
            if (this.progress.running) {
                this.report(IDLE_CHECK_STATE);
            }
        }
        const unanswered = blocked || (asked > 0 && failed === asked);
        this.failedRuns = unanswered ? this.failedRuns + 1 : 0;
        if (origin === 'auto' && asked > 0 && !unanswered && !this.stopped) {
            this.deps.lastCheck?.write(this.now());
        }
        this.tell(news);
        return { ok: true, count: news.count, titles: news.titles, notDownloaded: news.notDownloaded, failed, skipped };
    }

    private async attempt(anime: LibraryAnime, origin: AnimeArrivalOrigin, news: AnimeNewEpisodes): Promise<Outcome> {
        try {
            return await this.check(anime, origin, news);
        } catch (error) {
            return { kind: 'failed', blocked: false, message: messageOf(error) };
        }
    }

    private async check(anime: LibraryAnime, origin: AnimeArrivalOrigin, news: AnimeNewEpisodes): Promise<Outcome> {
        const searched = answerOf(await this.deps.search(anime.query, anime.searchIndex));
        if (!searched.ok) {
            return searched.outcome;
        }
        const index = resolveResult(anime, searched.value);
        if (index === null) {
            return { kind: 'skipped' };
        }
        if (index !== anime.searchIndex) {
            this.deps.db.updateSearchIndex(anime.id, index);
        }
        const listed = answerOf(await this.deps.episodes(anime.query, index));
        if (!listed.ok) {
            return listed.outcome;
        }
        if (!this.deps.db.hasEpisodesBaseline(anime.id)) {
            this.deps.db.registerEpisodesBaseline(anime.id, listed.value);
            return { kind: 'checked' };
        }
        const arrived = this.deps.db.registerNewEpisodes(anime.id, listed.value, origin);
        if (arrived.length > 0) {
            this.addNews(anime, arrived, news);
        }
        return { kind: 'checked' };
    }

    private addNews(anime: LibraryAnime, arrived: readonly string[], news: AnimeNewEpisodes): void {
        news.count += arrived.length;
        news.titles.push(anime.title);
        if (this.deps.autoDownload?.() !== true) {
            return;
        }
        if (arrived.length > MAX_AUTO_DOWNLOAD_EPISODES) {
            news.notDownloaded.push(anime.title);
            return;
        }
        this.deps.download?.(anime.id, [...arrived]);
    }

    private tell(news: AnimeNewEpisodes): void {
        if (news.count > 0) {
            this.deps.onLibraryChanged();
            this.deps.onNewEpisodes(news);
        }
    }
}
