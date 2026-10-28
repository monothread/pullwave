// @vitest-environment jsdom
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { MangaDetail } from '@renderer/components/MangaDetail';
import { useAppStore } from '@renderer/store/appStore';
import { useMangaStore, type MangaSelection } from '@renderer/store/mangaStore';
import { progressKey, saveLastChapter, saveProgress } from '@renderer/components/readerPrefs';
import { makeChapter, makeChapterRecord, makeDetails, makeLibraryManga, makeSource, makeSummary } from '../../helpers/mangaFixtures';
import { answerDialog, confirmDialog } from '../../helpers/confirmDialog';
import { installMockApi, type MockApiHandle } from '../../helpers/mockApi';

let mock: MockApiHandle;
const initialApp = useAppStore.getState();
const initialManga = useMangaStore.getState();

const CHAPTERS = [
    makeChapter({ remoteId: 11, name: 'Romance Dawn', number: 1, scanlator: 'Group A', dateUploaded: Date.UTC(2023, 10, 14, 12) }),
    makeChapter({ remoteId: 12, name: '', number: 2, scanlator: null, dateUploaded: null }),
    makeChapter({ remoteId: 13, name: '', number: 3, scanlator: null, dateUploaded: null })
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
                .getAllByRole('listitem')
                .map((item) => {
                    return item.textContent;
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
        expect(within(alert).getByRole('button')).toHaveAttribute('title', 'Click to copy the technical error');
    });

    it('hints at Cloudflare when the manga could not be opened because of it', () => {
        open({ status: 'error', details: null, chapters: [], error: { code: 'API_ERROR', message: 'Cloudflare bypass currently disabled' } });
        render(<MangaDetail />);
        expect(within(screen.getByRole('alert')).getByRole('button')).toHaveAttribute('title', 'Click to copy the technical error');
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
        expect(rows[0]).toHaveTextContent(`Group A · ${new Date(Date.UTC(2023, 10, 14, 12)).toLocaleDateString()}`);
        expect(rows[1]).toHaveTextContent('#2');
        rows.forEach((row) => {
            expect(row.querySelector('input')).toBeNull();
        });
    });

    it('lists the chapters from the lowest number up, whatever the order the source gave them', () => {
        open({
            chapters: [
                makeChapter({ remoteId: 15, name: 'Six', number: 6, sourceOrder: 7 }),
                makeChapter({ remoteId: 14, name: 'Five', number: 5, sourceOrder: 6 }),
                makeChapter({ remoteId: 13, name: 'Four point one', number: 4.1, sourceOrder: 5 }),
                makeChapter({ remoteId: 12, name: 'Four', number: 4, sourceOrder: 4 }),
                makeChapter({ remoteId: 11, name: 'One', number: 1, sourceOrder: 1 })
            ]
        });
        render(<MangaDetail />);
        const names = screen.getAllByTestId('manga-chapter').map((row) => {
            return row.textContent?.match(/One|Four point one|Four|Five|Six/)?.[0];
        });
        expect(names).toEqual(['One', 'Four', 'Four point one', 'Five', 'Six']);
    });

    it('keeps listing a chapter of the library that the source no longer lists, in its place and in the count', () => {
        useMangaStore.setState({
            library: [makeLibraryManga([makeChapterRecord({ id: 5, remoteId: 99, name: 'Old format', number: null, sourceOrder: 1, status: 'done' })])]
        });
        open();
        render(<MangaDetail />);
        expect(screen.getByText('Chapters (4)')).toBeInTheDocument();
        const rows = screen.getAllByTestId('manga-chapter');
        expect(rows).toHaveLength(4);
        expect(rows[0]).toHaveTextContent('Old format');
        expect(rows[0]).toHaveTextContent('Downloaded');
        expect(rows[1]).toHaveTextContent('Romance Dawn');
        expect(rows[2]).toHaveTextContent('#2');
        expect(rows[3]).toHaveTextContent('#3');
    });

    it('opens the reader on a chapter that only the library has, among the chapters of the list', async () => {
        const user = userEvent.setup();
        useMangaStore.setState({
            library: [makeLibraryManga([makeChapterRecord({ id: 5, remoteId: 99, name: 'Old format', number: null, sourceOrder: 1, status: 'done' })])]
        });
        open();
        render(<MangaDetail />);
        await user.click(screen.getByRole('button', { name: 'READ: Old format' }));
        expect(mock.api.manga.readPages).toHaveBeenCalledWith({ chapterRemoteId: 99, libraryChapterId: 5 });
        expect(useMangaStore.getState().reader).toMatchObject({
            index: 0,
            chapters: [
                { remoteId: 99, libraryChapterId: 5, name: 'Old format', number: null },
                { remoteId: 11, libraryChapterId: null, name: 'Romance Dawn', number: 1 },
                { remoteId: 12, libraryChapterId: null, name: '', number: 2 },
                { remoteId: 13, libraryChapterId: null, name: '', number: 3 }
            ]
        });
    });

    it('has no DOWNLOAD button for a chapter that only the library has and is not downloaded', () => {
        useMangaStore.setState({
            library: [makeLibraryManga([makeChapterRecord({ id: 5, remoteId: 99, name: 'Old format', number: null, sourceOrder: 1, status: 'idle', filePath: null })])]
        });
        open();
        render(<MangaDetail />);
        const row = screen.getAllByTestId('manga-chapter')[0]!;
        expect(row).toHaveTextContent('Old format');
        expect(within(row).queryByRole('button', { name: /^DOWNLOAD:/ })).not.toBeInTheDocument();
    });

    it('lists only what the source lists for a manga that is not in the library', () => {
        open();
        render(<MangaDetail />);
        expect(screen.getByText('Chapters (3)')).toBeInTheDocument();
        expect(screen.getAllByTestId('manga-chapter')).toHaveLength(3);
    });

    it('lists the chapters with no number before the numbered ones', () => {
        open({
            chapters: [
                makeChapter({ remoteId: 11, name: 'Numbered', number: 1, sourceOrder: 1 }),
                makeChapter({ remoteId: 12, name: 'Unnumbered', number: null, sourceOrder: 2 })
            ]
        });
        render(<MangaDetail />);
        const rows = screen.getAllByTestId('manga-chapter');
        expect(rows[0]).toHaveTextContent('Unnumbered');
        expect(rows[1]).toHaveTextContent('Numbered');
    });

    it('shows the chapters as cards in a grid, with the name on top and the state and the buttons together at the bottom', () => {
        useMangaStore.setState({ library: [makeLibraryManga([makeChapterRecord({ remoteId: 11, status: 'done' }), makeChapterRecord({ id: 2, remoteId: 12, status: 'error' })])] });
        open();
        render(<MangaDetail />);
        const rows = screen.getAllByTestId('manga-chapter');
        rows.forEach((row) => {
            expect(row.parentElement).toHaveClass('episode-cards', 'manga__chapters');
            expect(row.parentElement?.tagName).toBe('UL');
            expect(row.firstElementChild).toHaveClass('history__main');
            expect(row.lastElementChild).toHaveClass('anime__actions');
            expect(row.children).toHaveLength(2);
        });
        expect(within(rows[0]!.querySelector('.anime__actions') as HTMLElement).getByText('Downloaded')).toHaveClass('badge--done');
        expect(within(rows[1]!.querySelector('.anime__actions') as HTMLElement).getByText('Failed')).toHaveClass('badge--error');
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

    it('has no way to pick chapters or to download the ones picked', () => {
        useMangaStore.setState({ library: [makeLibraryManga([makeChapterRecord({ remoteId: 11, status: 'done' })], { id: 9 })] });
        open();
        render(<MangaDetail />);
        expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /DOWNLOAD SELECTED/ })).not.toBeInTheDocument();
        ['ALL', 'NONE', 'NOT DOWNLOADED'].forEach((name) => {
            expect(screen.queryByRole('button', { name: new RegExp(`^${name}$`) })).not.toBeInTheDocument();
        });
    });

    it('goes back to the list', async () => {
        const user = userEvent.setup();
        open();
        render(<MangaDetail />);
        await user.click(screen.getByRole('button', { name: '← BACK' }));
        expect(useMangaStore.getState().selection).toBeNull();
    });
});

