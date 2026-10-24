// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { CLOUDFLARE_SHOW_AFTER_MS } from '@renderer/components/MangaCloudflareNotice';
import { MangaReader } from '@renderer/components/MangaReader';
import { loadLastChapter, loadLastPosition, loadProgress, loadReaderPrefs, saveLastPosition, PREFS_KEY, progressKey, saveProgress, saveReaderPrefs } from '@renderer/components/readerPrefs';
import { useAppStore } from '@renderer/store/appStore';
import { useMangaStore, type MangaReaderState, type ReaderChapter } from '@renderer/store/mangaStore';
import { makeChapterRecord, makeLibraryManga } from '../../helpers/mangaFixtures';
import { installMockApi, type MockApiHandle } from '../../helpers/mockApi';

let mock: MockApiHandle;
const initialApp = useAppStore.getState();
const initialManga = useMangaStore.getState();

const CHAPTERS: ReaderChapter[] = [
    { remoteId: 1, libraryChapterId: null, name: 'Chapter 1', number: 1 },
    { remoteId: 2, libraryChapterId: 8, name: 'Chapter 2', number: 2 },
    { remoteId: 3, libraryChapterId: null, name: '', number: 3 }
];
const PAGES = ['http://127.0.0.1:4321/p/0', 'http://127.0.0.1:4321/p/1', 'http://127.0.0.1:4321/p/2'];

function open(patch: Partial<MangaReaderState> = {}): void {
    useMangaStore.setState({ reader: { status: 'ready', mangaTitle: 'One Piece', chapters: CHAPTERS, index: 1, pages: PAGES, local: false, missing: [], error: null, ...patch } });
}

function shownPage(): string | null {
    return screen.getByRole('img').getAttribute('src');
}

beforeEach(() => {
    window.localStorage.clear();
    mock = installMockApi();
    mock.api.manga.readPages.mockResolvedValue({ ok: true, value: { pages: PAGES, local: false, missing: [] } });
    useAppStore.setState({ ...initialApp, settings: DEFAULT_SETTINGS, toasts: [] });
    useMangaStore.setState({ ...initialManga });
});

describe('MangaReader the bar', () => {
    it('shows nothing while it is closed', () => {
        const { container } = render(<MangaReader />);
        expect(container).toBeEmptyDOMElement();
    });

    it('says what is being read and where, and closes', async () => {
        const user = userEvent.setup();
        open();
        render(<MangaReader />);
        expect(screen.getByRole('region', { name: 'Reader' })).toBeInTheDocument();
        expect(screen.getByText('One Piece · Chapter 2')).toBeInTheDocument();
        expect(screen.getByText('1 / 3')).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: '← CLOSE' }));
        expect(useMangaStore.getState().reader.status).toBe('closed');
    });

    it('names a chapter that has no name by its number', () => {
        open({ index: 2 });
        render(<MangaReader />);
        expect(screen.getByText('One Piece · #3')).toBeInTheDocument();
    });

    it('goes to the next and the previous chapter, and disables them at the ends', async () => {
        const user = userEvent.setup();
        open({ index: 0 });
        render(<MangaReader />);
        expect(screen.getByRole('button', { name: 'PREVIOUS CHAPTER' })).toBeDisabled();
        await user.click(screen.getByRole('button', { name: 'NEXT CHAPTER' }));
        expect(mock.api.manga.readPages).toHaveBeenCalledWith({ chapterRemoteId: 2, libraryChapterId: 8 });
        expect(useMangaStore.getState().reader.index).toBe(1);
        open({ index: 2 });
        expect(await screen.findByRole('button', { name: 'NEXT CHAPTER' })).toBeDisabled();
        await user.click(screen.getByRole('button', { name: 'PREVIOUS CHAPTER' }));
        expect(mock.api.manga.readPages).toHaveBeenLastCalledWith({ chapterRemoteId: 2, libraryChapterId: 8 });
    });

    it('says while the pages are loading, why they could not be, and when there are none', () => {
        open({ status: 'loading', pages: [] });
        const { rerender } = render(<MangaReader />);
        expect(screen.getByText('Loading the pages…')).toBeInTheDocument();
        expect(screen.queryByText(/ \/ /)).not.toBeInTheDocument();
        open({ status: 'error', pages: [], error: { code: 'API_ERROR', message: 'Cloudflare bypass currently disabled' } });
        rerender(<MangaReader />);
        expect(screen.getByRole('alert')).toHaveTextContent('The site or the extension reported an error.');
        expect(within(screen.getByRole('alert')).getByRole('button')).toHaveAttribute('title', 'Click to copy the technical error');
        open({ pages: [] });
        rerender(<MangaReader />);
        expect(screen.getByText('This chapter has no pages.')).toBeInTheDocument();
    });
});

