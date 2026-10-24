// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SETTINGS } from '@shared/constants';
import type { ProgramId, ToolState } from '@shared/tools';
import type { ProgramVersionInfo } from '@shared/programs';
import { ProgramsStatusBlock } from '@renderer/components/ProgramsStatusBlock';
import { UNSUPPORTED_STATUS, useAnimeStore } from '@renderer/store/animeStore';
import { useAppStore } from '@renderer/store/appStore';
import { useProgramsStore } from '@renderer/store/programsStore';
import { ANI_CLI_INFO, makeStatus } from '../../helpers/animeFixtures';
import { answerDialog, confirmDialog } from '../../helpers/confirmDialog';
import { installMockApi, makeProgramInfo, makeProgramsStatus, makeProgramVersions, type MockApiHandle } from '../../helpers/mockApi';

let mock: MockApiHandle;
const initialApp = useAppStore.getState();

const BINARIES = {
    ytdlp: { found: true, path: '/t/yt-dlp', version: '2026.08.19', source: 'installed' as const },
    ffmpeg: { found: true, path: '/t/ffmpeg', version: 'latest-abc', source: 'installed' as const }
};

function stateOf(id: ProgramId, overrides: Partial<ToolState> = {}): ToolState {
    return { id, status: 'ready', version: '1.0.0', bytesDone: 0, bytesTotal: 0, percent: 100, error: null, ...overrides };
}

function setProgram(id: ProgramId, overrides: Partial<ToolState> = {}, custom = false): void {
    const base = useProgramsStore.getState().status ?? makeProgramsStatus();
    useProgramsStore.setState({
        status: {
            ...base,
            programs: base.programs.map((program) => {
                return program.id === id ? makeProgramInfo(id, { custom, state: stateOf(id, overrides) }) : program;
            })
        }
    });
}

function version(id: ProgramId, overrides: Partial<ProgramVersionInfo>): void {
    const versions = useProgramsStore.getState().versions ?? makeProgramVersions();
    useProgramsStore.setState({ versions: { ...versions, [id]: { ...versions[id], ...overrides } } });
}

function row(id: ProgramId): HTMLElement {
    return screen.getByTestId(`program-${id}`);
}

beforeEach(() => {
    mock = installMockApi();
    useAppStore.setState({ ...initialApp, settings: DEFAULT_SETTINGS, binaries: BINARIES, notice: null, toasts: [] });
    useAnimeStore.setState({ status: UNSUPPORTED_STATUS });
    useProgramsStore.setState({ status: makeProgramsStatus(), updates: {}, versions: null, checking: false, working: {}, results: {} });
});

describe('ProgramsStatusBlock places', () => {
    it('shows only ffmpeg in the global place', () => {
        render(<ProgramsStatusBlock place="global" />);
        expect(screen.getByRole('group', { name: 'Status of the programs' })).toBeInTheDocument();
        expect(screen.getAllByTestId(/^program-/)).toHaveLength(1);
        expect(row('ffmpeg')).toBeInTheDocument();
        expect(screen.getByText(/ffmpeg joins and converts/)).toBeInTheDocument();
    });

    it('shows yt-dlp and deno in the downloads place', () => {
        render(<ProgramsStatusBlock place="downloads" />);
        expect(
            screen.getAllByTestId(/^program-/).map((item) => {
                return item.getAttribute('data-testid');
            })
        ).toEqual(['program-ytdlp', 'program-deno']);
        expect(screen.getByText(/yt-dlp and deno are downloaded by the app/)).toBeInTheDocument();
    });

    it('shows ani-cli, busybox and curl in the anime place', () => {
        render(<ProgramsStatusBlock place="anime" />);
        expect(
            screen.getAllByTestId(/^program-/).map((item) => {
                return item.getAttribute('data-testid');
            })
        ).toEqual(['program-anicli', 'program-busybox', 'program-curl']);
        expect(screen.getByText(/ani-cli, busybox and curl are downloaded/)).toBeInTheDocument();
    });

    it('shows nothing until the status is read', () => {
        useProgramsStore.setState({ status: null });
        const { container } = render(<ProgramsStatusBlock place="downloads" />);
        expect(container).toBeEmptyDOMElement();
    });

    it('says the programs are not made for the system where they are not', () => {
        useProgramsStore.setState({ status: makeProgramsStatus({ supported: false }) });
        render(<ProgramsStatusBlock place="downloads" />);
        expect(screen.getByText('These programs are not made for this system.')).toBeInTheDocument();
        expect(screen.queryByTestId('program-ytdlp')).not.toBeInTheDocument();
    });
});

