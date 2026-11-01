// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MangaListing, MangaResult } from '@shared/manga';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { MangaSearch } from '@renderer/components/MangaSearch';
import { useAppStore } from '@renderer/store/appStore';
import { useMangaStore } from '@renderer/store/mangaStore';
import { makeChapterRecord, makeDetails, makeLibraryManga, makeSource, makeSummary } from '../../helpers/mangaFixtures';
import { installMockApi, type MockApiHandle } from '../../helpers/mockApi';

let mock: MockApiHandle;
const initialApp = useAppStore.getState();
const initialManga = useMangaStore.getState();

const SOURCES = [
    makeSource({ id: '5', name: 'Site A', lang: 'en' }),
    makeSource({ id: '6', name: 'Site B', lang: 'en' }),
    makeSource({ id: '7', name: 'Site C', lang: 'en' }),
    makeSource({ id: '8', name: 'Site D', lang: 'pt' }),
    makeSource({ id: '9', name: 'Site E', lang: 'en', contentWarning: 'NSFW' })
];

function listed(items = [makeSummary({ remoteId: 1, title: 'One Piece', sourceId: '5' })]): MangaResult<MangaListing> {
    return { ok: true, value: { items, hasNextPage: false } };
}

beforeEach(() => {
    mock = installMockApi();
    window.localStorage.clear();
    useAppStore.setState({ ...initialApp, settings: { ...DEFAULT_SETTINGS, mangaLanguage: 'all-languages' }, toasts: [] });
    useMangaStore.setState({ ...initialManga, library: [], selection: null, selectionFrom: 'browse', view: 'search', search: initialManga.search, browse: { ...initialManga.browse, sources: SOURCES, sourcesStatus: 'ready' } });
    mock.api.manga.list.mockResolvedValue(listed());
});

afterEach(() => {
    vi.restoreAllMocks();
});

async function searchFor(user: ReturnType<typeof userEvent.setup>, name: string): Promise<void> {
    await user.type(screen.getByLabelText('Manga name'), name);
    await user.click(screen.getByRole('button', { name: 'SEARCH' }));
}

