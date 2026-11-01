// @vitest-environment jsdom
import type { CutMedia, CutRun } from '@shared/cut';
import { useCutStore } from '@renderer/store/cutStore';
import { installMockApi, type MockApiHandle } from '../../helpers/mockApi';

let mock: MockApiHandle;
const initialCut = useCutStore.getInitialState();

const VIDEO: CutMedia = { path: '/media/Talk.mp4', name: 'Talk', extension: '.mp4', kind: 'video', durationSeconds: 150 };
const AUDIO: CutMedia = { path: '/media/Song.mp3', name: 'Song', extension: '.mp3', kind: 'audio', durationSeconds: 200 };

function runOf(status: CutRun['status'], overrides: Partial<CutRun> = {}): CutRun {
    return {
        id: 1,
        mediaName: 'Talk',
        outputDirectory: '/downloads/Talk - cuts',
        audioOnly: false,
        status,
        segments: [{ segment: { start: 10, end: 14 }, status: status === 'running' ? 'cutting' : 'done', percent: 0, outputPath: null, error: null }],
        ...overrides
    };
}

function state() {
    return useCutStore.getState();
}

function fillFirstRow(start: string, end: string): void {
    state().updateRow(state().rows[0]!.id, { start, end });
}

beforeEach(() => {
    mock = installMockApi();
    useCutStore.setState(initialCut, true);
});

describe('cutStore start', () => {
    it('has no file, one blank part, the video kept as it is and nothing going on', () => {
        expect(state()).toMatchObject({ media: null, choosing: false, chooseError: null, audioOnly: false, starting: false, startError: null, cancelling: false, run: null });
        expect(state().rows).toHaveLength(1);
        expect(state().rows[0]).toMatchObject({ start: '', end: '' });
    });
});

describe('cutStore choose', () => {
    it('shows that it is reading while the window and the reading go on, then keeps the file with one blank part', async () => {
        let answer: (value: unknown) => void = () => {return undefined};
        mock.api.cut.choose.mockReturnValue(
            new Promise((resolve) => {
                answer = resolve;
            })
        );
        state().addRow();
        const choosing = state().choose();
        expect(state().choosing).toBe(true);
        answer({ ok: true, media: VIDEO });
        await choosing;
        expect(state()).toMatchObject({ choosing: false, media: VIDEO, chooseError: null, run: null, audioOnly: false });
        expect(state().rows).toHaveLength(1);
        expect(state().rows[0]).toMatchObject({ start: '', end: '' });
        expect(mock.api.cut.choose).toHaveBeenCalledTimes(1);
    });

    it('does not open a second window while one is open', async () => {
        mock.api.cut.choose.mockReturnValue(new Promise(() => {return undefined}));
        void state().choose();
        await state().choose();
        expect(mock.api.cut.choose).toHaveBeenCalledTimes(1);
    });

    it('keeps the file that was there when the window is closed', async () => {
        mock.api.cut.choose.mockResolvedValueOnce({ ok: true, media: VIDEO });
        await state().choose();
        fillFirstRow('0:10', '0:14');
        mock.api.cut.choose.mockResolvedValueOnce({ ok: false, reason: 'cancelled' });
        await state().choose();
        expect(state()).toMatchObject({ choosing: false, media: VIDEO, chooseError: null });
        expect(state().rows[0]).toMatchObject({ start: '0:10', end: '0:14' });
    });

    it.each(['unreadable', 'no-ffmpeg'] as const)('says why the file was not taken (%s), and keeps the one that was there', async (reason) => {
        mock.api.cut.choose.mockResolvedValueOnce({ ok: true, media: VIDEO });
        await state().choose();
        mock.api.cut.choose.mockResolvedValueOnce({ ok: false, reason });
        await state().choose();
        expect(state()).toMatchObject({ choosing: false, media: VIDEO, chooseError: reason });
    });

    it('forgets the mistake and the result of the last file when another file is taken', async () => {
        useCutStore.setState({ chooseError: 'unreadable', startError: 'busy', run: runOf('done'), audioOnly: true });
        mock.api.cut.choose.mockResolvedValueOnce({ ok: true, media: AUDIO });
        await state().choose();
        expect(state()).toMatchObject({ media: AUDIO, chooseError: null, startError: null, run: null, audioOnly: false });
    });

    it('clears the mistake of the last file as soon as it begins to read another', async () => {
        useCutStore.setState({ chooseError: 'unreadable' });
        mock.api.cut.choose.mockReturnValue(new Promise(() => {return undefined}));
        void state().choose();
        expect(state().chooseError).toBeNull();
    });
});

