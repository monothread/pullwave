// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { MangaDetail } from '@renderer/components/MangaDetail';
import { useAppStore } from '@renderer/store/appStore';
import { useMangaStore, type MangaSelection } from '@renderer/store/mangaStore';
import { makeChapter, makeChapterRecord, makeDetails, makeLibraryManga, makeSummary } from '../../helpers/mangaFixtures';
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
    useMangaStore.setState({ ...initialManga, library: [], selection: null });
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
        expect(screen.getByText('Author: Oda')).toBeInTheDocument();
        expect(screen.getByText('Artist: Oda E.')).toBeInTheDocument();
        expect(screen.getByText('Ongoing')).toBeInTheDocument();
        expect(screen.getByText('Action · Adventure')).toBeInTheDocument();
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
        const rows = screen.getAllByRole('listitem');
        expect(rows).toHaveLength(3);
        expect(within(rows[0]!).getByRole('checkbox', { name: 'Romance Dawn' })).not.toBeChecked();
        expect(rows[0]).toHaveTextContent(`Group A · ${new Date(Date.UTC(2023, 10, 14, 12)).toLocaleDateString()}`);
        expect(within(rows[1]!).getByRole('checkbox', { name: '#2' })).toBeInTheDocument();
        expect(rows[2]!.querySelector('input')).toHaveAttribute('aria-label', '');
    });

    it('shows the state of the chapters the library already has', () => {
        useMangaStore.setState({ library: [makeLibraryManga([makeChapterRecord({ remoteId: 11, status: 'done' }), makeChapterRecord({ id: 2, remoteId: 12, status: 'error' })])] });
        open();
        render(<MangaDetail />);
        const rows = screen.getAllByRole('listitem');
        expect(within(rows[0]!).getByText('Downloaded')).toHaveClass('badge--done');
        expect(within(rows[1]!).getByText('Failed')).toHaveClass('badge--error');
        expect(within(rows[2]!).queryByText(/Downloaded|Failed|Waiting/)).not.toBeInTheDocument();
    });

    it('picks chapters one by one', async () => {
        const user = userEvent.setup();
        open();
        render(<MangaDetail />);
        await user.click(screen.getByRole('checkbox', { name: 'Romance Dawn' }));
        await user.click(screen.getByRole('checkbox', { name: '#2' }));
        expect(useMangaStore.getState().selection?.selected).toEqual([11, 12]);
        expect(screen.getByRole('button', { name: 'DOWNLOAD SELECTED (2)' })).toBeEnabled();
        await user.click(screen.getByRole('checkbox', { name: 'Romance Dawn' }));
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

    it('adds the manga to the library', async () => {
        const user = userEvent.setup();
        mock.api.manga.addToLibrary.mockResolvedValue(makeLibraryManga([]));
        open();
        render(<MangaDetail />);
        await user.click(screen.getByRole('button', { name: 'ADD TO LIBRARY' }));
        expect(mock.api.manga.addToLibrary).toHaveBeenCalledWith({ manga: makeSummary(), details: makeDetails(), chapters: CHAPTERS });
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

describe('MangaDetail removing a chapter of the library', () => {
    it('offers it for the chapters the library has, unless they are queued or downloading', async () => {
        const user = userEvent.setup();
        const library = [
            makeLibraryManga([
                makeChapterRecord({ id: 1, remoteId: 11, status: 'done' }),
                makeChapterRecord({ id: 2, remoteId: 12, status: 'error' }),
                makeChapterRecord({ id: 3, remoteId: 13, status: 'downloading' })
            ])
        ];
        // The library is read again after a removal: the mock gives the same one back.
        mock.api.manga.library.mockResolvedValue(library);
        useMangaStore.setState({ library });
        open();
        render(<MangaDetail />);
        expect(screen.queryByRole('button', { name: /^Remove chapter: #3/ })).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Remove chapter: Romance Dawn' }));
        expect(mock.api.manga.removeChapter).toHaveBeenCalledWith(1);
        await user.click(screen.getByRole('button', { name: 'Remove chapter: #2' }));
        expect(mock.api.manga.removeChapter).toHaveBeenLastCalledWith(2);
    });

    it('offers nothing to remove for a chapter the library does not have', () => {
        open();
        render(<MangaDetail />);
        expect(screen.queryByRole('button', { name: /^Remove chapter/ })).not.toBeInTheDocument();
    });
});
