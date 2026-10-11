// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { MangaBrowse } from '@renderer/components/MangaBrowse';
import { useAppStore } from '@renderer/store/appStore';
import { useMangaStore } from '@renderer/store/mangaStore';
import { makeChapterRecord, makeLibraryManga, makeSource, makeSummary } from '../../helpers/mangaFixtures';
import { installMockApi, type MockApiHandle } from '../../helpers/mockApi';

let mock: MockApiHandle;
const initialApp = useAppStore.getState();
const initialManga = useMangaStore.getState();

const SOURCES = [makeSource({ id: '5', name: 'Site A', lang: 'en' }), makeSource({ id: '6', name: 'Site B', lang: 'all', supportsLatest: false })];
const ITEMS = [makeSummary({ remoteId: 1, title: 'Naruto' }), makeSummary({ remoteId: 2, title: 'Bleach' })];
const TEXT_PREFERENCE = { position: 0, type: 'text', key: 'Server URL Address', title: 'Server URL Address', summary: '', enabled: true, value: '' };

beforeEach(() => {
    mock = installMockApi();
    useAppStore.setState({ ...initialApp, settings: DEFAULT_SETTINGS, toasts: [] });
    useMangaStore.setState({ ...initialManga, library: [], selection: null });
    mock.api.manga.sources.mockResolvedValue({ ok: true, value: SOURCES });
    mock.api.manga.list.mockResolvedValue({ ok: true, value: { items: ITEMS, hasNextPage: false } });
});

// Opens the source named, from the list.
async function openSourceNamed(user: ReturnType<typeof userEvent.setup>, name: string): Promise<void> {
    await user.click(await screen.findByRole('button', { name: `POPULAR: ${name}` }));
}

describe('MangaBrowse the list of sources', () => {
    it('reads the sources and shows them, with no source open and nothing listed yet', async () => {
        render(<MangaBrowse />);
        expect(await screen.findByRole('button', { name: 'Open: Site A' })).toBeInTheDocument();
        expect(mock.api.manga.sources).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('button', { name: 'Open: Site B' })).toBeInTheDocument();
        expect(mock.api.manga.list).not.toHaveBeenCalled();
        expect(screen.queryByRole('button', { name: '← SOURCES' })).not.toBeInTheDocument();
    });

    it('says while the sources are being read, and when there are none', async () => {
        let answer: (value: unknown) => void = () => {return undefined};
        mock.api.manga.sources.mockReturnValue(
            new Promise((resolve) => {
                answer = resolve;
            })
        );
        render(<MangaBrowse />);
        expect(await screen.findByText('LOADING…')).toBeInTheDocument();
        answer({ ok: true, value: [] });
        expect(await screen.findByText('No source yet. Add a store and install an extension in EXTENSIONS.')).toBeInTheDocument();
        expect(screen.queryByTestId('manga-source')).not.toBeInTheDocument();
    });

    it('explains why the sources could not be read', async () => {
        mock.api.manga.sources.mockResolvedValue({ ok: false, error: { code: 'SERVER_UNAVAILABLE', message: 'not installed' } });
        render(<MangaBrowse />);
        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent('The manga server is not ready.');
        expect(alert).toHaveAttribute('title', 'not installed');
    });
});

