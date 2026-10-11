// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { MangaLibrary } from '@renderer/components/MangaLibrary';
import { useAppStore } from '@renderer/store/appStore';
import { useMangaStore } from '@renderer/store/mangaStore';
import { makeChapterRecord, makeLibraryManga } from '../../helpers/mangaFixtures';
import { installMockApi, type MockApiHandle } from '../../helpers/mockApi';

let mock: MockApiHandle;
const initialApp = useAppStore.getState();
const initialManga = useMangaStore.getState();

const ONE_PIECE = makeLibraryManga(
    [
        makeChapterRecord({ id: 1, remoteId: 11, name: 'Romance Dawn', status: 'done' }),
        makeChapterRecord({ id: 2, remoteId: 12, name: '', number: 2, status: 'error', error: { code: 'IMAGE', message: 'page 3' } }),
        makeChapterRecord({ id: 3, remoteId: 13, name: 'Third', status: 'idle' }),
        makeChapterRecord({ id: 4, remoteId: 14, name: 'Fourth', status: 'downloading' }),
        makeChapterRecord({ id: 5, remoteId: 15, name: 'Fifth', status: 'paused' })
    ],
    { id: 9 }
);

beforeEach(() => {
    mock = installMockApi();
    useAppStore.setState({ ...initialApp, settings: DEFAULT_SETTINGS, toasts: [] });
    useMangaStore.setState({ ...initialManga, library: [] });
});

describe('MangaLibrary', () => {
    it('says the library is empty', () => {
        render(<MangaLibrary />);
        expect(screen.getByText('Your library is empty. Open a manga in BROWSE and add it, or download some chapters.')).toBeInTheDocument();
    });

    it('lists the mangas with how many chapters are downloaded', () => {
        useMangaStore.setState({ library: [ONE_PIECE, makeLibraryManga([], { id: 10, title: 'Bleach', thumbnailUrl: null })] });
        render(<MangaLibrary />);
        const entries = screen.getAllByTestId('manga-entry');
        expect(entries).toHaveLength(2);
        expect(within(entries[0]!).getByRole('heading', { name: 'One Piece' })).toBeInTheDocument();
        expect(within(entries[0]!).getByText('1 of 5 downloaded')).toBeInTheDocument();
        expect(within(entries[1]!).getByText('0 of 0 downloaded')).toBeInTheDocument();
        expect(within(entries[1]!).queryByRole('button', { name: 'DOWNLOAD MISSING' })).not.toBeInTheDocument();
        expect(entries[1]!.querySelector('img')).toBeNull();
    });

    it('has no button to download what is missing in the list: that is done inside the manga', () => {
        useMangaStore.setState({ library: [ONE_PIECE] });
        render(<MangaLibrary />);
        expect(screen.queryByRole('button', { name: 'DOWNLOAD MISSING' })).not.toBeInTheDocument();
    });

    it('opens the folder', async () => {
        const user = userEvent.setup();
        useMangaStore.setState({ library: [ONE_PIECE] });
        render(<MangaLibrary />);
        await user.click(screen.getByRole('button', { name: 'OPEN FOLDER' }));
        expect(mock.api.manga.openFolder).toHaveBeenCalledWith(9);
    });

    it('has no list of chapters in the card: the manga is opened by clicking on it', () => {
        useMangaStore.setState({ library: [ONE_PIECE] });
        render(<MangaLibrary />);
        expect(screen.queryByRole('button', { name: 'Show chapters' })).not.toBeInTheDocument();
        expect(screen.queryByText('Romance Dawn')).not.toBeInTheDocument();
    });

    it('opens the manga with its chapters when its card is clicked, and comes back to the library', async () => {
        const user = userEvent.setup();
        mock.api.manga.details.mockResolvedValue({
            ok: true,
            value: { details: { remoteId: 7, sourceId: '123', title: 'One Piece', thumbnailUrl: null, author: 'Oda', artist: null, description: null, genres: [], status: 'ongoing' }, chapters: [] }
        });
        useMangaStore.setState({ library: [ONE_PIECE], view: 'library' });
        render(<MangaLibrary />);
        await user.click(screen.getByRole('button', { name: 'Open: One Piece' }));
        expect(useMangaStore.getState().selectionFrom).toBe('library');
        expect(mock.api.manga.details).toHaveBeenCalledWith(7);
        expect(useMangaStore.getState().selection?.manga).toEqual({ remoteId: 7, sourceId: '123', title: 'One Piece', thumbnailUrl: ONE_PIECE.thumbnailUrl });
        expect(await screen.findByText(/^Author:/)).toHaveTextContent('Author: Oda');
        await user.click(screen.getByRole('button', { name: '← BACK' }));
        expect(screen.getByRole('button', { name: 'Open: One Piece' })).toBeInTheDocument();
    });

    it('asks before removing a manga, and removes it only when confirmed', async () => {
        const user = userEvent.setup();
        useMangaStore.setState({ library: [ONE_PIECE] });
        render(<MangaLibrary />);
        await user.click(screen.getByRole('button', { name: 'REMOVE' }));
        expect(mock.api.manga.removeManga).not.toHaveBeenCalled();
        expect(screen.queryByRole('button', { name: 'REMOVE' })).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'REMOVE WITH FILES?' }));
        expect(mock.api.manga.removeManga).toHaveBeenCalledWith(9);
    });

    it('keeps the manga when the removal is called off', async () => {
        const user = userEvent.setup();
        useMangaStore.setState({ library: [ONE_PIECE] });
        render(<MangaLibrary />);
        await user.click(screen.getByRole('button', { name: 'REMOVE' }));
        await user.click(screen.getByRole('button', { name: 'KEEP' }));
        expect(mock.api.manga.removeManga).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: 'REMOVE' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'KEEP' })).not.toBeInTheDocument();
    });
});

describe('MangaLibrary and the manga opened from the browse', () => {
    it('shows the list of the library, not the manga that is open in the browse', () => {
        useMangaStore.setState({
            library: [ONE_PIECE],
            view: 'library',
            selectionFrom: 'browse',
            selection: { manga: { remoteId: 7, sourceId: '123', title: 'One Piece', thumbnailUrl: null }, status: 'loading', details: null, chapters: [], selected: [], error: null }
        });
        render(<MangaLibrary />);
        expect(screen.getByTestId('manga-entry')).toBeInTheDocument();
    });
});
