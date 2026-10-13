// @vitest-environment jsdom
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { MangaLibrary } from '@renderer/components/MangaLibrary';
import { useAppStore } from '@renderer/store/appStore';
import { useMangaStore } from '@renderer/store/mangaStore';
import { makeChapterRecord, makeLibraryManga, makeSource } from '../../helpers/mangaFixtures';
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
    useMangaStore.setState({ ...initialManga, library: [], hiddenGroupIds: [] });
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
        expect(within(entries[0]!).queryByRole('button', { name: 'DOWNLOAD SEASON' })).not.toBeInTheDocument();
        expect(entries[0]!.querySelector('img')).toBeNull();
        expect(within(entries[1]!).getByRole('heading', { name: 'One Piece' })).toBeInTheDocument();
        expect(within(entries[1]!).getByText('1 of 5 downloaded')).toBeInTheDocument();
    });

    it('has no button to download what is missing in the list: that is done inside the manga', () => {
        useMangaStore.setState({ library: [ONE_PIECE] });
        render(<MangaLibrary />);
        expect(screen.queryByRole('button', { name: 'DOWNLOAD SEASON' })).not.toBeInTheDocument();
    });

    it('has no button to open the folder in the card: it is inside the manga', () => {
        useMangaStore.setState({ library: [ONE_PIECE] });
        render(<MangaLibrary />);
        expect(screen.queryByRole('button', { name: 'OPEN FOLDER' })).not.toBeInTheDocument();
        expect(mock.api.manga.openFolder).not.toHaveBeenCalled();
    });

    it('shows each manga as a card of the grid, like the anime: the cover, the name and progress, and the remove button at the bottom', () => {
        useMangaStore.setState({ library: [ONE_PIECE] });
        render(<MangaLibrary />);
        const card = screen.getByTestId('manga-entry');
        expect(card.tagName).toBe('LI');
        expect(card.parentElement).toHaveClass('cover-grid');
        expect(card).toHaveClass('job', 'job--done', 'series', 'cover-card', 'row--link');
        expect(card.querySelector('img.cover')).toHaveAttribute('src', 'http://127.0.0.1:4321/api/v1/manga/7/thumbnail');
        const head = card.querySelector('header.job__head')!;
        expect(within(head as HTMLElement).getByRole('heading', { level: 3, name: 'One Piece' })).toHaveClass('series__title');
        expect(within(head as HTMLElement).getByText('1 of 5 downloaded')).toHaveClass('history__meta');
        const footer = card.querySelector('.cover-card__footer')!;
        expect(footer.lastElementChild).toHaveClass('job__actions', 'library__footer');
        expect(within(footer as HTMLElement).getByRole('button', { name: 'REMOVE: One Piece' })).toBeInTheDocument();
        // Nothing to say about seasons or new chapters for a manga on its own with no new chapter: no badges.
        expect(footer.querySelector('.job__badges')).toBeNull();
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

    it('asks in a window before removing a manga, and removes it only when confirmed', async () => {
        const user = userEvent.setup();
        useMangaStore.setState({ library: [ONE_PIECE] });
        render(<MangaLibrary />);
        await user.click(screen.getByRole('button', { name: 'REMOVE: One Piece' }));
        expect(mock.api.manga.removeManga).not.toHaveBeenCalled();
        const dialog = screen.getByRole('dialog', { name: 'Remove "One Piece"?' });
        expect(dialog).toHaveAttribute('aria-modal', 'true');
        expect(dialog).toHaveTextContent('The manga leaves the library and its downloaded chapters are deleted from the disk too.');
        await user.click(within(dialog).getByRole('button', { name: 'REMOVE' }));
        expect(mock.api.manga.removeManga).toHaveBeenCalledTimes(1);
        expect(mock.api.manga.removeManga).toHaveBeenCalledWith(9);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('keeps the manga when the removal is called off, with the button, Escape or a click outside the window', async () => {
        const user = userEvent.setup();
        useMangaStore.setState({ library: [ONE_PIECE] });
        render(<MangaLibrary />);
        await user.click(screen.getByRole('button', { name: 'REMOVE: One Piece' }));
        await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'KEEP' }));
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'REMOVE: One Piece' }));
        await user.keyboard('{Escape}');
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'REMOVE: One Piece' }));
        await user.click(document.querySelector('.modal-backdrop')!);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(mock.api.manga.removeManga).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: 'REMOVE: One Piece' })).toBeInTheDocument();
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
    const FRIEREN = makeLibraryManga([makeChapterRecord({ id: 20, status: 'done' })], { id: 20, remoteId: 21, title: 'Frieren', series: 'Sousou no Frieren', season: 1, groupIds: [] });
    const FRIEREN_2 = makeLibraryManga([makeChapterRecord({ id: 21, status: 'idle' })], { id: 21, remoteId: 22, title: 'Frieren 2', series: 'Sousou no Frieren', season: 2, groupIds: [] });
    const BLEACH = makeLibraryManga([], { id: 22, remoteId: 23, title: 'Bleach', groupIds: [] });
    // The same mangas, in groups.
    const FRIEREN_IN_MANGAS = { ...FRIEREN, groupIds: [1] };
    const FRIEREN_2_IN_MANGAS = { ...FRIEREN_2, groupIds: [1] };
    const BLEACH_IN_MANHWAS = { ...BLEACH, groupIds: [2] };
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

    it('lists the groups as tabs with the ones in no group first, and limits the library to the one picked', async () => {
        const user = userEvent.setup();
        const naruto = makeLibraryManga([], { id: 30, remoteId: 31, title: 'Naruto', groupIds: [] });
        useMangaStore.setState({ library: [FRIEREN_2_IN_MANGAS, BLEACH_IN_MANHWAS, FRIEREN_IN_MANGAS, naruto] });
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
        // A manga that is in a group is not in the tab of all.
        expect(screen.getAllByTestId('manga-entry')).toHaveLength(1);
        expect(within(screen.getByTestId('manga-entry')).getByRole('heading', { name: 'Naruto' })).toBeInTheDocument();
        expect(screen.queryByTestId('manga-series')).not.toBeInTheDocument();
        await user.click(within(nav).getByRole('button', { name: 'Manhwas' }));
        expect(useMangaStore.getState().libraryGroup).toBe(2);
        expect(within(screen.getByTestId('manga-entry')).getByRole('heading', { name: 'Bleach' })).toBeInTheDocument();
        expect(screen.queryByTestId('manga-series')).not.toBeInTheDocument();
        expect(within(nav).getByRole('button', { name: 'Manhwas' })).toHaveAttribute('aria-current', 'page');
        await user.click(within(nav).getByRole('button', { name: 'Mangas' }));
        expect(screen.getByTestId('manga-series')).toBeInTheDocument();
        expect(screen.queryByTestId('manga-entry')).not.toBeInTheDocument();
        await user.click(within(nav).getByRole('button', { name: 'ALL' }));
        expect(useMangaStore.getState().libraryGroup).toBeNull();
        expect(screen.getAllByTestId('manga-entry')).toHaveLength(1);
        expect(screen.queryByTestId('manga-series')).not.toBeInTheDocument();
    });

    describe('the source of each manga', () => {
        const ONE = makeLibraryManga([], { id: 50, remoteId: 51, title: 'First', sourceId: 'alpha', groupIds: [] });
        const TWO = makeLibraryManga([], { id: 51, remoteId: 52, title: 'Second', sourceId: 'beta', groupIds: [] });

        function listSources(): void {
            useMangaStore.setState({
                browse: {
                    ...useMangaStore.getState().browse,
                    sources: [makeSource({ id: 'alpha', name: 'MangaDex', lang: 'en' }), makeSource({ id: 'beta', name: 'Leitor', lang: 'pt' })],
                    sourcesStatus: 'ready'
                }
            });
        }

        it('has a badge with the name and the language of the source in the card of a manga', () => {
            useMangaStore.setState({ library: [ONE, TWO] });
            listSources();
            render(<MangaLibrary />);
            const cards = screen.getAllByTestId('manga-entry');
            const first = within(cards[0]!).getByTestId('manga-source-name');
            expect(first).toHaveTextContent('MangaDex · EN');
            expect(first).toHaveClass('badge', 'badge--source');
            expect(first).toHaveAttribute('title', 'Source the manga comes from');
            expect(first.parentElement).toHaveClass('job__badges');
            expect(within(cards[1]!).getByTestId('manga-source-name')).toHaveTextContent('Leitor · PT');
        });

        it('has the badge of every different source of a series, once each', () => {
            const one = makeLibraryManga([], { id: 52, remoteId: 53, title: 'S1', sourceId: 'alpha', series: 'Show', season: 1, groupIds: [] });
            const two = makeLibraryManga([], { id: 53, remoteId: 54, title: 'S2', sourceId: 'beta', series: 'Show', season: 2, groupIds: [] });
            const three = makeLibraryManga([], { id: 54, remoteId: 55, title: 'S3', sourceId: 'alpha', series: 'Show', season: 3, groupIds: [] });
            useMangaStore.setState({ library: [one, two, three] });
            listSources();
            render(<MangaLibrary />);
            const names = within(screen.getByTestId('manga-series')).getAllByTestId('manga-source-name').map((badge) => {
                return badge.textContent;
            });
            expect(names).toEqual(['MangaDex · EN', 'Leitor · PT']);
        });

        it('has no badge of the name while the sources are not known, or for a source that is gone (which has its own badge)', () => {
            useMangaStore.setState({ library: [ONE], browse: { ...useMangaStore.getState().browse, sources: [], sourcesStatus: 'idle' } });
            mock.api.manga.sources.mockResolvedValue({ ok: false, error: { code: 'SERVER_UNAVAILABLE', message: 'down' } });
            const { unmount } = render(<MangaLibrary />);
            expect(screen.queryByTestId('manga-source-name')).not.toBeInTheDocument();
            unmount();
            useMangaStore.setState({ browse: { ...useMangaStore.getState().browse, sources: [makeSource({ id: 'other' })], sourcesStatus: 'ready' } });
            render(<MangaLibrary />);
            expect(screen.queryByTestId('manga-source-name')).not.toBeInTheDocument();
            expect(screen.getByTestId('manga-source-missing')).toBeInTheDocument();
        });
    });

    describe('the mangas whose extension is not installed', () => {
        const HERE = makeLibraryManga([], { id: 40, remoteId: 41, title: 'Here', sourceId: 'here', groupIds: [] });
        const GONE = makeLibraryManga([], { id: 41, remoteId: 42, title: 'Gone', sourceId: 'gone', groupIds: [] });

        function listSources(ids: string[], status: 'ready' | 'idle' | 'loading' | 'error' = 'ready'): void {
            useMangaStore.setState({
                browse: {
                    ...useMangaStore.getState().browse,
                    sources: ids.map((id) => {
                        return makeSource({ id, name: `Site ${id}` });
                    }),
                    sourcesStatus: status
                }
            });
        }

        it('has a badge in the card of a manga whose source is not installed, and not in the card of one whose source is', () => {
            useMangaStore.setState({ library: [HERE, GONE] });
            listSources(['here']);
            render(<MangaLibrary />);
            const cards = screen.getAllByTestId('manga-entry');
            expect(within(cards[0]!).getByRole('heading', { name: 'Gone' })).toBeInTheDocument();
            const badge = within(cards[0]!).getByTestId('manga-source-missing');
            expect(badge).toHaveTextContent('SOURCE NOT INSTALLED');
            expect(badge).toHaveClass('badge', 'badge--error');
            expect(badge).toHaveAttribute('title', 'The extension of this source is not installed.');
            expect(badge.parentElement).toHaveClass('job__badges');
            expect(badge.closest('.cover-card__footer')).not.toBeNull();
            expect(within(cards[1]!).getByRole('heading', { name: 'Here' })).toBeInTheDocument();
            expect(within(cards[1]!).queryByTestId('manga-source-missing')).not.toBeInTheDocument();
        });

        it('has no badge for the local source, which is never in the list', () => {
            useMangaStore.setState({ library: [makeLibraryManga([], { id: 42, remoteId: 43, title: 'Local one', sourceId: '0', groupIds: [] })] });
            listSources(['here']);
            render(<MangaLibrary />);
            expect(screen.queryByTestId('manga-source-missing')).not.toBeInTheDocument();
        });

        it.each(['idle', 'loading', 'error'] as const)('has no badge while the list of sources is %s: nothing is known', (status) => {
            useMangaStore.setState({ library: [GONE] });
            listSources([], status);
            mock.api.manga.sources.mockResolvedValue({ ok: false, error: { code: 'SERVER_UNAVAILABLE', message: 'down' } });
            render(<MangaLibrary />);
            expect(screen.queryByTestId('manga-source-missing')).not.toBeInTheDocument();
        });

        it('has the badge in the card of a series when one of its seasons has no extension, beside the badge of the seasons', () => {
            const one = makeLibraryManga([], { id: 43, remoteId: 44, title: 'S1', sourceId: 'here', series: 'Show', season: 1, groupIds: [] });
            const two = makeLibraryManga([], { id: 44, remoteId: 45, title: 'S2', sourceId: 'gone', series: 'Show', season: 2, groupIds: [] });
            useMangaStore.setState({ library: [one, two] });
            listSources(['here']);
            render(<MangaLibrary />);
            const series = screen.getByTestId('manga-series');
            const badges = Array.from(series.querySelectorAll('.cover-card__footer .job__badges .badge')).map((badge) => {
                return badge.textContent;
            });
            expect(badges).toEqual(['2 SEASONS', 'Site here · EN', 'SOURCE NOT INSTALLED']);
        });

        it('has no badge in the card of a series when every season has its extension', () => {
            const one = makeLibraryManga([], { id: 43, remoteId: 44, title: 'S1', sourceId: 'here', series: 'Show', season: 1, groupIds: [] });
            const two = makeLibraryManga([], { id: 44, remoteId: 45, title: 'S2', sourceId: 'there', series: 'Show', season: 2, groupIds: [] });
            useMangaStore.setState({ library: [one, two] });
            listSources(['here', 'there']);
            render(<MangaLibrary />);
            expect(screen.queryByTestId('manga-source-missing')).not.toBeInTheDocument();
        });

        it('reads the sources by itself when they were not read yet, and shows the badge once they are', async () => {
            useMangaStore.setState({ library: [GONE] });
            listSources([], 'idle');
            mock.api.manga.sources.mockResolvedValue({ ok: true, value: [makeSource({ id: 'here' })] });
            render(<MangaLibrary />);
            expect(await screen.findByTestId('manga-source-missing')).toBeInTheDocument();
            expect(mock.api.manga.sources).toHaveBeenCalledTimes(1);
        });

        it('does not read the sources again when they are already known', () => {
            useMangaStore.setState({ library: [GONE] });
            listSources(['here']);
            render(<MangaLibrary />);
            expect(mock.api.manga.sources).not.toHaveBeenCalled();
        });
    });

    describe('the order of the tabs', () => {
        const NARUTO = makeLibraryManga([], { id: 30, remoteId: 31, title: 'Naruto', groupIds: [] });

        function tabs(): Array<string | null> {
            return within(screen.getByRole('navigation', { name: 'Groups' }))
                .getAllByRole('button')
                .map((button) => {
                    return button.textContent;
                });
        }

        beforeEach(() => {
            useMangaStore.setState({ library: [FRIEREN_IN_MANGAS, BLEACH_IN_MANHWAS, NARUTO] });
        });

        it('follows the order of the groups, not the alphabetical one: the first group is the tab on the left', () => {
            useMangaStore.setState({ groups: [{ id: 2, name: 'Manhwas' }, { id: 1, name: 'Mangas' }] });
            render(<MangaLibrary />);
            expect(tabs()).toEqual(['ALL', 'Manhwas', 'Mangas']);
        });

        it('moves a tab to the left or to the right when its group is moved', () => {
            useMangaStore.setState({ groups: [{ id: 1, name: 'Mangas' }, { id: 2, name: 'Manhwas' }] });
            const { rerender } = render(<MangaLibrary />);
            expect(tabs()).toEqual(['ALL', 'Mangas', 'Manhwas']);
            act(() => {
                useMangaStore.setState({ groups: [{ id: 2, name: 'Manhwas' }, { id: 1, name: 'Mangas' }] });
            });
            rerender(<MangaLibrary />);
            expect(tabs()).toEqual(['ALL', 'Manhwas', 'Mangas']);
        });

        it('keeps the order of the tabs that are shown when a group in the middle is hidden', () => {
            useMangaStore.setState({
                groups: [{ id: 3, name: 'Webtoons' }, { id: 2, name: 'Manhwas' }, { id: 1, name: 'Mangas' }],
                hiddenGroupIds: [2],
                library: [FRIEREN_IN_MANGAS, BLEACH_IN_MANHWAS, NARUTO, makeLibraryManga([], { id: 31, remoteId: 32, title: 'Solo', groupIds: [3] })]
            });
            render(<MangaLibrary />);
            expect(tabs()).toEqual(['ALL', 'Webtoons', 'Mangas']);
        });
    });

    describe('hidden groups', () => {
        const NARUTO = makeLibraryManga([], { id: 30, remoteId: 31, title: 'Naruto', groupIds: [] });

        function tabs(): Array<string | null> {
            return within(screen.getByRole('navigation', { name: 'Groups' }))
                .getAllByRole('button')
                .map((button) => {
                    return button.textContent;
                });
        }

        beforeEach(() => {
            useMangaStore.setState({ library: [FRIEREN_2_IN_MANGAS, BLEACH_IN_MANHWAS, FRIEREN_IN_MANGAS, NARUTO] });
        });

        it('has no tab for a hidden group, and says how many are hidden', () => {
            useMangaStore.setState({ hiddenGroupIds: [2] });
            render(<MangaLibrary />);
            expect(tabs()).toEqual(['ALL', 'Mangas']);
            expect(screen.getByText('1 hidden group(s). Open MANAGE GROUPS to show them again.')).toBeInTheDocument();
        });

        it('says nothing about hidden groups while none is hidden', () => {
            render(<MangaLibrary />);
            expect(screen.queryByText(/hidden group/)).not.toBeInTheDocument();
            expect(tabs()).toEqual(['ALL', 'Mangas', 'Manhwas']);
        });

        it('does not show the mangas that are only in a hidden group, not even in the tab of all', () => {
            useMangaStore.setState({ hiddenGroupIds: [1, 2] });
            render(<MangaLibrary />);
            expect(screen.queryByRole('navigation', { name: 'Groups' })).not.toBeInTheDocument();
            expect(screen.getAllByTestId('manga-entry')).toHaveLength(1);
            expect(within(screen.getByTestId('manga-entry')).getByRole('heading', { name: 'Naruto' })).toBeInTheDocument();
            expect(screen.queryByTestId('manga-series')).not.toBeInTheDocument();
            expect(screen.getByText('2 hidden group(s). Open MANAGE GROUPS to show them again.')).toBeInTheDocument();
        });

        it('still shows a manga that is in a hidden group and in a group that is not hidden', () => {
            const both = { ...BLEACH, groupIds: [1, 2] };
            useMangaStore.setState({ library: [both, NARUTO], hiddenGroupIds: [2], libraryGroup: 1 });
            render(<MangaLibrary />);
            expect(within(screen.getByTestId('manga-entry')).getByRole('heading', { name: 'Bleach' })).toBeInTheDocument();
        });

        it('goes to the first group that is not hidden when no manga is in no group', () => {
            useMangaStore.setState({ library: [FRIEREN_2_IN_MANGAS, BLEACH_IN_MANHWAS, FRIEREN_IN_MANGAS], hiddenGroupIds: [1] });
            render(<MangaLibrary />);
            expect(tabs()).toEqual(['Manhwas']);
            expect(within(screen.getByTestId('manga-entry')).getByRole('heading', { name: 'Bleach' })).toBeInTheDocument();
        });

        it('shows the group again through the panel that manages the groups', async () => {
            const user = userEvent.setup();
            useMangaStore.setState({ hiddenGroupIds: [2] });
            render(<MangaLibrary />);
            await user.click(screen.getByRole('button', { name: 'MANAGE GROUPS' }));
            await user.click(screen.getByRole('button', { name: 'SHOW: Manhwas' }));
            expect(tabs()).toEqual(['ALL', 'Mangas', 'Manhwas']);
            expect(screen.queryByText(/hidden group/)).not.toBeInTheDocument();
        });
    });

    it('shows every manga in the tab of all while none is in a group', () => {
        render(<MangaLibrary />);
        expect(screen.getByRole('button', { name: 'ALL' })).toHaveAttribute('aria-current', 'page');
        expect(screen.getAllByTestId('manga-entry')).toHaveLength(1);
        expect(screen.getAllByTestId('manga-series')).toHaveLength(1);
    });

    it('has no tab of all when every manga is in a group, and shows the first group', () => {
        useMangaStore.setState({ library: [FRIEREN_2_IN_MANGAS, BLEACH_IN_MANHWAS, FRIEREN_IN_MANGAS] });
        render(<MangaLibrary />);
        const nav = screen.getByRole('navigation', { name: 'Groups' });
        expect(
            within(nav)
                .getAllByRole('button')
                .map((button) => {
                    return button.textContent;
                })
        ).toEqual(['Mangas', 'Manhwas']);
        expect(within(nav).getByRole('button', { name: 'Mangas' })).toHaveAttribute('aria-current', 'page');
        expect(screen.getByTestId('manga-series')).toBeInTheDocument();
        expect(screen.queryByTestId('manga-entry')).not.toBeInTheDocument();
    });

    it('brings the tab of all back when a manga with no group is added', () => {
        useMangaStore.setState({ library: [FRIEREN_2_IN_MANGAS, BLEACH_IN_MANHWAS, FRIEREN_IN_MANGAS] });
        const { rerender } = render(<MangaLibrary />);
        expect(screen.queryByRole('button', { name: 'ALL' })).not.toBeInTheDocument();
        act(() => {
            useMangaStore.setState({ library: [FRIEREN_2_IN_MANGAS, BLEACH_IN_MANHWAS, FRIEREN_IN_MANGAS, makeLibraryManga([], { id: 30, remoteId: 31, title: 'Naruto' })] });
        });
        rerender(<MangaLibrary />);
        expect(screen.getByRole('button', { name: 'ALL' })).toBeInTheDocument();
    });

    it('goes back to the group chosen when the one that was shown by default is left', async () => {
        const user = userEvent.setup();
        useMangaStore.setState({ library: [FRIEREN_2_IN_MANGAS, BLEACH_IN_MANHWAS, FRIEREN_IN_MANGAS] });
        render(<MangaLibrary />);
        await user.click(screen.getByRole('button', { name: 'Manhwas' }));
        expect(screen.getByRole('button', { name: 'Manhwas' })).toHaveAttribute('aria-current', 'page');
        expect(within(screen.getByTestId('manga-entry')).getByRole('heading', { name: 'Bleach' })).toBeInTheDocument();
    });

    it('has no tabs while there are no groups', () => {
        useMangaStore.setState({ groups: [] });
        render(<MangaLibrary />);
        expect(screen.queryByRole('navigation', { name: 'Groups' })).not.toBeInTheDocument();
    });

    it('says a group has nothing in it yet', () => {
        useMangaStore.setState({ library: [FRIEREN_IN_MANGAS, FRIEREN_2_IN_MANGAS], libraryGroup: 2 });
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

    it('shows a series as a card with the badge of its seasons at the bottom, and nothing to remove from the card', () => {
        useMangaStore.setState({ library: [FRIEREN, FRIEREN_2], libraryGroup: null });
        render(<MangaLibrary />);
        const card = screen.getByTestId('manga-series');
        expect(card.tagName).toBe('LI');
        expect(card.parentElement).toHaveClass('cover-grid');
        expect(card).toHaveClass('job', 'job--done', 'series', 'cover-card', 'row--link');
        expect(card.querySelector('.cover')).not.toBeNull();
        const footer = card.querySelector('.cover-card__footer')!;
        expect(footer.querySelector('.job__badges .badge')).toHaveTextContent('2 SEASONS');
        expect(footer.querySelector('.job__actions')).toBeNull();
        expect(within(card).queryByRole('button', { name: /^REMOVE/ })).not.toBeInTheDocument();
        expect(within(card).queryByRole('button', { name: 'OPEN FOLDER' })).not.toBeInTheDocument();
    });

    it('puts the badge of the new chapters in the footer of the card, beside the seasons of a series', () => {
        const today = new Date().getTime();
        const fresh = makeLibraryManga([makeChapterRecord({ id: 40, status: 'done', addedAt: today, dateUploaded: null })], { id: 40, remoteId: 41, title: 'Fresh', groupIds: [] });
        const seasonOne = makeLibraryManga([makeChapterRecord({ id: 41, status: 'done', addedAt: today, dateUploaded: null })], { id: 41, remoteId: 42, title: 'Show 1', series: 'Show', season: 1, groupIds: [] });
        const seasonTwo = makeLibraryManga([], { id: 42, remoteId: 43, title: 'Show 2', series: 'Show', season: 2, groupIds: [] });
        useMangaStore.setState({ library: [fresh, seasonOne, seasonTwo], libraryGroup: null });
        render(<MangaLibrary />);
        const single = screen.getByTestId('manga-entry');
        expect(single.querySelector('.cover-card__footer .job__badges [data-testid="manga-new-chapters"]')).toHaveTextContent('NEW CHAPTER');
        expect(single.querySelector('.job__badges .badge:not(.badge--new)')).toBeNull();
        const series = screen.getByTestId('manga-series');
        const badges = Array.from(series.querySelectorAll('.cover-card__footer .job__badges .badge')).map((badge) => {
            return badge.textContent;
        });
        expect(badges).toEqual(['2 SEASONS', 'NEW CHAPTER']);
    });

    it('does not show the groups in the card: they are the tabs of the library', () => {
        useMangaStore.setState({ library: [BLEACH_IN_MANHWAS], libraryGroup: 2 });
        render(<MangaLibrary />);
        expect(screen.queryByTestId('manga-entry-groups')).not.toBeInTheDocument();
        expect(within(screen.getByTestId('manga-entry')).queryByText('Manhwas')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Manhwas' })).toBeInTheDocument();
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

describe('MangaLibrary the chapters that are new today', () => {
    const now = Date.now();
    const fresh = (id: number) => {
        return makeChapterRecord({ id, remoteId: 100 + id, status: 'idle', addedAt: now - 1000 });
    };
    const OLD = now - 30 * 24 * 3_600_000;

    it('says on the card of a manga that it has a new chapter, or how many', () => {
        useMangaStore.setState({
            library: [
                makeLibraryManga([fresh(1)], { id: 1, title: 'Bleach', createdAt: OLD }),
                makeLibraryManga([fresh(2), fresh(3)], { id: 2, title: 'Naruto', createdAt: OLD }),
                makeLibraryManga([makeChapterRecord({ id: 4, addedAt: OLD })], { id: 3, title: 'One Piece', createdAt: OLD })
            ]
        });
        render(<MangaLibrary />);
        const entries = screen.getAllByTestId('manga-entry');
        expect(within(entries[0]!).getByTestId('manga-new-chapters')).toHaveTextContent('NEW CHAPTER');
        expect(within(entries[0]!).getByTestId('manga-new-chapters')).toHaveClass('badge--new');
        expect(within(entries[1]!).getByTestId('manga-new-chapters')).toHaveTextContent('2 NEW CHAPTERS');
        expect(within(entries[2]!).queryByTestId('manga-new-chapters')).not.toBeInTheDocument();
    });

    it('does not say it of the chapters a manga came with, which have no time of arrival', () => {
        useMangaStore.setState({ library: [makeLibraryManga([makeChapterRecord({ id: 1, status: 'idle', addedAt: null }), makeChapterRecord({ id: 2, status: 'idle', addedAt: null })], { id: 1, title: 'Bleach' })] });
        render(<MangaLibrary />);
        expect(screen.queryByTestId('manga-new-chapters')).not.toBeInTheDocument();
    });

    it('counts the new chapters of all the seasons on the card of a series, and on each season', async () => {
        const user = userEvent.setup();
        const first = makeLibraryManga([fresh(1)], { id: 1, remoteId: 21, title: 'Frieren', series: 'Frieren', season: 1, createdAt: OLD });
        const second = makeLibraryManga([fresh(2), fresh(3)], { id: 2, remoteId: 22, title: 'Frieren 2', series: 'Frieren', season: 2, createdAt: OLD });
        useMangaStore.setState({ library: [first, second] });
        render(<MangaLibrary />);
        expect(within(screen.getByTestId('manga-series')).getByTestId('manga-new-chapters')).toHaveTextContent('3 NEW CHAPTERS');
        await user.click(screen.getByRole('button', { name: 'Open series: Frieren' }));
        const seasons = screen.getAllByTestId('manga-season');
        expect(within(seasons[0]!).getByTestId('manga-new-chapters')).toHaveTextContent('NEW CHAPTER');
        expect(within(seasons[1]!).getByTestId('manga-new-chapters')).toHaveTextContent('2 NEW CHAPTERS');
    });
});