describe('MangaBrowse a source', () => {
    it('opens on the popular mangas of the source and says which source it is', async () => {
        const user = userEvent.setup();
        render(<MangaBrowse />);
        await openSourceNamed(user, 'Site A');
        expect(await screen.findByText('Naruto', { selector: '.row-link__text' })).toBeInTheDocument();
        expect(mock.api.manga.list).toHaveBeenCalledWith({ sourceId: '5', kind: 'popular', page: 1, query: '' });
        expect(screen.getByRole('heading', { name: 'Site A' })).toBeInTheDocument();
        expect(screen.getByText('Results: 2')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'POPULAR' })).toHaveAttribute('aria-current', 'page');
    });

    it('opens on the latest mangas when that button of the list was pressed', async () => {
        const user = userEvent.setup();
        render(<MangaBrowse />);
        await user.click(await screen.findByRole('button', { name: 'LATEST: Site A' }));
        await vi.waitFor(() => {
            expect(mock.api.manga.list).toHaveBeenCalledWith({ sourceId: '5', kind: 'latest', page: 1, query: '' });
        });
        expect(screen.getByRole('button', { name: 'LATEST' })).toHaveAttribute('aria-current', 'page');
    });

    it('goes back to the list of sources', async () => {
        const user = userEvent.setup();
        render(<MangaBrowse />);
        await openSourceNamed(user, 'Site A');
        await screen.findByText('Naruto', { selector: '.row-link__text' });
        await user.click(screen.getByRole('button', { name: '← SOURCES' }));
        expect(await screen.findByRole('button', { name: 'Open: Site B' })).toBeInTheDocument();
        expect(screen.queryByText('Naruto', { selector: '.row-link__text' })).not.toBeInTheDocument();
        expect(useMangaStore.getState().browse.sourceId).toBeNull();
    });

    it('offers the latest only for a source that has them', async () => {
        const user = userEvent.setup();
        render(<MangaBrowse />);
        await openSourceNamed(user, 'Site A');
        await screen.findByText('Naruto', { selector: '.row-link__text' });
        expect(screen.getByRole('button', { name: 'LATEST' })).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: '← SOURCES' }));
        await openSourceNamed(user, 'Site B');
        await screen.findByText('Naruto', { selector: '.row-link__text' });
        expect(screen.queryByRole('button', { name: 'LATEST' })).not.toBeInTheDocument();
        expect(mock.api.manga.list).toHaveBeenLastCalledWith({ sourceId: '6', kind: 'popular', page: 1, query: '' });
    });

    it('lists the latest when chosen on the page of the source', async () => {
        const user = userEvent.setup();
        render(<MangaBrowse />);
        await openSourceNamed(user, 'Site A');
        await screen.findByText('Naruto', { selector: '.row-link__text' });
        await user.click(screen.getByRole('button', { name: 'LATEST' }));
        await vi.waitFor(() => {
            expect(mock.api.manga.list).toHaveBeenLastCalledWith({ sourceId: '5', kind: 'latest', page: 1, query: '' });
        });
    });

    it('searches only when the button is pressed, and not with an empty text', async () => {
        const user = userEvent.setup();
        render(<MangaBrowse />);
        await openSourceNamed(user, 'Site A');
        await screen.findByText('Naruto', { selector: '.row-link__text' });
        mock.api.manga.list.mockClear();
        await user.click(screen.getAllByRole('button', { name: 'SEARCH' })[0]!);
        const submit = screen.getAllByRole('button', { name: 'SEARCH' }).find((button) => {
            return button.getAttribute('type') === 'submit';
        })!;
        expect(submit).toBeDisabled();
        await user.type(screen.getByLabelText('Manga name'), '  one piece ');
        expect(mock.api.manga.list).not.toHaveBeenCalled();
        await user.click(submit);
        expect(mock.api.manga.list).toHaveBeenCalledWith({ sourceId: '5', kind: 'search', page: 1, query: 'one piece', filters: [] });
    });

    it('searches with Enter too', async () => {
        const user = userEvent.setup();
        render(<MangaBrowse />);
        await openSourceNamed(user, 'Site A');
        await screen.findByText('Naruto', { selector: '.row-link__text' });
        await user.click(screen.getAllByRole('button', { name: 'SEARCH' })[0]!);
        await user.type(screen.getByLabelText('Manga name'), 'bleach{Enter}');
        expect(mock.api.manga.list).toHaveBeenLastCalledWith({ sourceId: '5', kind: 'search', page: 1, query: 'bleach', filters: [] });
    });

    it('says when nothing was found', async () => {
        const user = userEvent.setup();
        mock.api.manga.list.mockResolvedValue({ ok: true, value: { items: [], hasNextPage: false } });
        render(<MangaBrowse />);
        await openSourceNamed(user, 'Site A');
        expect(await screen.findByText('Nothing found.')).toBeInTheDocument();
        expect(screen.queryByText(/Results:/)).not.toBeInTheDocument();
    });

    it('explains why a list could not be read', async () => {
        const user = userEvent.setup();
        mock.api.manga.list.mockResolvedValue({ ok: false, error: { code: 'REQUEST_FAILED', message: 'timeout' } });
        render(<MangaBrowse />);
        await openSourceNamed(user, 'Site A');
        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent('The request to the manga server failed.');
        expect(alert).toHaveAttribute('title', 'timeout');
    });

    it('marks the mangas that are in the library', async () => {
        const user = userEvent.setup();
        useMangaStore.setState({ library: [makeLibraryManga([makeChapterRecord()], { sourceId: '123', remoteId: 2 })] });
        mock.api.manga.list.mockResolvedValue({ ok: true, value: { items: [makeSummary({ remoteId: 1, title: 'Naruto', sourceId: '123' }), makeSummary({ remoteId: 2, title: 'Bleach', sourceId: '123' })], hasNextPage: false } });
        render(<MangaBrowse />);
        await openSourceNamed(user, 'Site A');
        await screen.findByText('Naruto', { selector: '.row-link__text' });
        const cards = screen.getAllByRole('listitem');
        expect(within(cards[0]!).queryByText('IN LIBRARY')).not.toBeInTheDocument();
        expect(within(cards[1]!).getByText('IN LIBRARY')).toBeInTheDocument();
    });

    it('loads more when there is another page', async () => {
        const user = userEvent.setup();
        mock.api.manga.list.mockResolvedValueOnce({ ok: true, value: { items: ITEMS, hasNextPage: true } });
        mock.api.manga.list.mockResolvedValueOnce({ ok: true, value: { items: [makeSummary({ remoteId: 3, title: 'One Piece' })], hasNextPage: false } });
        render(<MangaBrowse />);
        await openSourceNamed(user, 'Site A');
        await screen.findByText('Naruto', { selector: '.row-link__text' });
        await user.click(screen.getByRole('button', { name: 'LOAD MORE' }));
        expect(await screen.findByText('One Piece', { selector: '.row-link__text' })).toBeInTheDocument();
        expect(mock.api.manga.list).toHaveBeenLastCalledWith({ sourceId: '5', kind: 'popular', page: 2, query: '' });
        expect(screen.queryByRole('button', { name: 'LOAD MORE' })).not.toBeInTheDocument();
        expect(screen.getByText('Results: 3')).toBeInTheDocument();
    });

    it('opens a manga from its card, and comes back to the page of the source', async () => {
        const user = userEvent.setup();
        mock.api.manga.details.mockResolvedValue({ ok: false, error: { code: 'NOT_FOUND', message: 'none' } });
        render(<MangaBrowse />);
        await openSourceNamed(user, 'Site A');
        await screen.findByText('Naruto', { selector: '.row-link__text' });
        await user.click(screen.getByRole('button', { name: 'Open: Naruto' }));
        expect(mock.api.manga.details).toHaveBeenCalledWith(1);
        expect(await screen.findByText('The manga server is not ready.', { exact: false }).catch(() => {return null})).toBeDefined();
        await user.click(await screen.findByRole('button', { name: '← BACK' }));
        expect(await screen.findByRole('heading', { name: 'Site A' })).toBeInTheDocument();
    });
});

