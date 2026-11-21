import { IPC } from '@shared/constants';
import { registerExplorerHandlers } from '@main/ipc/registerExplorerHandlers';
import type { IpcMainLike } from '@main/ipc/registerHandlers';
import type { ExplorerService } from '@main/services/explorerService';

describe('registerExplorerHandlers', () => {
    it('wires every explorer IPC channel and validates arguments', async () => {
        const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
        const ipcMain: IpcMainLike = {
            handle: (channel, listener) => {
                handlers.set(channel, listener);
            }
        };
        const explorer = {
            list: vi.fn(async () => {
                return { ok: false as const, reason: 'not-found' as const };
            }),
            chooseFolder: vi.fn(async () => {
                return '/picked';
            }),
            openFolder: vi.fn(async () => {
                return { ok: true as const };
            }),
            createFolder: vi.fn(async () => {
                return { ok: true as const, path: '/a/new' };
            }),
            rename: vi.fn(async () => {
                return { ok: true as const, path: '/a/b.mp4', name: 'b.mp4' };
            }),
            trash: vi.fn(async () => {
                return { ok: true as const };
            }),
            openExternal: vi.fn(async () => {
                return { ok: true as const };
            }),
            preview: vi.fn(async () => {
                return { ok: true as const, url: 'pullwave-explorer://preview/1', converted: true };
            }),
            cancelPreview: vi.fn()
        };

        registerExplorerHandlers(ipcMain, explorer as unknown as ExplorerService);

        await handlers.get(IPC.explorerList)!({}, '/dir', true);
        expect(explorer.list).toHaveBeenCalledWith('/dir', true);
        await handlers.get(IPC.explorerList)!({}, '', false);
        expect(explorer.list).toHaveBeenCalledWith(undefined, false);

        expect(await handlers.get(IPC.explorerChooseFolder)!({})).toBe('/picked');
        expect(await handlers.get(IPC.explorerOpenFolder)!({}, '/a')).toEqual({ ok: true });
        expect(explorer.openFolder).toHaveBeenCalledWith('/a');
        expect(await handlers.get(IPC.explorerCreateFolder)!({}, '/a', 'new')).toEqual({ ok: true, path: '/a/new' });
        expect(await handlers.get(IPC.explorerRename)!({}, '/a/old.mp4', 'b.mp4')).toEqual({ ok: true, path: '/a/b.mp4', name: 'b.mp4' });
        expect(await handlers.get(IPC.explorerTrash)!({}, '/a/b.mp4')).toEqual({ ok: true });
        expect(await handlers.get(IPC.explorerOpenExternal)!({}, '/a/b.mp4')).toEqual({ ok: true });
        expect(await handlers.get(IPC.explorerPreview)!({}, 0)).toEqual({ ok: false, reason: 'not-found' });
        expect(await handlers.get(IPC.explorerPreview)!({}, 'abc')).toEqual({ ok: false, reason: 'not-found' });
        expect(await handlers.get(IPC.explorerPreview)!({}, 5)).toEqual({ ok: true, url: 'pullwave-explorer://preview/1', converted: true });
        expect(explorer.preview).toHaveBeenCalledWith(5);
        handlers.get(IPC.explorerCancelPreview)!({});
        expect(explorer.cancelPreview).toHaveBeenCalledTimes(1);
    });
});
