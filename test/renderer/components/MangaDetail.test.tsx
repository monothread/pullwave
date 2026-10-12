// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { MangaDetail } from '@renderer/components/MangaDetail';
import { useAppStore } from '@renderer/store/appStore';
import { useMangaStore, type MangaSelection } from '@renderer/store/mangaStore';
import { progressKey, saveLastChapter, saveProgress } from '@renderer/components/readerPrefs';
import { makeChapter, makeChapterRecord, makeDetails, makeLibraryManga, makeSource, makeSummary } from '../../helpers/mangaFixtures';
import { installMockApi, type MockApiHandle } from '../../helpers/mockApi';

let mock: MockApiHandle;
const initialApp = useAppStore.getState();
const initialManga = useMangaStore.getState();

const CHAPTERS = [
    makeChapter({ remoteId: 11, name: 'Romance Dawn', number: 1, scanlator: 'Group A', dateUploaded: Date.UTC(2023, 10, 14, 12) }),
    makeChapter({ remoteId: 12, name: '', number: 2, scanlator: null, dateUploaded: null }),
    makeChapter({ remoteId: 13, name: '', number: null, scanlator: null, dateUploaded: null })
];

function open(overrides: Partial<MangaSelection> = {}): void {
    useMangaStore.setState({
        selection: { manga: makeSummary(), status: 'ready', details: makeDetails(), chapters: CHAPTERS, selected: [], error: null, ...overrides }
    });
}

beforeEach(() => {
    mock = installMockApi();
    useAppStore.setState({ ...initialApp, settings: DEFAULT_SETTINGS, toasts: [] });
    useMangaStore.setState({ ...initialManga, library: [], selection: null, selectionFrom: 'library', view: 'library' });
});

