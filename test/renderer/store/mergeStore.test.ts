// @vitest-environment jsdom
import type { MergeMedia, MergeRun } from '@shared/merge';
import { useMergeStore } from '@renderer/store/mergeStore';
import { installMockApi, type MockApiHandle } from '../../helpers/mockApi';

const VIDEO_A: MergeMedia = {
    path: '/videos/part1.mp4',
    name: 'part1',
    extension: '.mp4',
    durationSeconds: 12,
    width: 1280,
    height: 720,
    fps: 30,
    videoCodec: 'h264',
    pixelFormat: 'yuv420p',
    videoTimebase: '15360',
    hasAudio: true,
    audioCodec: 'aac',
    audioSampleRate: 48000,
    audioChannels: 'stereo',
    streamOrder: 'va'
};

const VIDEO_B: MergeMedia = {
    path: '/videos/part2.mp4',
    name: 'part2',
    extension: '.mp4',
    durationSeconds: 18,
    width: 1280,
    height: 720,
    fps: 30,
    videoCodec: 'h264',
    pixelFormat: 'yuv420p',
    videoTimebase: '15360',
    hasAudio: true,
    audioCodec: 'aac',
    audioSampleRate: 48000,
    audioChannels: 'stereo',
    streamOrder: 'va'
};

const RUNNING: MergeRun = {
    id: 1,
    format: 'mp4',
    outputMode: 'downloads',
    outputDirectory: '/downloads',
    outputName: 'part1 - merged.mp4',
    inputCount: 2,
    totalDurationSeconds: 30,
    method: 'copy',
    status: 'running',
    percent: 40,
    outputPath: null,
    error: null
};

const initial = useMergeStore.getInitialState();
let mock: MockApiHandle;

beforeEach(() => {
    mock = installMockApi();
    useMergeStore.setState({ ...initial });
});

describe('useMergeStore', () => {
    it('subscribes to merge progress and loads the current run on init', async () => {
        mock.api.merge.current.mockResolvedValueOnce(RUNNING);
        const stop = await useMergeStore.getState().init();
        expect(useMergeStore.getState().run).toEqual(RUNNING);

        const done: MergeRun = { ...RUNNING, status: 'done', percent: 100, outputPath: '/downloads/part1 - merged.mp4' };
        mock.emitMergeProgress(done);
        expect(useMergeStore.getState().run).toEqual(done);
        stop();
    });

    it('chooses videos, reports rejections, and preserves error on cancel', async () => {
        mock.api.merge.choose.mockResolvedValueOnce({ ok: false, reason: 'not-video' });
        await useMergeStore.getState().choose();
        expect(useMergeStore.getState().error).toBe('not-video');

        mock.api.merge.choose.mockResolvedValueOnce({ ok: false, reason: 'cancelled' });
        await useMergeStore.getState().choose();
        expect(useMergeStore.getState().error).toBe('not-video');

        mock.api.merge.choose.mockResolvedValueOnce({
            ok: true,
            media: [VIDEO_A, VIDEO_B],
            rejected: [{ path: '/videos/song.mp3', reason: 'not-video' }]
        });
        await useMergeStore.getState().choose();
        expect(useMergeStore.getState().items.map((item) => {
            return item.media;
        })).toEqual([VIDEO_A, VIDEO_B]);
        expect(useMergeStore.getState().rejectedCount).toBe(1);
        expect(useMergeStore.getState().error).toBeNull();
    });

    it('adds dropped paths allowing duplicates, reorders items up and down, and removes by id', async () => {
        mock.api.merge.probe
            .mockResolvedValueOnce({ ok: true, media: VIDEO_A })
            .mockResolvedValueOnce({ ok: true, media: VIDEO_B })
            .mockResolvedValueOnce({ ok: true, media: VIDEO_A });

        await useMergeStore.getState().addPaths([VIDEO_A.path, VIDEO_B.path, VIDEO_A.path]);
        const items = useMergeStore.getState().items;
        expect(items.map((item) => {
            return item.media.name;
        })).toEqual(['part1', 'part2', 'part1']);

        useMergeStore.getState().moveItem(items[0]!.id, 'up');
        expect(useMergeStore.getState().items.map((item) => {
            return item.id;
        })).toEqual([items[0]!.id, items[1]!.id, items[2]!.id]);

        useMergeStore.getState().moveItem(items[1]!.id, 'up');
        expect(useMergeStore.getState().items.map((item) => {
            return item.media.name;
        })).toEqual(['part2', 'part1', 'part1']);

        useMergeStore.getState().moveItem(items[1]!.id, 'down');
        expect(useMergeStore.getState().items.map((item) => {
            return item.media.name;
        })).toEqual(['part1', 'part2', 'part1']);

        useMergeStore.getState().removeItem(items[2]!.id);
        expect(useMergeStore.getState().items.map((item) => {
            return item.media.name;
        })).toEqual(['part1', 'part2']);
    });

    it('starts a merge in the exact reordered sequence, syncs default format, cancels, and clears', async () => {
        const stop = await useMergeStore.getState().init();
        useMergeStore.getState().syncDefaultFormat('mkv');
        expect(useMergeStore.getState().format).toBe('mkv');
        useMergeStore.getState().setFormat('webm');
        useMergeStore.getState().syncDefaultFormat('mp4');
        expect(useMergeStore.getState().format).toBe('webm');

        mock.api.merge.probe.mockResolvedValueOnce({ ok: true, media: VIDEO_A }).mockResolvedValueOnce({ ok: true, media: VIDEO_B });
        await useMergeStore.getState().addPaths([VIDEO_A.path, VIDEO_B.path]);
        const secondId = useMergeStore.getState().items[1]!.id;
        useMergeStore.getState().moveItem(secondId, 'up');
        useMergeStore.getState().setOutputName('  My Mix  ');
        useMergeStore.getState().setOutputMode('custom');

        await useMergeStore.getState().start();
        expect(useMergeStore.getState().startError).toBe('invalid');
        expect(mock.api.merge.start).not.toHaveBeenCalled();

        mock.api.chooseDirectory.mockResolvedValueOnce('/exports');
        await useMergeStore.getState().chooseOutputDir();
        expect(useMergeStore.getState().customOutputDir).toBe('/exports');

        mock.api.merge.start.mockResolvedValueOnce({ ok: true, run: RUNNING });
        await useMergeStore.getState().start();
        expect(mock.api.merge.start).toHaveBeenCalledWith({
            paths: [VIDEO_B.path, VIDEO_A.path],
            format: 'webm',
            outputMode: 'custom',
            outputDirectory: '/exports',
            outputName: 'My Mix'
        });
        expect(useMergeStore.getState().run).toEqual(RUNNING);

        await useMergeStore.getState().cancel();
        expect(mock.api.merge.cancel).toHaveBeenCalledTimes(1);

        mock.emitMergeProgress({ ...RUNNING, status: 'cancelled', percent: 0 });
        await useMergeStore.getState().clear();
        expect(mock.api.merge.clear).toHaveBeenCalledTimes(1);
        expect(useMergeStore.getState().items).toEqual([]);
        expect(useMergeStore.getState().outputName).toBe('');
        expect(useMergeStore.getState().run).toBeNull();
        stop();
    });
});
