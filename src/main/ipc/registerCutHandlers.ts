import { IPC } from '@shared/constants';
import type { CutChooseResponse, CutPreviewRequest, CutPreviewResponse, CutRequest, CutRun, CutStartResponse } from '@shared/cut';
import type { CutPreview } from '../services/cutPreview';
import type { CutService } from '../services/cutService';
import type { IpcMainLike } from './registerHandlers';

// A file read for the cutter becomes the one its preview and its picture are made from.
async function chosen(response: Promise<CutChooseResponse>, preview: CutPreview): Promise<CutChooseResponse> {
    const answer = await response;
    if (answer.ok) {
        preview.select(answer.media);
    }
    return answer;
}

// What the screen of the cutter asks: to choose and read a file (or read the one that was dropped), to cut it, to end the cut and to see the
// one that goes on; and, before the cut, the picture of the file, where to play a part, and to forget the file.
export function registerCutHandlers(ipcMain: IpcMainLike, cut: CutService, preview: CutPreview): void {
    ipcMain.handle(IPC.cutChoose, (): Promise<CutChooseResponse> => {
        return chosen(cut.choose(), preview);
    });
    ipcMain.handle(IPC.cutProbe, (_event, path): Promise<CutChooseResponse> | CutChooseResponse => {
        return typeof path === 'string' && path.length > 0 ? chosen(cut.probe(path), preview) : { ok: false, reason: 'unreadable' };
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
    ipcMain.handle(IPC.cutThumbnail, (): Promise<string | null> => {
        return preview.thumbnail();
    });
    ipcMain.handle(IPC.cutPreview, (_event, request): Promise<CutPreviewResponse> => {
        return preview.preview(request as CutPreviewRequest);
    });
    ipcMain.handle(IPC.cutClear, (): void => {
        preview.clear();
    });
}
