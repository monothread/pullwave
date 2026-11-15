import type { AnimeAudioCheckSummary } from '@shared/anime';
import type { AnimeDb } from './animeDb';
import { probeAudio, type FfmpegRunner } from './audioExtractor';

export interface AudioCheckOptions {
    fileSize: (path: string) => number | null;
    hasAudio: (path: string) => Promise<boolean | null>;
}

export async function videoHasAudio(path: string, run: FfmpegRunner): Promise<boolean | null> {
    const probe = await probeAudio(path, run);
    if (probe.ok) {
        return true;
    }
    return probe.reason === 'no-audio' ? false : null;
}

export async function checkLibraryAudio(db: AnimeDb, options: AudioCheckOptions): Promise<AnimeAudioCheckSummary> {
    const summary: AnimeAudioCheckSummary = { checked: 0, withoutAudio: 0, unreadable: 0, unreadableIds: [], missing: 0 };
    for (const episode of db.episodesToCheckAudio()) {
        const path = episode.filePath;
        if (path === null || options.fileSize(path) === null) {
            summary.missing += 1;
            continue;
        }
        const hasAudio = await probeOrNull(path, options);
        if (hasAudio === null) {
            summary.unreadable += 1;
            summary.unreadableIds.push(episode.id);
            continue;
        }
        db.markAudioChecked(episode.id, path, hasAudio);
        summary.checked += 1;
        if (!hasAudio) {
            summary.withoutAudio += 1;
        }
    }
    return summary;
}

async function probeOrNull(path: string, options: AudioCheckOptions): Promise<boolean | null> {
    try {
        return await options.hasAudio(path);
    } catch {
        return null;
    }
}
