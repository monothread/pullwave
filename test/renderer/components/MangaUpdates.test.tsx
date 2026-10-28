// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SETTINGS } from '@shared/constants';
import type { MangaUpdateEntry } from '@shared/manga';
import { MangaUpdates } from '@renderer/components/MangaUpdates';
import { useAppStore } from '@renderer/store/appStore';
import { useMangaStore } from '@renderer/store/mangaStore';
import { makeLibraryManga } from '../../helpers/mangaFixtures';
import { installMockApi, type MockApiHandle } from '../../helpers/mockApi';

let mock: MockApiHandle;
const initialApp = useAppStore.getState();
const initialManga = useMangaStore.getState();

function at(daysAgo: number, hour: number): number {
    const day = new Date();
    day.setDate(day.getDate() - daysAgo);
    day.setHours(hour, 15, 0, 0);
    return day.getTime();
}

function entry(overrides: Partial<MangaUpdateEntry> = {}): MangaUpdateEntry {
    return { id: 1, mangaId: 9, mangaTitle: 'One Piece', thumbnailUrl: 'pullwave-manga://cover/9?v=abc', chapterId: 3, chapterRemoteId: 13, chapterName: 'The Great Race', chapterNumber: 3, dateUploaded: null, foundAt: at(0, 10), origin: 'auto', status: 'idle', ...overrides };
}

beforeEach(() => {
    mock = installMockApi();
    useAppStore.setState({ ...initialApp, settings: DEFAULT_SETTINGS, toasts: [] });
    useMangaStore.setState({ ...initialManga, updates: [], checkingNew: null, library: [makeLibraryManga([], { id: 9 })] });
});

describe('MangaUpdates', () => {
    it('reads the chapters that arrived when it opens', async () => {
        mock.api.manga.updates.mockResolvedValue([entry()]);
        render(<MangaUpdates />);
        expect(await screen.findByTestId('manga-update')).toBeInTheDocument();
        expect(mock.api.manga.updates).toHaveBeenCalledTimes(1);
    });

    it('says there is nothing yet, and what fills the list', () => {
        render(<MangaUpdates />);
        expect(screen.getByText('No new chapters yet. The check that runs every hour, and the buttons that look for new chapters, list here what they find.')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'CLEAR LIST' })).not.toBeInTheDocument();
        expect(screen.queryByTestId('manga-update-day')).not.toBeInTheDocument();
    });

    it('shows each chapter with its manga, its cover, when it was found, how it came and its state', async () => {
        mock.api.manga.updates.mockResolvedValue([entry({ origin: 'manual', status: 'done' })]);
        render(<MangaUpdates />);
        const row = await screen.findByTestId('manga-update');
        expect(within(row).getByRole('button', { name: 'Open: One Piece The Great Race' })).toHaveTextContent('One Piece');
        expect(row.querySelector('img.cover')).toHaveAttribute('src', 'pullwave-manga://cover/9?v=abc');
        expect(within(row).getByText(/^The Great Race · Found at /)).toBeInTheDocument();
        expect(within(row).getByText('MANUAL')).toBeInTheDocument();
        expect(within(row).getByText('Downloaded')).toHaveClass('badge--done');
    });

    it.each([
        ['auto', 'AUTOMATIC'],
        ['manual', 'MANUAL'],
        ['move', 'SOURCE MOVE']
    ] as const)('says a chapter that came by %s is %s', async (origin, label) => {
        mock.api.manga.updates.mockResolvedValue([entry({ origin })]);
        render(<MangaUpdates />);
        expect(await screen.findByText(label)).toBeInTheDocument();
    });

    it('names a chapter that has no name by its number', async () => {
        mock.api.manga.updates.mockResolvedValue([entry({ chapterName: '', chapterNumber: 7 })]);
        render(<MangaUpdates />);
        expect(await screen.findByText(/^#7 · Found at /)).toBeInTheDocument();
    });

    it('splits the list by day, with today and yesterday said and the older days by their date', async () => {
        mock.api.manga.updates.mockResolvedValue([entry({ id: 1, foundAt: at(0, 12) }), entry({ id: 2, foundAt: at(0, 9) }), entry({ id: 3, foundAt: at(1, 22) }), entry({ id: 4, foundAt: at(5, 8) })]);
        render(<MangaUpdates />);
        await screen.findAllByTestId('manga-update-day');
        const days = screen.getAllByTestId('manga-update-day');
        expect(days).toHaveLength(3);
        expect(days[0]).toHaveAccessibleName('Today');
        expect(within(days[0]!).getAllByTestId('manga-update')).toHaveLength(2);
        expect(days[1]).toHaveAccessibleName('Yesterday');
        expect(within(days[1]!).getAllByTestId('manga-update')).toHaveLength(1);
        expect(days[2]).toHaveAccessibleName(new Date(at(5, 8)).toLocaleDateString());
    });

    it('opens the manga in the library when a chapter is clicked', async () => {
        const user = userEvent.setup();
        mock.api.manga.updates.mockResolvedValue([entry()]);
        mock.api.manga.details.mockResolvedValue({ ok: false, error: { code: 'REQUEST_FAILED', message: 'x' } });
        render(<MangaUpdates />);
        await user.click(await screen.findByRole('button', { name: 'Open: One Piece The Great Race' }));
        expect(useMangaStore.getState().view).toBe('library');
        expect(useMangaStore.getState().selection?.manga.remoteId).toBe(7);
    });

    it('looks for new chapters in all the mangas, and cannot be asked twice at the same time', async () => {
        const user = userEvent.setup();
        let answer: (value: unknown) => void = () => {
            return undefined;
        };
        mock.api.manga.checkNewChapters.mockReturnValue(
            new Promise((resolve) => {
                answer = resolve;
            })
        );
        render(<MangaUpdates />);
        await user.click(screen.getByRole('button', { name: 'LOOK FOR NEW CHAPTERS' }));
        expect(mock.api.manga.checkNewChapters).toHaveBeenCalledWith(null);
        const working = screen.getByRole('button', { name: 'LOOKING…' });
        expect(working).toBeDisabled();
        answer({ ok: true, count: 0, titles: [], failed: 0, skipped: 0 });
        expect(await screen.findByRole('button', { name: 'LOOK FOR NEW CHAPTERS' })).toBeEnabled();
    });

    it('disables the button while one manga is being looked at', () => {
        useMangaStore.setState({ checkingNew: 9 });
        render(<MangaUpdates />);
        expect(screen.getByRole('button', { name: 'LOOK FOR NEW CHAPTERS' })).toBeDisabled();
    });

    it('clears the list after asking in a window, and only if it is confirmed', async () => {
        const user = userEvent.setup();
        mock.api.manga.updates.mockResolvedValue([entry()]);
        render(<MangaUpdates />);
        await screen.findByTestId('manga-update');
        await user.click(screen.getByRole('button', { name: 'CLEAR LIST' }));
        const dialog = screen.getByRole('dialog', { name: 'Clear the list of new chapters?' });
        expect(dialog).toHaveTextContent('Only the list goes. Nothing is removed from the library or from the disk.');
        await user.click(within(dialog).getByRole('button', { name: 'KEEP' }));
        expect(mock.api.manga.clearUpdates).not.toHaveBeenCalled();
        await user.click(screen.getByRole('button', { name: 'CLEAR LIST' }));
        await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'REMOVE' }));
        expect(mock.api.manga.clearUpdates).toHaveBeenCalledTimes(1);
        expect(screen.queryByTestId('manga-update')).not.toBeInTheDocument();
    });

    it('is a region named after the tab', () => {
        render(<MangaUpdates />);
        expect(screen.getByRole('region', { name: 'UPDATES' })).toBeInTheDocument();
    });
});

