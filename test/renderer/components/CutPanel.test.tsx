// @vitest-environment jsdom
import { act, createEvent, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SETTINGS } from '@shared/constants';
import type { CutMedia, CutRun, CutSegmentState } from '@shared/cut';
import { CutPanel } from '@renderer/components/CutPanel';
import { useAppStore } from '@renderer/store/appStore';
import { useCutStore } from '@renderer/store/cutStore';
import { installMockApi, type MockApiHandle } from '../../helpers/mockApi';

let mock: MockApiHandle;
const initialApp = useAppStore.getState();
const initialCut = useCutStore.getInitialState();

const VIDEO: CutMedia = { path: '/media/Talk.mp4', name: 'Talk', extension: '.mp4', kind: 'video', durationSeconds: 150 };
const AUDIO: CutMedia = { path: '/media/Song.mp3', name: 'Song', extension: '.mp3', kind: 'audio', durationSeconds: 3725 };

function part(overrides: Partial<CutSegmentState> = {}): CutSegmentState {
    return { segment: { start: 10, end: 14 }, status: 'waiting', percent: 0, outputPath: null, error: null, ...overrides };
}

function runOf(status: CutRun['status'], segments: CutSegmentState[], overrides: Partial<CutRun> = {}): CutRun {
    return { id: 1, mediaName: 'Talk', outputDirectory: '/downloads/Talk - cuts', audioOnly: false, status, segments, ...overrides };
}

beforeEach(() => {
    mock = installMockApi();
    useAppStore.setState({ ...initialApp, settings: { ...DEFAULT_SETTINGS, downloadDir: '/downloads', audioFormat: 'm4a' } });
    useCutStore.setState(initialCut, true);
});

async function chooseVideo(user: ReturnType<typeof userEvent.setup>, media: CutMedia = VIDEO): Promise<void> {
    mock.api.cut.choose.mockResolvedValueOnce({ ok: true, media });
    await user.click(screen.getByRole('button', { name: 'CHOOSE FILE' }));
    await screen.findByText(media.name + media.extension);
}

async function fill(user: ReturnType<typeof userEvent.setup>, number: number, start: string, end: string): Promise<void> {
    await user.type(screen.getByLabelText(`Start of part ${number}`), start);
    await user.type(screen.getByLabelText(`End of part ${number}`), end);
}

describe('CutPanel before a file', () => {
    it('explains what it does and offers only to choose a file', () => {
        render(<CutPanel />);
        expect(screen.getByRole('region', { name: 'Cut a file' })).toBeInTheDocument();
        expect(screen.getByText('CUT A FILE')).toBeInTheDocument();
        expect(screen.getByText(/Pick a video or audio file and mark the parts to keep/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'CHOOSE FILE' })).toBeEnabled();
        expect(screen.queryByText('Parts to keep')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'CUT' })).not.toBeInTheDocument();
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('shows that it is reading the file, with the button off, until the file is read', async () => {
        const user = userEvent.setup();
        let answer: (value: unknown) => void = () => {return undefined};
        mock.api.cut.choose.mockReturnValue(
            new Promise((resolve) => {
                answer = resolve;
            })
        );
        render(<CutPanel />);
        await user.click(screen.getByRole('button', { name: 'CHOOSE FILE' }));
        expect(screen.getByRole('status')).toHaveTextContent('Reading the file…');
        expect(screen.getByRole('button', { name: 'CHOOSE FILE' })).toBeDisabled();
        await act(async () => {
            answer({ ok: true, media: VIDEO });
        });
        expect(screen.queryByText('Reading the file…')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'CHANGE FILE' })).toBeEnabled();
    });

    it('stays as it was when the window of the files is closed', async () => {
        const user = userEvent.setup();
        render(<CutPanel />);
        await user.click(screen.getByRole('button', { name: 'CHOOSE FILE' }));
        expect(mock.api.cut.choose).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('button', { name: 'CHOOSE FILE' })).toBeEnabled();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it.each([
        ['unreadable', 'That file has no video or audio that can be read.'],
        ['no-ffmpeg', 'ffmpeg could not be started. Look at the programs in the downloads settings.']
    ] as const)('says why the file was not taken: %s', async (reason, text) => {
        const user = userEvent.setup();
        mock.api.cut.choose.mockResolvedValue({ ok: false, reason });
        render(<CutPanel />);
        await user.click(screen.getByRole('button', { name: 'CHOOSE FILE' }));
        expect(await screen.findByRole('alert')).toHaveTextContent(text);
    });

    it('follows the cut that goes on when the screen opens in the middle of it', async () => {
        mock.api.cut.current.mockResolvedValue(runOf('running', [part({ status: 'cutting', percent: 40 })]));
        render(<CutPanel />);
        expect(await screen.findByText('0 of 1 parts done')).toBeInTheDocument();
        expect(screen.getByRole('progressbar', { name: 'Cutting part 1' })).toHaveAttribute('aria-valuenow', '40');
    });

    it('listens to the cut while it is open, and stops listening when it is closed', async () => {
        const { unmount } = render(<CutPanel />);
        await vi.waitFor(() => {
            expect(mock.unsubscribers).toHaveLength(1);
        });
        expect(mock.api.cut.onProgress).toHaveBeenCalledTimes(1);
        expect(mock.unsubscribers[0]).not.toHaveBeenCalled();
        unmount();
        await vi.waitFor(() => {
            expect(mock.unsubscribers[0]).toHaveBeenCalledTimes(1);
        });
    });
});