describe('ProgramsStatusBlock states', () => {
    it('shows an installed program with the version that was probed', () => {
        render(<ProgramsStatusBlock place="downloads" />);
        expect(row('ytdlp')).toHaveTextContent('yt-dlp');
        expect(row('ytdlp')).toHaveTextContent('version 2026.08.19');
        expect(within(row('ytdlp')).getByText('INSTALLED')).toHaveClass('badge--done');
    });

    it('shows the build of ffmpeg as a build', () => {
        render(<ProgramsStatusBlock place="global" />);
        expect(row('ffmpeg')).toHaveTextContent('version build abc');
    });

    it('shows the commit of ani-cli by its first digits', () => {
        useAnimeStore.setState({ status: makeStatus({ aniCli: { ...ANI_CLI_INFO, version: '0123456789abcdef0123456789abcdef01234567' } }) });
        render(<ProgramsStatusBlock place="anime" />);
        expect(row('anicli')).toHaveTextContent('version 0123456');
    });

    it('says the version is not known when the program did not tell it', () => {
        useAppStore.setState({ binaries: { ...BINARIES, ytdlp: { ...BINARIES.ytdlp, version: null } } });
        render(<ProgramsStatusBlock place="downloads" />);
        expect(row('ytdlp')).toHaveTextContent('version not known');
    });

    it('shows the version of deno, busybox and curl from what was installed', () => {
        setProgram('deno', { version: '2.4.0' });
        setProgram('busybox', { version: '1.35.0' });
        render(<ProgramsStatusBlock place="downloads" />);
        expect(row('deno')).toHaveTextContent('version 2.4.0');
    });

    it('shows a program that is being downloaded with a bar and the percentage', () => {
        setProgram('ytdlp', { status: 'downloading', percent: 42.4, version: null });
        render(<ProgramsStatusBlock place="downloads" />);
        expect(within(row('ytdlp')).getByRole('progressbar', { name: 'yt-dlp' })).toHaveAttribute('aria-valuenow', '42');
        expect(row('ytdlp')).toHaveTextContent('Downloading… 42%');
        expect(within(row('ytdlp')).getByText('DOWNLOADING')).toBeInTheDocument();
    });

    it('shows a program that is not installed yet', () => {
        setProgram('ytdlp', { status: 'missing', percent: 0, version: null });
        render(<ProgramsStatusBlock place="downloads" />);
        expect(within(row('ytdlp')).getByText('NOT INSTALLED')).toHaveClass('badge--cancelled');
    });

    it('shows a failure with the reason and TRY AGAIN, which installs it again', () => {
        setProgram('ytdlp', { status: 'error', percent: 0, version: null, error: { code: 'DOWNLOAD_FAILED', message: 'getaddrinfo ENOTFOUND github.com' } });
        render(<ProgramsStatusBlock place="downloads" />);
        const failed = within(row('ytdlp'));
        expect(failed.getByText('FAILED')).toHaveClass('badge--error');
        expect(failed.getByRole('alert')).toHaveTextContent('The download failed. Check your connection and try again.');
        expect(failed.getByRole('alert')).toHaveAttribute('title', 'getaddrinfo ENOTFOUND github.com');
        fireEvent.click(failed.getByRole('button', { name: 'TRY AGAIN' }));
        expect(mock.api.programs.install).toHaveBeenCalledWith('ytdlp');
    });

    it('does not offer TRY AGAIN where there is no program for the system', () => {
        setProgram('ytdlp', { status: 'error', percent: 0, version: null, error: { code: 'UNSUPPORTED_PLATFORM', message: 'x' } });
        render(<ProgramsStatusBlock place="downloads" />);
        expect(within(row('ytdlp')).getByText('NOT AVAILABLE')).toBeInTheDocument();
        expect(within(row('ytdlp')).queryByRole('button', { name: 'TRY AGAIN' })).not.toBeInTheDocument();
    });

    it('disables TRY AGAIN while the retry goes on', () => {
        setProgram('ytdlp', { status: 'error', percent: 0, version: null, error: { code: 'DISK', message: 'x' } });
        useProgramsStore.setState({ working: { ytdlp: 'retrying' } });
        render(<ProgramsStatusBlock place="downloads" />);
        expect(within(row('ytdlp')).getByRole('button', { name: 'Waiting…' })).toBeDisabled();
    });

    it('says a program that is installed but does not run, with INSTALL AGAIN', () => {
        useAppStore.setState({ binaries: { ...BINARIES, ytdlp: { ...BINARIES.ytdlp, found: false, version: null } } });
        render(<ProgramsStatusBlock place="downloads" />);
        expect(within(row('ytdlp')).getByRole('alert')).toHaveTextContent('It is installed but does not run. Install it again.');
        fireEvent.click(within(row('ytdlp')).getByRole('button', { name: 'INSTALL AGAIN' }));
        expect(mock.api.programs.reinstall).toHaveBeenCalledWith('ytdlp');
    });

    it('does not say it does not run before the programs were probed', () => {
        useAppStore.setState({ binaries: null });
        render(<ProgramsStatusBlock place="downloads" />);
        expect(within(row('ytdlp')).queryByRole('button', { name: 'INSTALL AGAIN' })).not.toBeInTheDocument();
    });

    it('shows that INSTALL AGAIN is working and disables it', () => {
        useAppStore.setState({ binaries: { ...BINARIES, ffmpeg: { ...BINARIES.ffmpeg, found: false, version: null } } });
        useProgramsStore.setState({ working: { ffmpeg: 'reinstalling' } });
        render(<ProgramsStatusBlock place="global" />);
        expect(within(row('ffmpeg')).getByRole('button', { name: 'INSTALLING…' })).toBeDisabled();
    });

    it('shows a program the user gave a path for as theirs, with no state of download', () => {
        setProgram('ytdlp', { status: 'error', percent: 0, version: null, error: { code: 'DOWNLOAD_FAILED', message: 'x' } }, true);
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, ytdlpPath: '/opt/yt-dlp' } });
        render(<ProgramsStatusBlock place="downloads" />);
        expect(within(row('ytdlp')).getByText('YOURS')).toBeInTheDocument();
        expect(row('ytdlp')).toHaveTextContent('Using the one you chose in the settings: /opt/yt-dlp');
        expect(within(row('ytdlp')).queryByRole('alert')).not.toBeInTheDocument();
        expect(within(row('ytdlp')).queryByRole('button')).not.toBeInTheDocument();
    });

    it('says deno is not downloaded when the user chose their own yt-dlp', () => {
        setProgram('ytdlp', {}, true);
        setProgram('deno', {}, true);
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, ytdlpPath: '/opt/yt-dlp' } });
        render(<ProgramsStatusBlock place="downloads" />);
        expect(row('deno')).toHaveTextContent('Not downloaded: you chose your own yt-dlp in the settings.');
        expect(row('deno')).not.toHaveTextContent('/opt/yt-dlp');
        expect(within(row('deno')).getByText('YOURS')).toBeInTheDocument();
    });

    it('shows the ffmpeg and ani-cli paths the user chose', () => {
        setProgram('ffmpeg', {}, true);
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, ffmpegPath: '/opt/ffmpeg' } });
        useAnimeStore.setState({ status: makeStatus({ aniCli: { ...ANI_CLI_INFO, path: '/opt/ani-cli', source: 'custom' } }) });
        setProgram('anicli', {}, true);
        const { unmount } = render(<ProgramsStatusBlock place="global" />);
        expect(row('ffmpeg')).toHaveTextContent('/opt/ffmpeg');
        unmount();
        render(<ProgramsStatusBlock place="anime" />);
        expect(row('anicli')).toHaveTextContent('/opt/ani-cli');
    });

    it('says busybox and curl stay at the version of the app', () => {
        render(<ProgramsStatusBlock place="anime" />);
        expect(row('busybox')).toHaveTextContent('Stays at the version the app was made with.');
        expect(row('curl')).toHaveTextContent('Stays at the version the app was made with.');
        expect(row('anicli')).not.toHaveTextContent('Stays at the version the app was made with.');
    });
});

