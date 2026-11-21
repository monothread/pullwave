// @vitest-environment jsdom
import type { ConvertMedia, ConvertRun } from '@shared/convert';
import { useConvertStore } from '@renderer/store/convertStore';
import { installMockApi, type MockApiHandle } from '../../helpers/mockApi';

const VIDEO_A: ConvertMedia = { path: '/v/a.mp4', name: 'a', extension: '.mp4', durationSeconds: 30 };
const VIDEO_B: ConvertMedia = { path: '/v/b.mkv', name: 'b', extension: '.mkv', durationSeconds: 45 };

let mock: MockApiHandle;
const initial = useConvertStore.getInitialState();

beforeEach(() => {
    mock = installMockApi();
    useConvertStore.setState({ ...initial });
});

describe('convertStore', () => {
    it('subscribes to progress events and loads current run on init', async () => {
        const active: ConvertRun = {
            id: 1,
            format: 'mp3',
            outputMode: 'downloads',
            outputDirectory: '/downloads',
            status: 'running',
            items: [{ path: VIDEO_A.path, name: 'a.mp4', status: 'converting', percent: 40, outputPath: null, error: null }]
        };
        mock.api.convert.current.mockResolvedValue(active);

        const unsubscribe = await useConvertStore.getState().init();
        expect(useConvertStore.getState().run).toEqual(active);

        const finished: ConvertRun = {
            ...active,
            status: 'done',
            items: [{ path: VIDEO_A.path, name: 'a.mp4', status: 'done', percent: 100, outputPath: '/downloads/a.mp3', error: null }]
        };
        mock.emitConvertProgress(finished);
        expect(useConvertStore.getState().run).toEqual(finished);
        unsubscribe();
    });

    it('chooses, deduplicates, adds paths with partial rejection, and removes items', async () => {
        mock.api.convert.choose.mockResolvedValueOnce({
            ok: true,
            media: [VIDEO_A],
            rejected: [{ path: '/v/notes.txt', reason: 'unreadable' }]
        });
        await useConvertStore.getState().choose();
        expect(useConvertStore.getState().items).toEqual([VIDEO_A]);
        expect(useConvertStore.getState().rejectedCount).toBe(1);

        mock.api.convert.probe.mockResolvedValueOnce({ ok: true, media: VIDEO_B });
        mock.api.convert.probe.mockResolvedValueOnce({ ok: false, reason: 'no-audio' });
        await useConvertStore.getState().addPaths([VIDEO_A.path, VIDEO_B.path, '/v/silent.mp4']);
        expect(mock.api.convert.probe).toHaveBeenCalledTimes(2);
        expect(useConvertStore.getState().items).toEqual([VIDEO_A, VIDEO_B]);
        expect(useConvertStore.getState().rejectedCount).toBe(1);

        useConvertStore.getState().removeItem(VIDEO_A.path);
        expect(useConvertStore.getState().items).toEqual([VIDEO_B]);
    });

    it('syncs default format until user overrides it, chooses custom folder, starts, cancels and clears', async () => {
        useConvertStore.getState().syncDefaultFormat('opus');
        expect(useConvertStore.getState().format).toBe('opus');
        useConvertStore.getState().setFormat('flac');
        useConvertStore.getState().syncDefaultFormat('m4a');
        expect(useConvertStore.getState().format).toBe('flac');

        useConvertStore.setState({ items: [VIDEO_A] });
        useConvertStore.getState().setOutputMode('custom');
        await useConvertStore.getState().start();
        expect(useConvertStore.getState().startError).toBe('invalid');
        expect(mock.api.convert.start).not.toHaveBeenCalled();

        mock.api.chooseDirectory.mockResolvedValueOnce('/custom-out');
        await useConvertStore.getState().chooseOutputDir();
        expect(useConvertStore.getState().customOutputDir).toBe('/custom-out');

        const run: ConvertRun = {
            id: 2,
            format: 'flac',
            outputMode: 'custom',
            outputDirectory: '/custom-out',
            status: 'running',
            items: [{ path: VIDEO_A.path, name: 'a.mp4', status: 'waiting', percent: 0, outputPath: null, error: null }]
        };
        mock.api.convert.start.mockResolvedValueOnce({ ok: true, run });
        await useConvertStore.getState().start();
        expect(mock.api.convert.start).toHaveBeenCalledWith({
            paths: [VIDEO_A.path],
            format: 'flac',
            outputMode: 'custom',
            outputDirectory: '/custom-out'
        });
        expect(useConvertStore.getState().run).toEqual(run);

        await useConvertStore.getState().cancel();
        expect(mock.api.convert.cancel).toHaveBeenCalledTimes(1);

        useConvertStore.setState({ run: { ...run, status: 'done' } });
        await useConvertStore.getState().clear();
        expect(mock.api.convert.clear).toHaveBeenCalledTimes(1);
        expect(useConvertStore.getState().items).toEqual([]);
        expect(useConvertStore.getState().run).toBeNull();
    });
});