describe('CutPanel with a file', () => {
    it('shows the name with the extension, the kind and the length of a video', async () => {
        const user = userEvent.setup();
        render(<CutPanel />);
        await chooseVideo(user);
        expect(screen.getByText('Talk.mp4')).toHaveAttribute('title', '/media/Talk.mp4');
        expect(screen.getByText('VIDEO')).toBeInTheDocument();
        expect(screen.getByText('Length: 2:30')).toBeInTheDocument();
        expect(screen.getByText('Parts to keep')).toBeInTheDocument();
        expect(screen.getAllByTestId('cut-segment')).toHaveLength(1);
        expect(screen.getByLabelText('Start of part 1')).toHaveAttribute('placeholder', 'm:ss');
        expect(screen.getByLabelText('End of part 1')).toHaveAttribute('placeholder', 'm:ss');
        expect(screen.getByText('Saved in /downloads/Talk - cuts')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'CUT' })).toBeDisabled();
    });

    it('shows an audio file with hours in its length, and without the choice of only the audio', async () => {
        const user = userEvent.setup();
        render(<CutPanel />);
        await chooseVideo(user, AUDIO);
        expect(screen.getByText('AUDIO')).toBeInTheDocument();
        expect(screen.getByText('Length: 1:02:05')).toBeInTheDocument();
        expect(screen.queryByRole('switch', { name: 'Only the audio' })).not.toBeInTheDocument();
        expect(screen.getByText('Saved in /downloads/Song - cuts')).toBeInTheDocument();
    });

    it('offers the choice of only the audio for a video, off, and says the format of the settings', async () => {
        const user = userEvent.setup();
        render(<CutPanel />);
        await chooseVideo(user);
        const toggle = screen.getByRole('switch', { name: 'Only the audio' });
        expect(toggle).not.toBeChecked();
        expect(screen.getByText('Each part is saved as an audio file (m4a, the audio format of the settings) instead of a video.')).toBeInTheDocument();
        await user.click(toggle);
        expect(toggle).toBeChecked();
    });

    it('adds a part, shows its length when it is good, and removes a part', async () => {
        const user = userEvent.setup();
        render(<CutPanel />);
        await chooseVideo(user);
        await user.click(screen.getByRole('button', { name: '+ ADD PART' }));
        expect(screen.getAllByTestId('cut-segment')).toHaveLength(2);
        await fill(user, 1, '0:10', '0:14');
        await fill(user, 2, '1:34', '1:43');
        const [first, second] = screen.getAllByTestId('cut-segment');
        expect(within(first!).getByText('Length 0:04')).toBeInTheDocument();
        expect(within(second!).getByText('Length 0:09')).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Remove part 1' }));
        expect(screen.getAllByTestId('cut-segment')).toHaveLength(1);
        expect(screen.getByLabelText('Start of part 1')).toHaveValue('1:34');
    });

    it('leaves one blank part when the only part is removed', async () => {
        const user = userEvent.setup();
        render(<CutPanel />);
        await chooseVideo(user);
        await fill(user, 1, '0:10', '0:14');
        await user.click(screen.getByRole('button', { name: 'Remove part 1' }));
        expect(screen.getAllByTestId('cut-segment')).toHaveLength(1);
        expect(screen.getByLabelText('Start of part 1')).toHaveValue('');
    });

    it.each([
        ['abc', '0:14', 'The start of the part is not a time (write it as m:ss or h:mm:ss).'],
        ['0:10', 'x', 'The end of the part is not a time (write it as m:ss or h:mm:ss).'],
        ['0:20', '0:10', 'The end has to be after the start.'],
        ['0:10', '2:31', 'The end is after the end of the file (2:30).']
    ])('says what is wrong with a part (%s to %s), and does not let it be cut', async (start, end, text) => {
        const user = userEvent.setup();
        render(<CutPanel />);
        await chooseVideo(user);
        await fill(user, 1, start, end);
        expect(screen.getByRole('alert')).toHaveTextContent(text);
        expect(screen.getByRole('button', { name: 'CUT' })).toBeDisabled();
        expect(screen.queryByText(/^Length /)).not.toBeInTheDocument();
    });

    it('does not complain about a part before the user writes in it', async () => {
        const user = userEvent.setup();
        render(<CutPanel />);
        await chooseVideo(user);
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('does not let the cut be made while any part is wrong, even if another is good', async () => {
        const user = userEvent.setup();
        render(<CutPanel />);
        await chooseVideo(user);
        await user.click(screen.getByRole('button', { name: '+ ADD PART' }));
        await fill(user, 1, '0:10', '0:14');
        await fill(user, 2, '0:30', '0:20');
        expect(screen.getByRole('button', { name: 'CUT' })).toBeDisabled();
    });

    it('lets the cut be made when the parts are good, and a blank part is left out', async () => {
        const user = userEvent.setup();
        render(<CutPanel />);
        await chooseVideo(user);
        await user.click(screen.getByRole('button', { name: '+ ADD PART' }));
        await fill(user, 1, '0:10', '0:14');
        expect(screen.getByRole('button', { name: 'CUT' })).toBeEnabled();
        await user.click(screen.getByRole('button', { name: 'CUT' }));
        expect(mock.api.cut.start).toHaveBeenCalledWith({ path: '/media/Talk.mp4', segments: [{ start: 10, end: 14 }], audioOnly: false });
    });

    it('asks for audio only when the choice is on', async () => {
        const user = userEvent.setup();
        render(<CutPanel />);
        await chooseVideo(user);
        await fill(user, 1, '0:10', '0:14');
        await user.click(screen.getByRole('switch', { name: 'Only the audio' }));
        await user.click(screen.getByRole('button', { name: 'CUT' }));
        expect(mock.api.cut.start).toHaveBeenCalledWith({ path: '/media/Talk.mp4', segments: [{ start: 10, end: 14 }], audioOnly: true });
    });

    it('shows that the cut is starting, with the button off, until the cut answers', async () => {
        const user = userEvent.setup();
        let answer: (value: unknown) => void = () => {return undefined};
        mock.api.cut.start.mockReturnValue(
            new Promise((resolve) => {
                answer = resolve;
            })
        );
        render(<CutPanel />);
        await chooseVideo(user);
        await fill(user, 1, '0:10', '0:14');
        await user.click(screen.getByRole('button', { name: 'CUT' }));
        expect(screen.getByRole('status')).toHaveTextContent('STARTING…');
        expect(screen.getByRole('button', { name: 'CUT' })).toBeDisabled();
        expect(screen.getByLabelText('Start of part 1')).toBeDisabled();
        await act(async () => {
            answer({ ok: true, run: runOf('running', [part({ status: 'cutting' })]) });
        });
        expect(screen.queryByText('STARTING…')).not.toBeInTheDocument();
    });

    it.each([
        ['busy', 'Another cut is going on.'],
        ['invalid', 'Check the parts: each one needs a start and an end inside the file.'],
        ['unreadable', 'The file could not be read any more.'],
        ['no-ffmpeg', 'ffmpeg could not be started.'],
        ['folder', 'The folder for the parts could not be made.']
    ] as const)('says why the cut did not start: %s', async (reason, text) => {
        const user = userEvent.setup();
        mock.api.cut.start.mockResolvedValue({ ok: false, reason });
        render(<CutPanel />);
        await chooseVideo(user);
        await fill(user, 1, '0:10', '0:14');
        await user.click(screen.getByRole('button', { name: 'CUT' }));
        expect(await screen.findByRole('alert')).toHaveTextContent(text);
    });

    it('speaks the language of the app', async () => {
        const user = userEvent.setup();
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, downloadDir: '/downloads', language: 'pt' } });
        render(<CutPanel />);
        expect(screen.getByRole('region', { name: 'Cortar um arquivo' })).toBeInTheDocument();
        mock.api.cut.choose.mockResolvedValueOnce({ ok: true, media: VIDEO });
        await user.click(screen.getByRole('button', { name: 'ESCOLHER ARQUIVO' }));
        await screen.findByText('Talk.mp4');
        expect(screen.getByText('Trechos a guardar')).toBeInTheDocument();
        expect(screen.getByLabelText('Início do trecho 1')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'CORTAR' })).toBeInTheDocument();
    });
});

