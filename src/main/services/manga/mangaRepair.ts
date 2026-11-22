import type { MangaRepairResult, MangaResult } from '@shared/manga';
import type { ChapterDownloadResult, ChapterRepairOptions, ChapterRunResult } from './mangaChapterDownloader';
import type { MangaDb } from './mangaDb';

export interface MangaRepairDependencies {
    db: Pick<MangaDb, 'getChapter' | 'getManga' | 'chaptersOf' | 'markDone' | 'markIncomplete'>;
    repair: (options: ChapterRepairOptions, signal: AbortSignal) => Promise<ChapterRunResult<ChapterDownloadResult>>;
    pathExists: (path: string) => boolean;
    onLibraryEntryChanged: (mangaId: number) => void;
    onChapterRepaired?: (mangaId: number) => void;
}

function invalid(message: string): MangaResult<never> {
    return { ok: false, error: { code: 'INVALID_REQUEST', message } };
}

export class MangaRepair {
    private readonly running = new Map<number, number>();
    private readonly runs = new Set<Promise<unknown>>();
    private readonly controller = new AbortController();

    constructor(private readonly deps: MangaRepairDependencies) {}

    async repairMissing(mangaIds: readonly number[]): Promise<void> {
        const incomplete = mangaIds.flatMap((mangaId) => {
            return [...this.deps.db.chaptersOf(mangaId)]
                .reverse()
                .filter((chapter) => {
                    return chapter.status === 'incomplete';
                });
        });
        for (const chapter of incomplete) {
            if (this.controller.signal.aborted) {
                return;
            }
            await this.repair(chapter.id, null);
        }
    }

    isRepairing(mangaId: number): boolean {
        return [...this.running.values()].includes(mangaId);
    }

    async shutdown(): Promise<void> {
        this.controller.abort();
        await Promise.allSettled([...this.runs]);
    }

    repair(chapterId: number, pageIndex: number | null): Promise<MangaResult<MangaRepairResult>> {
        const run = this.repairChapter(chapterId, pageIndex);
        this.runs.add(run);
        void run.finally(() => {
            this.runs.delete(run);
        });
        return run;
    }

    private async repairChapter(chapterId: number, pageIndex: number | null): Promise<MangaResult<MangaRepairResult>> {
        const { db } = this.deps;
        if (this.controller.signal.aborted) {
            return invalid('The app is closing.');
        }
        const chapter = db.getChapter(chapterId);
        const manga = chapter === null ? null : db.getManga(chapter.mangaId);
        if (chapter === null || manga === null || chapter.status !== 'incomplete' || chapter.filePath === null || !this.deps.pathExists(chapter.filePath)) {
            return invalid('The chapter has no pages to download again.');
        }
        if (this.running.has(chapterId)) {
            return invalid('The pages of the chapter are being downloaded already.');
        }
        this.running.set(chapterId, chapter.mangaId);
        try {
            const result = await this.deps.repair(
                {
                    chapterRemoteId: chapter.remoteId,
                    seriesTitle: manga.title,
                    chapter,
                    details: { author: manga.author, artist: manga.artist, description: manga.description, genres: manga.genres },
                    filePath: chapter.filePath,
                    pageCount: chapter.pageCount,
                    pageIndex
                },
                this.controller.signal
            );
            if (result.status !== 'done') {
                return result.status === 'error' ? { ok: false, error: result.error } : { ok: false, error: { code: 'UNKNOWN', message: 'The pages were not downloaded.' } };
            }
            const { filePath, sizeBytes, pageCount, missingPages } = result.value;
            if (missingPages.length === 0) {
                db.markDone(chapterId, filePath, sizeBytes, pageCount);
            } else {
                db.markIncomplete(chapterId, filePath, sizeBytes, pageCount);
            }
            this.deps.onChapterRepaired?.(chapter.mangaId);
            this.deps.onLibraryEntryChanged(chapter.mangaId);
            return { ok: true, value: { missing: missingPages } };
        } finally {
            this.running.delete(chapterId);
        }
    }
}
