import { IPC } from '@shared/constants';
import type { ProgramResetResult, ProgramsStatus, ProgramUpdateResult, ProgramVersions } from '@shared/programs';
import { PROGRAM_IDS, type ToolState } from '@shared/tools';
import { registerProgramHandlers } from '@main/ipc/registerProgramHandlers';
import type { IpcMainLike } from '@main/ipc/registerHandlers';
import type { ProgramTools } from '@main/services/tools/programTools';
import { makeProgramVersions } from '../../helpers/mockApi';

type Handler = (event: unknown, ...args: unknown[]) => unknown;

const READY: ToolState = { id: 'deno', status: 'ready', version: '2.4.0', bytesDone: 0, bytesTotal: 0, percent: 100, error: null };
const STATUS: ProgramsStatus = { supported: true, programs: [{ id: 'deno', state: READY, custom: false, directory: '/t/deno/2.4.0' }] };
const VERSIONS: ProgramVersions = makeProgramVersions({ deno: { id: 'deno', current: '2.4.0', latest: '2.5.0', updatable: true, base: '2.4.0', chosen: false, error: null, errorMessage: null, unfit: [] } });
const UPDATED: ProgramUpdateResult = { ok: true, version: '2.5.0' };
const RESET: ProgramResetResult = { ok: true };
const INVALID_STATE: ToolState = { id: 'ytdlp', status: 'error', version: null, bytesDone: 0, bytesTotal: 0, percent: 0, error: { code: 'INVALID', message: 'The program is not one the app knows' } };

function setup() {
    const handlers = new Map<string, Handler>();
    const ipcMain: IpcMainLike = {
        handle: (channel, listener) => {
            handlers.set(channel, listener);
        }
    };
    const programs = {
        status: vi.fn(() => {
            return STATUS;
        }),
        install: vi.fn(async () => {
            return READY;
        }),
        reinstall: vi.fn(async () => {
            return READY;
        }),
        check: vi.fn(async () => {
            return VERSIONS;
        }),
        update: vi.fn(async () => {
            return UPDATED;
        }),
        reset: vi.fn(async () => {
            return RESET;
        })
    };
    registerProgramHandlers(ipcMain, { programs: programs as unknown as ProgramTools });
    const call = (channel: string, ...args: unknown[]): unknown => {
        const handler = handlers.get(channel);
        if (!handler) {
            throw new Error(`No handler for ${channel}`);
        }
        return handler({}, ...args);
    };
    return { handlers, call, programs };
}

describe('registerProgramHandlers', () => {
    it('registers the channels of the programs, and only them', () => {
        expect([...setup().handlers.keys()].sort()).toEqual([IPC.programsCheck, IPC.programsInstall, IPC.programsReinstall, IPC.programsReset, IPC.programsStatus, IPC.programsUpdate].sort());
    });

    it('gives the status of the programs', () => {
        const { call, programs } = setup();
        expect(call(IPC.programsStatus)).toEqual(STATUS);
        expect(programs.status).toHaveBeenCalledWith();
    });

    it('looks for the latest versions', async () => {
        const { call, programs } = setup();
        await expect(call(IPC.programsCheck)).resolves.toEqual(VERSIONS);
        expect(programs.check).toHaveBeenCalledWith();
    });

    it.each([...PROGRAM_IDS])('installs, reinstalls, updates and resets %s by its id', async (id) => {
        const { call, programs } = setup();
        await expect(call(IPC.programsInstall, id)).resolves.toEqual(READY);
        await expect(call(IPC.programsReinstall, id)).resolves.toEqual(READY);
        await expect(call(IPC.programsUpdate, id)).resolves.toEqual(UPDATED);
        await expect(call(IPC.programsReset, id)).resolves.toEqual(RESET);
        expect(programs.install).toHaveBeenCalledWith(id);
        expect(programs.reinstall).toHaveBeenCalledWith(id);
        expect(programs.update).toHaveBeenCalledWith(id);
        expect(programs.reset).toHaveBeenCalledWith(id);
    });

    it.each([['unknown'], [42], [null], [undefined], ['suwayomi'], ['']])('refuses %s without touching any program', async (id) => {
        const { call, programs } = setup();
        expect(call(IPC.programsInstall, id)).toEqual(INVALID_STATE);
        expect(call(IPC.programsReinstall, id)).toEqual(INVALID_STATE);
        expect(call(IPC.programsUpdate, id)).toEqual({ ok: false, reason: 'unsupported', message: 'The program is not one the app knows' });
        expect(call(IPC.programsReset, id)).toEqual({ ok: false, reason: 'unsupported', message: 'The program is not one the app knows' });
        expect(programs.install).not.toHaveBeenCalled();
        expect(programs.reinstall).not.toHaveBeenCalled();
        expect(programs.update).not.toHaveBeenCalled();
        expect(programs.reset).not.toHaveBeenCalled();
    });
});