describe('CutPanel while the file is cut', () => {
    async function running(segments: CutSegmentState[]): Promise<ReturnType<typeof userEvent.setup>> {
        const user = userEvent.setup();
        render(<CutPanel />);
        await chooseVideo(user);
        await fill(user, 1, '0:10', '0:14');
        mock.api.cut.start.mockResolvedValue({ ok: true, run: runOf('running', segments) });
        await user.click(screen.getByRole('button', { name: 'CUT' }));
        await screen.findByRole('progressbar', { name: /part 1/ });
        return user;
    }

    it('shows each part with its times and state: a bar that fills for the one being cut, a waiting bar for the next', async () => {
        await running([part({ status: 'cutting', percent: 40 }), part({ segment: { start: 94, end: 103 } })]);
        expect(screen.getByText('0 of 2 parts done')).toBeInTheDocument();
        const [first, second] = screen.getAllByTestId('cut-part');
        expect(within(first!).getByText('Part 1: 0:10 – 0:14')).toBeInTheDocument();
        expect(within(first!).getByText('CUTTING')).toHaveClass('badge--running');
        expect(within(first!).getByRole('progressbar', { name: 'Cutting part 1' })).toHaveAttribute('aria-valuenow', '40');
        expect(within(second!).getByText('Part 2: 1:34 – 1:43')).toBeInTheDocument();
        expect(within(second!).getByText('WAITING')).toHaveClass('badge--waiting');
        const waiting = within(second!).getByRole('progressbar', { name: 'Part 2 is waiting' });
        expect(waiting).toHaveClass('progress--waiting');
    });

    it('turns the controls off while it cuts, and offers to cancel', async () => {
        await running([part({ status: 'cutting', percent: 5 })]);
        expect(screen.getByRole('button', { name: 'CUT' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'CHANGE FILE' })).toBeDisabled();
        expect(screen.getByRole('button', { name: '+ ADD PART' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Remove part 1' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'CLEAR' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Play part 1' })).toBeEnabled();
        expect(screen.getByLabelText('Start of part 1')).toBeDisabled();
        expect(screen.getByLabelText('End of part 1')).toBeDisabled();
        expect(screen.getByRole('button', { name: 'CANCEL' })).toBeEnabled();
    });

    it('follows what the cut tells: the bar moves and the count grows', async () => {
        await running([part({ status: 'cutting', percent: 5 }), part({ segment: { start: 94, end: 103 } })]);
        act(() => {
            mock.emitCutProgress(runOf('running', [part({ status: 'done', percent: 100, outputPath: '/downloads/Talk - cuts/Talk - 01.mp4' }), part({ segment: { start: 94, end: 103 }, status: 'cutting', percent: 60 })]));
        });
        expect(screen.getByText('1 of 2 parts done')).toBeInTheDocument();
        const [first, second] = screen.getAllByTestId('cut-part');
        expect(within(first!).getByText('DONE')).toHaveClass('badge--done');
        expect(within(first!).queryByRole('progressbar')).not.toBeInTheDocument();
        expect(within(second!).getByRole('progressbar', { name: 'Cutting part 2' })).toHaveAttribute('aria-valuenow', '60');
    });

    it('asks to cancel, shows that it is stopping and takes the button away until the cut says it is over', async () => {
        const user = await running([part({ status: 'cutting', percent: 5 })]);
        await user.click(screen.getByRole('button', { name: 'CANCEL' }));
        expect(mock.api.cut.cancel).toHaveBeenCalledTimes(1);
        expect(screen.getByText('CANCELLING…')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'CANCEL' })).not.toBeInTheDocument();
        act(() => {
            mock.emitCutProgress(runOf('cancelled', [part({ status: 'cancelled' })]));
        });
        expect(screen.queryByText('CANCELLING…')).not.toBeInTheDocument();
        expect(screen.getByText('Cancelled: 0 of 1 parts were made.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'CUT' })).toBeEnabled();
    });

    it('shows a part that failed with what ffmpeg said', async () => {
        await running([part({ status: 'cutting' })]);
        act(() => {
            mock.emitCutProgress(runOf('done', [part({ status: 'error', error: 'Conversion failed!' })]));
        });
        const failed = screen.getByTestId('cut-part');
        expect(within(failed).getByText('FAILED')).toHaveClass('badge--error');
        expect(within(failed).getByRole('alert')).toHaveTextContent('Conversion failed!');
        expect(screen.getByText('0 part(s) done, 1 failed.')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'OPEN FOLDER' })).not.toBeInTheDocument();
    });
});