describe('ProgramsStatusBlock updates', () => {
    it('looks for the latest versions and shows them', async () => {
        mock.api.programs.check.mockResolvedValueOnce(makeProgramVersions({ ytdlp: { id: 'ytdlp', current: '2026.08.19', latest: '2026.09.01', updatable: true, base: '2026.08.19', chosen: false, error: null, errorMessage: null, unfit: [] } }));
        render(<ProgramsStatusBlock place="downloads" />);
        fireEvent.click(screen.getByRole('button', { name: 'CHECK FOR NEW VERSIONS' }));
        expect(await screen.findByText('Latest: 2026.09.01')).toBeInTheDocument();
        expect(mock.api.programs.check).toHaveBeenCalledTimes(1);
        expect(row('deno')).toHaveTextContent('This is the latest version.');
    });

    it('disables the look while it goes on', () => {
        useProgramsStore.setState({ checking: true });
        render(<ProgramsStatusBlock place="downloads" />);
        expect(screen.getByRole('button', { name: 'LOOKING…' })).toBeDisabled();
    });

    it('offers UPDATE with the version, and updates when clicked', () => {
        version('ytdlp', { latest: '2026.09.01', updatable: true });
        render(<ProgramsStatusBlock place="downloads" />);
        fireEvent.click(within(row('ytdlp')).getByRole('button', { name: 'yt-dlp: UPDATE TO 2026.09.01' }));
        expect(mock.api.programs.update).toHaveBeenCalledWith('ytdlp');
    });

    it('offers to update ffmpeg to the latest build, without a version number', () => {
        version('ffmpeg', { latest: 'latest-def', updatable: true });
        render(<ProgramsStatusBlock place="global" />);
        expect(row('ffmpeg')).toHaveTextContent('A newer build is available.');
        fireEvent.click(within(row('ffmpeg')).getByRole('button', { name: 'ffmpeg: UPDATE TO THE LATEST BUILD' }));
        expect(mock.api.programs.update).toHaveBeenCalledWith('ffmpeg');
    });

    it('shows the commit of the latest ani-cli by its first digits', () => {
        version('anicli', { latest: 'abcdef0123456789abcdef0123456789abcdef01', updatable: true });
        render(<ProgramsStatusBlock place="anime" />);
        expect(within(row('anicli')).getByRole('button', { name: 'ani-cli: UPDATE TO abcdef0' })).toBeEnabled();
    });

    it('shows UPDATING… while it goes on, disabling the button', () => {
        version('ytdlp', { latest: '2026.09.01', updatable: true });
        useProgramsStore.setState({ working: { ytdlp: 'updating' } });
        render(<ProgramsStatusBlock place="downloads" />);
        expect(within(row('ytdlp')).getByRole('button', { name: 'yt-dlp: UPDATING…' })).toBeDisabled();
    });

    it('shows the download of the update with a bar, apart from the program that works', () => {
        useProgramsStore.setState({ updates: { ytdlp: stateOf('ytdlp', { status: 'downloading', percent: 61.2 }) } });
        render(<ProgramsStatusBlock place="downloads" />);
        const item = within(row('ytdlp'));
        expect(item.getByRole('progressbar', { name: 'Downloading the update… 61%' })).toHaveAttribute('aria-valuenow', '61');
        expect(item.getByText('Downloading the update… 61%')).toBeInTheDocument();
        expect(item.getByText('INSTALLED')).toBeInTheDocument();
    });

    it('shows why the download of the update failed', () => {
        useProgramsStore.setState({ updates: { ytdlp: stateOf('ytdlp', { status: 'error', percent: 0, error: { code: 'HASH_MISMATCH', message: 'sha mismatch' } }) } });
        render(<ProgramsStatusBlock place="downloads" />);
        expect(within(row('ytdlp')).getByRole('alert')).toHaveTextContent('The downloaded file is not the one the app expects, so it was discarded.');
        expect(within(row('ytdlp')).getByRole('alert')).toHaveAttribute('title', 'sha mismatch');
    });

    it.each([
        ['no-release', 'there is no release for this system.'],
        ['signature', 'the list of checksums is not signed by the project.'],
        ['checksum', 'the checksum of the file is not published.'],
        ['invalid', 'the answer is not what the app expects.'],
        ['patches', 'the changes the app needs do not fit it.'],
        ['failed', 'check your connection and try again.']
    ] as const)('says why the latest version could not be looked for: %s', (reason, text) => {
        version('ytdlp', { latest: null, error: reason, errorMessage: 'detail of it' });
        render(<ProgramsStatusBlock place="downloads" />);
        expect(within(row('ytdlp')).getByRole('alert')).toHaveTextContent(`Could not look for the latest version: ${text}`);
        expect(within(row('ytdlp')).getByRole('alert')).toHaveAttribute('title', 'detail of it');
    });

    it('offers to go back to the version of the app only when another one is chosen', () => {
        version('ytdlp', { chosen: true });
        render(<ProgramsStatusBlock place="downloads" />);
        fireEvent.click(within(row('ytdlp')).getByRole('button', { name: 'yt-dlp: USE THE VERSION OF THE APP' }));
        expect(mock.api.programs.reset).not.toHaveBeenCalled();
        const dialog = confirmDialog(/^Use the version of the app for ".*"\?$/);
        expect(within(dialog).getByText('The program goes back to the version the app is made with. The one in use now is replaced.')).toBeInTheDocument();
        fireEvent.click(within(dialog).getByRole('button', { name: 'USE THE VERSION OF THE APP' }));
        expect(mock.api.programs.reset).toHaveBeenCalledWith('ytdlp');
        expect(within(row('deno')).queryByRole('button', { name: /USE THE VERSION OF THE APP/ })).not.toBeInTheDocument();
    });

    it('keeps the version in use when the user goes back or presses Esc', async () => {
        const user = userEvent.setup();
        version('ytdlp', { chosen: true });
        render(<ProgramsStatusBlock place="downloads" />);
        await user.click(within(row('ytdlp')).getByRole('button', { name: 'yt-dlp: USE THE VERSION OF THE APP' }));
        await answerDialog(user, /^Use the version of the app for ".*"\?$/, 'BACK');
        await user.click(within(row('ytdlp')).getByRole('button', { name: 'yt-dlp: USE THE VERSION OF THE APP' }));
        await user.keyboard('{Escape}');
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(mock.api.programs.reset).not.toHaveBeenCalled();
    });

    it('shows GOING BACK… while it goes on', () => {
        version('ytdlp', { chosen: true });
        useProgramsStore.setState({ working: { ytdlp: 'resetting' } });
        render(<ProgramsStatusBlock place="downloads" />);
        expect(within(row('ytdlp')).getByRole('button', { name: 'yt-dlp: GOING BACK…' })).toBeDisabled();
    });

    it('does not offer to update or go back for a program the user gave a path for', () => {
        setProgram('ytdlp', {}, true);
        version('ytdlp', { latest: '2026.09.01', updatable: true, chosen: true, error: 'failed' });
        render(<ProgramsStatusBlock place="downloads" />);
        expect(within(row('ytdlp')).queryByRole('button')).not.toBeInTheDocument();
        expect(within(row('ytdlp')).queryByText(/Latest:/)).not.toBeInTheDocument();
        expect(within(row('ytdlp')).queryByText(/Could not look/)).not.toBeInTheDocument();
    });

    it('warns that some changes of the app do not fit the latest ani-cli, naming them', () => {
        version('anicli', { latest: 'abcdef0123456789abcdef0123456789abcdef01', updatable: true, unfit: ['subtitleSelection', 'allSubtitles', 'debugReferer'] });
        render(<ProgramsStatusBlock place="anime" />);
        expect(row('anicli')).toHaveTextContent('The latest ani-cli works, but some changes of the app do not fit it (the choice of the subtitle, saving every subtitle, the address of the stream), so some subtitles may be missing.');
    });

    it('does not warn about the changes when there is nothing to update to', () => {
        version('anicli', { updatable: false, unfit: ['allSubtitles'] });
        render(<ProgramsStatusBlock place="anime" />);
        expect(row('anicli')).not.toHaveTextContent('do not fit it');
    });

    it.each([
        [{ action: 'update', ok: true, reason: null, lookup: null, version: '2026.09.01', message: '' }, 'Updated to 2026.09.01.'],
        [{ action: 'reset', ok: true, reason: null, lookup: null, version: null, message: '' }, 'Back to the version of the app.'],
        [{ action: 'update', ok: false, reason: 'current', lookup: null, version: null, message: 'c' }, 'Already the latest version.'],
        [{ action: 'update', ok: false, reason: 'busy', lookup: null, version: null, message: 'c' }, 'An update of this program is already going on.'],
        [{ action: 'update', ok: false, reason: 'custom', lookup: null, version: null, message: 'c' }, 'The program you chose in the settings is not looked after by the app.'],
        [{ action: 'update', ok: false, reason: 'unsupported', lookup: null, version: null, message: 'c' }, 'This program has no newer version to move to.'],
        [{ action: 'reset', ok: false, reason: 'none', lookup: null, version: null, message: 'c' }, 'No other version is chosen.'],
        [{ action: 'update', ok: false, reason: 'lookup', lookup: 'signature', version: null, message: 'c' }, 'Could not look for the latest version: the list of checksums is not signed by the project.'],
        [{ action: 'update', ok: false, reason: 'lookup', lookup: null, version: null, message: 'boom' }, 'Could not look for the latest version: boom'],
        [{ action: 'update', ok: false, reason: 'failed', lookup: null, version: null, message: 'disk full' }, 'The update did not work, and the version that was there is kept: disk full']
    ] as const)('shows how the last update ended: %#', (result, text) => {
        useProgramsStore.setState({ results: { ytdlp: { ...result } } });
        render(<ProgramsStatusBlock place="downloads" />);
        expect(row('ytdlp')).toHaveTextContent(text);
        expect(within(row('ytdlp')).queryByRole('alert') !== null).toBe(!result.ok);
    });
});