describe('MangaDetail downloading the season', () => {
    const SEASON = (statuses: Array<'done' | 'incomplete' | 'queued' | 'downloading' | 'idle' | 'error' | 'cancelled' | 'paused'>) => {
        return makeLibraryManga(
            statuses.map((status, index) => {
                return makeChapterRecord({ id: index + 1, remoteId: 11 + index, status });
            }),
            { id: 9 }
        );
    };

    it('has one button for the season that downloads what is missing of the manga of the library', async () => {
        const user = userEvent.setup();
        useMangaStore.setState({ library: [SEASON(['done', 'idle', 'error'])] });
        open();
        render(<MangaDetail />);
        const button = screen.getByRole('button', { name: 'DOWNLOAD SEASON: One Piece' });
        expect(button).toHaveClass('btn--primary');
        await user.click(button);
        expect(mock.api.manga.downloadMissing).toHaveBeenCalledTimes(1);
        expect(mock.api.manga.downloadMissing).toHaveBeenCalledWith([9]);
    });

    it.each([['idle'], ['error'], ['cancelled']] as const)('is there when a chapter is %s', (status) => {
        useMangaStore.setState({ library: [SEASON(['done', status])] });
        open();
        render(<MangaDetail />);
        expect(screen.getByRole('button', { name: 'DOWNLOAD SEASON: One Piece' })).toBeEnabled();
    });

    it('is there when a chapter lacks pages, and downloads them with the rest', async () => {
        const user = userEvent.setup();
        useMangaStore.setState({ library: [SEASON(['done', 'incomplete'])] });
        open();
        render(<MangaDetail />);
        await user.click(screen.getByRole('button', { name: 'DOWNLOAD SEASON: One Piece' }));
        expect(mock.api.manga.downloadMissing).toHaveBeenCalledWith([9]);
    });

    it('is not there when everything is downloaded, waiting or going on', () => {
        useMangaStore.setState({ library: [SEASON(['done', 'queued', 'downloading'])] });
        open();
        render(<MangaDetail />);
        expect(screen.queryByRole('button', { name: /DOWNLOAD SEASON/ })).not.toBeInTheDocument();
    });

    it('is not there for a manga that is not in the library, or on the page of the browse', () => {
        open();
        const { unmount } = render(<MangaDetail />);
        expect(screen.queryByRole('button', { name: /DOWNLOAD SEASON/ })).not.toBeInTheDocument();
        unmount();
        useMangaStore.setState({ library: [SEASON(['idle'])], selectionFrom: 'browse' });
        render(<MangaDetail />);
        expect(screen.queryByRole('button', { name: /DOWNLOAD SEASON/ })).not.toBeInTheDocument();
        expect(mock.api.manga.downloadMissing).not.toHaveBeenCalled();
    });
});