describe('CutPanel when the cut is over', () => {
    it('says how many files were saved, and opens the folder at the first one', async () => {
        const user = userEvent.setup();
        mock.api.cut.current.mockResolvedValue(
            runOf('done', [
                part({ status: 'done', percent: 100, outputPath: '/downloads/Talk - cuts/Talk - 01 (0m10s-0m14s).mp4' }),
                part({ segment: { start: 94, end: 103 }, status: 'done', percent: 100, outputPath: '/downloads/Talk - cuts/Talk - 02 (1m34s-1m43s).mp4' })
            ])
        );
        render(<CutPanel />);
        expect(await screen.findByText('Done: 2 file(s) saved.')).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'OPEN FOLDER' }));
        expect(mock.api.showItemInFolder).toHaveBeenCalledTimes(1);
        expect(mock.api.showItemInFolder).toHaveBeenCalledWith('/downloads/Talk - cuts/Talk - 01 (0m10s-0m14s).mp4');
    });

    it('says how many files were saved and how many failed', async () => {
        mock.api.cut.current.mockResolvedValue(
            runOf('done', [part({ status: 'done', percent: 100, outputPath: '/d/a.mp4' }), part({ status: 'error', error: 'boom' })])
        );
        render(<CutPanel />);
        expect(await screen.findByText('1 part(s) done, 1 failed.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'OPEN FOLDER' })).toBeInTheDocument();
    });

    it('opens the folder at the first file that was made when the cut was cancelled', async () => {
        const user = userEvent.setup();
        mock.api.cut.current.mockResolvedValue(
            runOf('cancelled', [part({ status: 'done', percent: 100, outputPath: '/d/a.mp4' }), part({ status: 'cancelled' })])
        );
        render(<CutPanel />);
        expect(await screen.findByText('Cancelled: 1 of 2 parts were made.')).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'OPEN FOLDER' }));
        expect(mock.api.showItemInFolder).toHaveBeenCalledWith('/d/a.mp4');
    });

    it('offers no folder when no file was made', async () => {
        mock.api.cut.current.mockResolvedValue(runOf('cancelled', [part({ status: 'cancelled' })]));
        render(<CutPanel />);
        expect(await screen.findByText('Cancelled: 0 of 1 parts were made.')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'OPEN FOLDER' })).not.toBeInTheDocument();
    });

    it('goes away when another file is chosen', async () => {
        const user = userEvent.setup();
        mock.api.cut.current.mockResolvedValue(runOf('done', [part({ status: 'done', percent: 100, outputPath: '/d/a.mp4' })]));
        render(<CutPanel />);
        await screen.findByText('Done: 1 file(s) saved.');
        mock.api.cut.choose.mockResolvedValueOnce({ ok: true, media: AUDIO });
        await user.click(screen.getByRole('button', { name: 'CHOOSE FILE' }));
        await screen.findByText('Song.mp3');
        expect(screen.queryByText('Done: 1 file(s) saved.')).not.toBeInTheDocument();
        expect(screen.queryAllByTestId('cut-part')).toHaveLength(0);
    });
});

