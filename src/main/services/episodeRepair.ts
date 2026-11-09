import type { AnimeRepairSummary } from '@shared/anime';
import type { AnimeDb } from './animeDb';
import type { RepairResult } from './imageHeaderRepair';

export interface EpisodeRepairOptions {
    // The size of a file, or null when it is not there.
    fileSize: (path: string) => number | null;
    repair: (path: string) => Promise<RepairResult>;
    // Whether the video has an audio stream, or null when that could not be told.
    hasAudio: (path: string) => Promise<boolean | null>;
}

// Repairs the videos of these downloaded episodes that are hidden behind a picture (see imageHeaderRepair.ts), one at a time. It answers how many
// it repaired, how many it could not (they stay as they were) and how many it left alone (not downloaded, no file on the disk, or a video that is
// not hidden behind a picture). A repaired episode has its size brought up to date and its audio looked at again.
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
