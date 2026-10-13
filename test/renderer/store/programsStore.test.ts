// @vitest-environment jsdom
import { DEFAULT_SETTINGS } from '@shared/constants';
import type { ProgramsStatus } from '@shared/programs';
import type { ToolState } from '@shared/tools';
import { UNSUPPORTED_STATUS, useAnimeStore } from '@renderer/store/animeStore';
import { useAppStore } from '@renderer/store/appStore';
import { PROGRAM_NAMES, useProgramsStore } from '@renderer/store/programsStore';
import { installMockApi, makeProgramInfo, makeProgramsStatus, makeProgramVersions, type MockApiHandle } from '../../helpers/mockApi';

let mock: MockApiHandle;
const initialApp = useAppStore.getState();
const initialPrograms = useProgramsStore.getState();

function toolState(overrides: Partial<ToolState> = {}): ToolState {
    return { id: 'ytdlp', status: 'downloading', version: null, bytesDone: 10, bytesTotal: 100, percent: 10, error: null, ...overrides };
}

function statusWith(state: ToolState): ProgramsStatus {
    const base = makeProgramsStatus();
    return {
        ...base,
        programs: base.programs.map((program) => {
            return program.id === state.id ? makeProgramInfo(program.id, { state }) : program;
        })
    };
}

beforeEach(() => {
    mock = installMockApi();
    useAppStore.setState({ ...initialApp, settings: DEFAULT_SETTINGS, toasts: [], notice: null });
    useAnimeStore.setState({ status: UNSUPPORTED_STATUS });
    useProgramsStore.setState({ ...initialPrograms, status: null, updates: {}, versions: null, checking: false, working: {}, results: {} });
});

describe('useProgramsStore initial state', () => {
    it('starts with nothing known', () => {
        expect(initialPrograms.status).toBeNull();
        expect(initialPrograms.updates).toEqual({});
        expect(initialPrograms.versions).toBeNull();
        expect(initialPrograms.checking).toBe(false);
        expect(initialPrograms.working).toEqual({});
        expect(initialPrograms.results).toEqual({});
    });

    it('names the programs the way they are called', () => {
        expect(PROGRAM_NAMES).toEqual({ ytdlp: 'yt-dlp', deno: 'deno', ffmpeg: 'ffmpeg', anicli: 'ani-cli', busybox: 'busybox', curl: 'curl' });
    });
});

describe('useProgramsStore.init', () => {
    it('reads the status and follows the programs', async () => {
        const status = statusWith(toolState({ id: 'ffmpeg', status: 'missing', percent: 0 }));
        mock.api.programs.status.mockResolvedValueOnce(status);
        const stop = await useProgramsStore.getState().init();
        expect(useProgramsStore.getState().status).toEqual(status);
        expect(mock.api.programs.onToolState).toHaveBeenCalledTimes(1);
        expect(mock.api.programs.onUpdateState).toHaveBeenCalledTimes(1);
        stop();
        mock.unsubscribers.forEach((unsubscribe) => {
            expect(unsubscribe).toHaveBeenCalledTimes(1);
        });
    });

    it('puts the state of a program that is being downloaded into the status', async () => {
        mock.api.programs.status.mockResolvedValueOnce(statusWith(toolState({ status: 'missing', percent: 0 })));
        await useProgramsStore.getState().init();
        const downloading = toolState({ status: 'downloading', percent: 55 });
        mock.emitProgramTool(downloading);
        const ytdlp = useProgramsStore.getState().status?.programs.find((program) => {
            return program.id === 'ytdlp';
        });
        expect(ytdlp?.state).toEqual(downloading);
        expect(mock.api.checkBinaries).not.toHaveBeenCalled();
        expect(useAppStore.getState().toasts).toEqual([]);
    });

    it('reads the checks and the anime status again when a program is ready', async () => {
        await useProgramsStore.getState().init();
        mock.emitProgramTool(toolState({ status: 'ready', percent: 100, version: '2026.08.19' }));
        expect(mock.api.checkBinaries).toHaveBeenCalledTimes(1);
        expect(mock.api.getAnimeStatus).toHaveBeenCalledTimes(1);
        expect(useAppStore.getState().toasts).toEqual([]);
    });

    it('tells the user with a toast when a program could not be downloaded, and reads the checks again', async () => {
        await useProgramsStore.getState().init();
        mock.emitProgramTool(toolState({ id: 'deno', status: 'error', percent: 0, error: { code: 'DOWNLOAD_FAILED', message: 'offline' } }));
        expect(useAppStore.getState().toasts.map((toast) => {
            return toast.message;
        })).toEqual(['Could not download deno. Open the settings of the section to try again.']);
        expect(mock.api.checkBinaries).toHaveBeenCalledTimes(1);
    });

    it('ignores a program it does not know', async () => {
        const status = makeProgramsStatus();
        mock.api.programs.status.mockResolvedValueOnce(status);
        await useProgramsStore.getState().init();
        mock.emitProgramTool({ ...toolState({ status: 'error', error: { code: 'DISK', message: 'x' } }), id: 'suwayomi' });
        mock.emitProgramUpdate({ ...toolState(), id: 'flaresolverr' });
        expect(useProgramsStore.getState().status).toEqual(status);
        expect(useProgramsStore.getState().updates).toEqual({});
        expect(useAppStore.getState().toasts).toEqual([]);
    });

    it('keeps the download of an update apart, and drops it when it is ready', async () => {
        await useProgramsStore.getState().init();
        const update = toolState({ id: 'deno', status: 'downloading', percent: 40 });
        mock.emitProgramUpdate(update);
        expect(useProgramsStore.getState().updates).toEqual({ deno: update });
        expect(useProgramsStore.getState().status).toEqual(makeProgramsStatus());
        mock.emitProgramUpdate({ ...update, status: 'ready', percent: 100 });
        expect(useProgramsStore.getState().updates).toEqual({});
    });

    it('keeps the update that failed, to show why', async () => {
        await useProgramsStore.getState().init();
        const failed = toolState({ id: 'deno', status: 'error', percent: 0, error: { code: 'HASH_MISMATCH', message: 'bad' } });
        mock.emitProgramUpdate(failed);
        expect(useProgramsStore.getState().updates).toEqual({ deno: failed });
    });

    it('does nothing to a status that has not been read when a state arrives', async () => {
        await useProgramsStore.getState().init();
        useProgramsStore.setState({ status: null });
        mock.emitProgramTool(toolState());
        expect(useProgramsStore.getState().status).toBeNull();
    });
});

