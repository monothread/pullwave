import { IPC } from '@shared/constants';
import type { ProgramResetResult, ProgramsStatus, ProgramUpdateResult, ProgramVersions } from '@shared/programs';
import { PROGRAM_IDS, type ProgramId, type ToolState } from '@shared/tools';
import type { ProgramTools } from '../services/tools/programTools';
import type { IpcMainLike } from './registerHandlers';

export interface ProgramHandlerDependencies {
    programs: ProgramTools;
}

function asProgramId(value: unknown): ProgramId | null {
    return typeof value === 'string' && (PROGRAM_IDS as readonly string[]).includes(value) ? (value as ProgramId) : null;
}

const INVALID = 'The program is not one the app knows';

// What the screens ask about the programs the app downloads (see ProgramTools): how each one stands, TRY AGAIN and REINSTALL, the latest
// versions, and moving to the latest or back to the version of the app.
export function registerProgramHandlers(ipcMain: IpcMainLike, deps: ProgramHandlerDependencies): void {
    const { programs } = deps;
    ipcMain.handle(IPC.programsStatus, (): ProgramsStatus => {
        return programs.status();
    });
    ipcMain.handle(IPC.programsInstall, (_event, id): Promise<ToolState> | ToolState => {
        const program = asProgramId(id);
        return program === null ? { id: 'ytdlp', status: 'error', version: null, bytesDone: 0, bytesTotal: 0, percent: 0, error: { code: 'INVALID', message: INVALID } } : programs.install(program);
    });
    ipcMain.handle(IPC.programsReinstall, (_event, id): Promise<ToolState> | ToolState => {
        const program = asProgramId(id);
        return program === null ? { id: 'ytdlp', status: 'error', version: null, bytesDone: 0, bytesTotal: 0, percent: 0, error: { code: 'INVALID', message: INVALID } } : programs.reinstall(program);
    });
    ipcMain.handle(IPC.programsCheck, (): Promise<ProgramVersions> => {
        return programs.check();
    });
    ipcMain.handle(IPC.programsUpdate, (_event, id): Promise<ProgramUpdateResult> | ProgramUpdateResult => {
        const program = asProgramId(id);
        return program === null ? { ok: false, reason: 'unsupported', message: INVALID } : programs.update(program);
    });
    ipcMain.handle(IPC.programsReset, (_event, id): Promise<ProgramResetResult> | ProgramResetResult => {
        const program = asProgramId(id);
        return program === null ? { ok: false, reason: 'unsupported', message: INVALID } : programs.reset(program);
    });
}
