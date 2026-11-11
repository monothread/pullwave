import type { AnimeImportSummary } from '@shared/anime';
import type { AnimeDb } from './animeDb';
import type { ScanResult } from './libraryScan';

export interface LibraryImportOptions {
    // The size of a file, or null when it is not there.
    fileSize: (path: string) => number | null;
    // An episode was added or pointed to a new file.
    onEpisodeSaved?: (episodeId: number) => void;
}

// Puts what was found on the disk into the library. An episode that is already there with the same file is left alone, one
// that is there with another file (the folder was renamed or moved) is pointed to the new one, and the others are added; what
// the metadata remembered (the position, watched or not) comes back with the episodes that are added.
export function importLibrary(db: AnimeDb, scan: ScanResult, options: LibraryImportOptions): AnimeImportSummary {
    const summary: AnimeImportSummary = { added: 0, relinked: 0, skipped: 0, ignored: scan.ignored };
    scan.episodes.forEach((found) => {
        const anime = db.importAnime({ title: found.title, query: found.query, searchIndex: found.searchIndex });
        if (found.series !== null && found.season !== null && anime.series === null) {
            // What the user set before is never replaced, and a season that is already taken leaves the anime on its own.
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
