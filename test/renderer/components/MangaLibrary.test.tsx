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
        // Alphabetical, whatever the order the library comes in.
        expect(within(entries[0]!).getByRole('heading', { name: 'Bleach' })).toBeInTheDocument();
        expect(within(entries[0]!).getByText('0 of 0 downloaded')).toBeInTheDocument();
        expect(within(entries[0]!).queryByRole('button', { name: 'DOWNLOAD MISSING' })).not.toBeInTheDocument();
        expect(entries[0]!.querySelector('img')).toBeNull();
        expect(within(entries[1]!).getByRole('heading', { name: 'One Piece' })).toBeInTheDocument();
        expect(within(entries[1]!).getByText('1 of 5 downloaded')).toBeInTheDocument();
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

describe('MangaLibrary series, groups and search', () => {
    const FRIEREN = makeLibraryManga([makeChapterRecord({ id: 20, status: 'done' })], { id: 20, remoteId: 21, title: 'Frieren', series: 'Sousou no Frieren', season: 1, groupIds: [1] });
    const FRIEREN_2 = makeLibraryManga([makeChapterRecord({ id: 21, status: 'idle' })], { id: 21, remoteId: 22, title: 'Frieren 2', series: 'Sousou no Frieren', season: 2, groupIds: [1] });
    const BLEACH = makeLibraryManga([], { id: 22, remoteId: 23, title: 'Bleach', groupIds: [2] });
    const GROUPS = [{ id: 1, name: 'Mangas' }, { id: 2, name: 'Manhwas' }];

    beforeEach(() => {
        useMangaStore.setState({ library: [FRIEREN_2, BLEACH, FRIEREN], groups: GROUPS, libraryGroup: null, librarySeries: null });
        mock.api.manga.library.mockResolvedValue([FRIEREN_2, BLEACH, FRIEREN]);
        mock.api.manga.groups.mockResolvedValue(GROUPS);
    });

    it('shows a series of several seasons as one card, and a manga on its own as a card of its own, in alphabetical order', () => {
        render(<MangaLibrary />);
        expect(screen.getByText('Library (2)')).toBeInTheDocument();
        expect(screen.getAllByTestId('manga-entry')).toHaveLength(1);
        expect(screen.getAllByTestId('manga-series')).toHaveLength(1);
        const series = screen.getByTestId('manga-series');
        expect(within(series).getByRole('heading', { name: 'Sousou no Frieren' })).toBeInTheDocument();
        expect(within(series).getByText('2 SEASONS')).toBeInTheDocument();
        expect(within(series).getByText('1 of 2 downloaded')).toBeInTheDocument();
        expect(within(screen.getByTestId('manga-entry')).getByRole('heading', { name: 'Bleach' })).toBeInTheDocument();
        const order = screen.getAllByRole('heading', { level: 3 }).map((heading) => {
            return heading.textContent;
        });
        expect(order).toEqual(['Bleach', 'Sousou no Frieren']);
    });

    it('says one season in the singular for a series with only one', () => {
        useMangaStore.setState({ library: [FRIEREN] });
        render(<MangaLibrary />);
        expect(screen.getByText('1 SEASON')).toBeInTheDocument();
    });

    it('opens a series on its own screen and comes back to the cards', async () => {
        const user = userEvent.setup();
        render(<MangaLibrary />);
        await user.click(screen.getByRole('button', { name: 'Open series: Sousou no Frieren' }));
        expect(useMangaStore.getState().librarySeries).toBe('series-sousou no frieren');
        expect(screen.getByTestId('manga-series-view')).toBeInTheDocument();
        expect(screen.getAllByTestId('manga-season')).toHaveLength(2);
        await user.click(screen.getByRole('button', { name: 'BACK TO LIBRARY' }));
        expect(useMangaStore.getState().librarySeries).toBeNull();
        expect(screen.getByTestId('manga-series')).toBeInTheDocument();
    });

    it('goes on with the series under its new name after it is renamed', async () => {
        const user = userEvent.setup();
        useMangaStore.setState({ librarySeries: 'series-sousou no frieren' });
        mock.api.manga.library.mockResolvedValue([{ ...FRIEREN_2, series: 'Frieren' }, BLEACH, { ...FRIEREN, series: 'Frieren' }]);
        render(<MangaLibrary />);
        await user.click(screen.getByRole('button', { name: 'Series options: Sousou no Frieren' }));
        await user.click(screen.getByRole('button', { name: 'RENAME SERIES: Sousou no Frieren' }));
        const field = screen.getByLabelText('Series name');
        await user.clear(field);
        await user.type(field, 'Frieren');
        await user.click(screen.getByRole('button', { name: 'SAVE' }));
        await vi.waitFor(() => {
            expect(useMangaStore.getState().librarySeries).toBe('series-frieren');
        });
        expect(await screen.findByRole('heading', { name: 'Frieren', level: 3 })).toBeInTheDocument();
    });

    it('falls back to the cards when the series that is open is not there any more', () => {
        useMangaStore.setState({ librarySeries: 'series-gone' });
        render(<MangaLibrary />);
        expect(screen.getByTestId('manga-series')).toBeInTheDocument();
    });

    it('searches by the title of a manga and by the name of a series, without regard to case or accents', async () => {
        const user = userEvent.setup();
        render(<MangaLibrary />);
        const field = screen.getByLabelText('Search the library');
        await user.type(field, 'SOUSOU');
        expect(screen.queryByTestId('manga-entry')).not.toBeInTheDocument();
        expect(screen.getByTestId('manga-series')).toBeInTheDocument();
        await user.clear(field);
        await user.type(field, 'bléach');
        expect(screen.getByTestId('manga-entry')).toBeInTheDocument();
        expect(screen.queryByTestId('manga-series')).not.toBeInTheDocument();
        await user.clear(field);
        await user.type(field, 'zzz');
        expect(screen.getByText('// NO MANGA IN THE LIBRARY MATCHES THIS SEARCH.')).toBeInTheDocument();
    });

    it('lists the groups as tabs with all of them first, and limits the library to the one picked', async () => {
        const user = userEvent.setup();
        render(<MangaLibrary />);
        const nav = screen.getByRole('navigation', { name: 'Groups' });
        expect(
            within(nav)
                .getAllByRole('button')
                .map((button) => {
                    return button.textContent;
                })
        ).toEqual(['ALL', 'Mangas', 'Manhwas']);
        expect(within(nav).getByRole('button', { name: 'ALL' })).toHaveAttribute('aria-current', 'page');
        await user.click(within(nav).getByRole('button', { name: 'Manhwas' }));
        expect(useMangaStore.getState().libraryGroup).toBe(2);
        expect(screen.getByTestId('manga-entry')).toBeInTheDocument();
        expect(screen.queryByTestId('manga-series')).not.toBeInTheDocument();
        expect(within(nav).getByRole('button', { name: 'Manhwas' })).toHaveAttribute('aria-current', 'page');
        await user.click(within(nav).getByRole('button', { name: 'Mangas' }));
        expect(screen.getByTestId('manga-series')).toBeInTheDocument();
        expect(screen.queryByTestId('manga-entry')).not.toBeInTheDocument();
        await user.click(within(nav).getByRole('button', { name: 'ALL' }));
        expect(useMangaStore.getState().libraryGroup).toBeNull();
        expect(screen.getAllByTestId('manga-entry')).toHaveLength(1);
        expect(screen.getAllByTestId('manga-series')).toHaveLength(1);
    });

    it('has no tabs while there are no groups', () => {
        useMangaStore.setState({ groups: [] });
        render(<MangaLibrary />);
        expect(screen.queryByRole('navigation', { name: 'Groups' })).not.toBeInTheDocument();
    });

    it('says a group has nothing in it yet', () => {
        useMangaStore.setState({ library: [FRIEREN, FRIEREN_2], libraryGroup: 2 });
        render(<MangaLibrary />);
        expect(screen.getByText('// NO MANGA IN THIS GROUP YET. OPEN A MANGA OR A SERIES TO PUT IT HERE.')).toBeInTheDocument();
    });

    it('searches inside the group', async () => {
        const user = userEvent.setup();
        useMangaStore.setState({ libraryGroup: 2 });
        render(<MangaLibrary />);
        await user.type(screen.getByLabelText('Search the library'), 'frieren');
        expect(screen.getByText('// NO MANGA IN THE LIBRARY MATCHES THIS SEARCH.')).toBeInTheDocument();
    });

    it('shows the groups a manga is in, beside its progress', () => {
        useMangaStore.setState({ library: [BLEACH] });
        render(<MangaLibrary />);
        expect(screen.getByTestId('manga-entry-groups')).toHaveTextContent('Manhwas');
    });

    it('shows nothing about groups for a manga that is in none', () => {
        useMangaStore.setState({ library: [makeLibraryManga([], { id: 30, title: 'Naruto' })] });
        render(<MangaLibrary />);
        expect(screen.queryByTestId('manga-entry-groups')).not.toBeInTheDocument();
    });

    it('opens and closes the panel to manage the groups', async () => {
        const user = userEvent.setup();
        render(<MangaLibrary />);
        const button = screen.getByRole('button', { name: 'MANAGE GROUPS' });
        expect(button).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByText('No group yet.')).not.toBeInTheDocument();
        await user.click(button);
        expect(button).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getAllByTestId('manga-group')).toHaveLength(2);
        await user.click(button);
        expect(screen.queryByTestId('manga-group')).not.toBeInTheDocument();
    });
});
