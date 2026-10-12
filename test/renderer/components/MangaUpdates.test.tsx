// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
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
        answer({ ok: true, count: 0, titles: [], failed: 0 });
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