describe('cutStore openPath', () => {
    it('reads the file that was dropped by its path, shows that it is reading, and keeps it with one blank part', async () => {
        let answer: (value: unknown) => void = () => {return undefined};
        mock.api.cut.probe.mockReturnValue(
            new Promise((resolve) => {
                answer = resolve;
            })
        );
        state().addRow();
        const opening = state().openPath('/media/Talk.mp4');
        expect(state().choosing).toBe(true);
        answer({ ok: true, media: VIDEO });
        await opening;
        expect(mock.api.cut.probe).toHaveBeenCalledWith('/media/Talk.mp4');
        expect(mock.api.cut.choose).not.toHaveBeenCalled();
        expect(state()).toMatchObject({ choosing: false, media: VIDEO, chooseError: null, run: null, audioOnly: false });
        expect(state().rows).toHaveLength(1);
    });

    it('forgets the last file, its mistakes and its result when another one is dropped', async () => {
        useCutStore.setState({ media: VIDEO, chooseError: 'dropped', startError: 'busy', run: runOf('done'), audioOnly: true });
        mock.api.cut.probe.mockResolvedValue({ ok: true, media: AUDIO });
        await state().openPath('/media/Song.mp3');
        expect(state()).toMatchObject({ media: AUDIO, chooseError: null, startError: null, run: null, audioOnly: false });
    });

    it.each(['unreadable', 'no-ffmpeg'] as const)('says why the file was not taken (%s), and keeps the one that was there', async (reason) => {
        useCutStore.setState({ media: VIDEO });
        mock.api.cut.probe.mockResolvedValue({ ok: false, reason });
        await state().openPath('/media/notes.txt');
        expect(state()).toMatchObject({ choosing: false, media: VIDEO, chooseError: reason });
    });

    it('does nothing while a cut goes on or is starting', async () => {
        useCutStore.setState({ run: runOf('running') });
        await state().openPath('/media/a.mp4');
        useCutStore.setState({ run: null, starting: true });
        await state().openPath('/media/a.mp4');
        expect(mock.api.cut.probe).not.toHaveBeenCalled();
    });

    it('does nothing while another file is being read', async () => {
        mock.api.cut.probe.mockReturnValue(new Promise(() => {return undefined}));
        void state().openPath('/media/a.mp4');
        await state().openPath('/media/b.mp4');
        expect(mock.api.cut.probe).toHaveBeenCalledTimes(1);
    });

    it('is taken after a cut that is over', async () => {
        useCutStore.setState({ run: runOf('done') });
        mock.api.cut.probe.mockResolvedValue({ ok: true, media: AUDIO });
        await state().openPath('/media/Song.mp3');
        expect(state().media).toEqual(AUDIO);
        expect(state().run).toBeNull();
    });
});

describe('cutStore rejectDrop', () => {
    it('says the file that was dropped could not be taken, and keeps the file that was there', () => {
        useCutStore.setState({ media: VIDEO });
        state().rejectDrop();
        expect(state()).toMatchObject({ chooseError: 'dropped', media: VIDEO });
    });

    it('says nothing while a file is being read', () => {
        useCutStore.setState({ choosing: true });
        state().rejectDrop();
        expect(state().chooseError).toBeNull();
    });
});

describe('cutStore parts', () => {
    it('adds blank parts, each with an id of its own', () => {
        state().addRow();
        state().addRow();
        expect(state().rows).toHaveLength(3);
        expect(new Set(state().rows.map((row) => { return row.id; })).size).toBe(3);
        expect(state().rows.map((row) => { return [row.start, row.end]; })).toEqual([['', ''], ['', ''], ['', '']]);
    });

    it('changes the start or the end of one part, and forgets the mistake of the last try', () => {
        state().addRow();
        useCutStore.setState({ startError: 'invalid' });
        const [first, second] = state().rows;
        state().updateRow(second!.id, { end: '0:30' });
        state().updateRow(second!.id, { start: '0:20' });
        expect(state().rows.map((row) => { return [row.id, row.start, row.end]; })).toEqual([
            [first!.id, '', ''],
            [second!.id, '0:20', '0:30']
        ]);
        expect(state().startError).toBeNull();
    });

    it('leaves the rows alone for an id that is not there', () => {
        const before = state().rows;
        state().updateRow(99999, { start: '1:00' });
        expect(state().rows).toEqual(before);
    });

    it('removes a part, and leaves one blank part when the last one is removed', () => {
        state().addRow();
        const [first, second] = state().rows;
        state().removeRow(first!.id);
        expect(state().rows.map((row) => { return row.id; })).toEqual([second!.id]);
        state().removeRow(second!.id);
        expect(state().rows).toHaveLength(1);
        expect(state().rows[0]).toMatchObject({ start: '', end: '' });
        expect(state().rows[0]!.id).not.toBe(second!.id);
    });

    it('turns the audio-only choice on and off', () => {
        state().setAudioOnly(true);
        expect(state().audioOnly).toBe(true);
        state().setAudioOnly(false);
        expect(state().audioOnly).toBe(false);
    });
});