describe('useProgramsStore.refresh', () => {
    it('reads the status again', async () => {
        const status = makeProgramsStatus({ supported: false });
        mock.api.programs.status.mockResolvedValueOnce(status);
        await useProgramsStore.getState().refresh();
        expect(useProgramsStore.getState().status).toEqual(status);
    });
});

describe('useProgramsStore.retry / reinstall', () => {
    it('installs the program again and reads the status, showing that it is working', async () => {
        let finish: () => void = () => {
            return undefined;
        };
        mock.api.programs.install.mockReturnValueOnce(
            new Promise((resolve) => {
                finish = () => {
                    resolve(toolState({ status: 'ready' }));
                };
            })
        );
        const retrying = useProgramsStore.getState().retry('ytdlp');
        expect(useProgramsStore.getState().working).toEqual({ ytdlp: 'retrying' });
        finish();
        await retrying;
        expect(mock.api.programs.install).toHaveBeenCalledWith('ytdlp');
        expect(mock.api.programs.status).toHaveBeenCalledTimes(1);
        expect(useProgramsStore.getState().working).toEqual({});
    });

    it('stops showing that it is working when it throws', async () => {
        mock.api.programs.install.mockRejectedValueOnce(new Error('ipc closed'));
        await expect(useProgramsStore.getState().retry('curl')).rejects.toThrow('ipc closed');
        expect(useProgramsStore.getState().working).toEqual({});
    });

    it('takes away what is installed and installs it again', async () => {
        const reinstalling = useProgramsStore.getState().reinstall('ffmpeg');
        expect(useProgramsStore.getState().working).toEqual({ ffmpeg: 'reinstalling' });
        await reinstalling;
        expect(mock.api.programs.reinstall).toHaveBeenCalledWith('ffmpeg');
        expect(mock.api.programs.status).toHaveBeenCalledTimes(1);
        expect(useProgramsStore.getState().working).toEqual({});
    });

    it('stops showing that it is reinstalling when it throws', async () => {
        mock.api.programs.reinstall.mockRejectedValueOnce(new Error('boom'));
        await expect(useProgramsStore.getState().reinstall('ffmpeg')).rejects.toThrow('boom');
        expect(useProgramsStore.getState().working).toEqual({});
    });
});

describe('useProgramsStore.check', () => {
    it('looks for the latest versions while showing it', async () => {
        const versions = makeProgramVersions();
        mock.api.programs.check.mockResolvedValueOnce(versions);
        const checking = useProgramsStore.getState().check();
        expect(useProgramsStore.getState().checking).toBe(true);
        await checking;
        expect(useProgramsStore.getState().versions).toEqual(versions);
        expect(useProgramsStore.getState().checking).toBe(false);
    });

    it('stops showing it when the look fails', async () => {
        mock.api.programs.check.mockRejectedValueOnce(new Error('x'));
        await expect(useProgramsStore.getState().check()).rejects.toThrow('x');
        expect(useProgramsStore.getState().checking).toBe(false);
        expect(useProgramsStore.getState().versions).toBeNull();
    });
});

