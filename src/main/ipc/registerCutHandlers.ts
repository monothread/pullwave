import { IPC } from '@shared/constants';
import type { CutChooseResponse, CutRequest, CutRun, CutStartResponse } from '@shared/cut';
import type { CutService } from '../services/cutService';
import type { IpcMainLike } from './registerHandlers';

// What the screen of the cutter asks: to choose and read a file (or read the one that was dropped), to cut it, to end the cut and to see the one that goes on.
export function registerCutHandlers(ipcMain: IpcMainLike, cut: CutService): void {
    ipcMain.handle(IPC.cutChoose, (): Promise<CutChooseResponse> => {
        return cut.choose();
    });
    ipcMain.handle(IPC.cutProbe, (_event, path): Promise<CutChooseResponse> | CutChooseResponse => {
        return typeof path === 'string' && path.length > 0 ? cut.probe(path) : { ok: false, reason: 'unreadable' };
    });
    ipcMain.handle(IPC.cutStart, (_event, request): Promise<CutStartResponse> => {
        return cut.start(request as CutRequest);
    });
    ipcMain.handle(IPC.cutCancel, (): void => {
        cut.cancel();
    });
    ipcMain.handle(IPC.cutCurrent, (): CutRun | null => {
        return cut.current();
    });
}
