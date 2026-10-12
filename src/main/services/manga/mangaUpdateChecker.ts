import type { ArrivalOrigin, LibraryManga, MangaChapter, MangaCheckResponse, MangaDetails, MangaNewChapters } from '@shared/manga';
import type { MangaDb } from './mangaDb';

// How often the mangas of the library are asked about, and how long after the app opens the first check is made (so opening the app is
// not slowed by it).
export const CHECK_INTERVAL_MS = 60 * 60 * 1000;
export const FIRST_CHECK_DELAY_MS = 2 * 60 * 1000;

export interface MangaUpdateCheckerDependencies {
    db: Pick<MangaDb, 'list' | 'getLibraryManga' | 'registerChapters' | 'saveDetails'>;
    // What the source says now about a manga of the library; throws when it cannot be reached.
    fetchManga: (remoteId: number) => Promise<{ details: MangaDetails; chapters: MangaChapter[] }>;
    // Whether the check is turned on (read at every check).
    isEnabled: () => boolean;
    onNewChapters: (news: MangaNewChapters) => void;
    // Whether the chapters that are found are downloaded too (read at every check), and the way to queue them.
    autoDownload?: () => boolean;
    download?: (mangaId: number, chapterRemoteIds: number[]) => void;
    onLibraryChanged: () => void;
    // The times, when they are not the usual ones (used by the end-to-end tests).
    firstDelayMs?: number;
    intervalMs?: number;
}

// The chapters the source has that the library does not.
export function newChaptersOf(manga: Pick<LibraryManga, 'chapters'>, remote: readonly MangaChapter[]): MangaChapter[] {
    const known = new Set(
        manga.chapters.map((chapter) => {
            return chapter.remoteId;
        })
    );
    return remote.filter((chapter) => {
        return !known.has(chapter.remoteId);
    });
}

// Looks, once an hour, for chapters the sources have published for the mangas of the library, and puts them in the library (they are
// not downloaded: that is for the user to decide).
export class MangaUpdateChecker {
    private first: ReturnType<typeof setTimeout> | null = null;
    private every: ReturnType<typeof setInterval> | null = null;
    private running: Promise<MangaCheckResponse> | null = null;
    private stopped = false;

    constructor(private readonly deps: MangaUpdateCheckerDependencies) {}

    start(): void {
        this.stopped = false;
        if (this.first !== null || this.every !== null) {
            return;
        }
        this.first = setTimeout(() => {
            this.first = null;
            void this.checkNow();
        }, this.deps.firstDelayMs ?? FIRST_CHECK_DELAY_MS);
        this.every = setInterval(() => {
            void this.checkNow();
        }, this.deps.intervalMs ?? CHECK_INTERVAL_MS);
    }

    stop(): void {
        this.stopped = true;
        if (this.first !== null) {
            clearTimeout(this.first);
            this.first = null;
        }
        if (this.every !== null) {
            clearInterval(this.every);
            this.every = null;
        }
    }

    // Checks every manga of the library, one after the other (a site is not asked for several things at once). A check that is going
    // on is not started again. A manga that cannot be reached is left for the next time. The hourly check only runs when it is turned on;
    // the one the user asks for runs whatever that setting says.
    checkNow(origin: ArrivalOrigin = 'auto'): Promise<MangaCheckResponse> {
        this.running ??= this.run(origin).finally(() => {
            this.running = null;
        });
        return this.running;
    }

    // Checks one manga of the library, now (the button of its page).
    async checkManga(mangaId: number): Promise<MangaCheckResponse> {
        const manga = this.deps.db.getLibraryManga(mangaId);
        if (manga === null) {
            return { ok: false, error: { code: 'NOT_FOUND', message: 'The manga is not in the library.' } };
        }
        const news: MangaNewChapters = { count: 0, titles: [] };
        try {
            await this.check(manga, 'manual', news);
        } catch (error) {
            return { ok: false, error: toCheckError(error) };
        }
        this.tell(news);
        return { ok: true, count: news.count, titles: news.titles, failed: 0 };
    }

    private async run(origin: ArrivalOrigin): Promise<MangaCheckResponse> {
        const news: MangaNewChapters = { count: 0, titles: [] };
        let failed = 0;
        if (origin === 'auto' && !this.deps.isEnabled()) {
            return { ok: true, count: 0, titles: [], failed: 0 };
        }
        for (const manga of this.deps.db.list()) {
            if (this.stopped) {
                break;
            }
            try {
                await this.check(manga, origin, news);
            } catch {
                failed += 1;
            }
        }
        this.tell(news);
        return { ok: true, count: news.count, titles: news.titles, failed };
    }

    // Asks the source about one manga; what is new is put in the library (and downloaded, when the user wants that). Throws when the
    // source cannot be reached.
    private async check(manga: LibraryManga, origin: ArrivalOrigin, news: MangaNewChapters): Promise<void> {
        const found = await this.deps.fetchManga(manga.remoteId);
        // The chapters are registered whether or not they are new: the source may have corrected a title or a number.
        const added = newChaptersOf(manga, found.chapters);
        this.deps.db.saveDetails(manga.id, found.details);
        if (added.length === 0) {
            return;
        }
        this.deps.db.registerChapters(manga.id, found.chapters, origin);
        news.count += added.length;
        news.titles.push(manga.title);
        if (this.deps.autoDownload?.() === true) {
            this.deps.download?.(
                manga.id,
                added.map((chapter) => {
                    return chapter.remoteId;
                })
            );
        }
    }

    private tell(news: MangaNewChapters): void {
        if (news.count > 0) {
            this.deps.onLibraryChanged();
            this.deps.onNewChapters(news);
        }
    }
}

function toCheckError(error: unknown): { code: 'UNKNOWN'; message: string } {
    return { code: 'UNKNOWN', message: error instanceof Error ? error.message : String(error) };
}
