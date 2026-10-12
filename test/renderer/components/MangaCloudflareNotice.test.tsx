// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import { DEFAULT_SETTINGS } from '@shared/constants';
import type { MangaCloudflareActivity } from '@shared/manga';
import { CLOUDFLARE_HIDE_AFTER_MS, CLOUDFLARE_SHOW_AFTER_MS, MangaCloudflareNotice } from '@renderer/components/MangaCloudflareNotice';
import { useAppStore } from '@renderer/store/appStore';
import { useMangaStore, type MangaReaderState } from '@renderer/store/mangaStore';
import { makeLibraryManga, makeSummary } from '../../helpers/mangaFixtures';
import { installMockApi } from '../../helpers/mockApi';

const initialApp = useAppStore.getState();
const initialManga = useMangaStore.getState();

const CHECK: MangaCloudflareActivity = { id: 1, host: 'manganato.com', startedAt: 1 };

// The user is in the source 123, which is being asked for something.
function browsing(sourceId = '123', status: 'idle' | 'loading' | 'done' = 'loading'): void {
    useMangaStore.setState({ view: 'browse', browse: { ...initialManga.browse, sourceId, status } });
}

function openManga(sourceId = '123', status: 'loading' | 'ready' = 'ready', refreshing = false): void {
    useMangaStore.setState({
        selection: { manga: makeSummary({ sourceId }), status, details: null, chapters: [], selected: [], error: null },
        selectionRefresh: { loading: refreshing, error: null }
    });
}

function checks(next: MangaCloudflareActivity[]): void {
    act(() => {
        useMangaStore.setState({ cloudflare: next });
    });
}

function wait(ms: number): void {
    act(() => {
        vi.advanceTimersByTime(ms);
    });
}

beforeEach(() => {
    vi.useFakeTimers();
    installMockApi();
    useAppStore.setState({ ...initialApp, settings: DEFAULT_SETTINGS });
    useMangaStore.setState({ ...initialManga, cloudflare: [], library: [] });
});

afterEach(() => {
    vi.useRealTimers();
});

describe('MangaCloudflareNotice', () => {
    it('is steady about its times', () => {
        expect(CLOUDFLARE_SHOW_AFTER_MS).toBe(1500);
        expect(CLOUDFLARE_HIDE_AFTER_MS).toBe(1000);
    });

    it('shows nothing while no check of Cloudflare is going on', () => {
        browsing();
        const { container } = render(<MangaCloudflareNotice />);
        wait(5000);
        expect(container).toBeEmptyDOMElement();
    });

    it('says which site is being checked, politely, with a bar that is not a percentage, once the check has taken a while', () => {
        browsing();
        useMangaStore.setState({ cloudflare: [CHECK] });
        render(<MangaCloudflareNotice />);
        wait(CLOUDFLARE_SHOW_AFTER_MS - 1);
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
        wait(1);
        const notice = screen.getByRole('status');
        expect(notice).toHaveAttribute('aria-live', 'polite');
        expect(notice).toHaveTextContent('Passing the Cloudflare check of manganato.com… this can take up to a minute.');
        const bar = screen.getByRole('progressbar');
        expect(bar).toHaveClass('progress--cloudflare');
        expect(bar).not.toHaveAttribute('aria-valuenow');
    });

    it('never shows a check that goes by quickly, however many come one after the other', () => {
        browsing();
        render(<MangaCloudflareNotice />);
        for (let round = 0; round < 6; round += 1) {
            checks([{ ...CHECK, id: round }]);
            wait(CLOUDFLARE_SHOW_AFTER_MS - 200);
            checks([]);
            wait(100);
        }
        expect(screen.queryByTestId('manga-cloudflare')).not.toBeInTheDocument();
    });

    it('stays for a moment after the check ends, and does not flicker when another one comes right after', () => {
        browsing();
        useMangaStore.setState({ cloudflare: [CHECK] });
        render(<MangaCloudflareNotice />);
        wait(CLOUDFLARE_SHOW_AFTER_MS);
        expect(screen.getByTestId('manga-cloudflare')).toBeInTheDocument();
        checks([]);
        wait(CLOUDFLARE_HIDE_AFTER_MS - 1);
        expect(screen.getByTestId('manga-cloudflare')).toHaveTextContent('manganato.com');
        checks([{ ...CHECK, id: 2 }]);
        wait(CLOUDFLARE_HIDE_AFTER_MS * 3);
        expect(screen.getByTestId('manga-cloudflare')).toBeInTheDocument();
        checks([]);
        wait(CLOUDFLARE_HIDE_AFTER_MS);
        expect(screen.queryByTestId('manga-cloudflare')).not.toBeInTheDocument();
    });

    it('lists the sites once each when several checks go on', () => {
        browsing();
        useMangaStore.setState({
            cloudflare: [
                { id: 1, host: 'manganato.com', startedAt: 1 },
                { id: 2, host: 'manhwaread.com', startedAt: 2 },
                { id: 3, host: 'manganato.com', startedAt: 3 }
            ]
        });
        render(<MangaCloudflareNotice />);
        wait(CLOUDFLARE_SHOW_AFTER_MS);
        expect(screen.getByRole('status')).toHaveTextContent('Passing the Cloudflare check of manganato.com, manhwaread.com…');
    });

    it('says it without a site when the site is not known', () => {
        browsing();
        useMangaStore.setState({ cloudflare: [{ id: 1, host: '', startedAt: 1 }] });
        render(<MangaCloudflareNotice />);
        wait(CLOUDFLARE_SHOW_AFTER_MS);
        expect(screen.getByRole('status')).toHaveTextContent('Passing a Cloudflare check… this can take up to a minute.');
    });
});

