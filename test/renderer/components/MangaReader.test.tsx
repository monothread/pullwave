// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { MangaReader } from '@renderer/components/MangaReader';
import { loadProgress, PREFS_KEY, saveProgress } from '@renderer/components/readerPrefs';
import { useAppStore } from '@renderer/store/appStore';
import { useMangaStore, type MangaReaderState, type ReaderChapter } from '@renderer/store/mangaStore';
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
    useMangaStore.setState({ reader: { status: 'ready', mangaTitle: 'One Piece', chapters: CHAPTERS, index: 1, pages: PAGES, local: false, error: null, ...patch } });
}

function shownPage(): string | null {
    return screen.getByRole('img').getAttribute('src');
}

beforeEach(() => {
    window.localStorage.clear();
    mock = installMockApi();
    mock.api.manga.readPages.mockResolvedValue({ ok: true, value: { pages: PAGES, local: false } });
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
        expect(screen.getByRole('alert')).toHaveAttribute('title', 'Cloudflare bypass currently disabled');
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
        expect(screen.getByTestId('reader-stage')).toHaveClass('reader__stage--screen');
        await user.selectOptions(screen.getByLabelText('Page size'), 'original');
        await user.selectOptions(screen.getByLabelText('Background'), 'white');
        expect(screen.getByTestId('reader-stage')).toHaveClass('reader__stage--original');
        expect(screen.getByRole('region', { name: 'Reader' })).toHaveClass('reader--white');
        expect(JSON.parse(window.localStorage.getItem(PREFS_KEY) ?? '{}')).toEqual({ mode: 'single', direction: 'ltr', scale: 'original', background: 'white' });
        unmount();
        render(<MangaReader />);
        expect(screen.getByTestId('reader-stage')).toHaveClass('reader__stage--original');
        expect(screen.getByRole('region', { name: 'Reader' })).toHaveClass('reader--white');
    });
});
