import { IPC } from '@shared/constants';
import type { MergeChooseResponse, MergeProbeResponse, MergeRequest, MergeRun, MergeStartResponse } from '@shared/merge';
import type { MergeService } from '../services/mergeService';
import type { IpcMainLike } from './registerHandlers';

export function registerMergeHandlers(ipcMain: IpcMainLike, merger: MergeService): void {
    ipcMain.handle(IPC.mergeChoose, (): Promise<MergeChooseResponse> => {
        return merger.choose();
    });
    ipcMain.handle(IPC.mergeProbe, (_event, path): Promise<MergeProbeResponse> | MergeProbeResponse => {
        return typeof path === 'string' && path.length > 0 ? merger.probe(path) : { ok: false, reason: 'unreadable' };
    });
    ipcMain.handle(IPC.mergeStart, (_event, request): Promise<MergeStartResponse> => {
        return merger.start(request as MergeRequest);
    });
    ipcMain.handle(IPC.mergeCancel, (): void => {
        merger.cancel();
    });
    ipcMain.handle(IPC.mergeCurrent, (): MergeRun | null => {
        return merger.current();
    });
    ipcMain.handle(IPC.mergeClear, (): void => {
        merger.clear();
    });
}