describe('MangaCloudflareNotice only for the source the user is in', () => {
    it('shows nothing in the screens that are not about a source: the library, the updates, the history, the settings, the extensions', () => {
        useMangaStore.setState({ cloudflare: [CHECK] });
        for (const view of ['library', 'updates', 'history', 'settings', 'extensions', 'downloads'] as const) {
            useMangaStore.setState({ view });
            const { container, unmount } = render(<MangaCloudflareNotice />);
            wait(CLOUDFLARE_SHOW_AFTER_MS * 2);
            expect(container).toBeEmptyDOMElement();
            unmount();
        }
    });

    it('shows nothing in the list of sources, with no source open', () => {
        useMangaStore.setState({ view: 'browse', browse: { ...initialManga.browse, sourceId: null }, cloudflare: [CHECK] });
        const { container } = render(<MangaCloudflareNotice />);
        wait(CLOUDFLARE_SHOW_AFTER_MS * 2);
        expect(container).toBeEmptyDOMElement();
    });

    it('shows a check of a site nobody knows when the source that is open is being asked for something', () => {
        for (const patch of [{ status: 'loading' }, { filtersStatus: 'loading' }, { loadingMore: true }] as const) {
            useMangaStore.setState({ view: 'browse', browse: { ...initialManga.browse, sourceId: '123', status: 'done', filtersStatus: 'ready', loadingMore: false, ...patch }, cloudflare: [CHECK] });
            const { unmount } = render(<MangaCloudflareNotice />);
            wait(CLOUDFLARE_SHOW_AFTER_MS);
            expect(screen.getByTestId('manga-cloudflare')).toBeInTheDocument();
            unmount();
        }
    });

    it('does not show a check of a site nobody knows when nothing is being asked of the source that is open', () => {
        browsing('123', 'done');
        useMangaStore.setState({ cloudflare: [CHECK] });
        const { container } = render(<MangaCloudflareNotice />);
        wait(CLOUDFLARE_SHOW_AFTER_MS * 2);
        expect(container).toBeEmptyDOMElement();
    });

    it('does not show the check of the site of another source, which the library knows, while this one is open', () => {
        browsing('123');
        useMangaStore.setState({
            library: [makeLibraryManga([], { id: 1, sourceId: '999', url: 'https://www.manganato.com/manga/one-piece' })],
            cloudflare: [CHECK]
        });
        const { container } = render(<MangaCloudflareNotice />);
        wait(CLOUDFLARE_SHOW_AFTER_MS * 2);
        expect(container).toBeEmptyDOMElement();
    });

    it('shows the check of the site of this source, which the library knows, even when nothing is being asked for', () => {
        browsing('123', 'done');
        useMangaStore.setState({
            library: [makeLibraryManga([], { id: 1, sourceId: '123', url: 'https://manganato.com/manga/one-piece' })],
            cloudflare: [CHECK]
        });
        render(<MangaCloudflareNotice />);
        wait(CLOUDFLARE_SHOW_AFTER_MS);
        expect(screen.getByTestId('manga-cloudflare')).toBeInTheDocument();
    });

    it('shows only the sites that are of this source when several checks go on', () => {
        browsing('123');
        useMangaStore.setState({
            library: [
                makeLibraryManga([], { id: 1, sourceId: '123', url: 'https://manganato.com/manga/a' }),
                makeLibraryManga([], { id: 2, sourceId: '999', url: 'https://manhwaread.com/manhwa/b' })
            ],
            cloudflare: [CHECK, { id: 2, host: 'manhwaread.com', startedAt: 2 }]
        });
        render(<MangaCloudflareNotice />);
        wait(CLOUDFLARE_SHOW_AFTER_MS);
        expect(screen.getByRole('status')).toHaveTextContent('Passing the Cloudflare check of manganato.com…');
        expect(screen.getByRole('status')).not.toHaveTextContent('manhwaread.com');
    });

    it('is about the source of the manga that is open, not the one that was browsed before', () => {
        browsing('123', 'done');
        openManga('555', 'loading');
        useMangaStore.setState({ library: [makeLibraryManga([], { id: 1, sourceId: '123', url: 'https://manganato.com/manga/a' })], cloudflare: [CHECK] });
        const { container } = render(<MangaCloudflareNotice />);
        wait(CLOUDFLARE_SHOW_AFTER_MS * 2);
        expect(container).toBeEmptyDOMElement();
    });

    it('shows the check of a manga that is open, from the library or not, while its page is read or looked at in the background', () => {
        useMangaStore.setState({ view: 'library', cloudflare: [CHECK] });
        openManga('123', 'loading');
        const first = render(<MangaCloudflareNotice />);
        wait(CLOUDFLARE_SHOW_AFTER_MS);
        expect(screen.getByTestId('manga-cloudflare')).toBeInTheDocument();
        first.unmount();
        openManga('123', 'ready', true);
        const second = render(<MangaCloudflareNotice />);
        wait(CLOUDFLARE_SHOW_AFTER_MS);
        expect(screen.getByTestId('manga-cloudflare')).toBeInTheDocument();
        second.unmount();
        openManga('123', 'ready', false);
        const third = render(<MangaCloudflareNotice />);
        wait(CLOUDFLARE_SHOW_AFTER_MS * 2);
        expect(third.container).toBeEmptyDOMElement();
    });

    it('is about the manga being read', () => {
        const reading = (status: MangaReaderState['status'], sourceId: string | null): MangaReaderState => {
            return { status, mangaTitle: 'One Piece', chapters: [], index: 0, pages: [], local: false, error: null, manga: sourceId === null ? null : makeSummary({ sourceId }) };
        };
        useMangaStore.setState({ cloudflare: [CHECK], reader: reading('loading', '123') });
        const first = render(<MangaCloudflareNotice />);
        wait(CLOUDFLARE_SHOW_AFTER_MS);
        expect(screen.getByTestId('manga-cloudflare')).toBeInTheDocument();
        first.unmount();
        useMangaStore.setState({ reader: reading('loading', '999'), library: [makeLibraryManga([], { id: 1, sourceId: '123', url: 'https://manganato.com/manga/a' })] });
        const second = render(<MangaCloudflareNotice />);
        wait(CLOUDFLARE_SHOW_AFTER_MS * 2);
        expect(second.container).toBeEmptyDOMElement();
        second.unmount();
        useMangaStore.setState({ reader: reading('ready', '123'), library: [] });
        const third = render(<MangaCloudflareNotice />);
        wait(CLOUDFLARE_SHOW_AFTER_MS * 2);
        expect(third.container).toBeEmptyDOMElement();
    });

    it('takes the manga of the page that is open when the reader does not know its manga', () => {
        useMangaStore.setState({ cloudflare: [CHECK], reader: { status: 'loading', mangaTitle: 'One Piece', chapters: [], index: 0, pages: [], local: false, error: null } });
        openManga('123');
        render(<MangaCloudflareNotice />);
        wait(CLOUDFLARE_SHOW_AFTER_MS);
        expect(screen.getByTestId('manga-cloudflare')).toBeInTheDocument();
    });

    it('learns the site of the manga that is open from its page on the site, so the check of another source is not taken for it', () => {
        useMangaStore.setState({ view: 'library', cloudflare: [CHECK, { id: 2, host: 'manhwaread.com', startedAt: 2 }] });
        useMangaStore.setState({
            selection: { manga: makeSummary({ sourceId: '123' }), status: 'ready', details: { ...makeSummary(), url: 'https://www.manganato.com/manga/one-piece', author: null, artist: null, description: null, genres: [], status: 'ongoing' }, chapters: [], selected: [], error: null },
            selectionRefresh: { loading: true, error: null },
            library: [makeLibraryManga([], { id: 1, sourceId: '999', url: 'https://manhwaread.com/manhwa/b' })]
        });
        render(<MangaCloudflareNotice />);
        wait(CLOUDFLARE_SHOW_AFTER_MS);
        expect(screen.getByRole('status')).toHaveTextContent('manganato.com');
        expect(screen.getByRole('status')).not.toHaveTextContent('manhwaread.com');
    });
});