describe('MangaDetail downloading one chapter', () => {
    const SAVED = (statuses: Array<'done' | 'incomplete' | 'queued' | 'downloading' | 'idle' | 'error' | 'cancelled' | 'paused'>) => {
        return makeLibraryManga(
            statuses.map((status, index) => {
                return makeChapterRecord({ id: index + 1, remoteId: 11 + index, status });
            }),
            { id: 9 }
        );
    };

    it('has a small DOWNLOAD button in the row of a chapter that is not downloaded, which sends only that chapter', async () => {
        const user = userEvent.setup();
        mock.api.manga.download.mockResolvedValue(makeLibraryManga([]));
        useMangaStore.setState({ library: [SAVED(['done', 'idle', 'idle'])] });
        open();
        render(<MangaDetail />);
        const rows = screen.getAllByTestId('manga-chapter');
        expect(within(rows[0]!).queryByRole('button', { name: /^DOWNLOAD:/ })).not.toBeInTheDocument();
        const button = within(rows[1]!).getByRole('button', { name: 'DOWNLOAD: #2' });
        expect(button).toHaveTextContent('DOWNLOAD');
        expect(button).toHaveClass('btn', 'btn--small');
        expect(button).not.toHaveClass('btn--primary');
        expect(button).not.toHaveClass('btn--ghost');
        await user.click(button);
        expect(mock.api.manga.download).toHaveBeenCalledTimes(1);
        expect(mock.api.manga.download).toHaveBeenCalledWith({ manga: makeSummary(), details: makeDetails(), chapters: [CHAPTERS[1]] });
        expect(mock.api.manga.downloadMissing).not.toHaveBeenCalled();
    });

    it('is after the mark as read and before the removal, in the row', () => {
        useMangaStore.setState({ library: [SAVED(['idle', 'idle', 'idle'])] });
        open();
        render(<MangaDetail />);
        const labels = within(screen.getAllByTestId('manga-chapter')[0]!)
            .getAllByRole('button')
            .map((button) => {
                return button.getAttribute('aria-label') ?? button.textContent;
            });
        expect(labels.indexOf('DOWNLOAD: Romance Dawn')).toBeGreaterThan(labels.indexOf('Mark as read: Romance Dawn'));
    });

    it.each([['done'], ['queued'], ['downloading'], ['paused']] as const)('has no button for a chapter that is %s', (status) => {
        useMangaStore.setState({ library: [SAVED([status])] });
        open();
        render(<MangaDetail />);
        expect(within(screen.getAllByTestId('manga-chapter')[0]!).queryByRole('button', { name: /^DOWNLOAD:/ })).not.toBeInTheDocument();
    });

    it.each([['error'], ['cancelled']] as const)('leaves a chapter that is %s to its RETRY, with no second button', (status) => {
        useMangaStore.setState({ library: [SAVED([status])] });
        open();
        render(<MangaDetail />);
        const row = screen.getAllByTestId('manga-chapter')[0]!;
        expect(within(row).queryByRole('button', { name: /^DOWNLOAD:/ })).not.toBeInTheDocument();
        expect(within(row).getByRole('button', { name: 'RETRY: Romance Dawn' })).toBeInTheDocument();
    });

    it('has the button for a chapter the library does not have yet', () => {
        useMangaStore.setState({ library: [SAVED(['done'])] });
        open();
        render(<MangaDetail />);
        const rows = screen.getAllByTestId('manga-chapter');
        expect(within(rows[1]!).getByRole('button', { name: 'DOWNLOAD: #2' })).toBeInTheDocument();
        expect(within(rows[2]!).getByRole('button', { name: /^DOWNLOAD:/ })).toBeInTheDocument();
    });

    it('is not on the page of the browse, which only reads and adds', () => {
        useMangaStore.setState({ library: [SAVED(['idle'])], selectionFrom: 'browse' });
        open();
        render(<MangaDetail />);
        expect(screen.queryByRole('button', { name: /^DOWNLOAD:/ })).not.toBeInTheDocument();
    });

    it('speaks the language of the app', () => {
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, language: 'pt' } });
        useMangaStore.setState({ library: [SAVED(['idle'])] });
        open();
        render(<MangaDetail />);
        expect(screen.getByRole('button', { name: 'BAIXAR: Romance Dawn' })).toBeInTheDocument();
    });
});

