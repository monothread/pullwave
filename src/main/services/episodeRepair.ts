import type { AnimeRepairSummary } from '@shared/anime';
import type { AnimeDb } from './animeDb';
import type { RepairResult } from './imageHeaderRepair';

export interface EpisodeRepairOptions {
    fileSize: (path: string) => number | null;
    repair: (path: string) => Promise<RepairResult>;
    hasAudio: (path: string) => Promise<boolean | null>;
}

export async function repairLibraryEpisodes(db: AnimeDb, episodeIds: readonly number[], options: EpisodeRepairOptions): Promise<AnimeRepairSummary> {
    const summary: AnimeRepairSummary = { repaired: 0, failed: 0, skipped: 0 };
    for (const episodeId of episodeIds) {
        const episode = db.getEpisode(episodeId);
        const path = episode?.filePath ?? null;
        if (episode?.status !== 'done' || path === null || options.fileSize(path) === null) {
            summary.skipped += 1;
            continue;
        }
        const result = await repairOrFail(path, options);
        if (result.status === 'not-needed') {
            summary.skipped += 1;
        } else if (result.status === 'failed') {
            summary.failed += 1;
        } else {
            db.updateFileSize(episodeId, path, result.sizeBytes);
            await markAudio(db, episodeId, path, options);
            summary.repaired += 1;
        }
    }
    return summary;
}

async function repairOrFail(path: string, options: EpisodeRepairOptions): Promise<RepairResult> {
    try {
        return await options.repair(path);
    } catch {
        return { status: 'failed' };
    }
}

async function markAudio(db: AnimeDb, episodeId: number, path: string, options: EpisodeRepairOptions): Promise<void> {
    try {
        const hasAudio = await options.hasAudio(path);
        if (hasAudio !== null) {
            db.markAudioChecked(episodeId, path, hasAudio);
        }
    } catch {
        // The audio is only looked at to help: the episode stays as it is, to be looked at when the user asks.
    }
}
