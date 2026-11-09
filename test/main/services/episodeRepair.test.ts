import { AnimeDb } from '@main/services/animeDb';
import { repairLibraryEpisodes } from '@main/services/episodeRepair';
import type { RepairResult } from '@main/services/imageHeaderRepair';

function makeLibrary() {
    const db = new AnimeDb(':memory:', () => {
        return 1000;
    });
    const anime = db.upsertAnime({ title: 'Kaiju', query: 'kaiju', searchIndex: 1, audio: 'sub' });
    const paths = ['/lib/Kaiju/1.mp4', '/lib/Kaiju/2.mp4', '/lib/Kaiju/3.mp4'];
    paths.forEach((path, index) => {
        db.markDone(db.ensureEpisode(anime.id, String(index + 1)).id, path, 100);
    });
    // The fourth is queued: it has no file.
    db.ensureEpisode(anime.id, '4');
    return { db, paths };
}

function options(answers: Record<string, RepairResult | Error>, files: readonly string[], audio: boolean | null | Error = true) {
    const repair = vi.fn(async (path: string): Promise<RepairResult> => {
        const answer = answers[path] ?? { status: 'not-needed' };
        if (answer instanceof Error) {
            throw answer;
        }
        return answer;
    });
    const fileSize = vi.fn((path: string): number | null => {
        return files.includes(path) ? 100 : null;
    });
    const hasAudio = vi.fn(async (): Promise<boolean | null> => {
        if (audio instanceof Error) {
            throw audio;
        }
        return audio;
    });
    return { repair, fileSize, hasAudio };
}

describe('repairLibraryEpisodes', () => {
    it('repairs the episodes it is given, one at a time and in that order, and says how many it repaired', async () => {
        const { db, paths } = makeLibrary();
        const settings = options({ [paths[0] as string]: { status: 'repaired', sizeBytes: 5000 }, [paths[1] as string]: { status: 'repaired', sizeBytes: 6000 } }, paths);

        const summary = await repairLibraryEpisodes(db, [1, 2], settings);

        expect(summary).toEqual({ repaired: 2, failed: 0, skipped: 0 });
        expect(settings.repair.mock.calls).toEqual([[paths[0]], [paths[1]]]);
    });

    it('brings the size of a repaired episode up to date and looks at its audio again', async () => {
        const { db, paths } = makeLibrary();
        const settings = options({ [paths[0] as string]: { status: 'repaired', sizeBytes: 5000 } }, paths, false);

        await repairLibraryEpisodes(db, [1], settings);

        expect(db.getEpisode(1)).toMatchObject({ status: 'done', filePath: paths[0], sizeBytes: 5000, noAudio: true });
        expect(settings.hasAudio).toHaveBeenCalledTimes(1);
        expect(settings.hasAudio).toHaveBeenCalledWith(paths[0]);
    });

    it('marks a repaired episode that has audio as one that has', async () => {
        const { db, paths } = makeLibrary();

        await repairLibraryEpisodes(db, [1], options({ [paths[0] as string]: { status: 'repaired', sizeBytes: 5000 } }, paths, true));

        expect(db.getEpisode(1)).toMatchObject({ noAudio: false });
    });

    it('leaves the audio as it was when it cannot be told after the repair, or the look fails', async () => {
        const { db, paths } = makeLibrary();
        const repaired = { [paths[0] as string]: { status: 'repaired', sizeBytes: 5000 } as RepairResult, [paths[1] as string]: { status: 'repaired', sizeBytes: 6000 } as RepairResult };

        expect(await repairLibraryEpisodes(db, [1], options(repaired, paths, null))).toEqual({ repaired: 1, failed: 0, skipped: 0 });
        expect(await repairLibraryEpisodes(db, [2], options(repaired, paths, new Error('spawn ffmpeg ENOENT')))).toEqual({ repaired: 1, failed: 0, skipped: 0 });

        expect(db.getEpisode(1)).toMatchObject({ sizeBytes: 5000 });
        expect(db.getEpisode(2)).toMatchObject({ sizeBytes: 6000 });
        // Neither was marked: both are still to be looked at when the user asks.
        expect(
            db.episodesToCheckAudio().map((episode) => {
                return episode.id;
            })
        ).toEqual([1, 2, 3]);
    });

    it('counts the ones it could not repair, and the ones whose repair threw, and leaves them as they were', async () => {
        const { db, paths } = makeLibrary();
        const settings = options({ [paths[0] as string]: { status: 'failed' }, [paths[1] as string]: new Error('disk full') }, paths);

        expect(await repairLibraryEpisodes(db, [1, 2], settings)).toEqual({ repaired: 0, failed: 2, skipped: 0 });

        expect(db.getEpisode(1)).toMatchObject({ sizeBytes: 100 });
        expect(db.getEpisode(2)).toMatchObject({ sizeBytes: 100 });
        expect(settings.hasAudio).not.toHaveBeenCalled();
    });

    it('leaves alone a video that is not hidden behind a picture', async () => {
        const { db, paths } = makeLibrary();

        expect(await repairLibraryEpisodes(db, [3], options({}, paths))).toEqual({ repaired: 0, failed: 0, skipped: 1 });

        expect(db.getEpisode(3)).toMatchObject({ sizeBytes: 100 });
    });

    it('leaves alone an episode that is not there, one that is not downloaded and one whose file is gone, without trying to repair them', async () => {
        const { db, paths } = makeLibrary();
        const settings = options({}, [paths[0] as string]);

        expect(await repairLibraryEpisodes(db, [99, 4, 2], settings)).toEqual({ repaired: 0, failed: 0, skipped: 3 });

        expect(settings.repair).not.toHaveBeenCalled();
    });

    it('does nothing for an empty list', async () => {
        const { db, paths } = makeLibrary();
        const settings = options({}, paths);

        expect(await repairLibraryEpisodes(db, [], settings)).toEqual({ repaired: 0, failed: 0, skipped: 0 });

        expect(settings.repair).not.toHaveBeenCalled();
    });

    it('counts every episode of a mixed list in the group it belongs to', async () => {
        const { db, paths } = makeLibrary();
        const settings = options({ [paths[0] as string]: { status: 'repaired', sizeBytes: 5000 }, [paths[1] as string]: { status: 'failed' } }, paths);

        expect(await repairLibraryEpisodes(db, [1, 2, 3, 4], settings)).toEqual({ repaired: 1, failed: 1, skipped: 2 });
    });
});