describe('MangaSearch', () => {
    it('has the name, and cannot search without a name', async () => {
        const user = userEvent.setup();
        render(<MangaSearch />);
        expect(screen.getByRole('region', { name: 'SEARCH' })).toBeInTheDocument();
        expect(screen.getByLabelText('Manga name')).toHaveValue('');
        expect(screen.getByRole('button', { name: 'SEARCH' })).toBeDisabled();
        await user.type(screen.getByLabelText('Manga name'), '   ');
        expect(screen.getByRole('button', { name: 'SEARCH' })).toBeDisabled();
        await user.type(screen.getByLabelText('Manga name'), 'one');
        expect(screen.getByRole('button', { name: 'SEARCH' })).toBeEnabled();
        expect(mock.api.manga.list).not.toHaveBeenCalled();
    });

    it('reads the sources when they are not read yet', async () => {
        useMangaStore.setState({ browse: { ...useMangaStore.getState().browse, sources: [], sourcesStatus: 'idle' } });
        mock.api.manga.sources.mockResolvedValue({ ok: true, value: SOURCES });
        render(<MangaSearch />);
        await waitFor(() => {
            expect(mock.api.manga.sources).toHaveBeenCalledTimes(1);
        });
        expect(await screen.findByLabelText('Manga name')).toBeInTheDocument();
    });

    it('asks every source that is shown, by name, with the name trimmed, and says what each one found', async () => {
        const user = userEvent.setup();
        mock.api.manga.list.mockImplementation(async (request) => {
            if (request.sourceId === '6') {
                return listed([]);
            }
            if (request.sourceId === '7') {
                return { ok: false, error: { code: 'REQUEST_FAILED', message: 'timeout' } };
            }
            return listed([makeSummary({ remoteId: 1, title: 'One Piece', sourceId: request.sourceId }), makeSummary({ remoteId: 2, title: 'One Piece Party', sourceId: request.sourceId })]);
        });
        render(<MangaSearch />);
        await user.type(screen.getByLabelText('Manga name'), '  one piece ');
        await user.click(screen.getByRole('button', { name: 'SEARCH' }));
        await screen.findByText('"one piece": found in 2 of 4 sources');
        expect(mock.api.manga.list).toHaveBeenCalledTimes(4);
        ['5', '6', '7', '8'].forEach((sourceId) => {
            expect(mock.api.manga.list).toHaveBeenCalledWith({ sourceId, kind: 'search', page: 1, query: 'one piece' });
        });
        const groups = screen.getAllByTestId('manga-search-source');
        expect(
            groups.map((group) => {
                return group.querySelector('h3')?.textContent;
            })
        ).toEqual(['Site A (EN) Found: 2', 'Site B (EN) Not found', 'Site C (EN) Failed', 'Site D (PT) Found: 2']);
        expect(within(groups[0]!).getAllByRole('listitem')).toHaveLength(2);
        expect(within(groups[1]!).queryByRole('listitem')).not.toBeInTheDocument();
        expect(within(groups[2]!).getByRole('alert')).toHaveTextContent('The request to the manga server failed.');
        expect(screen.queryByText(/Site E/)).not.toBeInTheDocument();
    });

    it('asks two sources at a time, and shows the others as waiting', async () => {
        const user = userEvent.setup();
        const resolvers = new Map<string, () => void>();
        mock.api.manga.list.mockImplementation((request) => {
            return new Promise<MangaResult<MangaListing>>((resolve) => {
                resolvers.set(request.sourceId, () => {
                    resolve(listed([]));
                });
            });
        });
        render(<MangaSearch />);
        await searchFor(user, 'bleach');
        await waitFor(() => {
            expect([...resolvers.keys()]).toEqual(['5', '6']);
        });
        const badges = (): Array<string | null | undefined> => {
            return screen.getAllByTestId('manga-search-source').map((group) => {
                return group.querySelector('.badge')?.textContent;
            });
        };
        expect(badges()).toEqual(['Searching…', 'Searching…', 'Waiting', 'Waiting']);
        expect(screen.getByText('Searching… 0 of 4 sources')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'SEARCH' })).toBeDisabled();
        resolvers.get('5')!();
        await waitFor(() => {
            expect([...resolvers.keys()]).toEqual(['5', '6', '7']);
        });
        expect(badges()).toEqual(['Not found', 'Searching…', 'Searching…', 'Waiting']);
        expect(screen.getByText('Searching… 1 of 4 sources')).toBeInTheDocument();
        resolvers.get('6')!();
        resolvers.get('7')!();
        await waitFor(() => {
            expect([...resolvers.keys()]).toEqual(['5', '6', '7', '8']);
        });
        resolvers.get('8')!();
        await screen.findByText('"bleach": found in 0 of 4 sources');
        expect(screen.getByRole('button', { name: 'SEARCH' })).toBeEnabled();
    });

    it('searches with the Enter key too', async () => {
        const user = userEvent.setup();
        render(<MangaSearch />);
        await user.type(screen.getByLabelText('Manga name'), 'naruto{Enter}');
        await screen.findByText(/^"naruto"/);
        expect(mock.api.manga.list).toHaveBeenCalledTimes(4);
    });

    it('has no field to pick the language, and a switch beside SEARCH to search every language, off by default', () => {
        render(<MangaSearch />);
        expect(screen.queryByLabelText('Language')).not.toBeInTheDocument();
        const toggle = screen.getByRole('switch', { name: 'Search every language' });
        expect(toggle).not.toBeChecked();
        const button = screen.getByRole('button', { name: 'SEARCH' });
        expect(button.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(button.closest('form')).toContainElement(toggle);
    });

    it('limits the search to the language of the settings', async () => {
        const user = userEvent.setup();
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, mangaLanguage: 'pt' } });
        render(<MangaSearch />);
        await searchFor(user, 'naruto');
        await screen.findByText('"naruto": found in 1 of 1 sources');
        expect(mock.api.manga.list).toHaveBeenCalledTimes(1);
        expect(mock.api.manga.list).toHaveBeenCalledWith({ sourceId: '8', kind: 'search', page: 1, query: 'naruto' });
    });

    it('searches every language when the switch is on, whatever the language of the settings', async () => {
        const user = userEvent.setup();
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, mangaLanguage: 'pt' } });
        render(<MangaSearch />);
        await user.click(screen.getByRole('switch', { name: 'Search every language' }));
        expect(screen.getByRole('switch', { name: 'Search every language' })).toBeChecked();
        expect(useMangaStore.getState().search.allLanguages).toBe(true);
        await searchFor(user, 'naruto');
        await screen.findByText('"naruto": found in 4 of 4 sources');
        expect(mock.api.manga.list).toHaveBeenCalledTimes(4);
    });

    it('goes back to the language of the settings when the switch is turned off', async () => {
        const user = userEvent.setup();
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, mangaLanguage: 'pt' } });
        render(<MangaSearch />);
        await user.click(screen.getByRole('switch', { name: 'Search every language' }));
        await user.click(screen.getByRole('switch', { name: 'Search every language' }));
        expect(useMangaStore.getState().search.allLanguages).toBe(false);
        await searchFor(user, 'naruto');
        await screen.findByText('"naruto": found in 1 of 1 sources');
    });

    it('keeps the switch when the name is erased and the results are cleared', async () => {
        const user = userEvent.setup();
        render(<MangaSearch />);
        await user.click(screen.getByRole('switch', { name: 'Search every language' }));
        await searchFor(user, 'naruto');
        await screen.findByText(/^"naruto"/);
        await user.clear(screen.getByLabelText('Manga name'));
        expect(screen.queryAllByTestId('manga-search-source')).toHaveLength(0);
        expect(screen.getByRole('switch', { name: 'Search every language' })).toBeChecked();
    });

    it('searches the language of the computer when the settings are on automatic', async () => {
        const user = userEvent.setup();
        vi.spyOn(navigator, 'language', 'get').mockReturnValue('pt-BR');
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, mangaLanguage: '', language: 'en' } });
        render(<MangaSearch />);
        await searchFor(user, 'naruto');
        await screen.findByText('"naruto": found in 1 of 1 sources');
        expect(mock.api.manga.list).toHaveBeenCalledWith({ sourceId: '8', kind: 'search', page: 1, query: 'naruto' });
    });

    it('searches the sources for adults when they are asked for', async () => {
        const user = userEvent.setup();
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, mangaShowAdult: true, mangaLanguage: 'all-languages' } });
        render(<MangaSearch />);
        await searchFor(user, 'naruto');
        await screen.findByText('"naruto": found in 5 of 5 sources');
        expect(screen.getByText(/Site E/)).toBeInTheDocument();
    });

    it('keeps the results when the user goes to another tab and comes back', async () => {
        const user = userEvent.setup();
        const { unmount } = render(<MangaSearch />);
        await searchFor(user, 'naruto');
        await screen.findByText('"naruto": found in 4 of 4 sources');
        unmount();
        render(<MangaSearch />);
        expect(screen.getByLabelText('Manga name')).toHaveValue('naruto');
        expect(screen.getByText('"naruto": found in 4 of 4 sources')).toBeInTheDocument();
        expect(screen.getAllByTestId('manga-search-source')).toHaveLength(4);
        expect(mock.api.manga.list).toHaveBeenCalledTimes(4);
    });

    it('marks what is in the library, and what is there from another source', async () => {
        const user = userEvent.setup();
        useMangaStore.setState({
            library: [makeLibraryManga([makeChapterRecord()], { id: 1, sourceId: '5', remoteId: 1, title: 'One Piece' }), makeLibraryManga([], { id: 2, sourceId: '99', remoteId: 50, title: 'Bleach' })]
        });
        mock.api.manga.list.mockImplementation(async (request) => {
            return listed(request.sourceId === '5' ? [makeSummary({ remoteId: 1, title: 'One Piece', sourceId: '5' }), makeSummary({ remoteId: 2, title: 'bleach', sourceId: '5' }), makeSummary({ remoteId: 3, title: 'Naruto', sourceId: '5' })] : []);
        });
        render(<MangaSearch />);
        await searchFor(user, 'x');
        await screen.findByText(/^"x"/);
        const cards = within(screen.getAllByTestId('manga-search-source')[0]!).getAllByRole('listitem');
        expect(within(cards[0]!).getByText('IN LIBRARY')).toBeInTheDocument();
        expect(within(cards[1]!).getByText('IN LIBRARY (OTHER SOURCE)')).toBeInTheDocument();
        expect(within(cards[2]!).queryByText(/IN LIBRARY/)).not.toBeInTheDocument();
    });

    it('opens a result on the page of the manga, which goes back to the results', async () => {
        const user = userEvent.setup();
        mock.api.manga.details.mockResolvedValue({ ok: true, value: { details: makeDetails({ remoteId: 1, sourceId: '5' }), chapters: [] } });
        const { rerender } = render(<MangaSearch />);
        await searchFor(user, 'one piece');
        await screen.findByText(/^"one piece"/);
        await user.click(within(screen.getAllByTestId('manga-search-source')[0]!).getByRole('button', { name: 'Open: One Piece' }));
        expect(mock.api.manga.details).toHaveBeenCalledWith(1);
        expect(useMangaStore.getState().selectionFrom).toBe('search');
        rerender(<MangaSearch />);
        expect(await screen.findByRole('heading', { name: 'One Piece' })).toBeInTheDocument();
        expect(screen.queryByLabelText('Manga name')).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: '← BACK' }));
        expect(screen.getByLabelText('Manga name')).toHaveValue('one piece');
        expect(screen.getAllByTestId('manga-search-source')).toHaveLength(4);
    });

    it('does not show a manga that was opened from the browse', () => {
        useMangaStore.setState({ selection: { manga: makeSummary(), status: 'ready', details: makeDetails(), chapters: [], selected: [], error: null }, selectionFrom: 'browse' });
        render(<MangaSearch />);
        expect(screen.getByLabelText('Manga name')).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: 'One Piece' })).not.toBeInTheDocument();
    });

    it('says there is no source to search when none is in the language, and offers no search', () => {
        useMangaStore.setState({ browse: { ...useMangaStore.getState().browse, sources: [SOURCES[4]!] } });
        render(<MangaSearch />);
        expect(screen.getByText('No source in this language. Install an extension to search.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'SEARCH' })).toBeDisabled();
    });

    it('shows why the sources could not be read', () => {
        useMangaStore.setState({ browse: { ...useMangaStore.getState().browse, sources: [], sourcesStatus: 'error', sourcesError: { code: 'SERVER_UNAVAILABLE', message: 'down' } } });
        render(<MangaSearch />);
        expect(screen.getByRole('alert')).toHaveTextContent('The manga server is not ready.');
        expect(screen.queryByLabelText('Manga name')).not.toBeInTheDocument();
    });

    it('shows that the sources are being read', () => {
        useMangaStore.setState({ browse: { ...useMangaStore.getState().browse, sources: [], sourcesStatus: 'loading' } });
        render(<MangaSearch />);
        expect(screen.getByText('LOADING…')).toBeInTheDocument();
    });
});