describe('CutPanel drag and drop', () => {
    const FILES = { types: ['Files'], files: [new File(['x'], 'Talk.mp4', { type: 'video/mp4' })], dropEffect: 'none' };

    function panel(): HTMLElement {
        return screen.getByRole('region', { name: 'Cut a file' });
    }

    // The drag leaves an element for another one (null: for none, as when it leaves the window or is cancelled).
    function dragLeave(from: Element, to: Element | null): void {
        const event = createEvent.dragLeave(from, { dataTransfer: FILES });
        Object.defineProperty(event, 'relatedTarget', { value: to });
        fireEvent(from, event);
    }

    it('says in the panel that a file can be dragged to it', () => {
        render(<CutPanel />);
        expect(screen.getByText('You can also drag a video or audio file and drop it here.')).toBeInTheDocument();
        expect(screen.queryByTestId('cut-drop')).not.toBeInTheDocument();
    });

    it('lights up with the words to drop the file when a file is dragged over it, and goes back when it leaves', () => {
        render(<CutPanel />);
        fireEvent.dragEnter(panel(), { dataTransfer: FILES });
        expect(panel()).toHaveClass('cut--dragging');
        expect(screen.getByTestId('cut-drop')).toHaveTextContent('DROP THE FILE HERE');
        expect(screen.getByTestId('cut-drop')).not.toHaveClass('cut__drop--busy');
        fireEvent.dragLeave(panel(), { dataTransfer: FILES });
        expect(panel()).not.toHaveClass('cut--dragging');
        expect(screen.queryByTestId('cut-drop')).not.toBeInTheDocument();
    });

    it('stays lit while the drag goes from one element of the panel to another, and goes off when it leaves the panel', () => {
        render(<CutPanel />);
        const button = screen.getByRole('button', { name: 'CHOOSE FILE' });
        fireEvent.dragEnter(panel(), { dataTransfer: FILES });
        fireEvent.dragEnter(button, { dataTransfer: FILES });
        dragLeave(panel(), button);
        expect(panel()).toHaveClass('cut--dragging');
        dragLeave(button, screen.getByText('CUT A FILE'));
        expect(panel()).toHaveClass('cut--dragging');
        dragLeave(button, document.body);
        expect(panel()).not.toHaveClass('cut--dragging');
    });

    it('goes off when the drag leaves the window or is cancelled (there is no element it goes to)', () => {
        render(<CutPanel />);
        fireEvent.dragEnter(panel(), { dataTransfer: FILES });
        dragLeave(screen.getByRole('button', { name: 'CHOOSE FILE' }), null);
        expect(panel()).not.toHaveClass('cut--dragging');
    });

    it('does not light up for text or a link that is dragged', () => {
        render(<CutPanel />);
        fireEvent.dragEnter(panel(), { dataTransfer: { types: ['text/plain'], files: [] } });
        expect(panel()).not.toHaveClass('cut--dragging');
        const dropped = fireEvent.drop(panel(), { dataTransfer: { types: ['text/plain'], files: [] } });
        expect(dropped).toBe(true);
        expect(mock.api.cut.probe).not.toHaveBeenCalled();
    });

    it('lets the file be dropped on the panel, copying it', () => {
        render(<CutPanel />);
        const transfer = { ...FILES };
        const accepted = fireEvent.dragOver(panel(), { dataTransfer: transfer });
        expect(accepted).toBe(false);
        expect(transfer.dropEffect).toBe('copy');
    });

    it('reads the file that is dropped, by the path the system gives for it, and shows it', async () => {
        mock.api.cut.pathForFile.mockReturnValue('/media/Talk.mp4');
        mock.api.cut.probe.mockResolvedValue({ ok: true, media: VIDEO });
        render(<CutPanel />);
        fireEvent.dragEnter(panel(), { dataTransfer: FILES });
        const notNavigated = fireEvent.drop(panel(), { dataTransfer: FILES });
        expect(notNavigated).toBe(false);
        expect(panel()).not.toHaveClass('cut--dragging');
        expect(mock.api.cut.pathForFile).toHaveBeenCalledWith(FILES.files[0]);
        expect(mock.api.cut.probe).toHaveBeenCalledWith('/media/Talk.mp4');
        expect(await screen.findByText('Talk.mp4')).toBeInTheDocument();
        expect(screen.getByText('Length: 2:30')).toBeInTheDocument();
        expect(screen.getAllByTestId('cut-segment')).toHaveLength(1);
    });

    it('shows that it is reading the file that was dropped', async () => {
        let answer: (value: unknown) => void = () => {return undefined};
        mock.api.cut.pathForFile.mockReturnValue('/media/Talk.mp4');
        mock.api.cut.probe.mockReturnValue(
            new Promise((resolve) => {
                answer = resolve;
            })
        );
        render(<CutPanel />);
        fireEvent.drop(panel(), { dataTransfer: FILES });
        expect(await screen.findByRole('status')).toHaveTextContent('Reading the file…');
        await act(async () => {
            answer({ ok: true, media: VIDEO });
        });
        expect(screen.queryByText('Reading the file…')).not.toBeInTheDocument();
    });

    it('takes the first file when several are dropped', async () => {
        mock.api.cut.pathForFile.mockImplementation((file: File) => {
            return `/media/${file.name}`;
        });
        mock.api.cut.probe.mockResolvedValue({ ok: true, media: VIDEO });
        render(<CutPanel />);
        fireEvent.drop(panel(), { dataTransfer: { types: ['Files'], files: [new File(['a'], 'first.mp4'), new File(['b'], 'second.mp4')] } });
        expect(mock.api.cut.probe).toHaveBeenCalledTimes(1);
        expect(mock.api.cut.probe).toHaveBeenCalledWith('/media/first.mp4');
    });

    it('says what is wrong with a file that is dropped and is not a video or an audio', async () => {
        mock.api.cut.pathForFile.mockReturnValue('/media/notes.txt');
        mock.api.cut.probe.mockResolvedValue({ ok: false, reason: 'unreadable' });
        render(<CutPanel />);
        fireEvent.drop(panel(), { dataTransfer: FILES });
        expect(await screen.findByRole('alert')).toHaveTextContent('That file has no video or audio that can be read.');
    });

    it('says the file could not be taken when the system gives no path for it', () => {
        mock.api.cut.pathForFile.mockReturnValue('');
        render(<CutPanel />);
        fireEvent.drop(panel(), { dataTransfer: FILES });
        expect(screen.getByRole('alert')).toHaveTextContent('Could not take the file that was dropped. Use CHOOSE FILE.');
        expect(mock.api.cut.probe).not.toHaveBeenCalled();
    });

    it('does nothing for a drop with no file in it', () => {
        render(<CutPanel />);
        fireEvent.drop(panel(), { dataTransfer: { types: ['Files'], files: [] } });
        expect(mock.api.cut.pathForFile).not.toHaveBeenCalled();
        expect(mock.api.cut.probe).not.toHaveBeenCalled();
    });

    it('says to wait, and does not take the file, while a cut goes on', async () => {
        mock.api.cut.current.mockResolvedValue(runOf('running', [part({ status: 'cutting', percent: 10 })]));
        render(<CutPanel />);
        await screen.findByText('0 of 1 parts done');
        fireEvent.dragEnter(panel(), { dataTransfer: FILES });
        expect(screen.getByTestId('cut-drop')).toHaveTextContent('WAIT FOR THE CUT TO END');
        expect(screen.getByTestId('cut-drop')).toHaveClass('cut__drop--busy');
        const transfer = { ...FILES };
        fireEvent.dragOver(panel(), { dataTransfer: transfer });
        expect(transfer.dropEffect).toBe('none');
        const notNavigated = fireEvent.drop(panel(), { dataTransfer: FILES });
        expect(notNavigated).toBe(false);
        expect(mock.api.cut.pathForFile).not.toHaveBeenCalled();
        expect(mock.api.cut.probe).not.toHaveBeenCalled();
        expect(panel()).not.toHaveClass('cut--dragging');
    });

    it('does not take a second file while one is being read', async () => {
        mock.api.cut.pathForFile.mockReturnValue('/media/Talk.mp4');
        mock.api.cut.probe.mockReturnValue(new Promise(() => {return undefined}));
        render(<CutPanel />);
        fireEvent.drop(panel(), { dataTransfer: FILES });
        await screen.findByRole('status');
        fireEvent.drop(panel(), { dataTransfer: FILES });
        expect(mock.api.cut.probe).toHaveBeenCalledTimes(1);
    });

    it('replaces the file that was there, with its parts, by the one that is dropped', async () => {
        const user = userEvent.setup();
        render(<CutPanel />);
        await chooseVideo(user);
        await fill(user, 1, '0:10', '0:14');
        mock.api.cut.pathForFile.mockReturnValue('/media/Song.mp3');
        mock.api.cut.probe.mockResolvedValue({ ok: true, media: AUDIO });
        fireEvent.drop(panel(), { dataTransfer: { types: ['Files'], files: [new File(['s'], 'Song.mp3')] } });
        expect(await screen.findByText('Song.mp3')).toBeInTheDocument();
        expect(screen.getByLabelText('Start of part 1')).toHaveValue('');
        expect(screen.queryByRole('switch', { name: 'Only the audio' })).not.toBeInTheDocument();
    });

    it('keeps the window from opening a file that is dropped outside the panel while the cutter is open', () => {
        const { unmount } = render(<CutPanel />);
        const outside = new Event('drop', { cancelable: true }) as Event & { dataTransfer: unknown };
        outside.dataTransfer = { types: ['Files'], files: [] };
        window.dispatchEvent(outside);
        expect(outside.defaultPrevented).toBe(true);
        const over = new Event('dragover', { cancelable: true }) as Event & { dataTransfer: unknown };
        over.dataTransfer = { types: ['Files'], files: [] };
        window.dispatchEvent(over);
        expect(over.defaultPrevented).toBe(true);
        const text = new Event('drop', { cancelable: true }) as Event & { dataTransfer: unknown };
        text.dataTransfer = { types: ['text/plain'], files: [] };
        window.dispatchEvent(text);
        expect(text.defaultPrevented).toBe(false);
        unmount();
        const after = new Event('drop', { cancelable: true }) as Event & { dataTransfer: unknown };
        after.dataTransfer = { types: ['Files'], files: [] };
        window.dispatchEvent(after);
        expect(after.defaultPrevented).toBe(false);
    });

    it('speaks the language of the app', () => {
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, downloadDir: '/downloads', language: 'pt' } });
        render(<CutPanel />);
        expect(screen.getByText('Você também pode arrastar um arquivo de vídeo ou áudio e soltá-lo aqui.')).toBeInTheDocument();
        fireEvent.dragEnter(screen.getByRole('region', { name: 'Cortar um arquivo' }), { dataTransfer: FILES });
        expect(screen.getByTestId('cut-drop')).toHaveTextContent('SOLTE O ARQUIVO AQUI');
    });
});

