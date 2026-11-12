// @vitest-environment jsdom
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { MangaLibrary } from '@renderer/components/MangaLibrary';
import { useAppStore } from '@renderer/store/appStore';
import { useMangaStore } from '@renderer/store/mangaStore';
import { DEFAULT_SORT_PREFS, SORT_PREFS_STORAGE_KEY, useSortPrefsStore } from '@renderer/store/sortPrefsStore';
import { makeChapterRecord, makeLibraryManga, makeSource } from '../../helpers/mangaFixtures';
import { installMockApi, type MockApiHandle } from '../../helpers/mockApi';
import { makeReading } from '../../helpers/homeFixtures';
import { seeEnd, stubIntersectionObserver, type ObservedEnd } from '../../helpers/intersectionObserver';

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

const RECENT_EVERYWHERE = { all: 'recent', news: 'recent', complete: 'recent', ongoing: 'recent' } as const;

beforeEach(() => {
    mock = installMockApi();
    useAppStore.setState({ ...initialApp, settings: DEFAULT_SETTINGS, toasts: [] });
    useMangaStore.setState({ ...initialManga, library: [] });
    useSortPrefsStore.setState({ library: { ...DEFAULT_SORT_PREFS.library }, list: { ...DEFAULT_SORT_PREFS.list } });
    window.localStorage.removeItem(SORT_PREFS_STORAGE_KEY);
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
        // Ctrl+F goes to this field.
        expect(field).toHaveAttribute('data-search-field', '');
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

        it('keeps the order of the groups in the tabs', () => {
            useMangaStore.setState({
                groups: [{ id: 3, name: 'Webtoons' }, { id: 2, name: 'Manhwas' }, { id: 1, name: 'Mangas' }],
                library: [FRIEREN_IN_MANGAS, BLEACH_IN_MANHWAS, NARUTO, makeLibraryManga([], { id: 31, remoteId: 32, title: 'Solo', groupIds: [3] })]
            });
            render(<MangaLibrary />);
            expect(tabs()).toEqual(['ALL', 'Webtoons', 'Manhwas', 'Mangas']);
        });
    });

    describe('mangas of the sources for adults', () => {
        const SAFE = makeLibraryManga([], { id: 40, remoteId: 41, sourceId: 'safe', title: 'Safe Manga', groupIds: [] });
        const ADULT = makeLibraryManga([], { id: 42, remoteId: 43, sourceId: 'adult', title: 'Adult Manga', groupIds: [] });
        const ADULT_IN_GROUP = makeLibraryManga([], { id: 44, remoteId: 45, sourceId: 'adult', title: 'Adult Grouped', groupIds: [1] });
        const SOURCES = [makeSource({ id: 'safe', contentWarning: 'SAFE' }), makeSource({ id: 'adult', contentWarning: 'NSFW' })];

        function titles(): Array<string | null> {
            return screen.getAllByTestId('manga-entry').map((entry) => {
                return within(entry).getByRole('heading').textContent;
            });
        }

        beforeEach(() => {
            useMangaStore.setState({ library: [SAFE, ADULT, ADULT_IN_GROUP], groups: [{ id: 1, name: 'Mangas' }], browse: { ...initialManga.browse, sources: SOURCES, sourcesStatus: 'ready' } });
        });

        it('hides them while the setting that lists the adult sources is off, and shows the rest', () => {
            render(<MangaLibrary />);
            expect(titles()).toEqual(['Safe Manga']);
        });

        it('does not list a hidden manga inside the tab of its group', () => {
            useMangaStore.setState({ libraryGroup: 1 });
            render(<MangaLibrary />);
            expect(screen.queryByText('Adult Grouped')).not.toBeInTheDocument();
            expect(screen.queryByTestId('manga-entry')).not.toBeInTheDocument();
        });

        it('shows them when the setting is on', () => {
            useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, mangaShowAdult: true } });
            render(<MangaLibrary />);
            expect(titles()).toEqual(['Adult Manga', 'Safe Manga']);
        });

        it('still shows a manga whose source is not known any more', () => {
            useMangaStore.setState({ library: [SAFE, { ...ADULT, sourceId: 'removed' }] });
            render(<MangaLibrary />);
            expect(titles()).toEqual(['Adult Manga', 'Safe Manga']);
        });

        it('keeps the hidden mangas in the store: nothing is removed', () => {
            render(<MangaLibrary />);
            expect(useMangaStore.getState().library).toEqual([SAFE, ADULT, ADULT_IN_GROUP]);
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

    describe('the tabs while searching', () => {
        const AFTER_SCHOOL = makeLibraryManga([], { id: 40, remoteId: 41, title: 'After School', groupIds: [2] });
        const AFTER_HOURS = makeLibraryManga([], { id: 41, remoteId: 42, title: 'After Hours', groupIds: [] });

        function tabs(): Array<string | null> {
            return within(screen.getByRole('navigation', { name: 'Groups' }))
                .getAllByRole('button')
                .map((button) => {
                    return button.textContent;
                });
        }

        beforeEach(() => {
            useMangaStore.setState({ library: [FRIEREN_IN_MANGAS, AFTER_SCHOOL, AFTER_HOURS], libraryGroup: 1 });
        });

        it('shows no number in the tabs while nothing is typed', () => {
            render(<MangaLibrary />);
            expect(tabs()).toEqual(['ALL', 'Mangas', 'Manhwas']);
            expect(document.querySelector('.tab .badge')).toBeNull();
        });

        it('shows how many cards match in each tab that has a match, the current one too', async () => {
            const user = userEvent.setup();
            render(<MangaLibrary />);
            await user.type(screen.getByLabelText('Search the library'), 'after');
            expect(tabs()).toEqual(['ALL1', 'Mangas', 'Manhwas1']);
            const badge = within(screen.getByRole('button', { name: /Manhwas/ })).getByLabelText('1 match(es) for the search');
            expect(badge).toHaveClass('badge');
            expect(badge).toHaveTextContent('1');
        });

        it('counts the tab that is open, and the cards of a series as one', async () => {
            const user = userEvent.setup();
            useMangaStore.setState({ library: [FRIEREN_IN_MANGAS, FRIEREN_2_IN_MANGAS, AFTER_SCHOOL, AFTER_HOURS] });
            render(<MangaLibrary />);
            await user.type(screen.getByLabelText('Search the library'), 'frieren');
            expect(tabs()).toEqual(['ALL', 'Mangas1', 'Manhwas']);
        });

        it('takes the numbers away when the search is cleared', async () => {
            const user = userEvent.setup();
            render(<MangaLibrary />);
            await user.type(screen.getByLabelText('Search the library'), 'after');
            await user.clear(screen.getByLabelText('Search the library'));
            expect(tabs()).toEqual(['ALL', 'Mangas', 'Manhwas']);
        });
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

describe('MangaLibrary: the highlights, the filters and the order', () => {
    const DAY = 24 * 60 * 60 * 1000;
    const SOLO = makeLibraryManga([makeChapterRecord({ id: 1, addedAt: Date.now() - DAY })], { id: 1, remoteId: 7, title: 'Solo Manga', createdAt: 9 });
    const PART_ONE = makeLibraryManga([makeChapterRecord({ id: 2, mangaId: 2 })], { id: 2, remoteId: 8, title: 'Epic', series: 'Epic', season: 1, createdAt: 3 });
    const PART_TWO = makeLibraryManga([makeChapterRecord({ id: 3, mangaId: 3 })], { id: 3, remoteId: 9, title: 'Epic 2', series: 'Epic', season: 2, createdAt: 1 });

    beforeEach(() => {
        useMangaStore.setState({ library: [SOLO, PART_ONE, PART_TWO], groups: [], history: [makeReading({ libraryMangaId: null })], librarySeries: null, libraryGroup: null });
    });

    function cardTitles(): string[] {
        return screen.getAllByRole('heading', { level: 3 }).map((heading) => {
            return heading.textContent ?? '';
        });
    }

    it('shows the highlights over the grid: the mangas with news of the last seven days', () => {
        render(<MangaLibrary />);
        const highlights = screen.getByRole('region', { name: 'Highlights of the library' });
        expect(within(highlights).getByRole('heading', { level: 2 })).toHaveTextContent('Solo Manga');
        expect(within(highlights).getByText('1 new chapter')).toBeInTheDocument();
    });

    it('shows the mangas added last first, and by name when asked', async () => {
        render(<MangaLibrary />);
        expect(cardTitles()).toEqual(['Solo Manga', 'Epic']);
        await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Sort by' }), 'az');
        expect(cardTitles()).toEqual(['Epic', 'Solo Manga']);
    });

    it('shows the mangas by name from Z when asked', async () => {
        render(<MangaLibrary />);
        await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Sort by' }), 'za');
        expect(cardTitles()).toEqual(['Solo Manga', 'Epic']);
        await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Sort by' }), 'az');
        expect(cardTitles()).toEqual(['Epic', 'Solo Manga']);
    });

    it('keeps the order chosen, for the next time the library opens and for the next time the app opens', async () => {
        const { unmount } = render(<MangaLibrary />);
        await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Sort by' }), 'az');
        expect(useSortPrefsStore.getState().library).toEqual({ anime: RECENT_EVERYWHERE, manga: { all: { ...RECENT_EVERYWHERE, all: 'az' } } });
        expect(JSON.parse(window.localStorage.getItem(SORT_PREFS_STORAGE_KEY) ?? 'null')).toEqual({
            library: { anime: RECENT_EVERYWHERE, manga: { all: { ...RECENT_EVERYWHERE, all: 'az' } } },
            list: { chapters: {}, episodes: {} }
        });
        unmount();
        render(<MangaLibrary />);
        expect(screen.getByRole('combobox', { name: 'Sort by' })).toHaveValue('az');
        expect(cardTitles()).toEqual(['Epic', 'Solo Manga']);
    });

    it('starts with the order kept', () => {
        useSortPrefsStore.setState({ library: { anime: RECENT_EVERYWHERE, manga: { all: { ...RECENT_EVERYWHERE, all: 'za' } } } });
        render(<MangaLibrary />);
        expect(screen.getByRole('combobox', { name: 'Sort by' })).toHaveValue('za');
        expect(cardTitles()).toEqual(['Solo Manga', 'Epic']);
    });

    it('keeps the order of each filter on its own: choosing a filter shows the order it was left with', async () => {
        render(<MangaLibrary />);
        const order = (): HTMLElement => {
            return screen.getByRole('combobox', { name: 'Sort by' });
        };
        await userEvent.selectOptions(order(), 'za');
        await userEvent.click(screen.getByRole('button', { name: 'NEW (1)' }));
        expect(order()).toHaveValue('recent');
        await userEvent.selectOptions(order(), 'last');
        expect(useSortPrefsStore.getState().library.manga).toEqual({ all: { ...RECENT_EVERYWHERE, all: 'za', news: 'last' } });
        await userEvent.click(screen.getByRole('button', { name: 'ALL (2)' }));
        expect(order()).toHaveValue('za');
        expect(cardTitles()).toEqual(['Solo Manga', 'Epic']);
        await userEvent.click(screen.getByRole('button', { name: 'NEW (1)' }));
        expect(order()).toHaveValue('last');
    });

    it('does not change the order of the filters of the anime library', async () => {
        render(<MangaLibrary />);
        await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Sort by' }), 'az');
        expect(useSortPrefsStore.getState().library.anime).toEqual(RECENT_EVERYWHERE);
    });

    describe('in the tabs of groups', () => {
        const LOOSE = makeLibraryManga([makeChapterRecord({ id: 11, mangaId: 11, addedAt: Date.now() - DAY })], { id: 11, remoteId: 31, title: 'Loose', createdAt: 7, groupIds: [] });
        const ALPHA = makeLibraryManga([makeChapterRecord({ id: 12, mangaId: 12, addedAt: Date.now() - DAY })], { id: 12, remoteId: 32, title: 'Alpha', createdAt: 2, groupIds: [1] });
        const BETA = makeLibraryManga([makeChapterRecord({ id: 13, mangaId: 13, addedAt: Date.now() - 30 * DAY })], { id: 13, remoteId: 33, title: 'Beta', createdAt: 5, groupIds: [1] });
        const GAMMA = makeLibraryManga([makeChapterRecord({ id: 14, mangaId: 14, addedAt: Date.now() - DAY })], { id: 14, remoteId: 34, title: 'Gamma', createdAt: 1, groupIds: [2] });
        const GROUPS = [{ id: 1, name: 'Mangas' }, { id: 2, name: 'Manhwas' }];

        beforeEach(() => {
            useMangaStore.setState({ library: [LOOSE, ALPHA, BETA, GAMMA], groups: GROUPS, libraryGroup: null });
        });

        function tab(name: string): HTMLElement {
            return within(screen.getByRole('navigation', { name: 'Groups' })).getByRole('button', { name });
        }

        function order(): HTMLElement {
            return screen.getByRole('combobox', { name: 'Sort by' });
        }

        it('keeps the order of each tab on its own: another tab starts from the default and the tab left shows the one it was left with', async () => {
            render(<MangaLibrary />);
            await userEvent.selectOptions(order(), 'za');
            await userEvent.click(tab('Mangas'));
            expect(order()).toHaveValue('recent');
            expect(cardTitles()).toEqual(['Beta', 'Alpha']);
            await userEvent.selectOptions(order(), 'az');
            expect(cardTitles()).toEqual(['Alpha', 'Beta']);
            await userEvent.click(tab('Manhwas'));
            expect(order()).toHaveValue('recent');
            await userEvent.click(tab('ALL'));
            expect(order()).toHaveValue('za');
            await userEvent.click(tab('Mangas'));
            expect(order()).toHaveValue('az');
            expect(cardTitles()).toEqual(['Alpha', 'Beta']);
            expect(useSortPrefsStore.getState().library.manga).toEqual({
                all: { ...RECENT_EVERYWHERE, all: 'za' },
                'group:1': { ...RECENT_EVERYWHERE, all: 'az' }
            });
        });

        it('keeps the order of each filter of each tab: every combination has its own', async () => {
            render(<MangaLibrary />);
            await userEvent.click(tab('Mangas'));
            await userEvent.selectOptions(order(), 'az');
            await userEvent.click(screen.getByRole('button', { name: /^NEW \(/ }));
            expect(order()).toHaveValue('recent');
            await userEvent.selectOptions(order(), 'last');
            await userEvent.click(tab('Manhwas'));
            expect(order()).toHaveValue('recent');
            await userEvent.selectOptions(order(), 'za');
            await userEvent.click(tab('Mangas'));
            expect(order()).toHaveValue('last');
            await userEvent.click(screen.getByRole('button', { name: /^ALL \(/ }));
            expect(order()).toHaveValue('az');
            await userEvent.click(tab('Manhwas'));
            expect(order()).toHaveValue('recent');
            await userEvent.click(screen.getByRole('button', { name: /^NEW \(/ }));
            expect(order()).toHaveValue('za');
            expect(useSortPrefsStore.getState().library.manga).toEqual({
                'group:1': { ...RECENT_EVERYWHERE, all: 'az', news: 'last' },
                'group:2': { ...RECENT_EVERYWHERE, news: 'za' }
            });
        });

        it('keeps the order of the tabs for the next time the app opens', async () => {
            const { unmount } = render(<MangaLibrary />);
            await userEvent.click(tab('Manhwas'));
            await userEvent.selectOptions(order(), 'last');
            expect(JSON.parse(window.localStorage.getItem(SORT_PREFS_STORAGE_KEY) ?? 'null')).toEqual({
                library: { anime: RECENT_EVERYWHERE, manga: { 'group:2': { ...RECENT_EVERYWHERE, all: 'last' } } },
                list: { chapters: {}, episodes: {} }
            });
            unmount();
            useMangaStore.setState({ libraryGroup: 2 });
            render(<MangaLibrary />);
            expect(order()).toHaveValue('last');
        });

        it('keeps the order under the first group when the tab of all is not there, because every manga is in a group', async () => {
            useMangaStore.setState({ library: [ALPHA, BETA, GAMMA], libraryGroup: null });
            render(<MangaLibrary />);
            expect(within(screen.getByRole('navigation', { name: 'Groups' })).queryByRole('button', { name: 'ALL' })).not.toBeInTheDocument();
            await userEvent.selectOptions(order(), 'az');
            expect(useSortPrefsStore.getState().library.manga).toEqual({ 'group:1': { ...RECENT_EVERYWHERE, all: 'az' } });
            await userEvent.click(tab('Manhwas'));
            expect(order()).toHaveValue('recent');
        });
    });

    it('shows the mangas read last first', async () => {
        useMangaStore.setState({ history: [makeReading({ id: 1, libraryMangaId: 3, readAt: 50 }), makeReading({ id: 2, libraryMangaId: 1, readAt: 20 })] });
        render(<MangaLibrary />);
        await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Sort by' }), 'last');
        expect(cardTitles()).toEqual(['Epic', 'Solo Manga']);
    });

    it('keeps only the mangas with something new in the last seven days with NEW', async () => {
        render(<MangaLibrary />);
        await userEvent.click(screen.getByRole('button', { name: 'NEW (1)' }));
        expect(cardTitles()).toEqual(['Solo Manga']);
        await userEvent.click(screen.getByRole('button', { name: 'ALL (2)' }));
        expect(cardTitles()).toEqual(['Solo Manga', 'Epic']);
    });

    it('says when nothing is new in the last seven days', async () => {
        useMangaStore.setState({ library: [PART_ONE, PART_TWO] });
        render(<MangaLibrary />);
        await userEvent.click(screen.getByRole('button', { name: 'NEW (0)' }));
        expect(screen.getByText('Nothing new in the last 7 days.')).toHaveClass('empty');
    });

    it('hides the highlights while a search is typed', async () => {
        render(<MangaLibrary />);
        await userEvent.type(screen.getByLabelText('Search the library'), 'solo');
        expect(screen.queryByRole('region', { name: 'Highlights of the library' })).not.toBeInTheDocument();
        expect(cardTitles()).toEqual(['Solo Manga']);
    });
});

describe('MangaLibrary with a big library', () => {
    let observers: ObservedEnd[] = [];

    beforeEach(() => {
        observers = stubIntersectionObserver();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    // 70 mangas, named so that their order by name is their order here.
    const BIG = Array.from({ length: 70 }, (_unused, index) => {
        const number = String(index + 1).padStart(2, '0');
        return makeLibraryManga([], { id: 100 + index, remoteId: 100 + index, title: `Manga ${number}`, thumbnailUrl: null });
    });

    function titles(): Array<string | null> {
        return screen.getAllByTestId('manga-entry').map((entry) => {
            return within(entry).getByRole('heading').textContent;
        });
    }

    function libraryTitles(count: number): string[] {
        return BIG.slice(0, count).map((manga) => {
            return manga.title;
        });
    }

    it('draws the first 60 mangas, and the others when the end of the grid comes into view', () => {
        useMangaStore.setState({ library: BIG });
        render(<MangaLibrary />);
        expect(titles()).toEqual(libraryTitles(60));
        expect(screen.getByTestId('list-more').tagName).toBe('LI');
        seeEnd(observers);
        expect(titles()).toEqual(libraryTitles(70));
        expect(screen.queryByTestId('list-more')).not.toBeInTheDocument();
    });
});
