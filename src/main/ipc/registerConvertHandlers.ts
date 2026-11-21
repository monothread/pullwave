import { IPC } from '@shared/constants';
import type { ConvertChooseResponse, ConvertProbeResponse, ConvertRequest, ConvertRun, ConvertStartResponse } from '@shared/convert';
import type { ConvertService } from '../services/convertService';
import type { IpcMainLike } from './registerHandlers';

export function registerConvertHandlers(ipcMain: IpcMainLike, converter: ConvertService): void {
    ipcMain.handle(IPC.convertChoose, (): Promise<ConvertChooseResponse> => {
        return converter.choose();
    });
    ipcMain.handle(IPC.convertProbe, (_event, path): Promise<ConvertProbeResponse> | ConvertProbeResponse => {
        return typeof path === 'string' && path.length > 0 ? converter.probe(path) : { ok: false, reason: 'unreadable' };
    });
    ipcMain.handle(IPC.convertStart, (_event, request): Promise<ConvertStartResponse> => {
        return converter.start(request as ConvertRequest);
    });
    ipcMain.handle(IPC.convertCancel, (): void => {
        converter.cancel();
    });
    ipcMain.handle(IPC.convertCurrent, (): ConvertRun | null => {
        return converter.current();
    });
    ipcMain.handle(IPC.convertClear, (): void => {
        converter.clear();
    });
}