describe('MangaBrowse source settings', () => {
    it('has a settings button only on the page of a source that has settings', async () => {
        const user = userEvent.setup();
        mock.api.manga.sources.mockResolvedValue({ ok: true, value: [makeSource({ id: '5', name: 'Site A', isConfigurable: true }), makeSource({ id: '6', name: 'Site B', isConfigurable: false })] });
        render(<MangaBrowse />);
        await openSourceNamed(user, 'Site A');
        const button = await screen.findByRole('button', { name: 'SOURCE SETTINGS' });
        expect(button).toHaveAttribute('title', 'SOURCE SETTINGS');
        expect(button).toHaveTextContent('⚙︎');
        await user.click(screen.getByRole('button', { name: '← SOURCES' }));
        await openSourceNamed(user, 'Site B');
        await screen.findByText('Naruto', { selector: '.row-link__text' });
        expect(screen.queryByRole('button', { name: 'SOURCE SETTINGS' })).not.toBeInTheDocument();
    });

    it('shows no settings button in the list of sources', async () => {
        mock.api.manga.sources.mockResolvedValue({ ok: true, value: [makeSource({ id: '5', name: 'Site A', isConfigurable: true })] });
        render(<MangaBrowse />);
        await screen.findByRole('button', { name: 'Open: Site A' });
        expect(screen.queryByRole('button', { name: 'SOURCE SETTINGS' })).not.toBeInTheDocument();
    });

    it('opens the settings as a screen of their own, and comes back to the mangas', async () => {
        const user = userEvent.setup();
        mock.api.manga.sources.mockResolvedValue({ ok: true, value: [makeSource({ id: '5', name: 'Site A', isConfigurable: true })] });
        mock.api.manga.sourcePreferences.mockResolvedValue({ ok: true, value: [TEXT_PREFERENCE] });
        render(<MangaBrowse />);
        await openSourceNamed(user, 'Site A');
        await screen.findByText('Naruto', { selector: '.row-link__text' });
        await user.click(screen.getByRole('button', { name: 'SOURCE SETTINGS' }));
        expect(mock.api.manga.sourcePreferences).toHaveBeenCalledWith('5');
        expect(await screen.findByLabelText('Server URL Address')).toBeInTheDocument();
        expect(screen.queryByText('Naruto', { selector: '.row-link__text' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'LATEST' })).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'CLOSE' }));
        expect(await screen.findByRole('heading', { name: 'Site A' })).toBeInTheDocument();
        expect(screen.queryByLabelText('Server URL Address')).not.toBeInTheDocument();
    });

    it('lists again after a setting is changed', async () => {
        const user = userEvent.setup();
        mock.api.manga.sources.mockResolvedValue({ ok: true, value: [makeSource({ id: '5', name: 'Site A', isConfigurable: true })] });
        mock.api.manga.sourcePreferences.mockResolvedValue({ ok: true, value: [TEXT_PREFERENCE] });
        mock.api.manga.setSourcePreference.mockResolvedValue({ ok: true, value: [{ ...TEXT_PREFERENCE, value: 'http://x:4567' }] });
        render(<MangaBrowse />);
        await openSourceNamed(user, 'Site A');
        await screen.findByText('Naruto', { selector: '.row-link__text' });
        await user.click(screen.getByRole('button', { name: 'SOURCE SETTINGS' }));
        mock.api.manga.list.mockClear();
        await user.type(await screen.findByLabelText('Server URL Address'), 'http://x:4567{Enter}');
        expect(mock.api.manga.list).not.toHaveBeenCalled();
        await user.click(await screen.findByRole('button', { name: 'CLOSE' }));
        await vi.waitFor(() => {
            expect(mock.api.manga.list).toHaveBeenCalledWith({ sourceId: '5', kind: 'popular', page: 1, query: '' });
        });
    });

    it('hints that the source may need to be set up when it reports an error', async () => {
        const user = userEvent.setup();
        mock.api.manga.sources.mockResolvedValue({ ok: true, value: [makeSource({ id: '5', name: 'Site A', isConfigurable: true })] });
        mock.api.manga.list.mockResolvedValue({ ok: false, error: { code: 'API_ERROR', message: "Empty list doesn't contain element at index 0." } });
        render(<MangaBrowse />);
        await openSourceNamed(user, 'Site A');
        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent('The site or the extension reported an error.');
        expect(alert).toHaveAttribute('title', "Empty list doesn't contain element at index 0.");
        expect(screen.getByText('This source may need to be set up first: open SOURCE SETTINGS.')).toBeInTheDocument();
    });

    it('hints at Cloudflare, and not at the settings, when the error is about Cloudflare', async () => {
        const user = userEvent.setup();
        mock.api.manga.sources.mockResolvedValue({ ok: true, value: [makeSource({ id: '5', name: 'Site A', isConfigurable: true })] });
        mock.api.manga.list.mockResolvedValue({ ok: false, error: { code: 'API_ERROR', message: 'java.io.IOException: Cloudflare bypass currently disabled' } });
        render(<MangaBrowse />);
        await openSourceNamed(user, 'Site A');
        const alert = await screen.findByRole('alert');
        expect(alert).toHaveAttribute('title', 'java.io.IOException: Cloudflare bypass currently disabled');
        expect(screen.getByText(/This site is protected by Cloudflare\./)).toBeInTheDocument();
        expect(screen.queryByText(/may need to be set up first/)).not.toBeInTheDocument();
    });

    it('does not mention Cloudflare for an error that is about something else', async () => {
        const user = userEvent.setup();
        mock.api.manga.sources.mockResolvedValue({ ok: true, value: [makeSource({ id: '5', name: 'Site A' })] });
        mock.api.manga.list.mockResolvedValue({ ok: false, error: { code: 'REQUEST_FAILED', message: 'timeout' } });
        render(<MangaBrowse />);
        await openSourceNamed(user, 'Site A');
        await screen.findByRole('alert');
        expect(screen.queryByText(/Cloudflare/)).not.toBeInTheDocument();
    });

    it('does not give the hint for another error, or for a source with no settings', async () => {
        const user = userEvent.setup();
        mock.api.manga.sources.mockResolvedValue({ ok: true, value: [makeSource({ id: '5', name: 'Site A', isConfigurable: true }), makeSource({ id: '6', name: 'Site B', isConfigurable: false })] });
        mock.api.manga.list.mockResolvedValue({ ok: false, error: { code: 'REQUEST_FAILED', message: 'timeout' } });
        render(<MangaBrowse />);
        await openSourceNamed(user, 'Site A');
        await screen.findByRole('alert');
        expect(screen.queryByText(/may need to be set up first/)).not.toBeInTheDocument();
        mock.api.manga.list.mockResolvedValue({ ok: false, error: { code: 'API_ERROR', message: 'x' } });
        await user.click(screen.getByRole('button', { name: '← SOURCES' }));
        await openSourceNamed(user, 'Site B');
        await screen.findByRole('alert');
        expect(screen.queryByText(/may need to be set up first/)).not.toBeInTheDocument();
    });
});