describe('MangaDetail reading', () => {
    const NEWEST_FIRST = [
        makeChapter({ remoteId: 13, name: 'Third', number: 3, sourceOrder: 3 }),
        makeChapter({ remoteId: 12, name: 'Second', number: 2, sourceOrder: 2 }),
        makeChapter({ remoteId: 11, name: 'First', number: 1, sourceOrder: 1 })
    ];

    it('hands the reader the chapters in the order of the list, by number and not by the order of the source', async () => {
        const user = userEvent.setup();
        open({
            chapters: [
                makeChapter({ remoteId: 11, name: 'Late', number: 9, sourceOrder: 1 }),
                makeChapter({ remoteId: 12, name: 'Early', number: 2, sourceOrder: 5 })
            ]
        });
        render(<MangaDetail />);
        await user.click(screen.getByRole('button', { name: 'READ: Late' }));
        expect(useMangaStore.getState().reader).toMatchObject({
            index: 1,
            chapters: [
                { remoteId: 12, libraryChapterId: null, name: 'Early', number: 2 },
                { remoteId: 11, libraryChapterId: null, name: 'Late', number: 9 }
            ]
        });
    });

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
        expect(mock.api.manga.removeDownload).not.toHaveBeenCalled();
        expect(within(confirmDialog('Remove the download of "Romance Dawn"?')).getByText('The downloaded file of this chapter is deleted from the disk. The chapter stays in the library.')).toBeInTheDocument();
        await answerDialog(user, 'Remove the download of "Romance Dawn"?', 'REMOVE');
        expect(mock.api.manga.removeDownload).toHaveBeenCalledTimes(1);
        expect(mock.api.manga.removeDownload).toHaveBeenCalledWith(1);
    });

    it('keeps the download of a chapter when the user keeps it or presses Esc', async () => {
        const user = userEvent.setup();
        useMangaStore.setState({ library: [makeLibraryManga([makeChapterRecord({ id: 1, remoteId: 11, status: 'done' })])] });
        open();
        render(<MangaDetail />);
        await user.click(screen.getByRole('button', { name: 'Remove download: Romance Dawn' }));
        await answerDialog(user, 'Remove the download of "Romance Dawn"?', 'KEEP');
        await user.click(screen.getByRole('button', { name: 'Remove download: Romance Dawn' }));
        await user.keyboard('{Escape}');
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(mock.api.manga.removeDownload).not.toHaveBeenCalled();
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

    it('has a button that looks for new chapters of this manga, which says it is looking meanwhile', async () => {
        const user = userEvent.setup();
        let answer: (value: unknown) => void = () => {
            return undefined;
        };
        mock.api.manga.checkNewChapters.mockReturnValue(
            new Promise((resolve) => {
                answer = resolve;
            })
        );
        mock.api.manga.library.mockResolvedValue([SAVED]);
        useMangaStore.setState({ library: [SAVED] });
        open();
        render(<MangaDetail />);
        await user.click(screen.getByRole('button', { name: 'LOOK FOR NEW CHAPTERS' }));
        expect(mock.api.manga.checkNewChapters).toHaveBeenCalledTimes(1);
        expect(mock.api.manga.checkNewChapters).toHaveBeenCalledWith(9);
        expect(screen.getByRole('button', { name: 'LOOKING…' })).toBeDisabled();
        answer({ ok: true, count: 1, titles: ['One Piece'], failed: 0, skipped: 0 });
        expect(await screen.findByRole('button', { name: 'LOOK FOR NEW CHAPTERS' })).toBeEnabled();
    });

    it('disables the button while another manga is being looked at', () => {
        useMangaStore.setState({ library: [SAVED], checkingNew: 'all' });
        open();
        render(<MangaDetail />);
        expect(screen.getByRole('button', { name: 'LOOK FOR NEW CHAPTERS' })).toBeDisabled();
    });

    it('disables the button while the look every hour is going on, and enables it when it ends', () => {
        useMangaStore.setState({ library: [SAVED], checkState: { running: true, origin: 'auto', done: 3, total: 40, current: 'Bleach' } });
        open();
        render(<MangaDetail />);

        expect(screen.getByRole('button', { name: 'LOOK FOR NEW CHAPTERS' })).toBeDisabled();
        act(() => {
            useMangaStore.setState({ checkState: { running: false, origin: null, done: 0, total: 0, current: null } });
        });
        expect(screen.getByRole('button', { name: 'LOOK FOR NEW CHAPTERS' })).toBeEnabled();
    });

    it('does not have the button on the page of the browse, or for a manga that is not in the library', () => {
        useMangaStore.setState({ library: [SAVED], selectionFrom: 'browse', view: 'browse' });
        open();
        const { unmount } = render(<MangaDetail />);
        expect(screen.queryByRole('button', { name: 'LOOK FOR NEW CHAPTERS' })).not.toBeInTheDocument();
        unmount();
        useMangaStore.setState({ library: [], selectionFrom: 'library', view: 'library' });
        render(<MangaDetail />);
        expect(screen.queryByRole('button', { name: 'LOOK FOR NEW CHAPTERS' })).not.toBeInTheDocument();
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

    it('opens the folder of the manga from its page in the library', async () => {
        const user = userEvent.setup();
        useMangaStore.setState({ library: [SAVED] });
        open();
        render(<MangaDetail />);
        await user.click(screen.getByRole('button', { name: 'OPEN FOLDER' }));
        expect(mock.api.manga.openFolder).toHaveBeenCalledTimes(1);
        expect(mock.api.manga.openFolder).toHaveBeenCalledWith(9);
    });

    it('shows the source the manga comes from, with its language, on its page in the library', () => {
        useMangaStore.setState({ library: [SAVED], browse: { ...initialManga.browse, sources: [makeSource({ id: '123', name: 'MangaDex', lang: 'en' })], sourcesStatus: 'ready' } });
        open();
        render(<MangaDetail />);
        expect(screen.getByTestId('manga-source')).toHaveTextContent('Source: MangaDex (EN)');
        expect(screen.queryByTestId('manga-source-gone')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'LINK SOURCE' })).not.toBeInTheDocument();
    });

    it('does not show the source on the page of the browse', () => {
        useMangaStore.setState({ library: [SAVED], selectionFrom: 'browse', view: 'browse', browse: { ...initialManga.browse, sources: [makeSource({ id: '123' })], sourcesStatus: 'ready' } });
        open();
        render(<MangaDetail />);
        expect(screen.queryByTestId('manga-source')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'LINK SOURCE' })).not.toBeInTheDocument();
    });

    it('says the extension is gone and offers LINK SOURCE, which opens the window to move the manga to a source that works', async () => {
        const user = userEvent.setup();
        useMangaStore.setState({ library: [SAVED], browse: { ...initialManga.browse, sources: [makeSource({ id: '200', name: 'Other Dex' })], sourcesStatus: 'ready' } });
        open();
        render(<MangaDetail />);
        expect(screen.queryByTestId('manga-source')).not.toBeInTheDocument();
        expect(screen.getByTestId('manga-source-gone')).toHaveTextContent('Source: 123. Its extension is not installed, so there is no source to read or update this manga from.');
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'LINK SOURCE' }));
        expect(screen.getByRole('dialog', { name: 'MIGRATE TO ANOTHER SOURCE' })).toBeInTheDocument();
        expect(within(screen.getByLabelText('Search in')).getAllByRole('option')).toHaveLength(2);
        await user.click(screen.getByRole('button', { name: 'CANCEL' }));
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it.each(['idle', 'loading', 'error'] as const)('says nothing about the source while the list of sources is %s', (status) => {
        useMangaStore.setState({ library: [SAVED], browse: { ...initialManga.browse, sources: [], sourcesStatus: status } });
        mock.api.manga.sources.mockResolvedValue({ ok: false, error: { code: 'SERVER_UNAVAILABLE', message: 'down' } });
        open();
        render(<MangaDetail />);
        expect(screen.queryByTestId('manga-source')).not.toBeInTheDocument();
        expect(screen.queryByTestId('manga-source-gone')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'LINK SOURCE' })).not.toBeInTheDocument();
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
        // Only the link that reads, the button that marks the chapter as read and the one that downloads it (the chapter is not downloaded).
        expect(
            within(row)
                .getAllByRole('button')
                .map((button) => {
                    return button.getAttribute('aria-label');
                })
        ).toEqual(['READ: Romance Dawn', 'Mark as read: Romance Dawn', 'DOWNLOAD: Romance Dawn']);
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

    describe('when the title is in the library from another source', () => {
        const OTHER = makeLibraryManga([], { id: 5, sourceId: '999', remoteId: 70, title: 'one piece' });

        beforeEach(() => {
            useMangaStore.setState({ library: [OTHER], browse: { ...initialManga.browse, sources: [makeSource({ id: '999', name: 'Site B' })], sourcesStatus: 'ready' } });
            mock.api.manga.addToLibrary.mockResolvedValue(makeLibraryManga([]));
        });

        it('says which source has it, and still offers to add', () => {
            open();
            render(<MangaDetail />);
            expect(screen.getByText('Already in your library from: Site B.')).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'ADD TO LIBRARY' })).toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'GO TO LIBRARY' })).not.toBeInTheDocument();
        });

        it('asks before adding, and adds when confirmed', async () => {
            const user = userEvent.setup();
            open();
            render(<MangaDetail />);
            await user.click(screen.getByRole('button', { name: 'ADD TO LIBRARY' }));
            expect(mock.api.manga.addToLibrary).not.toHaveBeenCalled();
            const dialog = screen.getByRole('dialog', { name: 'ALREADY IN YOUR LIBRARY' });
            expect(dialog).toHaveTextContent('"One Piece" is already in your library from Site B. Add it from this source too?');
            await user.click(within(dialog).getByRole('button', { name: 'ADD ANYWAY' }));
            expect(mock.api.manga.addToLibrary).toHaveBeenCalledWith({ manga: makeSummary(), details: makeDetails(), chapters: CHAPTERS });
            expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        });

        it('adds nothing when the question is cancelled', async () => {
            const user = userEvent.setup();
            open();
            render(<MangaDetail />);
            await user.click(screen.getByRole('button', { name: 'ADD TO LIBRARY' }));
            await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'CANCEL' }));
            expect(mock.api.manga.addToLibrary).not.toHaveBeenCalled();
            expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        });

        it('says nothing and adds at once when the same source already has it', async () => {
            const user = userEvent.setup();
            useMangaStore.setState({ library: [SAVED] });
            open();
            render(<MangaDetail />);
            expect(screen.queryByText(/Already in your library from/)).not.toBeInTheDocument();
            await user.click(screen.getByRole('button', { name: /ADD MISSING CHAPTERS/ }));
            expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
            expect(mock.api.manga.addToLibrary).toHaveBeenCalledTimes(1);
        });
    });

    it('has no button to open the folder in the page of the browse, even when the manga is in the library', () => {
        useMangaStore.setState({ library: [SAVED] });
        open();
        render(<MangaDetail />);
        expect(screen.queryByRole('button', { name: 'OPEN FOLDER' })).not.toBeInTheDocument();
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
        await user.click(await screen.findByRole('button', { name: 'Search by: Adventure' }));
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
        expect(useMangaStore.getState().browse).toMatchObject({ sourceId: '123', mode: 'search', filtersOpen: false });
    });

    it('does the same for the author when the source lists the authors as filters', async () => {
        const user = userEvent.setup();
        open();
        render(<MangaDetail />);
        await user.click(await screen.findByRole('button', { name: 'Search by: Oda' }));
        await vi.waitFor(() => {
            expect(mock.api.manga.list).toHaveBeenCalledTimes(1);
        });
        const sent = mock.api.manga.list.mock.calls[0]![0];
        expect(sent).toMatchObject({ kind: 'search', query: '' });
        expect(sent.filters?.[2]).toEqual({ type: 'group', name: 'Authors', filters: [{ type: 'checkbox', name: 'Oda', value: true }] });
    });

    it('gives the name of the author to the text filter of the source that is about authors', async () => {
        const user = userEvent.setup();
        mock.api.manga.sourceFilters.mockResolvedValue({ ok: true, value: [{ type: 'text', name: 'Author', value: '' }, { type: 'text', name: 'Artist', value: '' }] });
        open({ details: makeDetails({ author: 'Eiichiro Oda', artist: 'Oda E.', genres: [] }) });
        render(<MangaDetail />);
        await user.click(await screen.findByRole('button', { name: 'Search by: Eiichiro Oda' }));
        await vi.waitFor(() => {
            expect(mock.api.manga.list).toHaveBeenCalledTimes(1);
        });
        expect(mock.api.manga.list.mock.calls[0]![0]).toEqual({
            sourceId: '123',
            kind: 'search',
            page: 1,
            query: '',
            filters: [{ type: 'text', name: 'Author', value: 'Eiichiro Oda' }, { type: 'text', name: 'Artist', value: '' }]
        });
    });

    it('shows only as text what the source has no filter for, and never searches it by the text', async () => {
        open({ details: makeDetails({ artist: 'Someone Else', genres: ['Adventure', 'Content rating: Suggestive'] }) });
        render(<MangaDetail />);
        await screen.findByRole('button', { name: 'Search by: Adventure' });
        expect(screen.queryByRole('button', { name: 'Search by: Someone Else' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Search by: Content rating: Suggestive' })).not.toBeInTheDocument();
        expect(screen.getByText('Someone Else')).toHaveClass('manga__tag', 'manga__tag--plain');
        expect(screen.getByText('Content rating: Suggestive')).toHaveClass('manga__tag--plain');
        expect(mock.api.manga.list).not.toHaveBeenCalled();
    });

    it('shows everything as text until the filters of the source are known, and when they cannot be read', async () => {
        let answer: (value: unknown) => void = () => {
            return undefined;
        };
        mock.api.manga.sourceFilters.mockReturnValue(
            new Promise((resolve) => {
                answer = resolve;
            })
        );
        open();
        const { unmount } = render(<MangaDetail />);
        expect(screen.queryByRole('button', { name: /^Search by:/ })).not.toBeInTheDocument();
        expect(screen.getByText('Action')).toHaveClass('manga__tag--plain');
        answer({ ok: false, error: { code: 'REQUEST_FAILED', message: 'x' } });
        await vi.waitFor(() => {
            expect(useMangaStore.getState().termFilters.status).toBe('error');
        });
        expect(screen.queryByRole('button', { name: /^Search by:/ })).not.toBeInTheDocument();
        unmount();
    });

    it('reads the filters of the source once the details are there, not before', async () => {
        open({ status: 'loading', details: null, chapters: [] });
        const { unmount } = render(<MangaDetail />);
        expect(mock.api.manga.sourceFilters).not.toHaveBeenCalled();
        unmount();
        open();
        render(<MangaDetail />);
        await vi.waitFor(() => {
            expect(mock.api.manga.sourceFilters).toHaveBeenCalledWith('123');
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

    it('marks a chapter that lacks pages as incomplete, in yellow, and offers to download the missing pages', async () => {
        const user = userEvent.setup();
        mock.api.manga.repairChapter.mockResolvedValue({ ok: true, value: { missing: [] } });
        useMangaStore.setState({
            library: [
                makeLibraryManga([
                    makeChapterRecord({ id: 1, remoteId: 11, status: 'incomplete' }),
                    makeChapterRecord({ id: 2, remoteId: 12, status: 'done' })
                ])
            ]
        });
        open();
        render(<MangaDetail />);
        const rows = screen.getAllByTestId('manga-chapter');
        expect(within(rows[0]!).getByText('Incomplete')).toHaveClass('badge--incomplete');
        expect(within(rows[0]!).queryByText('Downloaded')).not.toBeInTheDocument();
        expect(within(rows[0]!).queryByRole('button', { name: /^DOWNLOAD:/ })).not.toBeInTheDocument();
        expect(within(rows[1]!).queryByRole('button', { name: /^RETRY/ })).not.toBeInTheDocument();
        await user.click(within(rows[0]!).getByRole('button', { name: 'RETRY: Romance Dawn' }));
        expect(mock.api.manga.repairChapter).toHaveBeenCalledTimes(1);
        expect(mock.api.manga.repairChapter).toHaveBeenCalledWith(1, null);
        expect(mock.api.manga.retry).not.toHaveBeenCalled();
        expect(useAppStore.getState().toasts.map((toast) => {
            return toast.message;
        })).toEqual(['The missing pages were downloaded.']);
    });

    it('keeps the button of an incomplete chapter off while its pages are being downloaded', async () => {
        const user = userEvent.setup();
        let answer: (value: { ok: true; value: { missing: number[] } }) => void = () => {
            return undefined;
        };
        mock.api.manga.repairChapter.mockReturnValue(
            new Promise((resolve) => {
                answer = resolve;
            })
        );
        useMangaStore.setState({ library: [makeLibraryManga([makeChapterRecord({ id: 1, remoteId: 11, status: 'incomplete' }), makeChapterRecord({ id: 2, remoteId: 12, status: 'incomplete' })])] });
        open();
        render(<MangaDetail />);
        await user.click(screen.getByRole('button', { name: 'RETRY: Romance Dawn' }));
        expect(screen.getByRole('button', { name: 'RETRY: Romance Dawn' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'RETRY: #2' })).toBeEnabled();
        await act(async () => {
            answer({ ok: true, value: { missing: [1, 3, 5] } });
        });
        expect(screen.getByRole('button', { name: 'RETRY: Romance Dawn' })).toBeEnabled();
        expect(useAppStore.getState().toasts.map((toast) => {
            return toast.message;
        })).toEqual(['3 page(s) are still missing.']);
    });

    it('does not offer to download the missing pages on the page of the browse', () => {
        useMangaStore.setState({ selectionFrom: 'browse', view: 'browse', library: [makeLibraryManga([makeChapterRecord({ id: 1, remoteId: 11, status: 'incomplete' })])] });
        open();
        render(<MangaDetail />);
        expect(within(screen.getAllByTestId('manga-chapter')[0]!).getByText('Incomplete')).toHaveClass('badge--incomplete');
        expect(screen.queryByRole('button', { name: /^RETRY/ })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^Remove download/ })).not.toBeInTheDocument();
    });

    it('can remove the download of an incomplete chapter', async () => {
        const user = userEvent.setup();
        const library = [makeLibraryManga([makeChapterRecord({ id: 1, remoteId: 11, status: 'incomplete' })])];
        mock.api.manga.library.mockResolvedValue(library);
        useMangaStore.setState({ library });
        open();
        render(<MangaDetail />);
        await user.click(screen.getByRole('button', { name: 'Remove download: Romance Dawn' }));
        await answerDialog(user, 'Remove the download of "Romance Dawn"?', 'REMOVE');
        expect(mock.api.manga.removeDownload).toHaveBeenCalledWith(1);
    });

    it('offers to go on with or cancel a paused chapter, in the library page only, and nothing else for it', async () => {
        const user = userEvent.setup();
        useMangaStore.setState({
            library: [
                makeLibraryManga([
                    makeChapterRecord({ id: 1, remoteId: 11, status: 'paused' }),
                    makeChapterRecord({ id: 2, remoteId: 12, status: 'downloading' }),
                    makeChapterRecord({ id: 3, remoteId: 13, status: 'done' })
                ])
            ]
        });
        open();
        render(<MangaDetail />);
        expect(screen.getAllByRole('button', { name: /^RESUME/ }).map((button) => {
            return button.getAttribute('aria-label');
        })).toEqual(['RESUME: Romance Dawn']);
        expect(screen.getAllByRole('button', { name: /^CANCEL/ }).map((button) => {
            return button.getAttribute('aria-label');
        })).toEqual(['CANCEL: Romance Dawn']);
        expect(screen.queryByRole('button', { name: /^(DOWNLOAD|RETRY): Romance Dawn/ })).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'RESUME: Romance Dawn' }));
        expect(mock.api.manga.resume).toHaveBeenCalledTimes(1);
        expect(mock.api.manga.resume).toHaveBeenCalledWith(1);
        await user.click(screen.getByRole('button', { name: 'CANCEL: Romance Dawn' }));
        expect(mock.api.manga.cancel).not.toHaveBeenCalled();
        await answerDialog(user, 'Cancel this download?', 'CANCEL');
        expect(mock.api.manga.cancel).toHaveBeenCalledTimes(1);
        expect(mock.api.manga.cancel).toHaveBeenCalledWith(1);
    });

    it('does not offer to go on with or cancel a paused chapter on the page of the browse', () => {
        useMangaStore.setState({ selectionFrom: 'browse', view: 'browse', library: [makeLibraryManga([makeChapterRecord({ id: 1, remoteId: 11, status: 'paused' })])] });
        open();
        render(<MangaDetail />);
        expect(screen.queryByRole('button', { name: /^(RESUME|CANCEL)/ })).not.toBeInTheDocument();
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
        expect(screen.getByRole('dialog', { name: 'MIGRATE TO ANOTHER SOURCE' })).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'CANCEL' }));
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
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

    it('offers to continue, not to start, as soon as the manga has a chapter it was last read in', () => {
        saveLastChapter('One Piece', 12);
        open({ chapters: ORDERED });
        render(<MangaDetail />);
        expect(screen.getByRole('button', { name: 'CONTINUE READING' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'START READING' })).not.toBeInTheDocument();
    });

    it('offers to start when the chapter the manga was last read in is not in its list', () => {
        saveLastChapter('One Piece', 99);
        open({ chapters: ORDERED });
        render(<MangaDetail />);
        expect(screen.getByRole('button', { name: 'START READING' })).toBeInTheDocument();
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

    it('continues in the chapter the manga was last read in even when it is read, which is the case of the first one that is not read only when there is none', async () => {
        const user = userEvent.setup();
        saveLastChapter('One Piece', 11);
        useMangaStore.setState({ readKeys: [progressKey('One Piece', 11), progressKey('One Piece', 12)] });
        open({ chapters: ORDERED });
        render(<MangaDetail />);
        await user.click(screen.getByRole('button', { name: 'CONTINUE READING' }));
        expect(mock.api.manga.readPages).toHaveBeenCalledWith({ chapterRemoteId: 11, libraryChapterId: null });
        expect(useMangaStore.getState().reader.index).toBe(0);
    });

    it('continues in the first chapter that is not read when the manga has no last chapter', async () => {
        const user = userEvent.setup();
        useMangaStore.setState({ readKeys: [progressKey('One Piece', 11), progressKey('One Piece', 12)] });
        open({ chapters: ORDERED });
        render(<MangaDetail />);
        await user.click(screen.getByRole('button', { name: 'CONTINUE READING' }));
        expect(mock.api.manga.readPages).toHaveBeenCalledWith({ chapterRemoteId: 13, libraryChapterId: null });
    });

    it('opens the chapter to be continued where the manga was last read, and a chapter from its row where that chapter was left', async () => {
        const user = userEvent.setup();
        saveLastChapter('One Piece', 12);
        open({ chapters: ORDERED });
        render(<MangaDetail />);
        await user.click(screen.getByRole('button', { name: 'CONTINUE READING' }));
        expect(useMangaStore.getState().reader.resume).toBe(true);
        useMangaStore.getState().closeReader();
        await user.click(within(screen.getAllByTestId('manga-chapter')[1]!).getByRole('button', { name: 'READ: Second' }));
        expect(useMangaStore.getState().reader.resume).toBe(false);
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
        expect(within(second()).queryByRole('img', { name: 'Read' })).not.toBeInTheDocument();
        expect(second()).not.toHaveClass('history__item--watched');
        expect(screen.getByRole('button', { name: 'Mark as read: Second' })).toHaveAttribute('aria-pressed', 'false');
        await user.click(screen.getByRole('button', { name: 'Mark as read: Second' }));
        expect(useMangaStore.getState().readKeys).toEqual([progressKey('One Piece', 12)]);
        expect(within(second()).getByRole('img', { name: 'Read' })).toHaveTextContent('✓');
        expect(within(second()).getByRole('img', { name: 'Read' })).toHaveClass('watched-mark');
        expect(within(second()).queryByText('Read')).not.toBeInTheDocument();
        expect(second()).toHaveClass('history__item', 'history__item--watched');
        expect(screen.getByRole('button', { name: 'Mark as not read: Second' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: 'Mark as not read: Second' })).not.toHaveClass('btn--ghost');
        expect(window.localStorage.getItem('pullwave.manga.read')).toBe(JSON.stringify([progressKey('One Piece', 12)]));
        await user.click(screen.getByRole('button', { name: 'Mark as not read: Second' }));
        expect(useMangaStore.getState().readKeys).toEqual([]);
        expect(within(second()).queryByRole('img', { name: 'Read' })).not.toBeInTheDocument();
        expect(second()).not.toHaveClass('history__item--watched');
    });

    it('marks the whole manga as read, and then as not read', async () => {
        const user = userEvent.setup();
        open({ chapters: ORDERED });
        render(<MangaDetail />);
        await user.click(screen.getByRole('button', { name: 'MARK ALL AS READ' }));
        expect([...useMangaStore.getState().readKeys].sort()).toEqual([11, 12, 13].map((id) => {return progressKey('One Piece', id)}).sort());
        expect(screen.getAllByRole('img', { name: 'Read' })).toHaveLength(3);
        screen.getAllByTestId('manga-chapter').forEach((row) => {
            expect(row).toHaveClass('history__item--watched');
        });
        await user.click(screen.getByRole('button', { name: 'MARK ALL AS NOT READ' }));
        expect(useMangaStore.getState().readKeys).toEqual([]);
        expect(screen.queryByRole('img', { name: 'Read' })).not.toBeInTheDocument();
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
        await user.click(screen.getByRole('button', { name: 'READ: Second' }));
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