describe('MangaUpdates while a check is going on', () => {
    const AUTO = { running: true, origin: 'auto', done: 7, total: 40, current: 'Dr. STONE' } as const;
    const MANUAL = { running: true, origin: 'manual', done: 2, total: 5, current: 'One Piece' } as const;
    const IDLE = { running: false, origin: null, done: 0, total: 0, current: null } as const;

    it('shows nothing about a check, and has the button ready, when none is going on', () => {
        render(<MangaUpdates />);

        expect(screen.getByRole('button', { name: 'LOOK FOR NEW CHAPTERS' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'LOOK FOR NEW CHAPTERS' })).not.toHaveAttribute('title');
        expect(screen.queryByTestId('manga-check-current')).not.toBeInTheDocument();
    });

    it('turns the button off and says the hourly look is going on, how far it is and which manga it asks about', () => {
        useMangaStore.setState({ checkState: AUTO });
        render(<MangaUpdates />);

        const button = screen.getByRole('button', { name: 'AUTOMATIC LOOK… 7/40' });
        expect(button).toBeDisabled();
        expect(button).toHaveAttribute('title', 'The look every hour is going on. Wait for it to end.');
        const current = screen.getByTestId('manga-check-current');
        expect(current).toHaveTextContent('Now: Dr. STONE');
        expect(current).toHaveAttribute('role', 'status');
        expect(current).toHaveAttribute('title', 'Dr. STONE');
    });

    it('turns the button off too for the look the user asked for, with its progress and no explanation of the hourly one', () => {
        useMangaStore.setState({ checkState: MANUAL });
        render(<MangaUpdates />);

        const button = screen.getByRole('button', { name: 'LOOKING… 2/5' });
        expect(button).toBeDisabled();
        expect(button).not.toHaveAttribute('title');
        expect(screen.getByTestId('manga-check-current')).toHaveTextContent('Now: One Piece');
    });

    it('says only that it is looking while the main process has not said how many mangas there are', () => {
        useMangaStore.setState({ checkState: { running: true, origin: 'auto', done: 0, total: 0, current: null } });
        render(<MangaUpdates />);

        expect(screen.getByRole('button', { name: 'LOOKING…' })).toBeDisabled();
        expect(screen.queryByTestId('manga-check-current')).not.toBeInTheDocument();
    });

    it('does not ask for another check when the button is pressed meanwhile', () => {
        useMangaStore.setState({ checkState: AUTO });
        render(<MangaUpdates />);

        fireEvent.click(screen.getByRole('button', { name: 'AUTOMATIC LOOK… 7/40' }));

        expect(mock.api.manga.checkNewChapters).not.toHaveBeenCalled();
    });

    it('follows the check: the manga changes, and when it ends the button is ready and the indicator is gone', () => {
        useMangaStore.setState({ checkState: AUTO });
        render(<MangaUpdates />);

        act(() => {
            useMangaStore.setState({ checkState: { ...AUTO, done: 8, current: 'Bleach' } });
        });
        expect(screen.getByRole('button', { name: 'AUTOMATIC LOOK… 8/40' })).toBeDisabled();
        expect(screen.getByTestId('manga-check-current')).toHaveTextContent('Now: Bleach');

        act(() => {
            useMangaStore.setState({ checkState: IDLE });
        });
        expect(screen.getByRole('button', { name: 'LOOK FOR NEW CHAPTERS' })).toBeEnabled();
        expect(screen.queryByTestId('manga-check-current')).not.toBeInTheDocument();
    });
});