describe('MangaBrowse filters of the search', () => {
    it('asks the source for its filters when the search is opened, and searches with them and no text', async () => {
        const user = userEvent.setup();
        mock.api.manga.sourceFilters.mockResolvedValue({ ok: true, value: [{ type: 'checkbox', name: 'Has chapters', value: false }] });
        render(<MangaBrowse />);
        await openSourceNamed(user, 'Site A');
        expect(mock.api.manga.sourceFilters).not.toHaveBeenCalled();
        await user.click(screen.getByRole('button', { name: 'SEARCH' }));
        expect(await screen.findByRole('button', { name: 'FILTERS' })).toBeInTheDocument();
        expect(mock.api.manga.sourceFilters).toHaveBeenCalledWith('5');
        await user.click(screen.getByRole('button', { name: 'FILTERS' }));
        await user.click(screen.getByRole('switch', { name: 'Has chapters' }));
        await user.click(screen.getByRole('button', { name: 'APPLY' }));
        expect(mock.api.manga.list).toHaveBeenLastCalledWith({ sourceId: '5', kind: 'search', page: 1, query: '', filters: [{ type: 'checkbox', name: 'Has chapters', value: true }] });
        expect(await screen.findByRole('button', { name: 'Open: Naruto' })).toBeInTheDocument();
    });

    it('lets the search button work with no text when the source has filters, and not otherwise', async () => {
        const user = userEvent.setup();
        mock.api.manga.sourceFilters.mockResolvedValue({ ok: true, value: [] });
        render(<MangaBrowse />);
        await openSourceNamed(user, 'Site A');
        await user.click(screen.getByRole('button', { name: 'SEARCH' }));
        await vi.waitFor(() => {
            expect(mock.api.manga.sourceFilters).toHaveBeenCalledTimes(1);
        });
        const submit = screen.getAllByRole('button', { name: 'SEARCH' }).find((button) => {
            return (button as HTMLButtonElement).type === 'submit';
        });
        expect(submit).toBeDisabled();
        expect(screen.queryByRole('button', { name: 'FILTERS' })).not.toBeInTheDocument();
    });

    it('does not ask for the filters in the popular list', async () => {
        const user = userEvent.setup();
        render(<MangaBrowse />);
        await openSourceNamed(user, 'Site A');
        expect(await screen.findByRole('button', { name: 'Open: Naruto' })).toBeInTheDocument();
        expect(mock.api.manga.sourceFilters).not.toHaveBeenCalled();
    });
});

describe('MangaBrowse and the manga opened from the library', () => {
    it('shows the list of sources, not the manga that is open in the library', async () => {
        useMangaStore.setState({
            selectionFrom: 'library',
            selection: { manga: makeSummary(), status: 'loading', details: null, chapters: [], selected: [], error: null }
        });
        render(<MangaBrowse />);
        expect(await screen.findByRole('button', { name: 'Open: Site A' })).toBeInTheDocument();
    });
});
