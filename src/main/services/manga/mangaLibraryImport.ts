import { hasChapterFile, type MangaChapterRecord, type MangaImportSummary } from '@shared/manga';
import type { MangaDb } from './mangaDb';
import type { MangaScanResult } from './mangaLibraryScan';

export interface MangaLibraryImportOptions {
    pathSize: (path: string) => number | null;
    onMangaSaved?: (mangaId: number) => void;
}

export function importMangaLibrary(db: MangaDb, scan: MangaScanResult, options: MangaLibraryImportOptions): MangaImportSummary {
    const summary: MangaImportSummary = { added: 0, relinked: 0, skipped: 0, ignored: scan.ignored };
    const savedMangaIds: number[] = [];

    db.transaction(() => {
        scan.mangas.forEach((found) => {
            const manga = db.importManga({
                sourceId: found.sourceId,
                remoteId: found.remoteId,
                title: found.title,
                thumbnailUrl: found.thumbnailUrl,
                url: found.url,
                author: found.author,
                artist: found.artist,
                description: found.description,
                genres: found.genres,
                status: found.status
            });
            let changed = false;
            if (found.series !== null && found.season !== null && manga.series === null) {
                if (db.setSeries(manga.id, found.series, found.season, found.seasonName)) {
                    changed = true;
                }
            }
            const existingChapters = db.chaptersOf(manga.id);
            const byRemoteId = new Map<number, MangaChapterRecord>();
            const byNumber = new Map<number, MangaChapterRecord>();
            const byLowerName = new Map<string, MangaChapterRecord>();
            let minRemoteId = 0;
            existingChapters.forEach((existing) => {
                byRemoteId.set(existing.remoteId, existing);
                if (existing.number !== null && !byNumber.has(existing.number)) {
                    byNumber.set(existing.number, existing);
                }
                const lower = existing.name.toLowerCase();
                if (!byLowerName.has(lower)) {
                    byLowerName.set(lower, existing);
                }
                if (existing.remoteId < minRemoteId) {
                    minRemoteId = existing.remoteId;
                }
            });

            const indexChapter = (record: MangaChapterRecord): void => {
                byRemoteId.set(record.remoteId, record);
                if (record.number !== null && !byNumber.has(record.number)) {
                    byNumber.set(record.number, record);
                }
                const lower = record.name.toLowerCase();
                if (!byLowerName.has(lower)) {
                    byLowerName.set(lower, record);
                }
                if (record.remoteId < minRemoteId) {
                    minRemoteId = record.remoteId;
                }
            };

            found.chapters.forEach((chapter) => {
                const known =
                    (chapter.remoteId !== null ? byRemoteId.get(chapter.remoteId) : undefined) ??
                    (chapter.number !== null ? byNumber.get(chapter.number) : undefined) ??
                    byLowerName.get(chapter.name.toLowerCase()) ??
                    null;
                if (known !== null && hasChapterFile(known.status) && known.filePath === chapter.filePath) {
                    summary.skipped += 1;
                    return;
                }
                if (known !== null && hasChapterFile(known.status)) {
                    if (known.filePath !== null && options.pathSize(known.filePath) !== null) {
                        summary.skipped += 1;
                        return;
                    }
                    const size = options.pathSize(chapter.filePath);
                    db.relinkChapter(known.id, chapter.filePath, size, chapter.pageCount);
                    indexChapter({ ...known, filePath: chapter.filePath, sizeBytes: size, pageCount: chapter.pageCount > 0 ? chapter.pageCount : known.pageCount });
                    summary.relinked += 1;
                    changed = true;
                    return;
                }
                const size = options.pathSize(chapter.filePath);
                const nextRemoteId = chapter.remoteId ?? (minRemoteId -= 1);
                const record =
                    known ??
                    db.ensureChapter(
                        manga.id,
                        {
                            remoteId: nextRemoteId,
                            name: chapter.name,
                            number: chapter.number,
                            dateUploaded: chapter.dateUploaded,
                            scanlator: chapter.scanlator,
                            sourceOrder: chapter.sourceOrder
                        },
                        false
                    );
                if (chapter.incomplete) {
                    db.markIncomplete(record.id, chapter.filePath, size, chapter.pageCount);
                    indexChapter({ ...record, status: 'incomplete', filePath: chapter.filePath, sizeBytes: size, pageCount: chapter.pageCount });
                } else {
                    db.markDone(record.id, chapter.filePath, size, chapter.pageCount);
                    indexChapter({ ...record, status: 'done', filePath: chapter.filePath, sizeBytes: size, pageCount: chapter.pageCount });
                }
                summary.added += 1;
                changed = true;
            });
            if (changed) {
                savedMangaIds.push(manga.id);
            }
        });
    });

    savedMangaIds.forEach((mangaId) => {
        options.onMangaSaved?.(mangaId);
    });
    return summary;
}
