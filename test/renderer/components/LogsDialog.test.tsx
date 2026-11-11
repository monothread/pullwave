// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SETTINGS } from '@shared/constants';
import type { LogLine, LogSource } from '@shared/logs';
import { LOG_SOURCE_LABELS, LogsDialog } from '@renderer/components/LogsDialog';
import { useAppStore } from '@renderer/store/appStore';
import { installMockApi, type MockApiHandle } from '../../helpers/mockApi';

const ESC = String.fromCharCode(27);
const AT = new Date(2026, 10, 11, 14, 3, 9, 42).getTime();
const initialApp = useAppStore.getState();

const YTDLP_LINES: LogLine[] = [
    { id: 1, at: AT, stream: 'command', text: 'yt-dlp --newline https://x.test/v?token=***' },
    { id: 2, at: AT, stream: 'stdout', text: '[youtube] Extracting URL: https://x.test/v' },
    { id: 3, at: AT, stream: 'stderr', text: 'WARNING: [youtube] Falling back' },
    { id: 4, at: AT, stream: 'stderr', text: `${ESC}[0;31mERROR:${ESC}[0m Video unavailable` },
    { id: 5, at: AT, stream: 'event', text: 'exited with code 1' }
];

let mock: MockApiHandle;

function stubClipboard(writeText: (text: string) => Promise<void>): void {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
}

function snapshotOf(lines: Partial<Record<LogSource, LogLine[]>>): void {
    mock.api.logs.snapshot.mockImplementation((source: LogSource) => {
        return Promise.resolve(lines[source] ?? []);
    });
}

function setup(sources: readonly LogSource[] = ['yt-dlp']) {
    const onClose = vi.fn();
    const outside = vi.fn();
    document.addEventListener('keydown', outside);
    const view = render(<LogsDialog sources={sources} onClose={onClose} />);
    return { onClose, outside, user: userEvent.setup(), ...view };
}

function shownTexts(): string[] {
    return Array.from(document.querySelectorAll('.log-line__text')).map((element) => {
        return element.textContent ?? '';
    });
}

beforeEach(() => {
    mock = installMockApi();
    useAppStore.setState({ ...initialApp, settings: DEFAULT_SETTINGS, toasts: [] });
});

describe('LOG_SOURCE_LABELS', () => {
    it('names each program by its own name', () => {
        expect(LOG_SOURCE_LABELS).toEqual({ 'yt-dlp': 'yt-dlp', 'ani-cli': 'ani-cli', ffmpeg: 'ffmpeg', suwayomi: 'Suwayomi', flaresolverr: 'FlareSolverr' });
    });
});