describe('MangaDetail', () => {
    it('shows nothing without an open manga', () => {
        const { container } = render(<MangaDetail />);
        expect(container).toBeEmptyDOMElement();
    });

    it('shows what the source says about the manga', () => {
        open();
        render(<MangaDetail />);
        expect(screen.getByRole('heading', { name: 'One Piece' })).toBeInTheDocument();
        expect(screen.getByText(/^Author:/)).toHaveTextContent('Author: Oda');
        expect(screen.getByText(/^Artist:/)).toHaveTextContent('Artist: Oda E.');
        expect(screen.getByText('Ongoing')).toBeInTheDocument();
        expect(
            within(screen.getByRole('list', { name: 'Genres and tags' }))
                .getAllByRole('button')
                .map((button) => {
                    return button.textContent;
                })
        ).toEqual(['Action', 'Adventure']);
        expect(screen.getByText('Pirates search for a treasure.')).toBeInTheDocument();
        expect(document.querySelector('img.cover')).toHaveAttribute('src', 'http://127.0.0.1:4321/api/v1/manga/7/thumbnail');
    });

    it('leaves out what the source does not tell', () => {
        open({ details: makeDetails({ author: null, artist: null, description: null, genres: [] }) });
        render(<MangaDetail />);
        expect(screen.queryByText(/Author:/)).not.toBeInTheDocument();
        expect(screen.queryByText(/Artist:/)).not.toBeInTheDocument();
        expect(document.querySelector('.manga__description')).toBeNull();
    });

    it('shows the title of the list while the details are loading', () => {
        open({ status: 'loading', details: null, chapters: [] });
        render(<MangaDetail />);
        expect(screen.getByRole('heading', { name: 'One Piece' })).toBeInTheDocument();
        expect(screen.getByText('LOADING CHAPTERS…')).toBeInTheDocument();
        expect(screen.queryByText(/Author:/)).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /DOWNLOAD SELECTED/ })).not.toBeInTheDocument();
    });

    it('explains why the manga could not be opened', () => {
        open({ status: 'error', details: null, chapters: [], error: { code: 'API_ERROR', message: 'Source not found' } });
        render(<MangaDetail />);
        const alert = screen.getByRole('alert');
        expect(alert).toHaveTextContent('The site or the extension reported an error.');
        expect(alert).toHaveAttribute('title', 'Source not found');
    });

    it('hints at Cloudflare when the manga could not be opened because of it', () => {
        open({ status: 'error', details: null, chapters: [], error: { code: 'API_ERROR', message: 'Cloudflare bypass currently disabled' } });
        render(<MangaDetail />);
        expect(screen.getByRole('alert')).toHaveAttribute('title', 'Cloudflare bypass currently disabled');
        expect(screen.getByText(/This site is protected by Cloudflare\./)).toBeInTheDocument();
    });

    it('does not mention Cloudflare for another error', () => {
        open({ status: 'error', details: null, chapters: [], error: { code: 'API_ERROR', message: 'Source not found' } });
        render(<MangaDetail />);
        expect(screen.queryByText(/Cloudflare/)).not.toBeInTheDocument();
    });

    it('says when there are no chapters', () => {
        open({ chapters: [] });
        render(<MangaDetail />);
        expect(screen.getByText('This manga has no chapters.')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'ADD TO LIBRARY' })).not.toBeInTheDocument();
    });

    it('lists the chapters with the name, the group and the date', () => {
        open();
        render(<MangaDetail />);
        expect(screen.getByText('Chapters (3)')).toBeInTheDocument();
        const rows = screen.getAllByTestId('manga-chapter');
        expect(rows).toHaveLength(3);
        expect(within(rows[0]!).getByRole('checkbox', { name: 'Select: Romance Dawn' })).not.toBeChecked();
        expect(rows[0]).toHaveTextContent(`Group A · ${new Date(Date.UTC(2023, 10, 14, 12)).toLocaleDateString()}`);
        expect(within(rows[1]!).getByRole('checkbox', { name: 'Select: #2' })).toBeInTheDocument();
        expect(rows[2]!.querySelector('input')).toHaveAttribute('aria-label', 'Select: ');
    });

    it('shows the state of the chapters the library already has', () => {
        useMangaStore.setState({ library: [makeLibraryManga([makeChapterRecord({ remoteId: 11, status: 'done' }), makeChapterRecord({ id: 2, remoteId: 12, status: 'error' })])] });
        open();
        render(<MangaDetail />);
        const rows = screen.getAllByTestId('manga-chapter');
        expect(within(rows[0]!).getByText('Downloaded')).toHaveClass('badge--done');
        expect(within(rows[1]!).getByText('Failed')).toHaveClass('badge--error');
        expect(within(rows[2]!).queryByText(/Downloaded|Failed|Waiting/)).not.toBeInTheDocument();
    });

    it('picks chapters one by one', async () => {
        const user = userEvent.setup();
        open();
        render(<MangaDetail />);
        await user.click(screen.getByRole('checkbox', { name: 'Select: Romance Dawn' }));
        await user.click(screen.getByRole('checkbox', { name: 'Select: #2' }));
        expect(useMangaStore.getState().selection?.selected).toEqual([11, 12]);
        expect(screen.getByRole('button', { name: 'DOWNLOAD SELECTED (2)' })).toBeEnabled();
        await user.click(screen.getByRole('checkbox', { name: 'Select: Romance Dawn' }));
        expect(useMangaStore.getState().selection?.selected).toEqual([12]);
    });

    it('picks all, none or the ones that are not downloaded', async () => {
        const user = userEvent.setup();
        useMangaStore.setState({ library: [makeLibraryManga([makeChapterRecord({ remoteId: 11, status: 'done' })])] });
        open();
        render(<MangaDetail />);
        await user.click(screen.getByRole('button', { name: 'ALL' }));
        expect(useMangaStore.getState().selection?.selected).toEqual([11, 12, 13]);
        await user.click(screen.getByRole('button', { name: 'NONE' }));
        expect(useMangaStore.getState().selection?.selected).toEqual([]);
        await user.click(screen.getByRole('button', { name: 'NOT DOWNLOADED' }));
        expect(useMangaStore.getState().selection?.selected).toEqual([12, 13]);
    });

    it('does not count the chapters that are downloaded, waiting or going on, and does not send them', async () => {
        const user = userEvent.setup();
        mock.api.manga.download.mockResolvedValue(makeLibraryManga([]));
        useMangaStore.setState({
            library: [
                makeLibraryManga([
                    makeChapterRecord({ id: 1, remoteId: 11, status: 'done' }),
                    makeChapterRecord({ id: 2, remoteId: 12, status: 'queued' }),
                    makeChapterRecord({ id: 3, remoteId: 13, status: 'error' })
                ])
            ]
        });
        open({ selected: [11, 12, 13] });
        render(<MangaDetail />);
        expect(screen.getByRole('button', { name: 'DOWNLOAD SELECTED (1)' })).toBeEnabled();
        await user.click(screen.getByRole('button', { name: 'DOWNLOAD SELECTED (1)' }));
        expect(mock.api.manga.download).toHaveBeenCalledWith({ manga: makeSummary(), details: makeDetails(), chapters: [CHAPTERS[2]] });
    });

    it('cannot download when everything picked is downloaded already', () => {
        useMangaStore.setState({ library: [makeLibraryManga([makeChapterRecord({ id: 1, remoteId: 11, status: 'done' }), makeChapterRecord({ id: 2, remoteId: 12, status: 'downloading' })])] });
        open({ selected: [11, 12] });
        render(<MangaDetail />);
        expect(screen.getByRole('button', { name: 'DOWNLOAD SELECTED (0)' })).toBeDisabled();
    });

    it('cannot download with no chapter picked', () => {
        open();
        render(<MangaDetail />);
        expect(screen.getByRole('button', { name: 'DOWNLOAD SELECTED (0)' })).toBeDisabled();
    });

    it('downloads the chapters picked', async () => {
        const user = userEvent.setup();
        mock.api.manga.download.mockResolvedValue(makeLibraryManga([]));
        open({ selected: [12] });
        render(<MangaDetail />);
        await user.click(screen.getByRole('button', { name: 'DOWNLOAD SELECTED (1)' }));
        expect(mock.api.manga.download).toHaveBeenCalledWith({ manga: makeSummary(), details: makeDetails(), chapters: [CHAPTERS[1]] });
    });

    it('goes back to the list', async () => {
        const user = userEvent.setup();
        open();
        render(<MangaDetail />);
        await user.click(screen.getByRole('button', { name: '← BACK' }));
        expect(useMangaStore.getState().selection).toBeNull();
    });
});