describe('useProgramsStore.update', () => {
    it('moves to the latest, keeps the result, reads everything again and looks for the versions again if they were known', async () => {
        useProgramsStore.setState({ versions: makeProgramVersions() });
        mock.api.programs.update.mockResolvedValueOnce({ ok: true, version: '2026.09.01' });
        const updating = useProgramsStore.getState().update('ytdlp');
        expect(useProgramsStore.getState().working).toEqual({ ytdlp: 'updating' });
        await updating;
        expect(mock.api.programs.update).toHaveBeenCalledWith('ytdlp');
        expect(useProgramsStore.getState().results).toEqual({ ytdlp: { action: 'update', ok: true, reason: null, lookup: null, version: '2026.09.01', message: '' } });
        expect(mock.api.programs.status).toHaveBeenCalledTimes(1);
        expect(mock.api.checkBinaries).toHaveBeenCalledTimes(1);
        expect(mock.api.getAnimeStatus).toHaveBeenCalledTimes(1);
        expect(mock.api.programs.check).toHaveBeenCalledTimes(1);
        expect(useProgramsStore.getState().working).toEqual({});
    });

    it('does not look for the versions when they were not known', async () => {
        await useProgramsStore.getState().update('deno');
        expect(mock.api.programs.check).not.toHaveBeenCalled();
    });

    it('keeps why it did not work, with the reason of the look-up', async () => {
        mock.api.programs.update.mockResolvedValueOnce({ ok: false, reason: 'lookup', message: 'signature', lookup: 'signature' });
        await useProgramsStore.getState().update('ytdlp');
        expect(useProgramsStore.getState().results.ytdlp).toEqual({ action: 'update', ok: false, reason: 'lookup', lookup: 'signature', version: null, message: 'signature' });
        expect(mock.api.checkBinaries).not.toHaveBeenCalled();
    });

    it('keeps a failure that has no look-up reason', async () => {
        mock.api.programs.update.mockResolvedValueOnce({ ok: false, reason: 'failed', message: 'disk full' });
        await useProgramsStore.getState().update('ytdlp');
        expect(useProgramsStore.getState().results.ytdlp).toEqual({ action: 'update', ok: false, reason: 'failed', lookup: null, version: null, message: 'disk full' });
    });

    it('forgets the previous result when it starts, and stops working when it throws', async () => {
        useProgramsStore.setState({ results: { ytdlp: { action: 'reset', ok: true, reason: null, lookup: null, version: null, message: '' } } });
        mock.api.programs.update.mockRejectedValueOnce(new Error('gone'));
        await expect(useProgramsStore.getState().update('ytdlp')).rejects.toThrow('gone');
        expect(useProgramsStore.getState().results).toEqual({});
        expect(useProgramsStore.getState().working).toEqual({});
    });
});

describe('useProgramsStore.reset', () => {
    it('goes back to the version of the app and keeps the result', async () => {
        useProgramsStore.setState({ versions: makeProgramVersions() });
        const resetting = useProgramsStore.getState().reset('ytdlp');
        expect(useProgramsStore.getState().working).toEqual({ ytdlp: 'resetting' });
        await resetting;
        expect(mock.api.programs.reset).toHaveBeenCalledWith('ytdlp');
        expect(useProgramsStore.getState().results).toEqual({ ytdlp: { action: 'reset', ok: true, reason: null, lookup: null, version: null, message: '' } });
        expect(mock.api.programs.status).toHaveBeenCalledTimes(1);
        expect(mock.api.checkBinaries).toHaveBeenCalledTimes(1);
        expect(mock.api.programs.check).toHaveBeenCalledTimes(1);
        expect(useProgramsStore.getState().working).toEqual({});
    });

    it('keeps why it could not go back', async () => {
        mock.api.programs.reset.mockResolvedValueOnce({ ok: false, reason: 'none', message: 'nothing to go back to' });
        await useProgramsStore.getState().reset('ffmpeg');
        expect(useProgramsStore.getState().results.ffmpeg).toEqual({ action: 'reset', ok: false, reason: 'none', lookup: null, version: null, message: 'nothing to go back to' });
        expect(mock.api.programs.check).not.toHaveBeenCalled();
    });

    it('stops working when it throws', async () => {
        mock.api.programs.reset.mockRejectedValueOnce(new Error('x'));
        await expect(useProgramsStore.getState().reset('ytdlp')).rejects.toThrow('x');
        expect(useProgramsStore.getState().working).toEqual({});
    });
});
