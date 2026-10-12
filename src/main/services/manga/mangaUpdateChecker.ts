import type { LibraryManga, MangaChapter, MangaDetails, MangaNewChapters } from '@shared/manga';
import type { MangaDb } from './mangaDb';

// How often the mangas of the library are asked about, and how long after the app opens the first check is made (so opening the app is
// not slowed by it).
export const CHECK_INTERVAL_MS = 60 * 60 * 1000;
export const FIRST_CHECK_DELAY_MS = 2 * 60 * 1000;

export interface MangaUpdateCheckerDependencies {
    db: Pick<MangaDb, 'list' | 'registerChapters' | 'saveDetails'>;
    // What the source says now about a manga of the library; throws when it cannot be reached.
    fetchManga: (remoteId: number) => Promise<{ details: MangaDetails; chapters: MangaChapter[] }>;
    // Whether the check is turned on (read at every check).
    isEnabled: () => boolean;
    onNewChapters: (news: MangaNewChapters) => void;
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
    private running: Promise<MangaNewChapters> | null = null;
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
    // on is not started again. A manga that cannot be reached is left for the next time.
    checkNow(): Promise<MangaNewChapters> {
        this.running ??= this.run().finally(() => {
            this.running = null;
        });
        return this.running;
    }

    private async run(): Promise<MangaNewChapters> {
        const news: MangaNewChapters = { count: 0, titles: [] };
        if (!this.deps.isEnabled()) {
            return news;
        }
        for (const manga of this.deps.db.list()) {
            if (this.stopped) {
                break;
            }
            try {
                const found = await this.deps.fetchManga(manga.remoteId);
                // The chapters are registered whether or not they are new: the source may have corrected a title or a number.
                const added = newChaptersOf(manga, found.chapters);
                this.deps.db.saveDetails(manga.id, found.details);
                if (added.length > 0) {
                    this.deps.db.registerChapters(manga.id, found.chapters, true);
                    news.count += added.length;
                    news.titles.push(manga.title);
                }
            } catch {
                continue;
            }
        }
        if (news.count > 0) {
            this.deps.onLibraryChanged();
            this.deps.onNewChapters(news);
        }
        return news;
    }
}