describe('MangaDetail reading', () => {
    const NEWEST_FIRST = [
        makeChapter({ remoteId: 13, name: 'Third', number: 3, sourceOrder: 3 }),
        makeChapter({ remoteId: 12, name: 'Second', number: 2, sourceOrder: 2 }),
        makeChapter({ remoteId: 11, name: 'First', number: 1, sourceOrder: 1 })
    ];

    it('reads a chapter from the source, among the chapters in reading order', async () => {
        const user = userEvent.setup();
        open({ chapters: NEWEST_FIRST });
        render(<MangaDetail />);
        await user.click(screen.getByRole('button', { name: 'READ: Second' }));
        expect(mock.api.manga.readPages).toHaveBeenCalledWith({ chapterRemoteId: 12, libraryChapterId: null });
        expect(useMangaStore.getState().reader).toMatchObject({
            mangaTitle: 'One Piece',
            index: 1,
            chapters: [
                { remoteId: 11, libraryChapterId: null, name: 'First', number: 1 },
                { remoteId: 12, libraryChapterId: null, name: 'Second', number: 2 },
                { remoteId: 13, libraryChapterId: null, name: 'Third', number: 3 }
            ]
        });
    });

    it('reads from the file when the chapter is in the library', async () => {
        const user = userEvent.setup();
        useMangaStore.setState({ library: [makeLibraryManga([makeChapterRecord({ id: 5, remoteId: 12, status: 'done' })])] });
        open({ chapters: NEWEST_FIRST });
        render(<MangaDetail />);
        await user.click(screen.getByRole('button', { name: 'READ: Second' }));
        expect(mock.api.manga.readPages).toHaveBeenCalledWith({ chapterRemoteId: 12, libraryChapterId: 5 });
    });
});

describe('MangaDetail removing the download of a chapter of the library', () => {
    it('offers it only for the chapters that are downloaded', async () => {
        const user = userEvent.setup();
        const library = [
            makeLibraryManga([
                makeChapterRecord({ id: 1, remoteId: 11, status: 'done' }),
                makeChapterRecord({ id: 2, remoteId: 12, status: 'error' }),
                makeChapterRecord({ id: 3, remoteId: 13, status: 'downloading' }),
                makeChapterRecord({ id: 4, remoteId: 14, status: 'idle' })
            ])
        ];
        // The library is read again after a removal: the mock gives the same one back.
        mock.api.manga.library.mockResolvedValue(library);
        useMangaStore.setState({ library });
        open({ chapters: [...CHAPTERS, makeChapter({ remoteId: 14, name: 'Fourth', number: 4 })] });
        render(<MangaDetail />);
        expect(screen.queryByRole('button', { name: /^Remove chapter/ })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Remove download: #2' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Remove download: ' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Remove download: Fourth' })).not.toBeInTheDocument();
        expect(screen.getAllByRole('button', { name: /^Remove download/ })).toHaveLength(1);
        await user.click(screen.getByRole('button', { name: 'Remove download: Romance Dawn' }));
        expect(mock.api.manga.removeDownload).toHaveBeenCalledTimes(1);
        expect(mock.api.manga.removeDownload).toHaveBeenCalledWith(1);
    });

    it('keeps the chapter in the list as not downloaded once its download is gone', () => {
        useMangaStore.setState({ library: [makeLibraryManga([makeChapterRecord({ id: 1, remoteId: 11, status: 'idle' })])] });
        open();
        render(<MangaDetail />);
        expect(within(screen.getAllByTestId('manga-chapter')[0]!).getByText('Not downloaded')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^Remove download/ })).not.toBeInTheDocument();
    });

    it('offers nothing to remove for a chapter the library does not have', () => {
        open();
        render(<MangaDetail />);
        expect(screen.queryByRole('button', { name: /^Remove download/ })).not.toBeInTheDocument();
    });
});

