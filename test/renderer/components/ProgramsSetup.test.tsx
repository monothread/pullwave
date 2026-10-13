// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { DEFAULT_SETTINGS } from '@shared/constants';
import type { ProgramId, ToolState } from '@shared/tools';
import { ProgramsGate } from '@renderer/components/ProgramsSetup';
import { useAppStore } from '@renderer/store/appStore';
import { useProgramsStore } from '@renderer/store/programsStore';
import { installMockApi, makeProgramInfo, makeProgramsStatus, type MockApiHandle } from '../../helpers/mockApi';

let mock: MockApiHandle;

function setProgram(id: ProgramId, overrides: Partial<ToolState>, custom = false): void {
    const base = useProgramsStore.getState().status ?? makeProgramsStatus();
    useProgramsStore.setState({
        status: {
            ...base,
            programs: base.programs.map((program) => {
                return program.id === id ? makeProgramInfo(id, { custom, state: { ...program.state, ...overrides } }) : program;
            })
        }
    });
}

function renderGate(area: 'downloads' | 'anime') {
    return render(
        <ProgramsGate area={area}>
            <p>the content</p>
        </ProgramsGate>
    );
}

beforeEach(() => {
    mock = installMockApi();
    useAppStore.setState({ settings: DEFAULT_SETTINGS });
    useProgramsStore.setState({ status: makeProgramsStatus(), updates: {}, versions: null, checking: false, working: {}, results: {} });
});

describe('ProgramsGate', () => {
    it('shows the content when every program of the area is ready', () => {
        renderGate('downloads');
        expect(screen.getByText('the content')).toBeInTheDocument();
        expect(screen.queryByTestId('programs-setup-downloads')).not.toBeInTheDocument();
    });

    it('shows the content until the status is read', () => {
        useProgramsStore.setState({ status: null });
        renderGate('anime');
        expect(screen.getByText('the content')).toBeInTheDocument();
    });

    it('shows the content where the programs are not made for the system', () => {
        useProgramsStore.setState({ status: makeProgramsStatus({ supported: false }) });
        renderGate('downloads');
        expect(screen.getByText('the content')).toBeInTheDocument();
    });

    it('waits for the programs of the video downloader (yt-dlp, deno and ffmpeg) and no others', () => {
        setProgram('ytdlp', { status: 'downloading', percent: 20 });
        setProgram('anicli', { status: 'downloading', percent: 20 });
        renderGate('downloads');
        expect(screen.queryByText('the content')).not.toBeInTheDocument();
        expect(screen.getByTestId('programs-setup-downloads')).toHaveTextContent('PREPARING THE VIDEO DOWNLOADER');
        expect(
            screen.getAllByTestId(/^program-setup-/).map((item) => {
                return item.getAttribute('data-testid');
            })
        ).toEqual(['program-setup-ytdlp', 'program-setup-deno', 'program-setup-ffmpeg']);
    });

    it('waits for the programs of the anime (ani-cli, busybox, curl, yt-dlp, deno and ffmpeg)', () => {
        setProgram('curl', { status: 'missing', percent: 0 });
        renderGate('anime');
        expect(screen.getByTestId('programs-setup-anime')).toHaveTextContent('PREPARING THE ANIME SECTION');
        expect(
            screen.getAllByTestId(/^program-setup-/).map((item) => {
                return item.getAttribute('data-testid');
            })
        ).toEqual(['program-setup-ytdlp', 'program-setup-deno', 'program-setup-ffmpeg', 'program-setup-anicli', 'program-setup-busybox', 'program-setup-curl']);
        expect(screen.getByText(/downloaded the first time the app opens/)).toBeInTheDocument();
    });

    it('does not wait for a program the user gave a path for', () => {
        setProgram('ytdlp', { status: 'error', percent: 0, error: { code: 'DOWNLOAD_FAILED', message: 'x' } }, true);
        renderGate('downloads');
        expect(screen.getByText('the content')).toBeInTheDocument();
    });

    it.each([
        ['downloading', 'Downloading… 37%'],
        ['verifying', 'Checking the file…'],
        ['extracting', 'Unpacking…'],
        ['missing', 'Waiting…']
    ] as const)('shows the program that is %s with a bar', (status, text) => {
        setProgram('ytdlp', { status, percent: 37 });
        renderGate('downloads');
        const item = within(screen.getByTestId('program-setup-ytdlp'));
        expect(item.getByRole('progressbar', { name: 'yt-dlp' })).toHaveAttribute('aria-valuenow', '37');
        expect(item.getByText(text)).toBeInTheDocument();
        expect(item.queryByRole('button')).not.toBeInTheDocument();
    });

    it('shows the programs that are ready among the ones it waits for, as ready', () => {
        setProgram('ytdlp', { status: 'downloading', percent: 5 });
        renderGate('downloads');
        const item = within(screen.getByTestId('program-setup-deno'));
        expect(item.getByText('Ready')).toBeInTheDocument();
        expect(item.getByRole('progressbar', { name: 'deno' })).toHaveAttribute('aria-valuenow', '100');
    });

    it('shows a failure with its reason, TRY AGAIN, and says what is ready is kept', () => {
        setProgram('ffmpeg', { status: 'error', percent: 0, error: { code: 'EXTRACT_FAILED', message: 'tar: xz: not found' } });
        renderGate('downloads');
        const item = within(screen.getByTestId('program-setup-ffmpeg'));
        expect(item.getByRole('alert')).toHaveTextContent('The file could not be unpacked. On Linux the tar program of the system has to know xz (the package xz-utils).');
        expect(item.getByRole('alert')).toHaveAttribute('title', 'tar: xz: not found');
        expect(item.queryByRole('progressbar')).not.toBeInTheDocument();
        expect(screen.getByText('Some programs could not be downloaded. Check your connection and try again; what is ready is kept.')).toBeInTheDocument();
        fireEvent.click(item.getByRole('button', { name: 'TRY AGAIN' }));
        expect(mock.api.programs.install).toHaveBeenCalledWith('ffmpeg');
    });

    it('does not say anything about a failure while the programs are only downloading', () => {
        setProgram('ytdlp', { status: 'downloading', percent: 5 });
        renderGate('downloads');
        expect(screen.queryByText(/could not be downloaded/)).not.toBeInTheDocument();
    });

    it('disables TRY AGAIN while the retry goes on', () => {
        setProgram('deno', { status: 'error', percent: 0, error: { code: 'DOWNLOAD_FAILED', message: 'x' } });
        useProgramsStore.setState({ working: { deno: 'retrying' } });
        renderGate('downloads');
        expect(within(screen.getByTestId('program-setup-deno')).getByRole('button', { name: 'TRY AGAIN' })).toBeDisabled();
    });

    it('shows the content again once the program that failed is ready', () => {
        setProgram('deno', { status: 'error', percent: 0, error: { code: 'DOWNLOAD_FAILED', message: 'x' } });
        const { rerender } = renderGate('downloads');
        expect(screen.queryByText('the content')).not.toBeInTheDocument();
        setProgram('deno', { status: 'ready', percent: 100, error: null });
        rerender(
            <ProgramsGate area="downloads">
                <p>the content</p>
            </ProgramsGate>
        );
        expect(screen.getByText('the content')).toBeInTheDocument();
    });
});
