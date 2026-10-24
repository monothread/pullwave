// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SETTINGS } from '@shared/constants';
import type { ReadingEntry } from '@shared/manga';
import { MangaHistory } from '@renderer/components/MangaHistory';
import { useAppStore } from '@renderer/store/appStore';
import { useMangaStore } from '@renderer/store/mangaStore';
import { makeLibraryManga } from '../../helpers/mangaFixtures';
import { answerDialog, confirmDialog } from '../../helpers/confirmDialog';
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

function line(overrides: Partial<ReadingEntry> = {}): ReadingEntry {
    return { id: 4, sourceId: '123', mangaRemoteId: 7, title: 'One Piece', thumbnailUrl: '/api/v1/manga/7/thumbnail', chapterRemoteId: 11, chapterName: 'Romance Dawn', chapterNumber: 1, page: 3, pageCount: 20, readAt: at(0, 10), libraryMangaId: null, ...overrides };
}

beforeEach(() => {
    mock = installMockApi();
    useAppStore.setState({ ...initialApp, settings: DEFAULT_SETTINGS, toasts: [] });
    useMangaStore.setState({ ...initialManga, history: [], library: [] });
});

describe('MangaHistory', () => {
    it('reads the history when it opens', async () => {
        mock.api.manga.readingHistory.mockResolvedValue([line()]);
        render(<MangaHistory />);
        expect(await screen.findByTestId('manga-history-entry')).toBeInTheDocument();
        expect(mock.api.manga.readingHistory).toHaveBeenCalledTimes(1);
    });

    it('says nothing was read yet, with no button to clear', () => {
        render(<MangaHistory />);
        expect(screen.getByText('Nothing read yet. The mangas you read are listed here, with where you stopped.')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'CLEAR HISTORY' })).not.toBeInTheDocument();
    });

    it('shows each manga with its cover and the chapter and page it was left on (the pages count from 1)', async () => {
        mock.api.manga.readingHistory.mockResolvedValue([line()]);
        render(<MangaHistory />);
        const row = await screen.findByTestId('manga-history-entry');
        expect(within(row).getByRole('button', { name: 'Open: One Piece' })).toHaveTextContent('One Piece');
        expect(row.querySelector('img.cover')).toHaveAttribute('src', '/api/v1/manga/7/thumbnail');
        expect(within(row).getByText('Romance Dawn · page 4 of 20')).toBeInTheDocument();
        expect(within(row).queryByText('IN THE LIBRARY')).not.toBeInTheDocument();
    });

    it('says a manga that is in the library is, and names a chapter with no name by its number', async () => {
        mock.api.manga.readingHistory.mockResolvedValue([line({ libraryMangaId: 9, chapterName: '', chapterNumber: 2, page: 0, pageCount: 1 })]);
        render(<MangaHistory />);
        const row = await screen.findByTestId('manga-history-entry');
        expect(within(row).getByText('IN THE LIBRARY')).toHaveClass('badge--done');
        expect(within(row).getByText('#2 · page 1 of 1')).toBeInTheDocument();
    });

    it('splits the list by day', async () => {
        mock.api.manga.readingHistory.mockResolvedValue([line({ id: 1, readAt: at(0, 12) }), line({ id: 2, title: 'Bleach', readAt: at(1, 9) }), line({ id: 3, title: 'Naruto', readAt: at(3, 9) })]);
        render(<MangaHistory />);
        await screen.findAllByTestId('manga-history-day');
        const days = screen.getAllByTestId('manga-history-day');
        expect(
            days.map((day) => {
                return [day.getAttribute('aria-label'), within(day).getAllByTestId('manga-history-entry').length];
            })
        ).toEqual([
            ['Today', 1],
            ['Yesterday', 1],
            [new Date(at(3, 9)).toLocaleDateString(), 1]
        ]);
    });

    it('opens a manga of the library on its page there', async () => {
        const user = userEvent.setup();
        useMangaStore.setState({ library: [makeLibraryManga([], { id: 9, title: 'One Piece' })] });
        mock.api.manga.readingHistory.mockResolvedValue([line({ libraryMangaId: 9 })]);
        mock.api.manga.details.mockResolvedValue({ ok: false, error: { code: 'REQUEST_FAILED', message: 'x' } });
        render(<MangaHistory />);
        await user.click(await screen.findByRole('button', { name: 'Open: One Piece' }));
        expect(useMangaStore.getState().view).toBe('library');
        expect(useMangaStore.getState().selectionFrom).toBe('library');
    });

    it('opens a manga that is not in the library on its source', async () => {
        const user = userEvent.setup();
        mock.api.manga.readingHistory.mockResolvedValue([line()]);
        mock.api.manga.details.mockResolvedValue({ ok: false, error: { code: 'REQUEST_FAILED', message: 'x' } });
        render(<MangaHistory />);
        await user.click(await screen.findByRole('button', { name: 'Open: One Piece' }));
        expect(useMangaStore.getState().view).toBe('browse');
        expect(useMangaStore.getState().selectionFrom).toBe('browse');
    });

    it('removes one line', async () => {
        const user = userEvent.setup();
        mock.api.manga.readingHistory.mockResolvedValue([line({ id: 4 }), line({ id: 5, title: 'Bleach' })]);
        render(<MangaHistory />);
        await user.click(await screen.findByRole('button', { name: 'Remove from the history: Bleach' }));
        expect(mock.api.manga.removeReading).not.toHaveBeenCalled();
        expect(within(confirmDialog('Remove "Bleach" from the history?')).getByText('Only the entry goes. Nothing is deleted from the disk.')).toBeInTheDocument();
        await answerDialog(user, 'Remove "Bleach" from the history?', 'REMOVE');
        expect(mock.api.manga.removeReading).toHaveBeenCalledWith(5);
        expect(screen.getAllByTestId('manga-history-entry')).toHaveLength(1);
    });

    it('clears the history after asking in a window, and only if it is confirmed', async () => {
        const user = userEvent.setup();
        mock.api.manga.readingHistory.mockResolvedValue([line()]);
        render(<MangaHistory />);
        await screen.findByTestId('manga-history-entry');
        await user.click(screen.getByRole('button', { name: 'CLEAR HISTORY' }));
        const dialog = screen.getByRole('dialog', { name: 'Clear the history of reading?' });
        expect(dialog).toHaveTextContent('Only the list goes. Nothing is removed from the library or from the disk.');
        await user.click(within(dialog).getByRole('button', { name: 'KEEP' }));
        expect(mock.api.manga.clearReading).not.toHaveBeenCalled();
        await user.click(screen.getByRole('button', { name: 'CLEAR HISTORY' }));
        await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'REMOVE' }));
        expect(mock.api.manga.clearReading).toHaveBeenCalledTimes(1);
        expect(screen.queryByTestId('manga-history-entry')).not.toBeInTheDocument();
    });

    it('is a region named after the tab', () => {
        render(<MangaHistory />);
        expect(screen.getByRole('region', { name: 'HISTORY' })).toBeInTheDocument();
    });
});