describe('MangaReader single page', () => {
    it('shows the first page and moves with the keys of the direction', () => {
        open();
        render(<MangaReader />);
        expect(shownPage()).toBe(PAGES[0]);
        expect(screen.getByRole('img')).toHaveAccessibleName('Page 1');
        fireEvent.keyDown(window, { key: 'ArrowRight' });
        expect(shownPage()).toBe(PAGES[1]);
        fireEvent.keyDown(window, { key: 'ArrowDown' });
        expect(shownPage()).toBe(PAGES[2]);
        fireEvent.keyDown(window, { key: 'ArrowLeft' });
        fireEvent.keyDown(window, { key: 'PageUp' });
        expect(shownPage()).toBe(PAGES[0]);
        fireEvent.keyDown(window, { key: ' ' });
        expect(shownPage()).toBe(PAGES[1]);
        fireEvent.keyDown(window, { key: ' ', shiftKey: true });
        expect(shownPage()).toBe(PAGES[0]);
        fireEvent.keyDown(window, { key: 'End' });
        expect(shownPage()).toBe(PAGES[2]);
        fireEvent.keyDown(window, { key: 'Home' });
        expect(shownPage()).toBe(PAGES[0]);
    });

    it('moves by the click on the half of the page, by the direction', async () => {
        const user = userEvent.setup();
        open();
        render(<MangaReader />);
        const stage = screen.getByTestId('reader-stage');
        stage.getBoundingClientRect = () => {
            return { left: 0, width: 200, top: 0, right: 200, bottom: 100, height: 100, x: 0, y: 0, toJSON: () => {return undefined} };
        };
        fireEvent.click(stage, { clientX: 150 });
        expect(shownPage()).toBe(PAGES[1]);
        fireEvent.click(stage, { clientX: 50 });
        expect(shownPage()).toBe(PAGES[0]);
        await user.click(screen.getByRole('button', { name: 'READER SETTINGS' }));
        await user.selectOptions(screen.getByLabelText('Reading direction'), 'rtl');
        fireEvent.click(stage, { clientX: 50 });
        expect(shownPage()).toBe(PAGES[1]);
        fireEvent.click(stage, { clientX: 150 });
        expect(shownPage()).toBe(PAGES[0]);
        fireEvent.keyDown(window, { key: 'ArrowLeft' });
        expect(shownPage()).toBe(PAGES[1]);
        fireEvent.keyDown(window, { key: 'ArrowRight' });
        expect(shownPage()).toBe(PAGES[0]);
    });

    it('goes to the next chapter past the last page, and to the previous before the first', () => {
        open();
        render(<MangaReader />);
        fireEvent.keyDown(window, { key: 'End' });
        fireEvent.keyDown(window, { key: 'ArrowRight' });
        expect(mock.api.manga.readPages).toHaveBeenLastCalledWith({ chapterRemoteId: 3, libraryChapterId: null });
    });

    describe('across the seasons of a series', () => {
        const SEASON_ONE = makeLibraryManga([makeChapterRecord({ id: 10, remoteId: 100, name: 'S1', number: 1, sourceOrder: 1 })], { id: 1, remoteId: 7, title: 'One Piece', series: 'One Piece', season: 1 });
        const SEASON_TWO = makeLibraryManga([makeChapterRecord({ id: 20, remoteId: 200, name: 'S2 first', number: 1, sourceOrder: 1 }), makeChapterRecord({ id: 21, remoteId: 201, name: 'S2 last', number: 2, sourceOrder: 2 })], {
            id: 2,
            remoteId: 8,
            title: 'One Piece 2',
            series: 'One Piece',
            season: 2
        });
        const SUMMARY = { remoteId: 7, sourceId: '123', title: 'One Piece', thumbnailUrl: null };

        beforeEach(() => {
            useMangaStore.setState({ library: [SEASON_TWO, SEASON_ONE] });
        });

        it('offers the next chapter at the end of the season and opens the first chapter of the next one', async () => {
            const user = userEvent.setup();
            open({ index: 2, manga: SUMMARY });
            render(<MangaReader />);
            expect(screen.getByRole('button', { name: 'NEXT CHAPTER' })).toBeEnabled();
            await user.click(screen.getByRole('button', { name: 'NEXT CHAPTER' }));
            expect(mock.api.manga.readPages).toHaveBeenLastCalledWith({ chapterRemoteId: 200, libraryChapterId: 20 });
            expect(useMangaStore.getState().reader).toMatchObject({ mangaTitle: 'One Piece 2', index: 0 });
        });

        it('offers the previous chapter at the start of the season and opens the last chapter of the previous one', async () => {
            const user = userEvent.setup();
            open({ index: 0, mangaTitle: 'One Piece 2', manga: { remoteId: 8, sourceId: '123', title: 'One Piece 2', thumbnailUrl: null }, chapters: [{ remoteId: 200, libraryChapterId: 20, name: 'S2 first', number: 1 }] });
            render(<MangaReader />);
            await user.click(screen.getByRole('button', { name: 'PREVIOUS CHAPTER' }));
            expect(mock.api.manga.readPages).toHaveBeenLastCalledWith({ chapterRemoteId: 100, libraryChapterId: 10 });
            expect(useMangaStore.getState().reader).toMatchObject({ mangaTitle: 'One Piece', index: 0 });
        });

        it('disables the buttons at the ends of the first and the last seasons', () => {
            open({ index: 0, manga: SUMMARY, chapters: [{ remoteId: 100, libraryChapterId: 10, name: 'S1', number: 1 }] });
            const { unmount } = render(<MangaReader />);
            expect(screen.getByRole('button', { name: 'PREVIOUS CHAPTER' })).toBeDisabled();
            expect(screen.getByRole('button', { name: 'NEXT CHAPTER' })).toBeEnabled();
            unmount();
            open({ index: 0, mangaTitle: 'One Piece 2', manga: { remoteId: 8, sourceId: '123', title: 'One Piece 2', thumbnailUrl: null }, chapters: [{ remoteId: 201, libraryChapterId: 21, name: 'S2 last', number: 2 }] });
            render(<MangaReader />);
            expect(screen.getByRole('button', { name: 'NEXT CHAPTER' })).toBeDisabled();
        });
    });

    it('goes to the previous chapter before the first page', () => {
        open();
        render(<MangaReader />);
        fireEvent.keyDown(window, { key: 'ArrowLeft' });
        expect(mock.api.manga.readPages).toHaveBeenLastCalledWith({ chapterRemoteId: 1, libraryChapterId: null });
    });

    it('changes chapter with N and P, and closes with Escape', () => {
        open();
        render(<MangaReader />);
        fireEvent.keyDown(window, { key: 'n' });
        expect(mock.api.manga.readPages).toHaveBeenLastCalledWith({ chapterRemoteId: 3, libraryChapterId: null });
        fireEvent.keyDown(window, { key: 'P' });
        expect(mock.api.manga.readPages).toHaveBeenLastCalledWith({ chapterRemoteId: 2, libraryChapterId: 8 });
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(useMangaStore.getState().reader.status).toBe('closed');
    });

    it('ignores the keys typed in a field', async () => {
        const user = userEvent.setup();
        open();
        render(<MangaReader />);
        await user.click(screen.getByRole('button', { name: 'READER SETTINGS' }));
        const select = screen.getByLabelText('Reading mode');
        fireEvent.keyDown(select, { key: 'ArrowRight' });
        expect(shownPage()).toBe(PAGES[0]);
    });

    it('loads the next pages before they are needed', () => {
        const sources: string[] = [];
        const original = window.Image;
        class FakeImage {
            set src(value: string) {
                sources.push(value);
            }
        }
        window.Image = FakeImage as unknown as typeof Image;
        open();
        render(<MangaReader />);
        window.Image = original;
        expect(sources).toEqual([PAGES[1], PAGES[2]]);
    });

    it('tries again only the page that failed, and loads it again', async () => {
        const user = userEvent.setup();
        open();
        render(<MangaReader />);
        await user.click(screen.getByRole('button', { name: 'READER SETTINGS' }));
        await user.selectOptions(screen.getByLabelText('Reading mode'), 'vertical');
        await user.click(screen.getByRole('button', { name: 'READER SETTINGS' }));
        const before = screen.getAllByRole('img');
        fireEvent.error(before[1]!);
        const alerts = screen.getAllByRole('alert');
        expect(alerts).toHaveLength(1);
        expect(alerts[0]).toHaveTextContent('Page 2 could not be loaded.');
        await user.click(screen.getByRole('button', { name: 'TRY AGAIN' }));
        const after = screen.getAllByRole('img');
        expect(after).toHaveLength(3);
        // The pages that did not fail are the same elements: they were not loaded again.
        expect(after[0]).toBe(before[0]);
        expect(after[2]).toBe(before[2]);
        expect(after[1]).toHaveAttribute('src', PAGES[1]);
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('says a page could not be loaded and tries it again', async () => {
        const user = userEvent.setup();
        open();
        render(<MangaReader />);
        fireEvent.error(screen.getByRole('img'));
        expect(screen.getByRole('alert')).toHaveTextContent('Page 1 could not be loaded.');
        expect(screen.queryByRole('img')).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'TRY AGAIN' }));
        expect(screen.getByRole('img')).toHaveAttribute('src', PAGES[0]);
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
});

describe('MangaReader a downloaded chapter that lacks pages', () => {
    const LOCAL = ['pullwave-manga://page/8/0', 'pullwave-manga://page/8/1', 'pullwave-manga://page/8/2'];

    it('says the page was not downloaded, and offers to download it instead of loading it again', () => {
        open({ pages: LOCAL, local: true, missing: [0] });
        render(<MangaReader />);
        fireEvent.error(screen.getByRole('img'));
        expect(screen.getByRole('alert')).toHaveTextContent('Page 1 was not downloaded.');
        expect(screen.queryByRole('img')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'DOWNLOAD PAGE' })).toBeEnabled();
        expect(screen.queryByRole('button', { name: 'TRY AGAIN' })).not.toBeInTheDocument();
    });

    it('downloads the page of the chapter of the library, and shows it once it is there', async () => {
        const user = userEvent.setup();
        mock.api.manga.repairChapter.mockResolvedValue({ ok: true, value: { missing: [] } });
        open({ pages: LOCAL, local: true, missing: [0] });
        render(<MangaReader />);
        fireEvent.error(screen.getByRole('img'));
        await user.click(screen.getByRole('button', { name: 'DOWNLOAD PAGE' }));
        expect(mock.api.manga.repairChapter).toHaveBeenCalledTimes(1);
        expect(mock.api.manga.repairChapter).toHaveBeenCalledWith(8, 0);
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(screen.getByRole('img')).toHaveAttribute('src', LOCAL[0]);
        expect(useMangaStore.getState().reader.missing).toEqual([]);
    });

    it('tells that the page could not be downloaded, and lets the user try again', async () => {
        const user = userEvent.setup();
        mock.api.manga.repairChapter.mockResolvedValueOnce({ ok: false, error: { code: 'REQUEST_FAILED', message: 'The server answered 500 for a page' } });
        mock.api.manga.repairChapter.mockResolvedValueOnce({ ok: true, value: { missing: [] } });
        open({ pages: LOCAL, local: true, missing: [0] });
        render(<MangaReader />);
        fireEvent.error(screen.getByRole('img'));
        await user.click(screen.getByRole('button', { name: 'DOWNLOAD PAGE' }));
        const alerts = screen.getAllByRole('alert');
        expect(alerts.map((alert) => {
            return alert.textContent;
        })).toEqual(['Page 1 was not downloaded.', 'The page could not be downloaded. Try again.']);
        expect(screen.queryByRole('img')).not.toBeInTheDocument();
        expect(useMangaStore.getState().reader.missing).toEqual([0]);
        expect(screen.getByRole('button', { name: 'DOWNLOAD PAGE' })).toBeEnabled();
        await user.click(screen.getByRole('button', { name: 'DOWNLOAD PAGE' }));
        expect(mock.api.manga.repairChapter).toHaveBeenCalledTimes(2);
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(screen.getByRole('img')).toHaveAttribute('src', LOCAL[0]);
    });

    it('keeps the button off while the page is being downloaded', async () => {
        const user = userEvent.setup();
        let answer: (result: { ok: true; value: { missing: number[] } }) => void = () => {
            return undefined;
        };
        mock.api.manga.repairChapter.mockReturnValue(
            new Promise((resolve) => {
                answer = resolve;
            })
        );
        open({ pages: LOCAL, local: true, missing: [0] });
        render(<MangaReader />);
        fireEvent.error(screen.getByRole('img'));
        await user.click(screen.getByRole('button', { name: 'DOWNLOAD PAGE' }));
        expect(screen.getByRole('button', { name: 'DOWNLOAD PAGE' })).toBeDisabled();
        await act(async () => {
            answer({ ok: true, value: { missing: [] } });
        });
        expect(screen.getByRole('img')).toHaveAttribute('src', LOCAL[0]);
        expect(mock.api.manga.repairChapter).toHaveBeenCalledTimes(1);
    });

    it('downloads only the page that is lacking in the scroll, and leaves the other pages as they are', async () => {
        const user = userEvent.setup();
        mock.api.manga.repairChapter.mockResolvedValue({ ok: true, value: { missing: [] } });
        open({ pages: LOCAL, local: true, missing: [2] });
        render(<MangaReader />);
        await user.click(screen.getByRole('button', { name: 'READER SETTINGS' }));
        await user.selectOptions(screen.getByLabelText('Reading mode'), 'vertical');
        await user.click(screen.getByRole('button', { name: 'READER SETTINGS' }));
        const before = screen.getAllByRole('img');
        fireEvent.error(before[2]!);
        expect(screen.getByRole('alert')).toHaveTextContent('Page 3 was not downloaded.');
        await user.click(screen.getByRole('button', { name: 'DOWNLOAD PAGE' }));
        expect(mock.api.manga.repairChapter).toHaveBeenCalledWith(8, 2);
        const after = screen.getAllByRole('img');
        expect(after).toHaveLength(3);
        expect(after[0]).toBe(before[0]);
        expect(after[1]).toBe(before[1]);
        expect(after[2]).toHaveAttribute('src', LOCAL[2]);
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('loads again a page that is there but did not load, even when the chapter lacks another page', async () => {
        const user = userEvent.setup();
        open({ pages: LOCAL, local: true, missing: [2] });
        render(<MangaReader />);
        fireEvent.error(screen.getByRole('img'));
        expect(screen.getByRole('alert')).toHaveTextContent('Page 1 could not be loaded.');
        expect(screen.queryByRole('button', { name: 'DOWNLOAD PAGE' })).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'TRY AGAIN' }));
        expect(mock.api.manga.repairChapter).not.toHaveBeenCalled();
        expect(screen.getByRole('img')).toHaveAttribute('src', LOCAL[0]);
    });

    it('forgets that a page could not be downloaded when the chapter changes', async () => {
        const user = userEvent.setup();
        mock.api.manga.repairChapter.mockResolvedValue({ ok: false, error: { code: 'IMAGE', message: 'A page came back empty' } });
        open({ pages: LOCAL, local: true, missing: [0] });
        render(<MangaReader />);
        fireEvent.error(screen.getByRole('img'));
        await user.click(screen.getByRole('button', { name: 'DOWNLOAD PAGE' }));
        expect(screen.getByText('The page could not be downloaded. Try again.')).toBeInTheDocument();
        mock.api.manga.readPages.mockResolvedValue({ ok: true, value: { pages: PAGES, local: false, missing: [] } });
        await act(async () => {
            await useMangaStore.getState().goToChapter(1);
        });
        fireEvent.error(screen.getByRole('img'));
        expect(screen.getByRole('alert')).toHaveTextContent('Page 1 could not be loaded.');
        expect(screen.queryByText('The page could not be downloaded. Try again.')).not.toBeInTheDocument();
    });
});

