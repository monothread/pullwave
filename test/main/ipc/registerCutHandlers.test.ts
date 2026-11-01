import { IPC } from '@shared/constants';
import type { CutChooseResponse, CutMedia, CutPreviewRequest, CutPreviewResponse, CutRequest, CutRun, CutStartResponse } from '@shared/cut';
import { registerCutHandlers } from '@main/ipc/registerCutHandlers';
import type { IpcMainLike } from '@main/ipc/registerHandlers';
import type { CutPreview } from '@main/services/cutPreview';
import type { CutService } from '@main/services/cutService';

type Handler = (event: unknown, ...args: unknown[]) => unknown;

const MEDIA: CutMedia = { path: '/a.mp4', name: 'a', extension: '.mp4', kind: 'video', durationSeconds: 90 };
const CHOSEN: CutChooseResponse = { ok: true, media: MEDIA };
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
const UNREADABLE: CutChooseResponse = { ok: false, reason: 'unreadable' };
const PREVIEW_REQUEST: CutPreviewRequest = { segment: { start: 10, end: 20 }, convert: false };
const PREVIEWED: CutPreviewResponse = { ok: true, url: 'pullwave-cut://media/1', start: 10, end: 20, converted: false };
const THUMBNAIL = 'pullwave-cut://thumbnail/1';

function setup(answer: CutChooseResponse = CHOSEN) {
    const handlers = new Map<string, Handler>();
    const ipcMain: IpcMainLike = {
        handle: (channel, listener) => {
            handlers.set(channel, listener);
        }
    };
    const cut = {
        choose: vi.fn(async () => {
            return answer;
        }),
        probe: vi.fn(async () => {
            return answer;
        }),
        start: vi.fn(async () => {
            return STARTED;
        }),
        cancel: vi.fn(),
        current: vi.fn(() => {
            return RUN;
        })
    };
    const preview = {
        select: vi.fn(),
        clear: vi.fn(),
        thumbnail: vi.fn(async () => {
            return THUMBNAIL;
        }),
        preview: vi.fn(async () => {
            return PREVIEWED;
        })
    };
    registerCutHandlers(ipcMain, cut as unknown as CutService, preview as unknown as CutPreview);
    return { handlers, cut, preview };
}

describe('registerCutHandlers', () => {
    it('answers the eight things the screen of the cutter asks, and nothing else', () => {
        expect([...setup().handlers.keys()].sort()).toEqual([IPC.cutCancel, IPC.cutChoose, IPC.cutClear, IPC.cutCurrent, IPC.cutPreview, IPC.cutProbe, IPC.cutStart, IPC.cutThumbnail].sort());
    });

    it('reads the file that was dropped, by its path', async () => {
        const { handlers, cut, preview } = setup();
        await expect(handlers.get(IPC.cutProbe)!({}, '/media/a.mp4')).resolves.toEqual(CHOSEN);
        expect(cut.probe).toHaveBeenCalledTimes(1);
        expect(cut.probe).toHaveBeenCalledWith('/media/a.mp4');
        expect(cut.choose).not.toHaveBeenCalled();
        expect(preview.select).toHaveBeenCalledTimes(1);
        expect(preview.select).toHaveBeenCalledWith(MEDIA);
    });

    it.each([[''], [5], [null], [undefined], [{}]])('does not read a path that is %j: the file is unreadable', async (path) => {
        const { handlers, cut, preview } = setup();
        expect(handlers.get(IPC.cutProbe)!({}, path)).toEqual(UNREADABLE);
        expect(cut.probe).not.toHaveBeenCalled();
        expect(preview.select).not.toHaveBeenCalled();
    });

    it('chooses and reads a file, which becomes the one the preview and the picture are made from', async () => {
        const { handlers, cut, preview } = setup();
        await expect(handlers.get(IPC.cutChoose)!({})).resolves.toEqual(CHOSEN);
        expect(cut.choose).toHaveBeenCalledTimes(1);
        expect(preview.select).toHaveBeenCalledTimes(1);
        expect(preview.select).toHaveBeenCalledWith(MEDIA);
    });

    it.each([
        ['chosen', IPC.cutChoose, []],
        ['dropped', IPC.cutProbe, ['/media/a.mp4']]
    ])('keeps the file of the preview when the file %s could not be read', async (_how, channel, args) => {
        const { handlers, preview } = setup(UNREADABLE);
        await expect(handlers.get(channel)!({}, ...args)).resolves.toEqual(UNREADABLE);
        expect(preview.select).not.toHaveBeenCalled();
    });

    it('gives the picture of the file', async () => {
        const { handlers, preview } = setup();
        await expect(handlers.get(IPC.cutThumbnail)!({})).resolves.toBe(THUMBNAIL);
        expect(preview.thumbnail).toHaveBeenCalledTimes(1);
        expect(preview.thumbnail).toHaveBeenCalledWith();
    });

    it('gives where to play the part it is asked about', async () => {
        const { handlers, preview } = setup();
        await expect(handlers.get(IPC.cutPreview)!({}, PREVIEW_REQUEST)).resolves.toEqual(PREVIEWED);
        expect(preview.preview).toHaveBeenCalledTimes(1);
        expect(preview.preview).toHaveBeenCalledWith(PREVIEW_REQUEST);
    });

    it('forgets the file of the preview', () => {
        const { handlers, preview, cut } = setup();
        expect(handlers.get(IPC.cutClear)!({})).toBeUndefined();
        expect(preview.clear).toHaveBeenCalledTimes(1);
        expect(preview.clear).toHaveBeenCalledWith();
        expect(cut.cancel).not.toHaveBeenCalled();
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