describe('MangaDetail in the library page', () => {
    const SAVED = makeLibraryManga([makeChapterRecord({ id: 1, remoteId: 11, status: 'done' }), makeChapterRecord({ id: 2, remoteId: 12, status: 'idle' })], { id: 9 });

    it('has no button that downloads what is missing, whatever is downloaded', () => {
        useMangaStore.setState({ library: [SAVED] });
        open();
        const { unmount } = render(<MangaDetail />);
        expect(screen.queryByRole('button', { name: 'DOWNLOAD MISSING' })).not.toBeInTheDocument();
        unmount();
        useMangaStore.setState({ library: [makeLibraryManga([makeChapterRecord({ remoteId: 11, status: 'done' })])] });
        render(<MangaDetail />);
        expect(screen.queryByRole('button', { name: 'DOWNLOAD MISSING' })).not.toBeInTheDocument();
        expect(mock.api.manga.downloadMissing).not.toHaveBeenCalled();
    });

    it('goes to the source, on the page of the manga there, when the extension is installed', async () => {
        const user = userEvent.setup();
        useMangaStore.setState({ library: [SAVED], browse: { ...initialManga.browse, sources: [makeSource({ id: '123' })], sourcesStatus: 'ready' } });
        open();
        render(<MangaDetail />);
        await user.click(screen.getByRole('button', { name: 'GO TO SOURCE' }));
        expect(useMangaStore.getState().view).toBe('browse');
        expect(useMangaStore.getState().browse.sourceId).toBe('123');
        expect(useMangaStore.getState().selectionFrom).toBe('browse');
        expect(mock.api.manga.details).toHaveBeenCalledWith(7);
    });

    it('cannot go to the source when its extension is not installed, and says why', () => {
        useMangaStore.setState({ library: [SAVED] });
        open();
        render(<MangaDetail />);
        const button = screen.getByRole('button', { name: 'GO TO SOURCE' });
        expect(button).toBeDisabled();
        expect(button).toHaveAttribute('title', 'The extension of this source is not installed.');
    });

    it('has no button to add to the library or to go to it, since it is there', () => {
        useMangaStore.setState({ library: [SAVED] });
        open();
        render(<MangaDetail />);
        expect(screen.queryByRole('button', { name: 'ADD TO LIBRARY' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'GO TO LIBRARY' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /ADD MISSING CHAPTERS/ })).not.toBeInTheDocument();
    });

    it('reads a chapter by clicking on its row, with no READ button', async () => {
        const user = userEvent.setup();
        open();
        render(<MangaDetail />);
        const row = screen.getAllByTestId('manga-chapter')[0]!;
        expect(row).toHaveClass('row--link');
        // Only the link that reads and the button that marks the chapter as read.
        expect(within(row).getAllByRole('button')).toHaveLength(2);
        expect(within(row).queryByText('READ')).not.toBeInTheDocument();
        await user.click(within(row).getByRole('button', { name: 'READ: Romance Dawn' }));
        expect(mock.api.manga.readPages).toHaveBeenCalledWith({ chapterRemoteId: 11, libraryChapterId: null });
    });
});

describe('MangaDetail in the page of the browse', () => {
    const SAVED = makeLibraryManga([makeChapterRecord({ id: 1, remoteId: 11, status: 'done' })], { id: 9 });

    beforeEach(() => {
        useMangaStore.setState({ selectionFrom: 'browse', view: 'browse' });
    });

    it('only reads and adds: no way to pick, download or remove chapters', () => {
        useMangaStore.setState({ library: [SAVED] });
        open();
        render(<MangaDetail />);
        expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /DOWNLOAD/ })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'ALL' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'NONE' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'NOT DOWNLOADED' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^Remove download/ })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'GO TO SOURCE' })).not.toBeInTheDocument();
    });

    it('still shows the state of the chapters the library has', () => {
        useMangaStore.setState({ library: [SAVED] });
        open();
        render(<MangaDetail />);
        expect(within(screen.getAllByTestId('manga-chapter')[0]!).getByText('Downloaded')).toBeInTheDocument();
    });

    it('adds the manga to the library', async () => {
        const user = userEvent.setup();
        mock.api.manga.addToLibrary.mockResolvedValue(makeLibraryManga([]));
        open();
        render(<MangaDetail />);
        expect(screen.queryByRole('button', { name: 'GO TO LIBRARY' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /ADD MISSING CHAPTERS/ })).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'ADD TO LIBRARY' }));
        expect(mock.api.manga.addToLibrary).toHaveBeenCalledWith({ manga: makeSummary(), details: makeDetails(), chapters: CHAPTERS });
    });

    it('goes to the library, on the page of the manga there, when it is in it', async () => {
        const user = userEvent.setup();
        useMangaStore.setState({ library: [SAVED] });
        open();
        render(<MangaDetail />);
        expect(screen.queryByRole('button', { name: 'ADD TO LIBRARY' })).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'GO TO LIBRARY' }));
        expect(useMangaStore.getState().view).toBe('library');
        expect(useMangaStore.getState().selectionFrom).toBe('library');
        expect(mock.api.manga.details).toHaveBeenCalledWith(7);
    });

    it('adds the chapters the library does not have yet, and says how many', async () => {
        const user = userEvent.setup();
        mock.api.manga.addToLibrary.mockResolvedValue(SAVED);
        useMangaStore.setState({ library: [SAVED] });
        open();
        render(<MangaDetail />);
        await user.click(screen.getByRole('button', { name: 'ADD MISSING CHAPTERS (2)' }));
        expect(mock.api.manga.addToLibrary).toHaveBeenCalledWith({ manga: makeSummary(), details: makeDetails(), chapters: CHAPTERS });
    });

    it('cannot add chapters when the library has them all', () => {
        useMangaStore.setState({ library: [makeLibraryManga(CHAPTERS.map((chapter, index) => {
            return makeChapterRecord({ id: index + 1, remoteId: chapter.remoteId });
        }), { id: 9 })] });
        open();
        render(<MangaDetail />);
        expect(screen.getByRole('button', { name: 'ADD MISSING CHAPTERS (0)' })).toBeDisabled();
    });

    it('reads a chapter by clicking on its row', async () => {
        const user = userEvent.setup();
        open();
        render(<MangaDetail />);
        await user.click(screen.getByRole('button', { name: 'READ: Romance Dawn' }));
        expect(mock.api.manga.readPages).toHaveBeenCalledWith({ chapterRemoteId: 11, libraryChapterId: null });
    });
});