describe('MangaReader progress', () => {
    it('starts on the page the chapter was left on and keeps the page as it moves', () => {
        saveProgress('One Piece|2', 1);
        open();
        render(<MangaReader />);
        expect(shownPage()).toBe(PAGES[1]);
        fireEvent.keyDown(window, { key: 'ArrowLeft' });
        expect(loadProgress('One Piece|2')).toBe(0);
        fireEvent.keyDown(window, { key: 'ArrowRight' });
        expect(loadProgress('One Piece|2')).toBe(1);
    });

    it('starts over when the chapter was finished, and remembers the end as read', () => {
        saveProgress('One Piece|2', 7);
        open();
        render(<MangaReader />);
        expect(shownPage()).toBe(PAGES[0]);
        fireEvent.keyDown(window, { key: 'End' });
        expect(loadProgress('One Piece|2')).toBe(0);
    });
});

describe('MangaReader scroll', () => {
    it('shows every page in a column, in the vertical and the webtoon modes', async () => {
        const user = userEvent.setup();
        open();
        render(<MangaReader />);
        await user.click(screen.getByRole('button', { name: 'READER SETTINGS' }));
        await user.selectOptions(screen.getByLabelText('Reading mode'), 'vertical');
        const scroll = screen.getByTestId('reader-scroll');
        expect(scroll).toHaveClass('reader__scroll--vertical');
        expect(
            screen.getAllByRole('img').map((image) => {
                return image.getAttribute('src');
            })
        ).toEqual(PAGES);
        expect(screen.getAllByRole('img')[0]).toHaveAttribute('loading', 'lazy');
        expect(screen.getByLabelText('Reading direction')).toBeDisabled();
        await user.selectOptions(screen.getByLabelText('Reading mode'), 'webtoon');
        expect(screen.getByTestId('reader-scroll')).toHaveClass('reader__scroll--webtoon', 'reader__stage--width');
        expect(screen.getByLabelText('Page size')).toBeDisabled();
    });

    it('keeps the arrows for the scroll itself', async () => {
        const user = userEvent.setup();
        open();
        render(<MangaReader />);
        await user.click(screen.getByRole('button', { name: 'READER SETTINGS' }));
        await user.selectOptions(screen.getByLabelText('Reading mode'), 'vertical');
        fireEvent.keyDown(window, { key: 'ArrowRight' });
        expect(screen.getByText('1 / 3')).toBeInTheDocument();
    });

    it('follows the page that is in view', async () => {
        const user = userEvent.setup();
        let callback: IntersectionObserverCallback = () => {return undefined};
        const observed: Element[] = [];
        const disconnect = vi.fn();
        class FakeObserver {
            constructor(handler: IntersectionObserverCallback) {
                callback = handler;
            }
            observe(element: Element) {
                observed.push(element);
            }
            disconnect = disconnect;
        }
        vi.stubGlobal('IntersectionObserver', FakeObserver);
        open();
        const { unmount } = render(<MangaReader />);
        await user.click(screen.getByRole('button', { name: 'READER SETTINGS' }));
        await user.selectOptions(screen.getByLabelText('Reading mode'), 'vertical');
        expect(observed).toHaveLength(3);
        const entry = (index: number, ratio: number, isIntersecting: boolean) => {
            return { target: observed[index], intersectionRatio: ratio, isIntersecting } as unknown as IntersectionObserverEntry;
        };
        callback([entry(0, 0.2, true), entry(1, 0.8, true), entry(2, 0, false)], {} as IntersectionObserver);
        expect(await screen.findByText('2 / 3')).toBeInTheDocument();
        callback([entry(0, 0, false), entry(1, 0, false), entry(2, 0, false)], {} as IntersectionObserver);
        expect(screen.getByText('2 / 3')).toBeInTheDocument();
        unmount();
        expect(disconnect).toHaveBeenCalled();
        vi.unstubAllGlobals();
    });
});

describe('MangaReader settings', () => {
    it('opens and closes the panel with the button and with Escape, and offers the choices', async () => {
        const user = userEvent.setup();
        open();
        render(<MangaReader />);
        const gear = screen.getByRole('button', { name: 'READER SETTINGS' });
        expect(gear).toHaveAttribute('aria-expanded', 'false');
        await user.click(gear);
        expect(gear).toHaveAttribute('aria-expanded', 'true');
        const options = (label: string): Array<string | null> => {
            return Array.from(screen.getByLabelText(label).querySelectorAll('option')).map((option) => {
                return option.textContent;
            });
        };
        expect(options('Reading mode')).toEqual(['Single page', 'Vertical scroll', 'Webtoon']);
        expect(options('Reading direction')).toEqual(['Left to right', 'Right to left']);
        expect(options('Page size')).toEqual(['Fit to width', 'Fit to height', 'Fit to screen', 'Original size']);
        expect(options('Background')).toEqual(['Dark', 'Black', 'Gray', 'White']);
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(screen.queryByLabelText('Reading mode')).not.toBeInTheDocument();
        expect(useMangaStore.getState().reader.status).toBe('ready');
        await user.click(gear);
        await user.click(gear);
        expect(screen.queryByLabelText('Reading mode')).not.toBeInTheDocument();
    });

    it('changes the size and the background, and keeps what was chosen', async () => {
        const user = userEvent.setup();
        open();
        const { unmount } = render(<MangaReader />);
        await user.click(screen.getByRole('button', { name: 'READER SETTINGS' }));
        expect(screen.getByTestId('reader-stage')).toHaveClass('reader__stage--width');
        await user.selectOptions(screen.getByLabelText('Page size'), 'original');
        await user.selectOptions(screen.getByLabelText('Background'), 'white');
        expect(screen.getByTestId('reader-stage')).toHaveClass('reader__stage--original');
        expect(screen.getByRole('region', { name: 'Reader' })).toHaveClass('reader--white');
        expect(JSON.parse(window.localStorage.getItem(PREFS_KEY) ?? '{}')).toEqual({ mode: 'single', direction: 'ltr', scale: 'original', background: 'white', autoScrollSpeed: 80, pageGap: 8, chapterSwitch: true });
        unmount();
        render(<MangaReader />);
        expect(screen.getByTestId('reader-stage')).toHaveClass('reader__stage--original');
        expect(screen.getByRole('region', { name: 'Reader' })).toHaveClass('reader--white');
    });
});

describe('MangaReader the progress of the chapter', () => {
    it('shows how much of the chapter was read, in the bar of the neon of the app', async () => {
        open();
        render(<MangaReader />);
        const bar = screen.getByRole('progressbar', { name: 'Reading progress' });
        expect(bar).toHaveClass('progress', 'reader__progress');
        expect(bar).toHaveAttribute('aria-valuenow', '33');
        expect(bar.querySelector('.progress__bar')).toHaveStyle({ width: `${String((1 / 3) * 100)}%` });
        fireEvent.keyDown(window, { key: 'ArrowRight' });
        expect(await screen.findByText('2 / 3')).toBeInTheDocument();
        expect(screen.getByRole('progressbar', { name: 'Reading progress' })).toHaveAttribute('aria-valuenow', '67');
        fireEvent.keyDown(window, { key: 'ArrowRight' });
        expect(await screen.findByText('3 / 3')).toBeInTheDocument();
        expect(screen.getByRole('progressbar', { name: 'Reading progress' })).toHaveAttribute('aria-valuenow', '100');
        expect(screen.getByRole('progressbar', { name: 'Reading progress' }).querySelector('.progress__bar')).toHaveStyle({ width: '100%' });
    });

    describe('in the scroll', () => {
        let main: HTMLElement;
        let contentTop: number;

        beforeEach(() => {
            main = document.createElement('div');
            main.className = 'app__main';
            document.body.appendChild(main);
            contentTop = 0;
            vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
                const rect = (top: number, height: number): DOMRect => {
                    return { top, height, bottom: top + height, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => { return {}; } } as DOMRect;
                };
                if (this === main) {
                    return rect(0, 500);
                }
                if (this.getAttribute('data-testid') === 'reader-scroll') {
                    return rect(contentTop, 3000);
                }
                return rect(0, 0);
            });
        });

        afterEach(() => {
            vi.restoreAllMocks();
            main.remove();
        });

        async function openScrollMode(mode: 'vertical' | 'webtoon'): Promise<void> {
            const user = userEvent.setup();
            open();
            render(<MangaReader />, { container: main.appendChild(document.createElement('div')) });
            await user.click(screen.getByRole('button', { name: 'READER SETTINGS' }));
            await user.selectOptions(screen.getByLabelText('Reading mode'), mode);
        }

        function bar(): HTMLElement {
            return screen.getByRole('progressbar', { name: 'Reading progress' });
        }

        it.each(['vertical', 'webtoon'] as const)('follows the scroll in the %s mode, not the number of pages', async (mode) => {
            await openScrollMode(mode);
            expect(bar()).toHaveAttribute('aria-valuenow', '0');
            expect(bar().querySelector('.progress__bar')).toHaveStyle({ width: '0%' });
            contentTop = -1250;
            act(() => {
                main.dispatchEvent(new Event('scroll'));
            });
            expect(bar()).toHaveAttribute('aria-valuenow', '50');
            expect(bar().querySelector('.progress__bar')).toHaveStyle({ width: '50%' });
            expect(screen.getByText('1 / 3')).toBeInTheDocument();
            contentTop = -2500;
            act(() => {
                main.dispatchEvent(new Event('scroll'));
            });
            expect(bar()).toHaveAttribute('aria-valuenow', '100');
            expect(bar().querySelector('.progress__bar')).toHaveStyle({ width: '100%' });
        });

        it('goes back to following the page in the single page mode', async () => {
            await openScrollMode('vertical');
            contentTop = -1250;
            act(() => {
                main.dispatchEvent(new Event('scroll'));
            });
            expect(bar()).toHaveAttribute('aria-valuenow', '50');
            await userEvent.setup().selectOptions(screen.getByLabelText('Reading mode'), 'single');
            expect(bar()).toHaveAttribute('aria-valuenow', '33');
        });
    });

    it('is not there while the pages load or when there are none', () => {
        open({ status: 'loading', pages: [] });
        const { rerender } = render(<MangaReader />);
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
        open({ pages: [] });
        rerender(<MangaReader />);
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });
});