describe('LogsDialog', () => {
    it('is a window over the screen in the body of the page, named by its heading with the programs', async () => {
        const { container } = setup(['suwayomi', 'flaresolverr']);
        const dialog = screen.getByRole('dialog', { name: 'LOGS — Suwayomi · FlareSolverr' });
        expect(dialog).toHaveAttribute('aria-modal', 'true');
        expect(dialog).toHaveClass('modal', 'modal--logs');
        expect(dialog.parentElement).toHaveClass('modal-backdrop');
        expect(dialog.parentElement?.parentElement).toBe(document.body);
        expect(container.contains(dialog)).toBe(false);
        await screen.findByText('Nothing recorded yet. The lines show up here as soon as the program runs.');
    });

    it('shows that it loads, then each line with its time, colored by how serious it is and by its pieces', async () => {
        snapshotOf({ 'yt-dlp': YTDLP_LINES });
        setup();
        expect(screen.getByText('Loading…')).toHaveClass('logs__empty');
        const list = await screen.findByRole('list', { name: 'Lines of the log of yt-dlp' });
        expect(list).toHaveClass('logs__lines');
        const rows = within(list).getAllByRole('listitem');
        expect(
            rows.map((row) => {
                return [row.className, row.getAttribute('data-stream')];
            })
        ).toEqual([
            ['log-line log-line--command', 'command'],
            ['log-line log-line--plain', 'stdout'],
            ['log-line log-line--warning', 'stderr'],
            ['log-line log-line--error', 'stderr'],
            ['log-line log-line--error', 'event']
        ]);
        expect(rows[0]?.querySelector('.log-line__time')?.textContent).toBe('14:03:09.042');
        expect(shownTexts()).toEqual([
            'yt-dlp --newline https://x.test/v?token=***',
            '[youtube] Extracting URL: https://x.test/v',
            'WARNING: [youtube] Falling back',
            'ERROR: Video unavailable',
            'exited with code 1'
        ]);
        expect(screen.getAllByText('[youtube]', { selector: '.log-token--tag' })).toHaveLength(2);
        expect(screen.getByText('***', { selector: '.log-token--redacted' })).toBeInTheDocument();
        expect(screen.getByText('--newline', { selector: '.log-token--flag' })).toBeInTheDocument();
        expect(screen.getByText('https://x.test/v', { selector: '.log-token--url' })).toBeInTheDocument();
        expect(screen.getByText('WARNING:', { selector: '.log-token--level' })).toBeInTheDocument();
        expect(screen.getByText('ERROR:', { selector: '.ansi.ansi--red' })).toBeInTheDocument();
        expect(screen.getByText('5 of 5 lines')).toHaveClass('logs__count');
    });

    it('adds the new lines as the program writes them', async () => {
        snapshotOf({ 'yt-dlp': [YTDLP_LINES[0] as LogLine] });
        setup();
        await screen.findByRole('list');
        act(() => {
            mock.emitLogLines('yt-dlp', [{ id: 9, at: AT, stream: 'stdout', text: '[download] 100% of 1.00MiB' }]);
        });
        expect(shownTexts()).toEqual(['yt-dlp --newline https://x.test/v?token=***', '[download] 100% of 1.00MiB']);
        expect(screen.getByText('2 of 2 lines')).toBeInTheDocument();
    });

    it('shows only the warnings and the errors, or only the errors, as chosen', async () => {
        snapshotOf({ 'yt-dlp': YTDLP_LINES });
        const { user } = setup();
        await screen.findByRole('list');
        const filter = screen.getByLabelText('Show');
        expect(
            within(filter)
                .getAllByRole('option')
                .map((option) => {
                    return [option.getAttribute('value'), option.textContent];
                })
        ).toEqual([
            ['all', 'Everything'],
            ['warnings', 'Warnings and errors'],
            ['errors', 'Errors only']
        ]);
        await user.selectOptions(filter, 'warnings');
        expect(shownTexts()).toEqual(['WARNING: [youtube] Falling back', 'ERROR: Video unavailable', 'exited with code 1']);
        await user.selectOptions(filter, 'errors');
        expect(shownTexts()).toEqual(['ERROR: Video unavailable', 'exited with code 1']);
        expect(screen.getByText('2 of 5 lines')).toBeInTheDocument();
    });

    it('searches the lines, and says so when none matches', async () => {
        snapshotOf({ 'yt-dlp': YTDLP_LINES });
        const { user } = setup();
        await screen.findByRole('list');
        const search = screen.getByLabelText('Search');
        expect(search).toHaveAttribute('placeholder', 'Search the log');
        await user.type(search, 'unavailable');
        expect(shownTexts()).toEqual(['ERROR: Video unavailable']);
        await user.clear(search);
        await user.type(search, 'nothing like this');
        expect(screen.queryByRole('list')).not.toBeInTheDocument();
        expect(screen.getByText('No line matches the filter.')).toHaveClass('logs__empty');
        expect(screen.getByText('0 of 5 lines')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'COPY' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'CLEAR' })).toBeEnabled();
    });

    it('copies the lines shown, as plain text, and says so', async () => {
        snapshotOf({ 'yt-dlp': YTDLP_LINES });
        const writeText = vi.fn(() => {
            return Promise.resolve();
        });
        const { user } = setup();
        stubClipboard(writeText);
        await screen.findByRole('list');
        await user.selectOptions(screen.getByLabelText('Show'), 'errors');
        await user.click(screen.getByRole('button', { name: 'COPY' }));
        expect(writeText).toHaveBeenCalledTimes(1);
        expect(writeText).toHaveBeenCalledWith('14:03:09.042 [stderr] ERROR: Video unavailable\n14:03:09.042 [event] exited with code 1');
        expect(
            useAppStore.getState().toasts.map((toast) => {
                return toast.message;
            })
        ).toEqual(['Log copied.']);
    });

    it('says when the lines could not be copied', async () => {
        snapshotOf({ 'yt-dlp': YTDLP_LINES });
        const { user } = setup();
        stubClipboard(() => {
            return Promise.reject(new Error('denied'));
        });
        await screen.findByRole('list');
        await user.click(screen.getByRole('button', { name: 'COPY' }));
        expect(
            useAppStore.getState().toasts.map((toast) => {
                return toast.message;
            })
        ).toEqual(['Could not copy the log.']);
    });

    it('clears the log of the program shown', async () => {
        snapshotOf({ 'yt-dlp': YTDLP_LINES });
        const { user } = setup();
        await screen.findByRole('list');
        await user.click(screen.getByRole('button', { name: 'CLEAR' }));
        expect(mock.api.logs.clear).toHaveBeenCalledTimes(1);
        expect(mock.api.logs.clear).toHaveBeenCalledWith('yt-dlp');
        expect(screen.getByText('Nothing recorded yet. The lines show up here as soon as the program runs.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'CLEAR' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'COPY' })).toBeDisabled();
    });

    it('has no tabs for one program', async () => {
        setup(['ffmpeg']);
        await screen.findByText('Nothing recorded yet. The lines show up here as soon as the program runs.');
        expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
        expect(mock.api.logs.watch).toHaveBeenCalledWith('ffmpeg', expect.any(Function));
    });

    it('has a tab per program, shows the first one, and switches, keeping the filter and the search', async () => {
        snapshotOf({
            suwayomi: [{ id: 1, at: AT, stream: 'stdout', text: '10:00:00.000 [main] ERROR server - boom' }],
            flaresolverr: [
                { id: 2, at: AT, stream: 'stdout', text: '2026-11-11 10:00:00 ERROR    Chrome crashed' },
                { id: 3, at: AT, stream: 'stdout', text: '2026-11-11 10:00:01 INFO     Serving' }
            ]
        });
        const { user } = setup(['suwayomi', 'flaresolverr']);
        const tablist = screen.getByRole('tablist', { name: 'Programs' });
        const tabs = within(tablist).getAllByRole('tab');
        expect(
            tabs.map((tab) => {
                return [tab.textContent, tab.getAttribute('aria-selected'), tab.className];
            })
        ).toEqual([
            ['Suwayomi', 'true', 'btn btn--small logs__tab logs__tab--active'],
            ['FlareSolverr', 'false', 'btn btn--small logs__tab']
        ]);
        await screen.findByRole('list', { name: 'Lines of the log of Suwayomi' });
        await user.selectOptions(screen.getByLabelText('Show'), 'errors');
        await user.click(within(tablist).getByRole('tab', { name: 'FlareSolverr' }));
        await screen.findByRole('list', { name: 'Lines of the log of FlareSolverr' });
        expect(shownTexts()).toEqual(['2026-11-11 10:00:00 ERROR    Chrome crashed']);
        expect(screen.getByLabelText('Show')).toHaveValue('errors');
        expect(within(tablist).getByRole('tab', { name: 'FlareSolverr' })).toHaveAttribute('aria-selected', 'true');
        const stopSuwayomi = mock.api.logs.watch.mock.results[0]?.value as ReturnType<typeof vi.fn>;
        expect(mock.api.logs.watch.mock.calls[0]?.[0]).toBe('suwayomi');
        expect(stopSuwayomi).toHaveBeenCalledTimes(1);
    });

    it('closes with its button, with Esc (not heard behind it), and with a click outside, but not with a click inside', async () => {
        const { user, onClose, outside } = setup();
        await screen.findByText('Nothing recorded yet. The lines show up here as soon as the program runs.');
        await user.click(screen.getByRole('button', { name: 'CLOSE' }));
        expect(onClose).toHaveBeenCalledTimes(1);
        await user.keyboard('{Escape}');
        expect(onClose).toHaveBeenCalledTimes(2);
        expect(outside).not.toHaveBeenCalled();
        await user.click(screen.getByRole('dialog'));
        expect(onClose).toHaveBeenCalledTimes(2);
        await user.click(document.querySelector('.modal-backdrop') as HTMLElement);
        expect(onClose).toHaveBeenCalledTimes(3);
    });

    it('stops watching the program when it closes', async () => {
        const { unmount } = setup();
        await screen.findByText('Nothing recorded yet. The lines show up here as soon as the program runs.');
        const stop = mock.api.logs.watch.mock.results[0]?.value as ReturnType<typeof vi.fn>;
        unmount();
        expect(stop).toHaveBeenCalledTimes(1);
    });

    it('follows the new lines while the list is at its end, and offers to go back to the end when it is not', async () => {
        snapshotOf({ 'yt-dlp': YTDLP_LINES });
        const { user } = setup();
        const list = await screen.findByRole('list');
        Object.defineProperty(list, 'scrollHeight', { value: 1000, configurable: true });
        Object.defineProperty(list, 'clientHeight', { value: 200, configurable: true });
        act(() => {
            mock.emitLogLines('yt-dlp', [{ id: 10, at: AT, stream: 'stdout', text: 'new' }]);
        });
        expect(list.scrollTop).toBe(1000);
        expect(screen.queryByRole('button', { name: 'GO TO THE END' })).not.toBeInTheDocument();
        act(() => {
            list.scrollTop = 100;
            list.dispatchEvent(new Event('scroll'));
        });
        const follow = screen.getByRole('button', { name: 'GO TO THE END' });
        expect(follow).toHaveClass('btn', 'btn--small', 'logs__follow');
        act(() => {
            mock.emitLogLines('yt-dlp', [{ id: 11, at: AT, stream: 'stdout', text: 'newer' }]);
        });
        expect(list.scrollTop).toBe(100);
        await user.click(follow);
        expect(list.scrollTop).toBe(1000);
        expect(screen.queryByRole('button', { name: 'GO TO THE END' })).not.toBeInTheDocument();
        act(() => {
            list.scrollTop = 790;
            list.dispatchEvent(new Event('scroll'));
        });
        expect(screen.queryByRole('button', { name: 'GO TO THE END' })).not.toBeInTheDocument();
    });

    it('puts the focus in the window when it opens', async () => {
        setup(['suwayomi', 'flaresolverr']);
        await waitFor(() => {
            expect(screen.getByRole('tab', { name: 'Suwayomi' })).toHaveFocus();
        });
    });
});