describe('MangaDetail searching by what the source says', () => {
    beforeEach(() => {
        useMangaStore.setState({ selectionFrom: 'browse', view: 'browse', browse: { ...initialManga.browse, sources: [makeSource({ id: '123' })], sourcesStatus: 'ready' } });
        mock.api.manga.sourceFilters.mockResolvedValue({
            ok: true,
            value: [
                { type: 'text', name: 'Title', value: '' },
                { type: 'group', name: 'Genres', filters: [{ type: 'tristate', name: 'Action', value: 'ignore' }, { type: 'tristate', name: 'Adventure', value: 'ignore' }] },
                { type: 'group', name: 'Authors', filters: [{ type: 'checkbox', name: 'Oda', value: false }] }
            ]
        });
        mock.api.manga.list.mockResolvedValue({ ok: true, value: { items: [], hasNextPage: false } });
    });

    it('opens the search of the source with the genre as a filter that is on', async () => {
        const user = userEvent.setup();
        open();
        render(<MangaDetail />);
        await user.click(screen.getByRole('button', { name: 'Search by: Adventure' }));
        await vi.waitFor(() => {
            expect(mock.api.manga.list).toHaveBeenCalledTimes(1);
        });
        expect(mock.api.manga.sourceFilters).toHaveBeenCalledWith('123');
        expect(mock.api.manga.list).toHaveBeenCalledWith({
            sourceId: '123',
            kind: 'search',
            page: 1,
            query: '',
            filters: [
                { type: 'text', name: 'Title', value: '' },
                { type: 'group', name: 'Genres', filters: [{ type: 'tristate', name: 'Action', value: 'ignore' }, { type: 'tristate', name: 'Adventure', value: 'include' }] },
                { type: 'group', name: 'Authors', filters: [{ type: 'checkbox', name: 'Oda', value: false }] }
            ]
        });
        expect(useMangaStore.getState()).toMatchObject({ view: 'browse', selection: null });
        expect(useMangaStore.getState().browse).toMatchObject({ sourceId: '123', mode: 'search', filtersOpen: true });
    });

    it('does the same for the author when the source has a filter for them', async () => {
        const user = userEvent.setup();
        open();
        render(<MangaDetail />);
        await user.click(screen.getByRole('button', { name: 'Search by: Oda' }));
        await vi.waitFor(() => {
            expect(mock.api.manga.list).toHaveBeenCalledTimes(1);
        });
        const sent = mock.api.manga.list.mock.calls[0]![0];
        expect(sent).toMatchObject({ kind: 'search', query: '' });
        expect(sent.filters?.[2]).toEqual({ type: 'group', name: 'Authors', filters: [{ type: 'checkbox', name: 'Oda', value: true }] });
    });

    it('searches by the text when the source has no filter for it', async () => {
        const user = userEvent.setup();
        open({ details: makeDetails({ artist: 'Someone Else' }) });
        render(<MangaDetail />);
        await user.click(screen.getByRole('button', { name: 'Search by: Someone Else' }));
        await vi.waitFor(() => {
            expect(mock.api.manga.list).toHaveBeenCalledTimes(1);
        });
        expect(mock.api.manga.list).toHaveBeenCalledWith({
            sourceId: '123',
            kind: 'search',
            page: 1,
            query: 'Someone Else',
            filters: [
                { type: 'text', name: 'Title', value: '' },
                { type: 'group', name: 'Genres', filters: [{ type: 'tristate', name: 'Action', value: 'ignore' }, { type: 'tristate', name: 'Adventure', value: 'ignore' }] },
                { type: 'group', name: 'Authors', filters: [{ type: 'checkbox', name: 'Oda', value: false }] }
            ]
        });
    });
});