describe('CutPanel picture of the file', () => {
    it('shows a glow while the picture is made, then the frame of the video', async () => {
        const user = userEvent.setup();
        let answer: (url: string | null) => void = () => {
            return undefined;
        };
        mock.api.cut.thumbnail.mockReturnValue(
            new Promise<string | null>((resolve) => {
                answer = resolve;
            })
        );
        render(<CutPanel />);
        mock.api.cut.choose.mockResolvedValueOnce({ ok: true, media: VIDEO });
        await user.click(screen.getByRole('button', { name: 'CHOOSE FILE' }));
        const loading = await screen.findByTestId('cut-thumb');
        expect(loading).toHaveClass('cut__thumb', 'cut__thumb--empty', 'cut__thumb--loading');
        expect(loading).toHaveAttribute('aria-hidden', 'true');
        expect(loading).toHaveTextContent('');
        await act(async () => {
            answer('pullwave-cut://thumbnail/2');
        });
        const picture = screen.getByRole('img', { name: 'Picture of the file' });
        expect(picture).toHaveAttribute('src', 'pullwave-cut://thumbnail/2');
        expect(picture).toHaveClass('cut__thumb');
        expect(picture).toHaveAttribute('data-testid', 'cut-thumb');
    });

    it('shows the mark of an audio when it has no cover', async () => {
        const user = userEvent.setup();
        mock.api.cut.thumbnail.mockResolvedValueOnce(null);
        render(<CutPanel />);
        await chooseVideo(user, AUDIO);
        const mark = await screen.findByText('♫');
        expect(mark).toHaveClass('cut__thumb', 'cut__thumb--empty');
        expect(mark).not.toHaveClass('cut__thumb--loading');
        expect(screen.queryByRole('img', { name: 'Picture of the file' })).not.toBeInTheDocument();
    });

    it('shows the mark of a video when its frame could not be taken', async () => {
        const user = userEvent.setup();
        mock.api.cut.thumbnail.mockResolvedValueOnce(null);
        render(<CutPanel />);
        await chooseVideo(user);
        await vi.waitFor(() => {
            expect(screen.getByTestId('cut-thumb')).toHaveTextContent('▶');
        });
        expect(screen.getByTestId('cut-thumb')).toHaveClass('cut__thumb', 'cut__thumb--empty');
        expect(screen.getByTestId('cut-thumb')).not.toHaveClass('cut__thumb--loading');
    });

    it('shows no picture before a file is chosen', () => {
        render(<CutPanel />);
        expect(screen.queryByTestId('cut-thumb')).not.toBeInTheDocument();
    });
});

