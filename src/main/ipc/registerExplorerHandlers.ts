import { IPC } from '@shared/constants';
import type {
    ExplorerCreateFolderResponse,
    ExplorerListResponse,
    ExplorerOpenExternalResponse,
    ExplorerOpenFolderResponse,
    ExplorerPreviewResponse,
    ExplorerRenameResponse,
    ExplorerTrashResponse
} from '@shared/explorer';
import type { ExplorerService } from '../services/explorerService';
import type { IpcMainLike } from './registerHandlers';

export function registerExplorerHandlers(ipcMain: IpcMainLike, explorer: ExplorerService): void {
    ipcMain.handle(IPC.explorerList, (_event, directory, showHidden): Promise<ExplorerListResponse> => {
        const target = typeof directory === 'string' && directory.length > 0 ? directory : undefined;
        return explorer.list(target, showHidden === true);
    });
    ipcMain.handle(IPC.explorerOpenFolder, (_event, directory): Promise<ExplorerOpenFolderResponse> => {
        return explorer.openFolder(typeof directory === 'string' ? directory : '');
    });
    ipcMain.handle(IPC.explorerCreateFolder, (_event, parentDir, name): Promise<ExplorerCreateFolderResponse> => {
        return explorer.createFolder(typeof parentDir === 'string' ? parentDir : '', typeof name === 'string' ? name : '');
    });
    ipcMain.handle(IPC.explorerRename, (_event, path, newName): Promise<ExplorerRenameResponse> => {
        return explorer.rename(typeof path === 'string' ? path : '', typeof newName === 'string' ? newName : '');
    });
    ipcMain.handle(IPC.explorerTrash, (_event, path): Promise<ExplorerTrashResponse> => {
        return explorer.trash(typeof path === 'string' ? path : '');
    });
    ipcMain.handle(IPC.explorerOpenExternal, (_event, path): Promise<ExplorerOpenExternalResponse> => {
        return explorer.openExternal(typeof path === 'string' ? path : '');
    });
    ipcMain.handle(IPC.explorerPreview, (_event, token): Promise<ExplorerPreviewResponse> | ExplorerPreviewResponse => {
        return typeof token === 'number' && Number.isInteger(token) && token > 0 ? explorer.preview(token) : { ok: false, reason: 'not-found' };
    });
    ipcMain.handle(IPC.explorerCancelPreview, (): void => {
        explorer.cancelPreview();
    });
}