describe('cutStore start of a cut', () => {
    async function withVideo(): Promise<void> {
        mock.api.cut.choose.mockResolvedValueOnce({ ok: true, media: VIDEO });
        await state().choose();
    }

    it('does nothing without a file', async () => {
        await state().start();
        expect(mock.api.cut.start).not.toHaveBeenCalled();
        expect(state().starting).toBe(false);
    });

    it('does nothing while a part has a mistake or nothing is written', async () => {
        await withVideo();
        await state().start();
        fillFirstRow('0:20', '0:10');
        await state().start();
        expect(mock.api.cut.start).not.toHaveBeenCalled();
    });

    it('asks for the cut with the parts as seconds, shows that it is starting, and keeps the cut it gets back', async () => {
        await withVideo();
        state().addRow();
        fillFirstRow('0:10', '0:14');
        state().updateRow(state().rows[1]!.id, { start: '1:34', end: '1:43' });
        let answer: (value: unknown) => void = () => {return undefined};
        mock.api.cut.start.mockReturnValue(
            new Promise((resolve) => {
                answer = resolve;
            })
        );
        const starting = state().start();
        expect(state().starting).toBe(true);
        expect(mock.api.cut.start).toHaveBeenCalledWith({
            path: '/media/Talk.mp4',
            segments: [
                { start: 10, end: 14 },
                { start: 94, end: 103 }
            ],
            audioOnly: false
        });
        answer({ ok: true, run: runOf('running') });
        await starting;
        expect(state()).toMatchObject({ starting: false, startError: null, run: runOf('running') });
    });

    it('asks for audio only for a video when the choice is on', async () => {
        await withVideo();
        fillFirstRow('0:10', '0:14');
        state().setAudioOnly(true);
        await state().start();
        expect(mock.api.cut.start).toHaveBeenCalledWith(expect.objectContaining({ audioOnly: true }));
    });

    it('does not ask for audio only for an audio file, whatever the choice was', async () => {
        mock.api.cut.choose.mockResolvedValueOnce({ ok: true, media: AUDIO });
        await state().choose();
        fillFirstRow('0:10', '0:14');
        state().setAudioOnly(true);
        await state().start();
        expect(mock.api.cut.start).toHaveBeenCalledWith({ path: '/media/Song.mp3', segments: [{ start: 10, end: 14 }], audioOnly: false });
    });

    it('says why the cut was not made, and stops showing that it is starting', async () => {
        await withVideo();
        fillFirstRow('0:10', '0:14');
        mock.api.cut.start.mockResolvedValue({ ok: false, reason: 'folder' });
        await state().start();
        expect(state()).toMatchObject({ starting: false, startError: 'folder', run: null });
    });

    it('does not ask twice while it is starting', async () => {
        await withVideo();
        fillFirstRow('0:10', '0:14');
        mock.api.cut.start.mockReturnValue(new Promise(() => {return undefined}));
        void state().start();
        await state().start();
        expect(mock.api.cut.start).toHaveBeenCalledTimes(1);
    });

    it('forgets the mistake of the last try when it asks again', async () => {
        await withVideo();
        fillFirstRow('0:10', '0:14');
        useCutStore.setState({ startError: 'busy', cancelling: true });
        mock.api.cut.start.mockReturnValue(new Promise(() => {return undefined}));
        void state().start();
        expect(state()).toMatchObject({ startError: null, cancelling: false });
    });
});

describe('cutStore cancel', () => {
    it('does nothing when no cut goes on', async () => {
        await state().cancel();
        expect(mock.api.cut.cancel).not.toHaveBeenCalled();
        useCutStore.setState({ run: runOf('done') });
        await state().cancel();
        expect(mock.api.cut.cancel).not.toHaveBeenCalled();
        expect(state().cancelling).toBe(false);
    });

    it('asks to end the cut and shows that it is ending, until the cut says it is over', async () => {
        useCutStore.setState({ run: runOf('running') });
        const cancelling = state().cancel();
        expect(state().cancelling).toBe(true);
        await cancelling;
        expect(mock.api.cut.cancel).toHaveBeenCalledTimes(1);
        await state().cancel();
        expect(mock.api.cut.cancel).toHaveBeenCalledTimes(1);
    });
});

describe('cutStore init', () => {
    it('follows the cut as it is told, keeps showing that it is ending while the cut goes on, and stops when it is over', async () => {
        const stop = await state().init();
        useCutStore.setState({ cancelling: true });
        mock.emitCutProgress(runOf('running'));
        expect(state().run).toEqual(runOf('running'));
        expect(state().cancelling).toBe(true);
        mock.emitCutProgress(runOf('cancelled'));
        expect(state().run).toEqual(runOf('cancelled'));
        expect(state().cancelling).toBe(false);
        expect(mock.unsubscribers).toHaveLength(1);
        expect(mock.unsubscribers[0]).not.toHaveBeenCalled();
        stop();
        expect(mock.unsubscribers[0]).toHaveBeenCalledTimes(1);
    });

    it('takes the cut that goes on when the screen opens in the middle of it', async () => {
        mock.api.cut.current.mockResolvedValue(runOf('running'));
        await state().init();
        expect(state().run).toEqual(runOf('running'));
    });

    it('keeps what it has when there is no cut', async () => {
        useCutStore.setState({ run: runOf('done') });
        mock.api.cut.current.mockResolvedValue(null);
        await state().init();
        expect(state().run).toEqual(runOf('done'));
    });
});
