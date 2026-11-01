import { IPC } from '@shared/constants';
import type { CutChooseResponse, CutRequest, CutRun, CutStartResponse } from '@shared/cut';
import { registerCutHandlers } from '@main/ipc/registerCutHandlers';
import type { IpcMainLike } from '@main/ipc/registerHandlers';
import type { CutService } from '@main/services/cutService';

type Handler = (event: unknown, ...args: unknown[]) => unknown;

const CHOSEN: CutChooseResponse = { ok: true, media: { path: '/a.mp4', name: 'a', extension: '.mp4', kind: 'video', durationSeconds: 90 } };
const RUN: CutRun = {
    id: 1,
    mediaName: 'a',
    outputDirectory: '/downloads/a - cuts',
    audioOnly: false,
    status: 'running',
    segments: [{ segment: { start: 1, end: 2 }, status: 'waiting', percent: 0, outputPath: null, error: null }]
};
const STARTED: CutStartResponse = { ok: true, run: RUN };
const REQUEST: CutRequest = { path: '/a.mp4', segments: [{ start: 1, end: 2 }], audioOnly: false };

function setup() {
    const handlers = new Map<string, Handler>();
    const ipcMain: IpcMainLike = {
        handle: (channel, listener) => {
            handlers.set(channel, listener);
        }
    };
    const cut = {
        choose: vi.fn(async () => {
            return CHOSEN;
        }),
        probe: vi.fn(async () => {
            return CHOSEN;
        }),
        start: vi.fn(async () => {
            return STARTED;
        }),
        cancel: vi.fn(),
        current: vi.fn(() => {
            return RUN;
        })
    };
    registerCutHandlers(ipcMain, cut as unknown as CutService);
    return { handlers, cut };
}

describe('registerCutHandlers', () => {
    it('answers the five things the screen of the cutter asks, and nothing else', () => {
        expect([...setup().handlers.keys()].sort()).toEqual([IPC.cutCancel, IPC.cutChoose, IPC.cutCurrent, IPC.cutProbe, IPC.cutStart].sort());
    });

    it('reads the file that was dropped, by its path', async () => {
        const { handlers, cut } = setup();
        await expect(handlers.get(IPC.cutProbe)!({}, '/media/a.mp4')).resolves.toEqual(CHOSEN);
        expect(cut.probe).toHaveBeenCalledTimes(1);
        expect(cut.probe).toHaveBeenCalledWith('/media/a.mp4');
        expect(cut.choose).not.toHaveBeenCalled();
    });

    it.each([[''], [5], [null], [undefined], [{}]])('does not read a path that is %j: the file is unreadable', async (path) => {
        const { handlers, cut } = setup();
        expect(handlers.get(IPC.cutProbe)!({}, path)).toEqual({ ok: false, reason: 'unreadable' });
        expect(cut.probe).not.toHaveBeenCalled();
    });

    it('chooses and reads a file', async () => {
        const { handlers, cut } = setup();
        await expect(handlers.get(IPC.cutChoose)!({})).resolves.toEqual(CHOSEN);
        expect(cut.choose).toHaveBeenCalledTimes(1);
    });

    it('starts the cut with the request it is given', async () => {
        const { handlers, cut } = setup();
        await expect(handlers.get(IPC.cutStart)!({}, REQUEST)).resolves.toEqual(STARTED);
        expect(cut.start).toHaveBeenCalledTimes(1);
        expect(cut.start).toHaveBeenCalledWith(REQUEST);
    });

    it('ends the cut that goes on', () => {
        const { handlers, cut } = setup();
        expect(handlers.get(IPC.cutCancel)!({})).toBeUndefined();
        expect(cut.cancel).toHaveBeenCalledTimes(1);
        expect(cut.cancel).toHaveBeenCalledWith();
    });

    it('gives the cut that goes on', () => {
        const { handlers, cut } = setup();
        expect(handlers.get(IPC.cutCurrent)!({})).toEqual(RUN);
        expect(cut.current).toHaveBeenCalledTimes(1);
    });
});