describe('MangaDetail the site of the source and the chapters that failed', () => {
    it('opens the page of the manga on its site', async () => {
        const user = userEvent.setup();
        open();
        render(<MangaDetail />);
        const button = screen.getByRole('button', { name: 'OPEN SITE' });
        expect(button).toHaveAttribute('title', 'https://dex.example/manga/one-piece');
        await user.click(button);
        expect(mock.api.manga.openSite).toHaveBeenCalledWith('https://dex.example/manga/one-piece');
    });

    it('has no such button when the source does not say where the manga is, or while it loads', () => {
        open({ details: makeDetails({ url: null }) });
        const { rerender } = render(<MangaDetail />);
        expect(screen.queryByRole('button', { name: 'OPEN SITE' })).not.toBeInTheDocument();
        open({ status: 'loading', details: null, chapters: [] });
        rerender(<MangaDetail />);
        expect(screen.queryByRole('button', { name: 'OPEN SITE' })).not.toBeInTheDocument();
    });

    it('shows the button on the page of the browse too', () => {
        useMangaStore.setState({ selectionFrom: 'browse', view: 'browse' });
        open();
        render(<MangaDetail />);
        expect(screen.getByRole('button', { name: 'OPEN SITE' })).toBeInTheDocument();
    });

    it('offers to try again a chapter that failed or was cancelled, in the library page only', async () => {
        const user = userEvent.setup();
        useMangaStore.setState({
            library: [
                makeLibraryManga([
                    makeChapterRecord({ id: 1, remoteId: 11, status: 'error' }),
                    makeChapterRecord({ id: 2, remoteId: 12, status: 'cancelled' }),
                    makeChapterRecord({ id: 3, remoteId: 13, status: 'done' })
                ])
            ]
        });
        open();
        render(<MangaDetail />);
        expect(screen.queryByRole('button', { name: 'RETRY: #3' })).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'RETRY: Romance Dawn' }));
        expect(mock.api.manga.retry).toHaveBeenCalledWith(1);
        await user.click(screen.getByRole('button', { name: 'RETRY: #2' }));
        expect(mock.api.manga.retry).toHaveBeenLastCalledWith(2);
    });

    it('does not offer it on the page of the browse', () => {
        useMangaStore.setState({ selectionFrom: 'browse', view: 'browse', library: [makeLibraryManga([makeChapterRecord({ id: 1, remoteId: 11, status: 'error' })])] });
        open();
        render(<MangaDetail />);
        expect(screen.queryByRole('button', { name: /^RETRY/ })).not.toBeInTheDocument();
    });
});

describe('MangaDetail organizing a manga of the library', () => {
    const SAVED = makeLibraryManga([makeChapterRecord({ id: 1, remoteId: 11, status: 'done' })], { id: 9 });

    beforeEach(() => {
        mock.api.manga.groups.mockResolvedValue([{ id: 1, name: 'Mangas' }]);
        mock.api.manga.library.mockResolvedValue([SAVED]);
        useMangaStore.setState({ library: [SAVED], groups: [{ id: 1, name: 'Mangas' }], browse: { ...initialManga.browse, sources: [makeSource({ id: '123' }), makeSource({ id: '200', name: 'Other Dex' })], sourcesStatus: 'ready' } });
    });

    async function openGear(user: ReturnType<typeof userEvent.setup>): Promise<void> {
        await user.click(screen.getByRole('button', { name: 'Groups, series and source' }));
    }

    it('keeps the groups, the series and the move to another source behind a gear at the corner of the head of the manga', async () => {
        const user = userEvent.setup();
        open();
        render(<MangaDetail />);
        const gear = screen.getByRole('button', { name: 'Groups, series and source' });
        expect(gear).toHaveClass('manga__head-gear');
        expect(gear).toHaveAttribute('aria-expanded', 'false');
        expect(gear.closest('header')).toHaveClass('manga__head');
        expect(screen.queryByRole('list', { name: 'Groups of One Piece' })).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Series')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'MIGRATE TO ANOTHER SOURCE' })).not.toBeInTheDocument();
        await openGear(user);
        expect(gear).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByRole('list', { name: 'Groups of One Piece' })).toBeInTheDocument();
        expect(screen.getByLabelText('Series')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'MIGRATE TO ANOTHER SOURCE' })).toBeInTheDocument();
        await openGear(user);
        expect(screen.queryByLabelText('Series')).not.toBeInTheDocument();
    });

    it('puts the manga in a group from there', async () => {
        const user = userEvent.setup();
        open();
        render(<MangaDetail />);
        await openGear(user);
        await user.click(screen.getByRole('button', { name: 'Mangas' }));
        expect(mock.api.manga.setGroupMembers).toHaveBeenCalledWith(1, [9], true);
    });

    it('joins the manga to a series from there', async () => {
        const user = userEvent.setup();
        open();
        render(<MangaDetail />);
        await openGear(user);
        await user.type(screen.getByLabelText('Series'), 'One Piece');
        await user.click(screen.getByRole('button', { name: 'SAVE SERIES' }));
        expect(mock.api.manga.setSeries).toHaveBeenCalledWith({ mangaId: 9, series: 'One Piece', season: 1, seasonName: null });
    });

    it('opens the panel to move the manga to another source, and closes it', async () => {
        const user = userEvent.setup();
        open();
        render(<MangaDetail />);
        await openGear(user);
        await user.click(screen.getByRole('button', { name: 'MIGRATE TO ANOTHER SOURCE' }));
        expect(screen.getByRole('region', { name: 'MIGRATE TO ANOTHER SOURCE' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'MIGRATE TO ANOTHER SOURCE' })).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'CANCEL' }));
        expect(screen.getByRole('button', { name: 'MIGRATE TO ANOTHER SOURCE' })).toBeInTheDocument();
    });

    it('shows none of that on the page of the browse, nor for a manga that is not in the library', () => {
        useMangaStore.setState({ selectionFrom: 'browse', view: 'browse' });
        open();
        const { rerender } = render(<MangaDetail />);
        expect(screen.queryByRole('button', { name: 'Groups, series and source' })).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Series')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'MIGRATE TO ANOTHER SOURCE' })).not.toBeInTheDocument();
        useMangaStore.setState({ selectionFrom: 'library', view: 'library', library: [] });
        rerender(<MangaDetail />);
        expect(screen.queryByRole('button', { name: 'Groups, series and source' })).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Series')).not.toBeInTheDocument();
        expect(screen.queryByRole('list', { name: /^Groups of/ })).not.toBeInTheDocument();
    });
});

