import { IDLE_MANGA_CHECK_STATE, type ArrivalOrigin, type LibraryManga, type MangaChapter, type MangaCheckResponse, type MangaCheckState, type MangaDetails, type MangaNewChapters, type MangaStatus } from '@shared/manga';
import { LOCAL_MANGA_SOURCE_ID, type MangaDb } from './mangaDb';

export const CHECK_INTERVAL_MS = 60 * 60 * 1000;
export const FIRST_CHECK_DELAY_MS = 2 * 60 * 1000;

export interface MangaUpdateCheckerDependencies {
    db: Pick<MangaDb, 'list' | 'getLibraryManga' | 'registerChapters' | 'saveDetails'>;
    fetchManga: (remoteId: number) => Promise<{ details: MangaDetails; chapters: MangaChapter[] }>;
    installedSourceIds?: () => Promise<ReadonlySet<string> | null>;
    isEnabled: () => boolean;
    onNewChapters: (news: MangaNewChapters) => void;
    autoDownload?: () => boolean;
    download?: (mangaId: number, chapterRemoteIds: number[]) => void;
    onLibraryChanged: () => void;
    onProgress?: (state: MangaCheckState) => void;
    firstDelayMs?: number;
    intervalMs?: number;
}

const OVER_STATUSES: ReadonlySet<MangaStatus> = new Set<MangaStatus>(['completed', 'cancelled']);

export function isMangaOver(manga: Pick<LibraryManga, 'status'>): boolean {
    return OVER_STATUSES.has(manga.status);
}

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

export class MangaUpdateChecker {
    private first: ReturnType<typeof setTimeout> | null = null;
    private every: ReturnType<typeof setInterval> | null = null;
    private running: Promise<MangaCheckResponse> | null = null;
    private stopped = false;
    private progress: MangaCheckState = IDLE_MANGA_CHECK_STATE;

    constructor(private readonly deps: MangaUpdateCheckerDependencies) {}

    state(): MangaCheckState {
        return this.progress;
    }

    private report(state: MangaCheckState): void {
        this.progress = state;
        this.deps.onProgress?.(state);
    }

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

    checkNow(origin: ArrivalOrigin = 'auto'): Promise<MangaCheckResponse> {
        this.running ??= this.run(origin).finally(() => {
            this.running = null;
        });
        return this.running;
    }

    private async installedSources(): Promise<ReadonlySet<string> | null> {
        if (this.deps.installedSourceIds === undefined) {
            return null;
        }
        try {
            return await this.deps.installedSourceIds();
        } catch {
            return null;
        }
    }

    async checkManga(mangaId: number): Promise<MangaCheckResponse> {
        const manga = this.deps.db.getLibraryManga(mangaId);
        if (manga === null) {
            return { ok: false, error: { code: 'NOT_FOUND', message: 'The manga is not in the library.' } };
        }
        if (manga.sourceId === LOCAL_MANGA_SOURCE_ID) {
            return { ok: true, count: 0, titles: [], failed: 0, skipped: 1 };
        }
        const installed = this.deps.installedSourceIds === undefined ? null : await this.installedSources();
        if (installed !== null && !installed.has(manga.sourceId)) {
            return { ok: true, count: 0, titles: [], failed: 0, skipped: 1 };
        }
        const news: MangaNewChapters = { count: 0, titles: [] };
        try {
            await this.check(manga, 'manual', news);
        } catch (error) {
            return { ok: false, error: toCheckError(error) };
        }
        this.tell(news);
        return { ok: true, count: news.count, titles: news.titles, failed: 0, skipped: 0 };
    }

    private async run(origin: ArrivalOrigin): Promise<MangaCheckResponse> {
        const news: MangaNewChapters = { count: 0, titles: [] };
        let failed = 0;
        let skipped = 0;
        if (origin === 'auto' && !this.deps.isEnabled()) {
            return { ok: true, count: 0, titles: [], failed: 0, skipped: 0 };
        }
        const installed = this.deps.installedSourceIds === undefined ? null : await this.installedSources();
        const library = this.deps.db.list().filter((manga) => {
            return origin === 'manual' || !isMangaOver(manga);
        });
        const asked = library.filter((manga) => {
            return manga.sourceId !== LOCAL_MANGA_SOURCE_ID && (installed === null || installed.has(manga.sourceId));
        });
        let done = 0;
        if (asked.length > 0) {
            this.report({ running: true, origin, done: 0, total: asked.length, current: (asked[0] as LibraryManga).title });
        }
        try {
            for (const manga of library) {
                if (this.stopped) {
                    break;
                }
                if (manga.sourceId === LOCAL_MANGA_SOURCE_ID || (installed !== null && !installed.has(manga.sourceId))) {
                    skipped += 1;
                    continue;
                }
                if (done > 0) {
                    this.report({ running: true, origin, done, total: asked.length, current: manga.title });
                }
                try {
                    await this.check(manga, origin, news);
                } catch {
                    failed += 1;
                }
                done += 1;
            }
        } finally {
            if (this.progress.running) {
                this.report(IDLE_MANGA_CHECK_STATE);
            }
        }
        this.tell(news);
        return { ok: true, count: news.count, titles: news.titles, failed, skipped };
    }

    private async check(manga: LibraryManga, origin: ArrivalOrigin, news: MangaNewChapters): Promise<void> {
        const found = await this.deps.fetchManga(manga.remoteId);
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
