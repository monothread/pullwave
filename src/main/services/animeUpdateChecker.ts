import {
    IDLE_CHECK_STATE,
    MAX_AUTO_DOWNLOAD_EPISODES,
    type AniRunResult,
    type AnimeArrivalOrigin,
    type AnimeAudio,
    type AnimeCheckResponse,
    type AnimeCheckState,
    type AnimeNewEpisodes,
    type AnimeSearchResult,
    type LibraryAnime
} from '@shared/anime';
import type { AnimeDb } from './animeDb';
import { resolveResult } from './animeSourceMatch';

// How often the anime of the library are asked about (every 6 hours: the library is long and every look is a few requests for each anime),
// and how long after the app opens the first check is made when none was made in the last interval (so opening the app is not slowed by it).
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const FIRST_CHECK_DELAY_MS = 2 * 60 * 1000;
// When a look fails for every anime it is tried again after this long, then after twice as long and so on up to the limit below, and while
// the automatic look is off the setting is read again this often.
export const RETRY_BASE_MS = 60 * 60 * 1000;
// The longest the retries wait.
export const BACKOFF_LIMIT_MS = 6 * 60 * 60 * 1000;

export interface AnimeUpdateCheckerDependencies {
    db: Pick<AnimeDb, 'list' | 'getLibraryAnime' | 'hasEpisodesBaseline' | 'registerEpisodesBaseline' | 'registerNewEpisodes' | 'updateSearchIndex'>;
    // What the source lists now: the results of a search, and the episodes of one of them.
    search: (query: string, audio: AnimeAudio) => Promise<AniRunResult<AnimeSearchResult[]>>;
    episodes: (query: string, index: number, audio: AnimeAudio) => Promise<AniRunResult<string[]>>;
    // Whether the hourly check is turned on (read at every check).
    isEnabled: () => boolean;
    // Whether the episodes that are found are downloaded too (read at every check), and the way to queue them.
    autoDownload?: () => boolean;
    download?: (animeId: number, episodes: string[]) => void;
    onNewEpisodes: (news: AnimeNewEpisodes) => void;
    onLibraryChanged: () => void;
    // The check of all the anime began, moved on by one anime or ended (see `state`).
    onProgress?: (state: AnimeCheckState) => void;
    // Done at the start of each check of all the anime, before the anime to ask about are chosen: it brings up to date what is known about
    // which ones have ended. When it fails the check goes on with what was known.
    beforeCheck?: () => Promise<void>;
    // When the last look that asked about the anime and got an answer was made (in milliseconds), kept between runs of the app: opening the
    // app again the same day does not look again. Null: none is known. Without it, a look is made after each start.
    lastCheck?: { read: () => number | null; write: (time: number) => void };
    // The times and the waiting, when they are not the usual ones (used by the tests).
    now?: () => number;
    firstDelayMs?: number;
    intervalMs?: number;
    retryMs?: number;
}

// What came of the check of one anime: it was read, it cannot be told apart in the source (it is left until the user opens it), or the
// source could not be asked (`blocked` when it refused, which ends the whole check).
type Outcome = { kind: 'checked' } | { kind: 'skipped' } | { kind: 'failed'; blocked: boolean; message: string };

type Answer<T> = { ok: true; value: T } | { ok: false; outcome: Outcome };

// What ani-cli answered, or the outcome of the check when it did not answer with a value: an anime the search no longer finds is skipped,
// and anything else is a failure.
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

// Looks, once an hour, for episodes the source has listed for the anime of the library, and puts them in the library (they are only
// downloaded when the user wants that). It asks about one anime at a time.
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

    // How long after the app opens the first look is made: the usual time, or what is left of the interval since the last look when that was
    // made less than an interval ago.
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

    // Whether a check of all the anime is going on and how far it is (a check of one anime is too short to be told).
    state(): AnimeCheckState {
        return this.progress;
    }

    private report(state: AnimeCheckState): void {
        this.progress = state;
        this.deps.onProgress?.(state);
    }

    // How long the check after the one that just ended waits: the interval, or, after checks in a row where the source could not be reached
    // for any anime, a retry that waits twice as long each time (never longer than the limit or than the interval).
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

    // Checks every anime of the library that is not complete, one after the other. A check that is going on is not started again.
    // An anime that cannot be reached is left for the next time. The hourly check only runs when it is turned on; the one the user asks
    // for runs whatever that setting says.
    checkNow(origin: AnimeArrivalOrigin = 'auto'): Promise<AnimeCheckResponse> {
        this.running ??= this.run(origin).finally(() => {
            this.running = null;
        });
        return this.running;
    }

    // Checks one anime of the library, now (the button of its page).
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
            // An anime whose releases are over has no new episodes to find: it is not asked about.
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
                    // The source refused: asking about the rest would only make it worse.
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
        // A look that got answers counts as the last look (one the app was closed in the middle of, or that nobody answered, does not).
        if (origin === 'auto' && asked > 0 && !unanswered && !this.stopped) {
            this.deps.lastCheck?.write(this.now());
        }
        this.tell(news);
        return { ok: true, count: news.count, titles: news.titles, notDownloaded: news.notDownloaded, failed, skipped };
    }

    // Checks one anime, whatever goes wrong with it: that is a failure of that anime and the others are still asked about.
    private async attempt(anime: LibraryAnime, origin: AnimeArrivalOrigin, news: AnimeNewEpisodes): Promise<Outcome> {
        try {
            return await this.check(anime, origin, news);
        } catch (error) {
            return { kind: 'failed', blocked: false, message: messageOf(error) };
        }
    }

    // Asks the source about one anime; what is new is put in the library (and downloaded, when the user wants that). The first reading of
    // the episodes of an anime only registers them: they are not new, and so they are not announced nor downloaded.
    private async check(anime: LibraryAnime, origin: AnimeArrivalOrigin, news: AnimeNewEpisodes): Promise<Outcome> {
        const searched = answerOf(await this.deps.search(anime.query, anime.audio));
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
        const listed = answerOf(await this.deps.episodes(anime.query, index, anime.audio));
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

    // Counts the episodes that arrived and, when the user wants them downloaded, queues them. So many at once is not a season coming out
    // but the list of the source changing, so none is downloaded then (they are all in the library).
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