describe('MangaDetail what was read', () => {
    const ORDERED = [
        makeChapter({ remoteId: 13, name: 'Third', number: 3, sourceOrder: 3 }),
        makeChapter({ remoteId: 12, name: 'Second', number: 2, sourceOrder: 2 }),
        makeChapter({ remoteId: 11, name: 'First', number: 1, sourceOrder: 1 })
    ];

    beforeEach(() => {
        window.localStorage.clear();
        useMangaStore.setState({ readKeys: [] });
    });

    it('offers to start reading when nothing was read, from the first chapter', async () => {
        const user = userEvent.setup();
        open({ chapters: ORDERED });
        render(<MangaDetail />);
        expect(screen.queryByRole('button', { name: 'CONTINUE READING' })).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'START READING' }));
        expect(mock.api.manga.readPages).toHaveBeenCalledWith({ chapterRemoteId: 11, libraryChapterId: null });
        expect(useMangaStore.getState().reader).toMatchObject({ mangaTitle: 'One Piece', index: 0 });
    });

    it('continues in the chapter the manga was left on, which reader resumes on its page', async () => {
        const user = userEvent.setup();
        saveLastChapter('One Piece', 12);
        saveProgress(progressKey('One Piece', 12), 4);
        open({ chapters: ORDERED });
        render(<MangaDetail />);
        expect(screen.getByText(/left on page 5/)).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'CONTINUE READING' }));
        expect(mock.api.manga.readPages).toHaveBeenCalledWith({ chapterRemoteId: 12, libraryChapterId: null });
        expect(useMangaStore.getState().reader.index).toBe(1);
    });

    it('continues in the first chapter that is not read when the one it was left on is read', async () => {
        const user = userEvent.setup();
        saveLastChapter('One Piece', 11);
        useMangaStore.setState({ readKeys: [progressKey('One Piece', 11), progressKey('One Piece', 12)] });
        open({ chapters: ORDERED });
        render(<MangaDetail />);
        await user.click(screen.getByRole('button', { name: 'CONTINUE READING' }));
        expect(mock.api.manga.readPages).toHaveBeenCalledWith({ chapterRemoteId: 13, libraryChapterId: null });
    });

    it('starts again from the first chapter when everything is read', async () => {
        const user = userEvent.setup();
        useMangaStore.setState({ readKeys: ORDERED.map((chapter) => {return progressKey('One Piece', chapter.remoteId)}) });
        open({ chapters: ORDERED });
        render(<MangaDetail />);
        await user.click(screen.getByRole('button', { name: 'CONTINUE READING' }));
        expect(mock.api.manga.readPages).toHaveBeenCalledWith({ chapterRemoteId: 11, libraryChapterId: null });
    });

    it('marks a chapter as read and as not read from its row, and says it is read', async () => {
        const user = userEvent.setup();
        open({ chapters: ORDERED });
        render(<MangaDetail />);
        const second = (): HTMLElement => {
            return screen.getAllByTestId('manga-chapter')[1]!;
        };
        expect(within(second()).queryByText('Read')).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Mark as read: Second' }));
        expect(useMangaStore.getState().readKeys).toEqual([progressKey('One Piece', 12)]);
        expect(within(second()).getByText('Read')).toHaveClass('badge--done');
        expect(window.localStorage.getItem('pullwave.manga.read')).toBe(JSON.stringify([progressKey('One Piece', 12)]));
        await user.click(screen.getByRole('button', { name: 'Mark as not read: Second' }));
        expect(useMangaStore.getState().readKeys).toEqual([]);
        expect(within(second()).queryByText('Read')).not.toBeInTheDocument();
    });

    it('marks the whole manga as read, and then as not read', async () => {
        const user = userEvent.setup();
        open({ chapters: ORDERED });
        render(<MangaDetail />);
        await user.click(screen.getByRole('button', { name: 'MARK ALL AS READ' }));
        expect([...useMangaStore.getState().readKeys].sort()).toEqual([11, 12, 13].map((id) => {return progressKey('One Piece', id)}).sort());
        expect(screen.getAllByText('Read')).toHaveLength(3);
        await user.click(screen.getByRole('button', { name: 'MARK ALL AS NOT READ' }));
        expect(useMangaStore.getState().readKeys).toEqual([]);
        expect(screen.queryByText('Read')).not.toBeInTheDocument();
    });

    it('does not say the page a read chapter was left on', () => {
        saveProgress(progressKey('One Piece', 12), 3);
        useMangaStore.setState({ readKeys: [progressKey('One Piece', 12)] });
        open({ chapters: ORDERED });
        render(<MangaDetail />);
        expect(screen.queryByText(/left on page/)).not.toBeInTheDocument();
    });

    it('has no way to start reading, continue or mark as read on the page of the browse, which only adds and reads one chapter', async () => {
        const user = userEvent.setup();
        saveLastChapter('One Piece', 12);
        saveProgress(progressKey('One Piece', 12), 4);
        useMangaStore.setState({ selectionFrom: 'browse', view: 'browse', readKeys: [progressKey('One Piece', 11)] });
        open({ chapters: ORDERED });
        render(<MangaDetail />);
        expect(screen.queryByRole('button', { name: 'START READING' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'CONTINUE READING' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^MARK ALL AS/ })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^Mark as/ })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'ADD TO LIBRARY' })).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Read: Second' }));
        expect(mock.api.manga.readPages).toHaveBeenCalledWith({ chapterRemoteId: 12, libraryChapterId: null });
    });
});

