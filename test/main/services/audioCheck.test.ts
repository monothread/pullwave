import { AnimeDb } from '@main/services/animeDb';
import { checkLibraryAudio, videoHasAudio } from '@main/services/audioCheck';
import type { FfmpegResult, FfmpegRunner } from '@main/services/audioExtractor';

const VIDEO_AND_AUDIO = `Input #0, mov,mp4, from '/lib/1.mp4':
  Duration: 00:23:40.04, start: 0.000000, bitrate: 4477 kb/s
  Stream #0:0[0x1](und): Video: h264 (High), yuv420p, 1920x1080, 4475 kb/s
  Stream #0:1[0x2](jpn): Audio: aac (LC), 48000 Hz, stereo, fltp, 128 kb/s
At least one output file must be specified`;

const VIDEO_ONLY = `Input #0, mov,mp4, from '/lib/1.mp4':
  Duration: 00:23:40.04, start: 0.000000, bitrate: 4477 kb/s
  Stream #0:0[0x1](und): Video: h264 (High), yuv420p, 1920x1080, 4475 kb/s
At least one output file must be specified`;

function runnerAnswering(result: FfmpegResult) {
    return vi.fn<FfmpegRunner>(async () => {
        return result;
    });
}

describe('videoHasAudio', () => {
    it('is true for a video that has an audio stream, and asks ffmpeg only for what it says of the input', async () => {
        const run = runnerAnswering({ code: 1, stderr: VIDEO_AND_AUDIO });

        expect(await videoHasAudio('/lib/1.mp4', run)).toBe(true);

        expect(run).toHaveBeenCalledTimes(1);
        expect(run).toHaveBeenCalledWith(['-hide_banner', '-nostdin', '-i', '/lib/1.mp4']);
    });

    it('is false for a video that has only the picture', async () => {
        expect(await videoHasAudio('/lib/1.mp4', runnerAnswering({ code: 1, stderr: VIDEO_ONLY }))).toBe(false);
    });

    it('says nothing for a file ffmpeg could not read as a video', async () => {
        const unreadable = runnerAnswering({ code: 1, stderr: "/lib/1.mp4: Invalid data found when processing input" });

        expect(await videoHasAudio('/lib/1.mp4', unreadable)).toBeNull();
    });

    it('says nothing when ffmpeg could not be run', async () => {
        expect(await videoHasAudio('/lib/1.mp4', runnerAnswering({ code: null, stderr: '' }))).toBeNull();
    });
});

describe('checkLibraryAudio', () => {
    function makeLibrary() {
        const db = new AnimeDb(':memory:', () => {
            return 1000;
        });
        const naruto = db.upsertAnime({ title: 'Naruto', query: 'naruto', searchIndex: 1 });
        const bleach = db.upsertAnime({ title: 'Bleach', query: 'bleach', searchIndex: 2 });
        const paths = ['/lib/Naruto/1.mp4', '/lib/Naruto/2.mp4', '/lib/Bleach/1.mp4'];
        [
            [naruto.id, '1'],
            [naruto.id, '2'],
            [bleach.id, '1']
        ].forEach(([animeId, number], index) => {
            db.markDone(db.ensureEpisode(animeId as number, number as string).id, paths[index] as string, 100);
        });
        return { db, paths };
    }

    function options(files: string[], answers: Record<string, boolean | null | Error>) {
        const hasAudio = vi.fn(async (path: string): Promise<boolean | null> => {
            const answer = path in answers ? answers[path] : true;
            if (answer instanceof Error) {
                throw answer;
            }
            return answer ?? null;
        });
        const fileSize = vi.fn((path: string): number | null => {
            return files.includes(path) ? 100 : null;
        });
        return { hasAudio, fileSize };
    }

    it('looks at every downloaded episode once, in the order of the library, and says how many have no audio', async () => {
        const { db, paths } = makeLibrary();
        const { hasAudio, fileSize } = options(paths, { '/lib/Naruto/2.mp4': false });

        const summary = await checkLibraryAudio(db, { hasAudio, fileSize });

        expect(summary).toEqual({ checked: 3, withoutAudio: 1, unreadable: 0, unreadableIds: [], missing: 0 });
        expect(hasAudio.mock.calls).toEqual([['/lib/Naruto/1.mp4'], ['/lib/Naruto/2.mp4'], ['/lib/Bleach/1.mp4']]);
        expect(
            db.list().flatMap((anime) => {
                return anime.episodes.map((episode) => {
                    return [anime.title, episode.number, episode.noAudio];
                });
            })
        ).toEqual([
            ['Bleach', '1', false],
            ['Naruto', '1', false],
            ['Naruto', '2', true]
        ]);
        expect(db.episodesToCheckAudio()).toEqual([]);
    });

    it('does not look again at what was looked at, so asking again only looks at what is left', async () => {
        const { db, paths } = makeLibrary();
        const first = options(paths, { '/lib/Naruto/2.mp4': false });
        await checkLibraryAudio(db, first);

        const second = options(paths, {});
        const summary = await checkLibraryAudio(db, second);

        expect(summary).toEqual({ checked: 0, withoutAudio: 0, unreadable: 0, unreadableIds: [], missing: 0 });
        expect(second.hasAudio).not.toHaveBeenCalled();
        expect(db.getEpisode(2)).toMatchObject({ noAudio: true });
    });

    it('counts the episodes whose file is not on the disk, without looking at them, and leaves them to be looked at later', async () => {
        const { db, paths } = makeLibrary();
        const { hasAudio, fileSize } = options([paths[0] as string, paths[2] as string], {});

        const summary = await checkLibraryAudio(db, { hasAudio, fileSize });

        expect(summary).toEqual({ checked: 2, withoutAudio: 0, unreadable: 0, unreadableIds: [], missing: 1 });
        expect(hasAudio).not.toHaveBeenCalledWith('/lib/Naruto/2.mp4');
        expect(db.episodesToCheckAudio()).toMatchObject([{ id: 2, filePath: '/lib/Naruto/2.mp4' }]);
    });

    it('counts the videos that could not be read, whether the check said so or failed, and leaves them to be looked at later', async () => {
        const { db, paths } = makeLibrary();
        const { hasAudio, fileSize } = options(paths, { '/lib/Naruto/1.mp4': null, '/lib/Naruto/2.mp4': new Error('spawn ffmpeg ENOENT') });

        const summary = await checkLibraryAudio(db, { hasAudio, fileSize });

        expect(summary).toEqual({ checked: 1, withoutAudio: 0, unreadable: 2, unreadableIds: [1, 2], missing: 0 });
        expect(
            db.episodesToCheckAudio().map((episode) => {
                return episode.filePath;
            })
        ).toEqual(['/lib/Naruto/1.mp4', '/lib/Naruto/2.mp4']);
    });

    it('answers zeros for a library with nothing downloaded', async () => {
        const db = new AnimeDb(':memory:');
        const { hasAudio, fileSize } = options([], {});

        expect(await checkLibraryAudio(db, { hasAudio, fileSize })).toEqual({ checked: 0, withoutAudio: 0, unreadable: 0, unreadableIds: [], missing: 0 });
        expect(hasAudio).not.toHaveBeenCalled();
        expect(fileSize).not.toHaveBeenCalled();
    });
});
