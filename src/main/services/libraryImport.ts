import type { AnimeImportSummary } from '@shared/anime';
import type { AnimeDb } from './animeDb';
import type { ScanResult } from './libraryScan';

export interface LibraryImportOptions {
    fileSize: (path: string) => number | null;
    onEpisodeSaved?: (episodeId: number) => void;
}

export function importLibrary(db: AnimeDb, scan: ScanResult, options: LibraryImportOptions): AnimeImportSummary {
    const summary: AnimeImportSummary = { added: 0, relinked: 0, skipped: 0, ignored: scan.ignored };
    scan.episodes.forEach((found) => {
        const anime = db.importAnime({ title: found.title, query: found.query, searchIndex: found.searchIndex });
        if (found.series !== null && found.season !== null && anime.series === null) {
            db.setSeries(anime.id, found.series, found.season, found.seasonName);
        }
        const size = options.fileSize(found.videoPath);
        const known = db.getEpisodeByNumber(anime.id, found.number);
        if (known?.status === 'done' && known.filePath === found.videoPath) {
            summary.skipped += 1;
            return;
        }
        if (known?.status === 'done') {
            db.relinkEpisode(known.id, found.videoPath, size);
            options.onEpisodeSaved?.(known.id);
            summary.relinked += 1;
            return;
        }
        const episode = db.ensureEpisode(anime.id, found.number);
        db.markDone(episode.id, found.videoPath, size);
        if (found.progress) {
            db.saveProgress({ episodeId: episode.id, ...found.progress });
        }
        options.onEpisodeSaved?.(episode.id);
        summary.added += 1;
    });
    return summary;
}