describe('MangaDetail the chapters that are new today', () => {
    it('marks the chapters that arrived in the library today, and no other', () => {
        const now = Date.now();
        const old = now - 30 * 24 * 3_600_000;
        useMangaStore.setState({
            library: [
                makeLibraryManga(
                    [
                        makeChapterRecord({ id: 1, remoteId: 11, status: 'idle', addedAt: now - 1000 }),
                        makeChapterRecord({ id: 2, remoteId: 12, status: 'idle', addedAt: old }),
                        makeChapterRecord({ id: 3, remoteId: 13, status: 'idle', addedAt: null })
                    ]
                )
            ]
        });
        open();
        render(<MangaDetail />);
        const rows = screen.getAllByTestId('manga-chapter');
        expect(within(rows[0]!).getByText('NEW')).toHaveClass('badge--new');
        expect(within(rows[1]!).queryByText('NEW')).not.toBeInTheDocument();
        expect(within(rows[2]!).queryByText('NEW')).not.toBeInTheDocument();
    });
});

describe('MangaDetail looking at the source in the background', () => {
    function setRefresh(refresh: { loading: boolean; error: { code: 'REQUEST_FAILED'; message: string } | null }): void {
        useMangaStore.setState({ selectionRefresh: refresh });
    }

    it('says the source is being looked at while the chapters of the library are already there', () => {
        open();
        setRefresh({ loading: true, error: null });
        render(<MangaDetail />);
        expect(screen.getByText('Looking at the source for changes…')).toBeInTheDocument();
        expect(screen.getAllByTestId('manga-chapter')).toHaveLength(3);
    });

    it('says nothing when the source is not being looked at', () => {
        open();
        setRefresh({ loading: false, error: null });
        render(<MangaDetail />);
        expect(screen.queryByText('Looking at the source for changes…')).not.toBeInTheDocument();
        expect(screen.queryByText('Could not reach the source. Showing what is saved.')).not.toBeInTheDocument();
    });

    it('says the source could not be reached and keeps showing the chapters that are saved', () => {
        open();
        setRefresh({ loading: false, error: { code: 'REQUEST_FAILED', message: 'site down' } });
        render(<MangaDetail />);
        const warning = screen.getByRole('alert');
        expect(warning).toHaveTextContent('Could not reach the source. Showing what is saved.');
        expect(warning).toHaveAttribute('title', 'site down');
        expect(screen.getAllByTestId('manga-chapter')).toHaveLength(3);
        expect(screen.queryByText(/Cloudflare/)).not.toBeInTheDocument();
    });

    it('explains Cloudflare when that is why the source could not be reached', () => {
        open();
        setRefresh({ loading: false, error: { code: 'REQUEST_FAILED', message: 'Cloudflare protection is on' } });
        render(<MangaDetail />);
        expect(screen.getByRole('alert')).toHaveTextContent('Could not reach the source. Showing what is saved.');
        expect(screen.getByText('This site is protected by Cloudflare. The helper that gets past it is downloaded when the app opens; if it is ready and the error stays, the site may be blocking it.')).toBeInTheDocument();
    });

    it('does not show the notes while the page is still loading', () => {
        open({ status: 'loading', details: null, chapters: [] });
        setRefresh({ loading: true, error: null });
        render(<MangaDetail />);
        expect(screen.queryByText('Looking at the source for changes…')).not.toBeInTheDocument();
    });
});

describe('MangaDetail the cover of a manga of the library', () => {
    it('shows the cover the app keeps, not the one the source gave', () => {
        open();
        useMangaStore.setState({ library: [makeLibraryManga([], { thumbnailUrl: 'pullwave-manga://cover/1?v=abcdef123456' })] });
        render(<MangaDetail />);
        expect(document.querySelector('img.cover')).toHaveAttribute('src', 'pullwave-manga://cover/1?v=abcdef123456');
    });

    it('shows the cover of the source when the manga is not in the library', () => {
        open();
        render(<MangaDetail />);
        expect(document.querySelector('img.cover')).toHaveAttribute('src', 'http://127.0.0.1:4321/api/v1/manga/7/thumbnail');
    });
});
