import { IPC } from '@shared/constants';
import type { ConvertRequest, ConvertRun } from '@shared/convert';
import { registerConvertHandlers } from '@main/ipc/registerConvertHandlers';
import type { IpcMainLike } from '@main/ipc/registerHandlers';
import type { ConvertService } from '@main/services/convertService';

describe('registerConvertHandlers', () => {
    it('wires every convert IPC channel and validates probe path', async () => {
        const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
        const ipcMain: IpcMainLike = {
            handle: (channel, listener) => {
                handlers.set(channel, listener);
            }
        };
        const run: ConvertRun = { id: 1, format: 'mp3', outputMode: 'downloads', outputDirectory: '/d', status: 'running', items: [] };
        const converter = {
            choose: vi.fn(async () => {
                return { ok: false as const, reason: 'cancelled' as const };
            }),
            probe: vi.fn(async (path: string) => {
                return { ok: true as const, media: { path, name: 'clip', extension: '.mp4', durationSeconds: 10 } };
            }),
            start: vi.fn(async () => {
                return { ok: true as const, run };
            }),
            cancel: vi.fn(),
            current: vi.fn(() => {
                return run;
            }),
            clear: vi.fn()
        };

        registerConvertHandlers(ipcMain, converter as unknown as ConvertService);

        expect(await handlers.get(IPC.convertChoose)!({})).toEqual({ ok: false, reason: 'cancelled' });
        expect(await handlers.get(IPC.convertProbe)!({}, '')).toEqual({ ok: false, reason: 'unreadable' });
        expect(await handlers.get(IPC.convertProbe)!({}, 42)).toEqual({ ok: false, reason: 'unreadable' });
        expect(await handlers.get(IPC.convertProbe)!({}, '/v/clip.mp4')).toEqual({
            ok: true,
            media: { path: '/v/clip.mp4', name: 'clip', extension: '.mp4', durationSeconds: 10 }
        });
        const request: ConvertRequest = { paths: ['/v/clip.mp4'], format: 'mp3', outputMode: 'downloads' };
        expect(await handlers.get(IPC.convertStart)!({}, request)).toEqual({ ok: true, run });
        expect(converter.start).toHaveBeenCalledWith(request);
        handlers.get(IPC.convertCancel)!({});
        expect(converter.cancel).toHaveBeenCalledTimes(1);
        expect(handlers.get(IPC.convertCurrent)!({})).toEqual(run);
        handlers.get(IPC.convertClear)!({});
        expect(converter.clear).toHaveBeenCalledTimes(1);
    });
});