describe('MangaReader the chapter list', () => {
    it('is between the previous and the next chapter, with every chapter and the one being read chosen', () => {
        open();
        render(<MangaReader />);
        const select = screen.getByLabelText('Go to chapter');
        expect(select).toHaveValue('1');
        expect(
            Array.from(select.querySelectorAll('option')).map((option) => {
                return [option.getAttribute('value'), option.textContent];
            })
        ).toEqual([
            ['0', 'Chapter 1'],
            ['1', 'Chapter 2'],
            ['2', '#3']
        ]);
        const buttons = Array.from(select.parentElement!.children);
        expect(buttons.indexOf(select)).toBe(1);
        expect(buttons[0]).toHaveTextContent('PREVIOUS CHAPTER');
        expect(buttons[2]).toHaveTextContent('NEXT CHAPTER');
    });

    it('jumps to the chapter that is picked, reading it from where it is', async () => {
        const user = userEvent.setup();
        open({ index: 0 });
        render(<MangaReader />);
        await user.selectOptions(screen.getByLabelText('Go to chapter'), '2');
        expect(mock.api.manga.readPages).toHaveBeenCalledWith({ chapterRemoteId: 3, libraryChapterId: null });
        expect(useMangaStore.getState().reader.index).toBe(2);
    });
});

describe('MangaReader the settings stay in view', () => {
    it('opens inside the bar that stays on top of the page, wherever the user is reading', async () => {
        const user = userEvent.setup();
        open();
        render(<MangaReader />);
        await user.click(screen.getByRole('button', { name: 'READER SETTINGS' }));
        const panel = screen.getByLabelText('Reading mode').closest('.reader__settings');
        expect(panel).not.toBeNull();
        expect(panel!.parentElement).toHaveClass('reader__bar');
    });
});

describe('MangaReader back to the top', () => {
    function scrollArea(): HTMLElement {
        const area = document.createElement('div');
        area.className = 'app__main';
        area.scrollTo = vi.fn() as unknown as typeof area.scrollTo;
        document.body.appendChild(area);
        return area;
    }

    afterEach(() => {
        document.querySelectorAll('.app__main').forEach((element) => {
            element.remove();
        });
    });

    describe('the scroll to the top', () => {
        let frames: Array<(time: number) => void>;

        beforeEach(() => {
            frames = [];
            vi.stubGlobal('requestAnimationFrame', (callback: (time: number) => void) => {
                frames.push(callback);
                return frames.length;
            });
            vi.stubGlobal('cancelAnimationFrame', (id: number) => {
                frames[id - 1] = () => {
                    return undefined;
                };
            });
        });

        afterEach(() => {
            vi.unstubAllGlobals();
        });

        function runFrame(time: number): void {
            const run = frames.splice(0);
            act(() => {
                run.forEach((frame) => {
                    frame(time);
                });
            });
        }

        async function openScrolledDown(top: number): Promise<{ area: HTMLElement; button: HTMLElement }> {
            const area = scrollArea();
            open();
            render(<MangaReader />, { container: area.appendChild(document.createElement('div')) });
            area.scrollTop = top;
            fireEvent.scroll(area);
            return { area, button: await screen.findByRole('button', { name: 'Back to the top' }) };
        }

        it('shows a button at the corner once the page is scrolled down', async () => {
            const area = scrollArea();
            open();
            render(<MangaReader />, { container: area.appendChild(document.createElement('div')) });
            expect(screen.queryByRole('button', { name: 'Back to the top' })).not.toBeInTheDocument();
            area.scrollTop = 900;
            fireEvent.scroll(area);
            expect(await screen.findByRole('button', { name: 'Back to the top' })).toHaveClass('reader__top');
            area.scrollTop = 100;
            fireEvent.scroll(area);
            await vi.waitFor(() => {
                expect(screen.queryByRole('button', { name: 'Back to the top' })).not.toBeInTheDocument();
            });
        });

        it('glides up frame by frame, slowly at the start and at the end, and lands on the top', async () => {
            const user = userEvent.setup();
            const { area, button } = await openScrolledDown(900);
            await user.click(button);
            expect(area.scrollTo).not.toHaveBeenCalled();
            expect(area.scrollTop).toBe(900);
            runFrame(1000);
            expect(area.scrollTop).toBe(900);
            runFrame(1100);
            const early = area.scrollTop;
            expect(early).toBeLessThan(900);
            expect(early).toBeGreaterThan(800);
            runFrame(1250);
            const middle = area.scrollTop;
            expect(middle).toBeLessThan(early);
            runFrame(1350);
            expect(area.scrollTop).toBeLessThan(middle);
            runFrame(5000);
            expect(area.scrollTop).toBe(0);
            expect(frames).toHaveLength(0);
        });

        it('stops where it is when the user takes over', async () => {
            const user = userEvent.setup();
            const { area, button } = await openScrolledDown(900);
            await user.click(button);
            runFrame(1000);
            runFrame(1200);
            const stoppedAt = area.scrollTop;
            expect(stoppedAt).toBeGreaterThan(0);
            fireEvent.wheel(area);
            runFrame(1400);
            runFrame(5000);
            expect(area.scrollTop).toBe(stoppedAt);
        });

        it('stops the auto scroll that was going on', async () => {
            const user = userEvent.setup();
            const { area } = await openScrolledDown(900);
            await user.click(screen.getByRole('button', { name: 'READER SETTINGS' }));
            await user.selectOptions(screen.getByLabelText('Reading mode'), 'vertical');
            await user.click(screen.getByRole('button', { name: 'READER SETTINGS' }));
            await user.click(screen.getByRole('button', { name: 'AUTO SCROLL' }));
            expect(screen.getByRole('button', { name: 'STOP SCROLL' })).toHaveAttribute('aria-pressed', 'true');
            // The chapter starts again at its first page when the mode changes: the page is scrolled down again.
            area.scrollTop = 3000;
            fireEvent.scroll(area);
            await user.click(await screen.findByRole('button', { name: 'Back to the top' }));
            expect(screen.getByRole('button', { name: 'AUTO SCROLL' })).toHaveAttribute('aria-pressed', 'false');
        });
    });
});