describe('CutPanel clear', () => {
    it('offers to clear once a file is there, and asks first', async () => {
        const user = userEvent.setup();
        render(<CutPanel />);
        expect(screen.queryByRole('button', { name: 'CLEAR' })).not.toBeInTheDocument();
        await chooseVideo(user);
        await user.click(screen.getByRole('button', { name: 'CLEAR' }));
        const dialog = screen.getByRole('dialog', { name: 'Clear the cutter?' });
        expect(within(dialog).getByText('The file is taken out of the cutter and the parts and the options are cleared. The file itself stays where it is.')).toBeInTheDocument();
        expect(mock.api.cut.clear).not.toHaveBeenCalled();
    });

    it('keeps everything when the question is answered no', async () => {
        const user = userEvent.setup();
        render(<CutPanel />);
        await chooseVideo(user);
        await fill(user, 1, '0:10', '0:14');
        await user.click(screen.getByRole('button', { name: 'CLEAR' }));
        await user.click(within(screen.getByRole('dialog', { name: 'Clear the cutter?' })).getByRole('button', { name: 'KEEP' }));
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(screen.getByText('Talk.mp4')).toBeInTheDocument();
        expect(screen.getByLabelText('Start of part 1')).toHaveValue('0:10');
        expect(mock.api.cut.clear).not.toHaveBeenCalled();
    });

    it('takes the file away and goes back to the start when confirmed', async () => {
        const user = userEvent.setup();
        render(<CutPanel />);
        await chooseVideo(user);
        await fill(user, 1, '0:10', '0:14');
        await user.click(screen.getByRole('button', { name: '+ ADD PART' }));
        await user.click(screen.getByRole('button', { name: 'CLEAR' }));
        await user.click(within(screen.getByRole('dialog', { name: 'Clear the cutter?' })).getByRole('button', { name: 'CLEAR' }));
        expect(mock.api.cut.clear).toHaveBeenCalledTimes(1);
        expect(mock.api.cut.clear).toHaveBeenCalledWith();
        expect(screen.queryByText('Talk.mp4')).not.toBeInTheDocument();
        expect(screen.queryByText('Parts to keep')).not.toBeInTheDocument();
        expect(screen.queryByTestId('cut-thumb')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'CHOOSE FILE' })).toBeEnabled();
        mock.api.cut.choose.mockResolvedValueOnce({ ok: true, media: VIDEO });
        await user.click(screen.getByRole('button', { name: 'CHOOSE FILE' }));
        await screen.findByText('Talk.mp4');
        expect(screen.getAllByTestId('cut-segment')).toHaveLength(1);
        expect(screen.getByLabelText('Start of part 1')).toHaveValue('');
    });

    it('takes the result of the last cut away too', async () => {
        const user = userEvent.setup();
        render(<CutPanel />);
        await chooseVideo(user);
        act(() => {
            useCutStore.setState({ run: runOf('done', [part({ status: 'done', outputPath: '/downloads/Talk - cuts/Talk 1.mp4' })]) });
        });
        expect(screen.getByRole('status')).toHaveTextContent('Done: 1 file(s) saved.');
        await user.click(screen.getByRole('button', { name: 'CLEAR' }));
        await user.click(within(screen.getByRole('dialog', { name: 'Clear the cutter?' })).getByRole('button', { name: 'CLEAR' }));
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
        expect(screen.queryByTestId('cut-part')).not.toBeInTheDocument();
    });

    it('speaks the language of the app', async () => {
        const user = userEvent.setup();
        useAppStore.setState({ settings: { ...useAppStore.getState().settings, language: 'pt' } });
        render(<CutPanel />);
        mock.api.cut.choose.mockResolvedValueOnce({ ok: true, media: VIDEO });
        await user.click(screen.getByRole('button', { name: 'ESCOLHER ARQUIVO' }));
        await screen.findByText('Talk.mp4');
        await user.click(screen.getByRole('button', { name: 'LIMPAR' }));
        expect(screen.getByRole('dialog', { name: 'Limpar o cortador?' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Tocar a parte 1' })).toBeInTheDocument();
    });
});

describe('CutPanel play of a part', () => {
    it('offers the play of a part only once the part is good', async () => {
        const user = userEvent.setup();
        render(<CutPanel />);
        await chooseVideo(user);
        const play = screen.getByRole('button', { name: 'Play part 1' });
        expect(play).toBeDisabled();
        expect(play).toHaveTextContent('▶');
        expect(play).toHaveAttribute('title', 'Play part 1');
        await fill(user, 1, '0:20', '0:10');
        expect(screen.getByRole('button', { name: 'Play part 1' })).toBeDisabled();
        await user.clear(screen.getByLabelText('End of part 1'));
        await user.type(screen.getByLabelText('End of part 1'), '0:30');
        expect(screen.getByRole('button', { name: 'Play part 1' })).toBeEnabled();
    });

    it('opens the player of the app on the part, from its start to its end', async () => {
        const user = userEvent.setup();
        mock.api.cut.preview.mockResolvedValueOnce({ ok: true, url: 'pullwave-cut://media/1', start: 10, end: 14, converted: false });
        render(<CutPanel />);
        await chooseVideo(user);
        await fill(user, 1, '0:10', '0:14');
        await user.click(screen.getByRole('button', { name: 'Play part 1' }));
        expect(mock.api.cut.preview).toHaveBeenCalledWith({ segment: { start: 10, end: 14 }, convert: false });
        const player = await screen.findByRole('dialog', { name: 'Part 1: 0:10 – 0:14' });
        expect(within(player).getByTestId('cut-preview-video')).toHaveAttribute('src', 'pullwave-cut://media/1');
    });

    it('plays the second part with its own number', async () => {
        const user = userEvent.setup();
        mock.api.cut.preview.mockResolvedValueOnce({ ok: true, url: 'pullwave-cut://media/1', start: 94, end: 103, converted: false });
        render(<CutPanel />);
        await chooseVideo(user);
        await fill(user, 1, '0:10', '0:14');
        await user.click(screen.getByRole('button', { name: '+ ADD PART' }));
        await fill(user, 2, '1:34', '1:43');
        await user.click(screen.getByRole('button', { name: 'Play part 2' }));
        expect(mock.api.cut.preview).toHaveBeenCalledWith({ segment: { start: 94, end: 103 }, convert: false });
        expect(await screen.findByRole('dialog', { name: 'Part 2: 1:34 – 1:43' })).toBeInTheDocument();
    });
});