describe('MangaReader auto scroll', () => {
    let frames: Array<(time: number) => void> = [];
    let area: HTMLElement;

    beforeEach(() => {
        frames = [];
        vi.stubGlobal('requestAnimationFrame', (callback: (time: number) => void) => {
            frames.push(callback);
            return frames.length;
        });
        vi.stubGlobal('cancelAnimationFrame', (id: number) => {
            frames[id - 1] = () => {
                return undefined;
            };
        });
        area = document.createElement('div');
        area.className = 'app__main';
        Object.defineProperty(area, 'clientHeight', { value: 500, configurable: true });
        Object.defineProperty(area, 'scrollHeight', { value: 5000, configurable: true });
        document.body.appendChild(area);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        area.remove();
    });

    function tick(time: number): void {
        const run = frames.splice(0);
        act(() => {
            run.forEach((frame) => {
                frame(time);
            });
        });
    }

    async function openScroll(user: ReturnType<typeof userEvent.setup>, patch: Partial<MangaReaderState> = {}): Promise<void> {
        open(patch);
        render(<MangaReader />, { container: area.appendChild(document.createElement('div')) });
        await user.click(screen.getByRole('button', { name: 'READER SETTINGS' }));
        await user.selectOptions(screen.getByLabelText('Reading mode'), 'vertical');
        await user.click(screen.getByRole('button', { name: 'READER SETTINGS' }));
    }

    it('is off in the single page mode, and says why', () => {
        open();
        render(<MangaReader />);
        const button = screen.getByRole('button', { name: 'AUTO SCROLL' });
        expect(button).toBeDisabled();
        expect(button).toHaveAttribute('title', 'Auto scroll works in the vertical scroll and webtoon modes.');
    });

    it('scrolls the page down by itself at the speed chosen, and stops when told to', async () => {
        const user = userEvent.setup();
        await openScroll(user);
        const button = screen.getByRole('button', { name: 'AUTO SCROLL' });
        expect(button).toBeEnabled();
        expect(button).toHaveAttribute('aria-pressed', 'false');
        await user.click(button);
        expect(screen.getByRole('button', { name: 'STOP SCROLL' })).toHaveAttribute('aria-pressed', 'true');
        tick(1000);
        tick(2000);
        expect(area.scrollTop).toBe(80);
        tick(3000);
        expect(area.scrollTop).toBe(160);
        await user.click(screen.getByRole('button', { name: 'STOP SCROLL' }));
        expect(screen.getByRole('button', { name: 'AUTO SCROLL' })).toHaveAttribute('aria-pressed', 'false');
        tick(4000);
        expect(area.scrollTop).toBe(160);
    });

    it('uses the speed of the settings, and keeps it', async () => {
        const user = userEvent.setup();
        await openScroll(user);
        await user.click(screen.getByRole('button', { name: 'READER SETTINGS' }));
        const speed = screen.getByLabelText('Auto scroll speed (pixels per second)');
        expect(speed).toHaveValue(80);
        expect(speed).toHaveAttribute('min', '10');
        expect(speed).toHaveAttribute('max', '600');
        expect(speed).toHaveAttribute('step', '10');
        fireEvent.change(speed, { target: { value: '200' } });
        expect(JSON.parse(window.localStorage.getItem(PREFS_KEY) ?? '{}')).toMatchObject({ autoScrollSpeed: 200 });
        await user.click(screen.getByRole('button', { name: 'READER SETTINGS' }));
        await user.click(screen.getByRole('button', { name: 'AUTO SCROLL' }));
        tick(1000);
        tick(2000);
        expect(area.scrollTop).toBe(200);
    });

    it('keeps the speed inside its limits', async () => {
        const user = userEvent.setup();
        await openScroll(user);
        await user.click(screen.getByRole('button', { name: 'READER SETTINGS' }));
        const speed = screen.getByLabelText('Auto scroll speed (pixels per second)');
        fireEvent.change(speed, { target: { value: '99999' } });
        expect(speed).toHaveValue(600);
        fireEvent.change(speed, { target: { value: '1' } });
        expect(speed).toHaveValue(10);
    });

    it('stops by itself at the end of the last chapter', async () => {
        const user = userEvent.setup();
        await openScroll(user, { index: 2 });
        area.scrollTop = 4600;
        await user.click(screen.getByRole('button', { name: 'AUTO SCROLL' }));
        tick(1000);
        tick(2000);
        expect(screen.getByRole('button', { name: 'AUTO SCROLL' })).toHaveAttribute('aria-pressed', 'false');
    });

    it('waits at the end of the chapter for the next one when it opens by itself', async () => {
        const user = userEvent.setup();
        await openScroll(user);
        area.scrollTop = 4600;
        await user.click(screen.getByRole('button', { name: 'AUTO SCROLL' }));
        tick(1000);
        tick(2000);
        tick(3000);
        expect(screen.getByRole('button', { name: 'STOP SCROLL' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('stops at the end of the chapter when the next one does not open by itself', async () => {
        const user = userEvent.setup();
        window.localStorage.setItem(PREFS_KEY, JSON.stringify({ chapterSwitch: false }));
        await openScroll(user);
        area.scrollTop = 4600;
        await user.click(screen.getByRole('button', { name: 'AUTO SCROLL' }));
        tick(1000);
        tick(2000);
        expect(screen.getByRole('button', { name: 'AUTO SCROLL' })).toHaveAttribute('aria-pressed', 'false');
    });

    it('stops when the reader goes back to one page at a time', async () => {
        const user = userEvent.setup();
        await openScroll(user);
        await user.click(screen.getByRole('button', { name: 'AUTO SCROLL' }));
        await user.click(screen.getByRole('button', { name: 'READER SETTINGS' }));
        await user.selectOptions(screen.getByLabelText('Reading mode'), 'single');
        expect(screen.getByRole('button', { name: 'AUTO SCROLL' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'AUTO SCROLL' })).toHaveAttribute('aria-pressed', 'false');
    });
});

describe('MangaReader the space between the pages', () => {
    async function openVertical(user: ReturnType<typeof userEvent.setup>): Promise<void> {
        open();
        render(<MangaReader />);
        await user.click(screen.getByRole('button', { name: 'READER SETTINGS' }));
        await user.selectOptions(screen.getByLabelText('Reading mode'), 'vertical');
    }

    it('is 8 pixels by default in the vertical scroll', async () => {
        const user = userEvent.setup();
        await openVertical(user);
        expect(screen.getByLabelText('Space between pages (pixels)')).toHaveValue(8);
        expect(screen.getByTestId('reader-scroll')).toHaveStyle({ gap: '8px' });
    });

    it('can be made zero, which joins the pages, and is kept', async () => {
        const user = userEvent.setup();
        await openVertical(user);
        const field = screen.getByLabelText('Space between pages (pixels)');
        expect(field).toHaveAttribute('min', '0');
        expect(field).toHaveAttribute('max', '100');
        expect(field).toHaveAttribute('step', '4');
        fireEvent.change(field, { target: { value: '0' } });
        expect(screen.getByTestId('reader-scroll')).toHaveStyle({ gap: '0px' });
        expect(JSON.parse(window.localStorage.getItem(PREFS_KEY) ?? '{}')).toMatchObject({ pageGap: 0 });
    });

    it('can be made wider, within its limits', async () => {
        const user = userEvent.setup();
        await openVertical(user);
        const field = screen.getByLabelText('Space between pages (pixels)');
        fireEvent.change(field, { target: { value: '40' } });
        expect(screen.getByTestId('reader-scroll')).toHaveStyle({ gap: '40px' });
        fireEvent.change(field, { target: { value: '5000' } });
        expect(field).toHaveValue(100);
        fireEvent.change(field, { target: { value: '-3' } });
        expect(field).toHaveValue(0);
    });

    it('is off, and says why, in the single page mode and in the webtoon mode', async () => {
        const user = userEvent.setup();
        open();
        render(<MangaReader />);
        await user.click(screen.getByRole('button', { name: 'READER SETTINGS' }));
        expect(screen.getByLabelText('Space between pages (pixels)')).toBeDisabled();
        expect(screen.getByText('Only in the vertical scroll; the webtoon mode has none.')).toBeInTheDocument();
        await user.selectOptions(screen.getByLabelText('Reading mode'), 'webtoon');
        expect(screen.getByLabelText('Space between pages (pixels)')).toBeDisabled();
        expect(screen.getByTestId('reader-scroll')).not.toHaveAttribute('style');
    });
});

describe('MangaReader continuing where the manga was last read', () => {
    it('keeps the chapter and the page as the pages are turned, the last page included', () => {
        open();
        render(<MangaReader />);
        expect(loadLastPosition('One Piece')).toEqual({ chapterRemoteId: 2, page: 0 });
        fireEvent.keyDown(window, { key: 'ArrowRight' });
        expect(loadLastPosition('One Piece')).toEqual({ chapterRemoteId: 2, page: 1 });
        fireEvent.keyDown(window, { key: 'End' });
        expect(loadLastPosition('One Piece')).toEqual({ chapterRemoteId: 2, page: 2 });
        // The page kept for the chapter goes back to the first one when it is read to its end, the last position does not.
        expect(loadProgress('One Piece|2')).toBe(0);
    });

    it('keeps the new chapter with the page it starts on when the reader goes to another chapter', async () => {
        saveProgress('One Piece|3', 1);
        open();
        render(<MangaReader />);
        act(() => {
            open({ index: 2 });
        });
        expect(loadLastPosition('One Piece')).toEqual({ chapterRemoteId: 3, page: 1 });
    });

    it('keeps nothing while the pages load, when there are none, or when the chapter did not load', () => {
        open({ status: 'loading', pages: [] });
        const { rerender } = render(<MangaReader />);
        expect(loadLastPosition('One Piece')).toBeNull();
        open({ status: 'ready', pages: [] });
        rerender(<MangaReader />);
        expect(loadLastPosition('One Piece')).toBeNull();
        open({ status: 'error', pages: [], error: { code: 'API_ERROR', message: 'x' } });
        rerender(<MangaReader />);
        expect(loadLastPosition('One Piece')).toBeNull();
    });

    it('starts on the last page when the manga was last read there, though the chapter starts over when it is opened from its row', () => {
        saveLastPosition('One Piece', 2, 2);
        open({ resume: true });
        const { unmount } = render(<MangaReader />);
        expect(shownPage()).toBe(PAGES[2]);
        expect(screen.getByText('3 / 3')).toBeInTheDocument();
        unmount();
        saveProgress('One Piece|2', 0);
        open({ resume: false });
        render(<MangaReader />);
        expect(shownPage()).toBe(PAGES[0]);
    });

    it('starts on the page the manga was last read on, not on the one the chapter was left on, when it is continued', () => {
        saveProgress('One Piece|2', 1);
        saveLastPosition('One Piece', 2, 2);
        open({ resume: true });
        render(<MangaReader />);
        expect(shownPage()).toBe(PAGES[2]);
    });

    it('starts on the page the chapter was left on when it is not continued, whatever the last position', () => {
        saveProgress('One Piece|2', 1);
        saveLastPosition('One Piece', 2, 2);
        open();
        render(<MangaReader />);
        expect(shownPage()).toBe(PAGES[1]);
    });

    it('starts where the chapter was left when the last position is of another chapter, or there is none', () => {
        saveProgress('One Piece|2', 1);
        saveLastPosition('One Piece', 1, 2);
        open({ resume: true });
        const { unmount } = render(<MangaReader />);
        expect(shownPage()).toBe(PAGES[1]);
        unmount();
        window.localStorage.clear();
        saveProgress('One Piece|2', 1);
        open({ resume: true });
        render(<MangaReader />);
        expect(shownPage()).toBe(PAGES[1]);
    });

    it('starts on the first page when the page kept is past the end of the chapter', () => {
        saveLastPosition('One Piece', 2, 9);
        open({ resume: true });
        render(<MangaReader />);
        expect(shownPage()).toBe(PAGES[0]);
    });

    it('keeps the last position of each manga on its own', () => {
        open();
        render(<MangaReader />);
        fireEvent.keyDown(window, { key: 'ArrowRight' });
        act(() => {
            open({ mangaTitle: 'Bleach', index: 0 });
        });
        expect(loadLastPosition('Bleach')).toEqual({ chapterRemoteId: 1, page: 0 });
        expect(loadLastPosition('One Piece')).toEqual({ chapterRemoteId: 2, page: 1 });
    });
});

describe('MangaReader what was read', () => {
    beforeEach(() => {
        useMangaStore.setState({ readKeys: [] });
    });

    it('remembers the chapter the manga is being read in', () => {
        open();
        render(<MangaReader />);
        expect(loadLastChapter('One Piece')).toBe(2);
        act(() => {
            open({ index: 0 });
        });
        expect(loadLastChapter('One Piece')).toBe(1);
    });

    it('does not remember a chapter that did not load', () => {
        open({ status: 'loading', pages: [] });
        render(<MangaReader />);
        expect(loadLastChapter('One Piece')).toBeNull();
    });

    it('marks the chapter as read only when its last page is reached', async () => {
        open();
        render(<MangaReader />);
        expect(useMangaStore.getState().readKeys).toEqual([]);
        fireEvent.keyDown(window, { key: 'ArrowRight' });
        expect(await screen.findByText('2 / 3')).toBeInTheDocument();
        expect(useMangaStore.getState().readKeys).toEqual([]);
        fireEvent.keyDown(window, { key: 'ArrowRight' });
        expect(await screen.findByText('3 / 3')).toBeInTheDocument();
        expect(useMangaStore.getState().readKeys).toEqual([progressKey('One Piece', 2)]);
    });

    it('marks a chapter of one page as read right away', () => {
        open({ pages: [PAGES[0]!] });
        render(<MangaReader />);
        expect(useMangaStore.getState().readKeys).toEqual([progressKey('One Piece', 2)]);
    });
});

describe('MangaReader the buttons at the corner', () => {
    it('has the auto scroll beside the one that goes back to the top, at the bottom right, and none in the bar', async () => {
        const user = userEvent.setup();
        open();
        const area = document.createElement('div');
        area.className = 'app__main';
        area.scrollTo = vi.fn() as unknown as typeof area.scrollTo;
        document.body.appendChild(area);
        render(<MangaReader />, { container: area.appendChild(document.createElement('div')) });
        const auto = screen.getByRole('button', { name: 'AUTO SCROLL' });
        expect(auto.closest('.reader__float')).not.toBeNull();
        expect(auto.closest('.reader__bar')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Back to the top' })).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'READER SETTINGS' }));
        await user.selectOptions(screen.getByLabelText('Reading mode'), 'vertical');
        area.scrollTop = 900;
        fireEvent.scroll(area);
        const top = await screen.findByRole('button', { name: 'Back to the top' });
        expect(top.parentElement).toBe(auto.parentElement);
        expect(auto.parentElement).toHaveClass('reader__float');
        area.remove();
    });

    it('is not there while the pages load', () => {
        open({ status: 'loading', pages: [] });
        render(<MangaReader />);
        expect(screen.queryByRole('button', { name: 'AUTO SCROLL' })).not.toBeInTheDocument();
    });
});

describe('MangaReader the size of the pages by default', () => {
    it('fits the pages to the width until the user chooses another size', async () => {
        const user = userEvent.setup();
        open();
        render(<MangaReader />);
        expect(screen.getByTestId('reader-stage')).toHaveClass('reader__stage--width');
        await user.click(screen.getByRole('button', { name: 'READER SETTINGS' }));
        expect(screen.getByLabelText('Page size')).toHaveValue('width');
    });
});

describe('MangaReader coming back to a page in the scroll', () => {
    const MANY = ['p/0', 'p/1', 'p/2', 'p/3', 'p/4'].map((path) => {
        return `http://127.0.0.1:4321/${path}`;
    });
    let observed: Element[];
    let callback: IntersectionObserverCallback;
    let broughtIntoView: string[];

    function entry(index: number, ratio: number): IntersectionObserverEntry {
        return { target: observed[index], intersectionRatio: ratio, isIntersecting: ratio > 0 } as unknown as IntersectionObserverEntry;
    }

    function image(index: number): HTMLElement {
        return screen.getAllByRole('img')[index]!;
    }

    function renderScroll(savedPage: number, mode: 'vertical' | 'webtoon' | 'single' = 'vertical'): void {
        saveReaderPrefs({ ...loadReaderPrefs(), mode });
        if (savedPage > 0) {
            saveProgress('One Piece|2', savedPage);
        }
        open({ pages: MANY });
        render(<MangaReader />);
    }

    beforeEach(() => {
        observed = [];
        broughtIntoView = [];
        callback = () => {
            return undefined;
        };
        class FakeObserver {
            constructor(handler: IntersectionObserverCallback) {
                callback = handler;
            }
            observe(element: Element) {
                observed.push(element);
            }
            disconnect() {
                return undefined;
            }
        }
        vi.stubGlobal('IntersectionObserver', FakeObserver);
        Element.prototype.scrollIntoView = function scrollIntoView(this: HTMLElement) {
            broughtIntoView.push(this.dataset['page'] ?? '');
        };
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
        delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    });

    it('brings the chapter to the page it was left on, and says that page', () => {
        renderScroll(2);
        expect(broughtIntoView).toEqual(['2']);
        expect(screen.getByText('3 / 5')).toBeInTheDocument();
    });

    it('loads at once the pictures above that page and the next one, and the others when they come in view', () => {
        renderScroll(2);
        expect(
            screen.getAllByRole('img').map((item) => {
                return item.getAttribute('loading');
            })
        ).toEqual([null, null, null, null, 'lazy']);
    });

    it('does not let the pages that come in view change the place while the pictures above it arrive', () => {
        renderScroll(2);
        act(() => {
            callback([entry(0, 0.9), entry(1, 0.1)], {} as IntersectionObserver);
        });
        expect(screen.getByText('3 / 5')).toBeInTheDocument();
        expect(loadProgress('One Piece|2')).toBe(2);
    });

    it('brings the chapter back to the page every time a picture above it arrives', () => {
        renderScroll(2);
        broughtIntoView.length = 0;
        fireEvent.load(image(0));
        fireEvent.load(image(1));
        expect(broughtIntoView).toEqual(['2', '2']);
    });

    it('goes back to following the page in view once every picture up to the page has arrived', () => {
        renderScroll(2);
        fireEvent.load(image(0));
        fireEvent.load(image(1));
        act(() => {
            callback([entry(0, 0.9)], {} as IntersectionObserver);
        });
        expect(screen.getByText('3 / 5')).toBeInTheDocument();
        fireEvent.load(image(2));
        act(() => {
            callback([entry(0, 0.9), entry(3, 0.1)], {} as IntersectionObserver);
        });
        expect(screen.getByText('1 / 5')).toBeInTheDocument();
        expect(loadProgress('One Piece|2')).toBe(0);
    });

    it('counts a picture that failed as one that is no longer being waited for', () => {
        renderScroll(1);
        fireEvent.error(image(0));
        fireEvent.load(image(1));
        act(() => {
            callback([entry(0, 0.2), entry(1, 0.7)], {} as IntersectionObserver);
        });
        expect(screen.getByText('2 / 5')).toBeInTheDocument();
        expect(screen.getByText('Page 1 could not be loaded.')).toBeInTheDocument();
    });

    it('does not count the pictures after the page, which are not waited for', () => {
        renderScroll(1);
        fireEvent.load(image(3));
        fireEvent.load(image(4));
        broughtIntoView.length = 0;
        fireEvent.load(image(0));
        expect(broughtIntoView).toEqual(['1']);
    });

    it.each([['wheel'], ['touchstart'], ['mousedown'], ['keydown']] as const)('lets the user take over with %s', (name) => {
        renderScroll(2);
        fireEvent[name === 'keydown' ? 'keyDown' : name === 'mousedown' ? 'mouseDown' : name === 'touchstart' ? 'touchStart' : 'wheel'](window, name === 'keydown' ? { key: 'Shift' } : {});
        act(() => {
            callback([entry(0, 0.9)], {} as IntersectionObserver);
        });
        expect(screen.getByText('1 / 5')).toBeInTheDocument();
    });

    it('stops correcting the place after a few seconds even if a picture never arrives', () => {
        vi.useFakeTimers();
        renderScroll(2);
        act(() => {
            vi.advanceTimersByTime(7999);
        });
        act(() => {
            callback([entry(0, 0.9)], {} as IntersectionObserver);
        });
        expect(screen.getByText('3 / 5')).toBeInTheDocument();
        act(() => {
            vi.advanceTimersByTime(1);
        });
        act(() => {
            callback([entry(0, 0.9)], {} as IntersectionObserver);
        });
        expect(screen.getByText('1 / 5')).toBeInTheDocument();
    });

    it('does nothing about the place when the chapter starts at the first page, which follows the page in view at once', () => {
        renderScroll(0);
        expect(broughtIntoView).toEqual([]);
        expect(
            screen.getAllByRole('img').map((item) => {
                return item.getAttribute('loading');
            })
        ).toEqual(['lazy', 'lazy', 'lazy', 'lazy', 'lazy']);
        act(() => {
            callback([entry(0, 0.2), entry(1, 0.8)], {} as IntersectionObserver);
        });
        expect(screen.getByText('2 / 5')).toBeInTheDocument();
    });

    it('starts on the page it was left on in the page by page mode, with nothing to bring into view', () => {
        renderScroll(2, 'single');
        expect(broughtIntoView).toEqual([]);
        expect(shownPage()).toBe(MANY[2]);
    });

    it('brings the next chapter to its own page when the reader goes to it', () => {
        saveProgress('One Piece|3', 3);
        renderScroll(2);
        broughtIntoView.length = 0;
        act(() => {
            useMangaStore.setState({ reader: { ...useMangaStore.getState().reader, index: 2 } });
        });
        expect(broughtIntoView).toEqual(['3']);
        expect(screen.getByText('4 / 5')).toBeInTheDocument();
    });
});

describe('MangaReader the history of reading', () => {
    const MANGA = { remoteId: 7, sourceId: '123', title: 'One Piece', thumbnailUrl: '/api/v1/manga/7/thumbnail' };
    const RECORD = { sourceId: '123', mangaRemoteId: 7, title: 'One Piece', thumbnailUrl: '/api/v1/manga/7/thumbnail', chapterRemoteId: 2, chapterName: 'Chapter 2', chapterNumber: 2, pageCount: 3 };

    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('writes where the user is a moment after the page stops changing', () => {
        open({ manga: MANGA });
        render(<MangaReader />);
        act(() => {
            vi.advanceTimersByTime(799);
        });
        expect(mock.api.manga.recordReading).not.toHaveBeenCalled();
        act(() => {
            vi.advanceTimersByTime(1);
        });
        expect(mock.api.manga.recordReading).toHaveBeenCalledTimes(1);
        expect(mock.api.manga.recordReading).toHaveBeenCalledWith({ ...RECORD, page: 0 });
    });

    it('writes only the page the user stopped on when they turn the pages quickly', () => {
        open({ manga: MANGA });
        render(<MangaReader />);
        fireEvent.keyDown(window, { key: 'ArrowRight' });
        act(() => {
            vi.advanceTimersByTime(500);
        });
        fireEvent.keyDown(window, { key: 'ArrowRight' });
        act(() => {
            vi.advanceTimersByTime(799);
        });
        expect(mock.api.manga.recordReading).not.toHaveBeenCalled();
        act(() => {
            vi.advanceTimersByTime(1);
        });
        expect(mock.api.manga.recordReading).toHaveBeenCalledTimes(1);
        expect(mock.api.manga.recordReading).toHaveBeenCalledWith({ ...RECORD, page: 2 });
    });

    it('writes what is waiting when the reader closes, so a chapter left at once is not lost', () => {
        open({ manga: MANGA });
        const { unmount } = render(<MangaReader />);
        fireEvent.keyDown(window, { key: 'ArrowRight' });
        unmount();
        expect(mock.api.manga.recordReading).toHaveBeenCalledTimes(1);
        expect(mock.api.manga.recordReading).toHaveBeenCalledWith({ ...RECORD, page: 1 });
        act(() => {
            vi.advanceTimersByTime(5000);
        });
        expect(mock.api.manga.recordReading).toHaveBeenCalledTimes(1);
    });

    it('does not write twice what was written already when the reader closes', () => {
        open({ manga: MANGA });
        const { unmount } = render(<MangaReader />);
        act(() => {
            vi.advanceTimersByTime(800);
        });
        unmount();
        expect(mock.api.manga.recordReading).toHaveBeenCalledTimes(1);
    });

    it('writes what is waiting when the reader goes to another chapter, and then the new one', () => {
        open({ manga: MANGA, index: 0 });
        render(<MangaReader />);
        fireEvent.keyDown(window, { key: 'ArrowRight' });
        act(() => {
            useMangaStore.setState({ reader: { ...useMangaStore.getState().reader, index: 1, pages: PAGES.slice(0, 2) } });
        });
        expect(mock.api.manga.recordReading).toHaveBeenCalledTimes(1);
        expect(mock.api.manga.recordReading).toHaveBeenLastCalledWith({ ...RECORD, chapterRemoteId: 1, chapterName: 'Chapter 1', chapterNumber: 1, page: 1 });
        act(() => {
            vi.advanceTimersByTime(800);
        });
        expect(mock.api.manga.recordReading).toHaveBeenCalledTimes(2);
        expect(mock.api.manga.recordReading).toHaveBeenLastCalledWith({ ...RECORD, chapterRemoteId: 2, chapterName: 'Chapter 2', chapterNumber: 2, pageCount: 2, page: 0 });
    });

    it('writes nothing when the manga is not known, while the pages are loading, or when there are none', () => {
        open({ manga: null });
        const { unmount } = render(<MangaReader />);
        unmount();
        open({ manga: MANGA, status: 'loading', pages: [] });
        const second = render(<MangaReader />);
        second.unmount();
        open({ manga: MANGA, pages: [] });
        const third = render(<MangaReader />);
        act(() => {
            vi.advanceTimersByTime(5000);
        });
        third.unmount();
        open({ manga: undefined });
        render(<MangaReader />);
        act(() => {
            vi.advanceTimersByTime(5000);
        });
        expect(mock.api.manga.recordReading).not.toHaveBeenCalled();
    });
});

describe('MangaReader the check of Cloudflare while the pages are asked for', () => {
    const MANGA = { remoteId: 7, sourceId: '123', title: 'One Piece', thumbnailUrl: null };

    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('says a check of the source of the manga is going on while the pages load, after a moment', () => {
        useMangaStore.setState({ cloudflare: [{ id: 1, host: 'dex.example', startedAt: 1 }] });
        open({ status: 'loading', pages: [], manga: MANGA });
        render(<MangaReader />);
        expect(screen.getByText('Loading the pages…')).toBeInTheDocument();
        expect(screen.queryByTestId('manga-cloudflare')).not.toBeInTheDocument();
        act(() => {
            vi.advanceTimersByTime(CLOUDFLARE_SHOW_AFTER_MS);
        });
        expect(screen.getByTestId('manga-cloudflare')).toHaveTextContent('Passing the Cloudflare check of dex.example');
    });

    it('does not say it for the check of another source, nor once the pages are there', () => {
        useMangaStore.setState({ cloudflare: [{ id: 1, host: 'dex.example', startedAt: 1 }], library: [makeLibraryManga([], { id: 1, sourceId: '999', url: 'https://dex.example/m' })] });
        open({ status: 'loading', pages: [], manga: MANGA });
        const { unmount } = render(<MangaReader />);
        act(() => {
            vi.advanceTimersByTime(CLOUDFLARE_SHOW_AFTER_MS * 2);
        });
        expect(screen.queryByTestId('manga-cloudflare')).not.toBeInTheDocument();
        unmount();
        useMangaStore.setState({ library: [] });
        open({ status: 'ready', manga: MANGA });
        render(<MangaReader />);
        act(() => {
            vi.advanceTimersByTime(CLOUDFLARE_SHOW_AFTER_MS * 2);
        });
        expect(screen.queryByTestId('manga-cloudflare')).not.toBeInTheDocument();
    });
});

describe('MangaReader the zones between chapters', () => {
    let area: HTMLElement;
    let frames: Array<(time: number) => void>;

    function box(top: number, height: number): DOMRect {
        return { top, height, bottom: top + height, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => { return {}; } } as DOMRect;
    }

    beforeEach(() => {
        area = document.createElement('div');
        area.className = 'app__main';
        area.scrollTo = vi.fn() as unknown as typeof area.scrollTo;
        document.body.appendChild(area);
        frames = [];
        vi.stubGlobal('requestAnimationFrame', (callback: (time: number) => void) => {
            frames.push(callback);
            return frames.length;
        });
        vi.stubGlobal('cancelAnimationFrame', (id: number) => {
            frames[id - 1] = () => {
                return undefined;
            };
        });
        // An area 652 tall under a bar of 90, with the pages 3000 tall after a zone of 468 (the pages start at 678 when it is not scrolled).
        vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
            if (this === area) {
                return box(112, 652);
            }
            if (this.classList.contains('reader__bar')) {
                return box(112, 90);
            }
            if (this.getAttribute('data-testid') === 'reader-scroll') {
                return box(678 - area.scrollTop, 3000);
            }
            return box(0, 0);
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        area.remove();
    });

    function show(patch: Partial<MangaReaderState> = {}, mode: 'vertical' | 'webtoon' | 'single' = 'webtoon') {
        window.localStorage.setItem(PREFS_KEY, JSON.stringify({ mode }));
        open(patch);
        return render(<MangaReader />, { container: area.appendChild(document.createElement('div')) });
    }

    function runFrames(time: number): void {
        const run = frames.splice(0);
        act(() => {
            run.forEach((frame) => {
                frame(time);
            });
        });
    }

    it.each(['vertical', 'webtoon'] as const)('has a zone above the first page and one below the last in the %s mode', (mode) => {
        show({}, mode);
        const start = screen.getByTestId('reader-zone-start');
        const end = screen.getByTestId('reader-zone-end');
        const pages = screen.getByTestId('reader-scroll');
        expect(start.nextElementSibling).toBe(pages);
        expect(pages.nextElementSibling).toBe(end);
        expect(pages.parentElement).toHaveClass('reader__flow');
        expect(within(start).getByText('Chapter 1')).toBeInTheDocument();
        expect(within(end).getByText('#3')).toBeInTheDocument();
        expect(pages.querySelectorAll('img')).toHaveLength(3);
    });

    describe('the zones at the edge of a season', () => {
        const SEASON_ONE = makeLibraryManga([makeChapterRecord({ id: 10, remoteId: 100, name: 'S1 last', number: 9, sourceOrder: 1 })], { id: 1, remoteId: 7, title: 'One Piece', series: 'One Piece', season: 1 });
        const SEASON_TWO = makeLibraryManga([makeChapterRecord({ id: 20, remoteId: 200, name: 'S2 first', number: 1, sourceOrder: 1 }), makeChapterRecord({ id: 21, remoteId: 201, name: 'S2 last', number: 2, sourceOrder: 2 })], {
            id: 2,
            remoteId: 8,
            title: 'One Piece 2',
            series: 'One Piece',
            season: 2
        });

        beforeEach(() => {
            useMangaStore.setState({ library: [SEASON_TWO, SEASON_ONE] });
        });

        it('names the first chapter of the next season in the zone below the last chapter, instead of saying it is the last', () => {
            show({ index: 0, manga: { remoteId: 7, sourceId: '123', title: 'One Piece', thumbnailUrl: null }, chapters: [{ remoteId: 100, libraryChapterId: 10, name: 'S1 last', number: 9 }] });
            const end = screen.getByTestId('reader-zone-end');
            expect(within(end).getByText('S2 first')).toBeInTheDocument();
            expect(within(end).getByRole('button', { name: 'GO TO THE NEXT CHAPTER' })).toBeInTheDocument();
            expect(within(end).queryByText('This is the last chapter.')).not.toBeInTheDocument();
            expect(within(screen.getByTestId('reader-zone-start')).getByText('This is the first chapter.')).toBeInTheDocument();
        });

        it('names the last chapter of the previous season in the zone above the first chapter', () => {
            show({ index: 0, mangaTitle: 'One Piece 2', manga: { remoteId: 8, sourceId: '123', title: 'One Piece 2', thumbnailUrl: null }, chapters: [{ remoteId: 200, libraryChapterId: 20, name: 'S2 first', number: 1 }, { remoteId: 201, libraryChapterId: 21, name: 'S2 last', number: 2 }] });
            const start = screen.getByTestId('reader-zone-start');
            expect(within(start).getByText('S1 last')).toBeInTheDocument();
            expect(within(start).queryByText('This is the first chapter.')).not.toBeInTheDocument();
        });

        it('says it is the last chapter only after the last chapter of the last season', () => {
            show({ index: 1, mangaTitle: 'One Piece 2', manga: { remoteId: 8, sourceId: '123', title: 'One Piece 2', thumbnailUrl: null }, chapters: [{ remoteId: 200, libraryChapterId: 20, name: 'S2 first', number: 1 }, { remoteId: 201, libraryChapterId: 21, name: 'S2 last', number: 2 }] });
            expect(within(screen.getByTestId('reader-zone-end')).getByText('This is the last chapter.')).toBeInTheDocument();
        });
    });

    it('has no zone one page at a time', () => {
        show({}, 'single');
        expect(screen.queryByTestId('reader-zone-start')).not.toBeInTheDocument();
        expect(screen.queryByTestId('reader-zone-end')).not.toBeInTheDocument();
        expect(screen.queryByTestId('reader-scroll')).not.toBeInTheDocument();
    });

    it('has no zone while the chapter loads, or when it has no pages', () => {
        show({ status: 'loading', pages: [] });
        expect(screen.queryByTestId('reader-zone-end')).not.toBeInTheDocument();
    });

    it('says there is no previous chapter at the first one and no next chapter at the last one', () => {
        const { unmount } = show({ index: 0 });
        expect(within(screen.getByTestId('reader-zone-start')).getByText('This is the first chapter.')).toBeInTheDocument();
        expect(within(screen.getByTestId('reader-zone-end')).getByText('Chapter 2')).toBeInTheDocument();
        unmount();
        show({ index: 2 });
        expect(within(screen.getByTestId('reader-zone-end')).getByText('This is the last chapter.')).toBeInTheDocument();
        expect(within(screen.getByTestId('reader-zone-start')).getByText('Chapter 2')).toBeInTheDocument();
    });

    it('shows how the zone is made: as tall as most of the window', () => {
        show();
        expect(screen.getByTestId('reader-zone-end')).toHaveStyle({ height: `${String(Math.max(240, Math.round(window.innerHeight * 0.6)))}px` });
    });

    it('goes to the next chapter with the button of its zone, and reads it from its start', async () => {
        const user = userEvent.setup();
        saveProgress('One Piece|3', 1);
        show();
        await user.click(within(screen.getByTestId('reader-zone-end')).getByRole('button', { name: 'GO TO THE NEXT CHAPTER' }));
        expect(mock.api.manga.readPages).toHaveBeenCalledWith({ chapterRemoteId: 3, libraryChapterId: null });
        expect(await screen.findByText('1 / 3')).toBeInTheDocument();
        expect(useMangaStore.getState().reader).toMatchObject({ index: 2, entry: 'start', status: 'ready' });
        expect(screen.getByText('One Piece · #3')).toBeInTheDocument();
    });

    it('goes to the previous chapter with the button of its zone, and reads it from its end', async () => {
        const user = userEvent.setup();
        saveProgress('One Piece|1', 1);
        show();
        await user.click(within(screen.getByTestId('reader-zone-start')).getByRole('button', { name: 'GO TO THE PREVIOUS CHAPTER' }));
        expect(mock.api.manga.readPages).toHaveBeenCalledWith({ chapterRemoteId: 1, libraryChapterId: null });
        expect(await screen.findByText('3 / 3')).toBeInTheDocument();
        expect(useMangaStore.getState().reader).toMatchObject({ index: 0, entry: 'end', status: 'ready' });
        expect(loadLastPosition('One Piece')).toEqual({ chapterRemoteId: 1, page: 2 });
    });

    it('shows only the chapter that is on, not the one it came from', async () => {
        const user = userEvent.setup();
        show();
        await user.click(within(screen.getByTestId('reader-zone-end')).getByRole('button', { name: 'GO TO THE NEXT CHAPTER' }));
        await screen.findByText('1 / 3');
        expect(screen.getAllByTestId('reader-scroll')).toHaveLength(1);
        expect(screen.getByTestId('reader-scroll').querySelectorAll('img')).toHaveLength(3);
        expect(screen.getAllByTestId('reader-zone-end')).toHaveLength(1);
        expect(screen.getAllByTestId('reader-zone-start')).toHaveLength(1);
        expect(screen.queryByText('One Piece · Chapter 2')).not.toBeInTheDocument();
    });

    it('starts a chapter reached by scrolling on its first page, whatever it was left on', () => {
        saveProgress('One Piece|2', 1);
        show({ entry: 'start' });
        expect(screen.getByText('1 / 3')).toBeInTheDocument();
    });

    it('starts a chapter reached from the one after it on its last page, whatever it was left on', () => {
        saveProgress('One Piece|2', 1);
        show({ entry: 'end' });
        expect(screen.getByText('3 / 3')).toBeInTheDocument();
    });

    it('starts where the chapter was left when it was not reached by scrolling', () => {
        saveProgress('One Piece|2', 1);
        show();
        expect(screen.getByText('2 / 3')).toBeInTheDocument();
    });

    it('brings a chapter reached from the one after it to the end of its last page, not to the top of it', () => {
        const bring = vi.fn();
        Element.prototype.scrollIntoView = bring;
        show({ entry: 'end' });
        expect(bring).toHaveBeenCalledWith({ block: 'end' });
        bring.mockClear();
        act(() => {
            useMangaStore.setState({ reader: { ...useMangaStore.getState().reader, entry: undefined, resume: true } });
        });
        delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    });

    it('puts the first page just under the bar when a chapter starts, the zone above it out of view', () => {
        show();
        expect(area.scrollTop).toBe(678 - (112 + 90 + 8));
    });

    it('does not move the page of a chapter that is brought to a page it was left on', () => {
        const bring = vi.fn();
        Element.prototype.scrollIntoView = bring;
        saveProgress('One Piece|2', 2);
        show();
        expect(area.scrollTop).toBe(0);
        expect(bring).toHaveBeenCalledWith(undefined);
        delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    });

    it('has the switch in the settings, on, and keeps it when it is turned off, which takes the bar and the hint out of the zones', async () => {
        const user = userEvent.setup();
        show();
        await user.click(screen.getByRole('button', { name: 'READER SETTINGS' }));
        const toggle = screen.getByRole('switch', { name: 'Switch chapter while scrolling' });
        expect(toggle).toBeChecked();
        expect(screen.getByText(/going through the zone at the end \(or the start\)/)).toBeInTheDocument();
        expect(within(screen.getByTestId('reader-zone-end')).getByRole('progressbar')).toBeInTheDocument();
        await user.click(toggle);
        expect(toggle).not.toBeChecked();
        expect(JSON.parse(window.localStorage.getItem(PREFS_KEY) ?? '{}')).toMatchObject({ chapterSwitch: false });
        expect(within(screen.getByTestId('reader-zone-end')).queryByRole('progressbar')).not.toBeInTheDocument();
        expect(within(screen.getByTestId('reader-zone-end')).getByRole('button', { name: 'GO TO THE NEXT CHAPTER' })).toBeInTheDocument();
    });

    it('goes back to where the chapter starts, not to the zone above it, with the button at the corner', async () => {
        const user = userEvent.setup();
        show();
        const start = area.scrollTop;
        expect(screen.queryByRole('button', { name: 'Back to the top' })).not.toBeInTheDocument();
        area.scrollTop = start + 900;
        fireEvent.scroll(area);
        await user.click(await screen.findByRole('button', { name: 'Back to the top' }));
        runFrames(0);
        runFrames(10_000);
        expect(area.scrollTop).toBe(start);
    });

    it('shows the button at the corner only after the chapter was scrolled, not at its start', async () => {
        show();
        expect(screen.queryByRole('button', { name: 'Back to the top' })).not.toBeInTheDocument();
        area.scrollTop = area.scrollTop + 300;
        fireEvent.scroll(area);
        expect(screen.queryByRole('button', { name: 'Back to the top' })).not.toBeInTheDocument();
        area.scrollTop = area.scrollTop + 200;
        fireEvent.scroll(area);
        expect(await screen.findByRole('button', { name: 'Back to the top' })).toBeInTheDocument();
    });

    it('keeps the progress bar to the pages, not to the zones', () => {
        show();
        const bar = screen.getByRole('progressbar', { name: 'Reading progress' });
        expect(bar).toHaveAttribute('aria-valuenow', '0');
    });
});

