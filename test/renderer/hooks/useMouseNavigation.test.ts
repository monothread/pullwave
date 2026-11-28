// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import type { AnimeSearchResult } from '@shared/anime';
import { DEFAULT_SETTINGS } from '@shared/constants';
import type { ExplorerListResponse } from '@shared/explorer';
import { MOUSE_BACK_BUTTON, MOUSE_FORWARD_BUTTON, snapshotKey, useMouseNavigation, type MangaPage, type NavigationSnapshot } from '@renderer/hooks/useMouseNavigation';
import { batchNavigation } from '@renderer/navigation/navigationBatch';
import { INITIAL_SEARCH, useAnimeStore, type AnimeSelection } from '@renderer/store/animeStore';
import { useAppStore } from '@renderer/store/appStore';
import { useCutStore, type CutPreviewState } from '@renderer/store/cutStore';
import { useExplorerStore } from '@renderer/store/explorerStore';
import { useMangaStore } from '@renderer/store/mangaStore';
import { makeDetails, makeSource, makeSummary } from '../../helpers/mangaFixtures';
import { makeAnime } from '../../helpers/animeFixtures';
import { installMockApi, type MockApiHandle } from '../../helpers/mockApi';

const initialApp = useAppStore.getState();
const initialAnime = useAnimeStore.getState();
const initialManga = useMangaStore.getState();
const initialCut = useCutStore.getInitialState();
const initialExplorer = useExplorerStore.getInitialState();
const PREVIEW: CutPreviewState = { rowId: 1, number: 1, segment: { start: 10, end: 20 }, status: 'ready', url: 'pullwave-cut://media/1', start: 10, end: 20, converted: false, error: null };
const RESULT: AnimeSearchResult = { index: 2, title: 'Naruto' };
const SELECTION: AnimeSelection = { result: RESULT, query: 'naruto', status: 'ready', episodes: ['1', '2'], error: null };

let mock: MockApiHandle;

beforeEach(() => {
    mock = installMockApi();
    mock.api.listAnimeLibrary.mockResolvedValue([]);
    useAppStore.setState({ ...initialApp, tab: 'downloads', downloadsView: 'queue', settings: DEFAULT_SETTINGS });
    useExplorerStore.setState({ ...initialExplorer });
    useAnimeStore.setState({
        ...initialAnime,
        view: 'search',
        returnView: 'search',
        library: [],
        search: INITIAL_SEARCH,
        selection: null,
        libraryFocus: null,
        librarySeries: null,
        librarySeason: null,
        playing: null,
        streaming: null
    });
    useMangaStore.setState({ ...initialManga });
    useCutStore.setState(initialCut, true);
    mock.api.manga.sources.mockResolvedValue({ ok: true, value: [makeSource({ id: '5' }), makeSource({ id: '6' })] });
    mock.api.manga.details.mockResolvedValue({ ok: true, value: { details: makeDetails(), chapters: [] } });
});

function press(button: number): MouseEvent {
    const event = new MouseEvent('mouseup', { button, bubbles: true, cancelable: true });
    act(() => {
        window.dispatchEvent(event);
    });
    return event;
}

function setTab(tab: 'downloads' | 'anime' | 'settings'): void {
    act(() => {
        useAppStore.getState().setTab(tab);
    });
}

function setDownloadsView(view: 'queue' | 'history' | 'settings'): void {
    act(() => {
        useAppStore.getState().setDownloadsView(view);
    });
}

function setView(view: 'search' | 'library' | 'history' | 'settings'): void {
    act(() => {
        useAnimeStore.getState().setView(view);
    });
}

function mount(): { unmount: () => void } {
    return renderHook(() => {
        useMouseNavigation();
    });
}

describe('snapshotKey', () => {
    const manga: MangaPage = { view: 'browse', previousView: 'browse', sourceId: null, mode: 'popular', settingsOpen: false, selection: null, selectionFrom: 'browse', librarySeries: null, libraryGroup: null };
    const base: NavigationSnapshot = { tab: 'anime', downloadsView: 'queue', toolsMode: 'cut', view: 'library', returnView: 'library', selection: null, libraryFocus: null, librarySeries: null, librarySeason: null, manga };

    it('joins the parts that make a page', () => {
        expect(snapshotKey(base)).toBe('anime|queue|cut|library|library|||||browse:browse::popular:false::browse::');
        expect(snapshotKey({ ...base, selection: SELECTION, libraryFocus: 7, librarySeries: 'series-frieren', librarySeason: 12 })).toBe('anime|queue|cut|library|library|2|7|series-frieren|12|browse:browse::popular:false::browse::');
        expect(snapshotKey({ ...base, downloadsView: 'tools', toolsMode: 'merge' })).not.toBe(snapshotKey({ ...base, downloadsView: 'tools', toolsMode: 'cut' }));
    });

    it('differs between the screens of the manga section, the sources, the modes, the settings of a source and the mangas open', () => {
        const key = snapshotKey(base);
        const keys = [
            { ...manga, view: 'library' as const },
            { ...manga, view: 'downloads' as const, previousView: 'library' as const },
            { ...manga, sourceId: '5' },
            { ...manga, sourceId: '5', mode: 'search' as const },
            { ...manga, sourceId: '5', settingsOpen: true },
            { ...manga, selection: { manga: makeSummary({ remoteId: 7 }), status: 'ready' as const, details: null, chapters: [], selected: [], error: null } },
            { ...manga, selectionFrom: 'library' as const },
            { ...manga, librarySeries: 'series-frieren' },
            { ...manga, libraryGroup: 2 }
        ].map((page) => {
            return snapshotKey({ ...base, manga: page });
        });
        expect(new Set([key, ...keys]).size).toBe(10);
    });

    it('does not change when the content of the same manga loads', () => {
        const loading = { manga: makeSummary({ remoteId: 7 }), status: 'loading' as const, details: null, chapters: [], selected: [], error: null };
        const ready = { ...loading, status: 'ready' as const, details: makeDetails({ remoteId: 7 }), selected: [1] };
        expect(snapshotKey({ ...base, manga: { ...manga, selection: loading } })).toBe(snapshotKey({ ...base, manga: { ...manga, selection: ready } }));
    });

    it('differs between the cards of the library and each series open', () => {
        const key = snapshotKey(base);
        expect(snapshotKey({ ...base, librarySeries: 'series-frieren' })).not.toBe(key);
        expect(snapshotKey({ ...base, librarySeries: 'series-frieren' })).not.toBe(snapshotKey({ ...base, librarySeries: 'anime-4' }));
    });

    it('does not change when the content of the same selection loads', () => {
        expect(snapshotKey({ ...base, selection: { ...SELECTION, status: 'loading', episodes: [] } })).toBe(snapshotKey({ ...base, selection: SELECTION }));
    });

    it('differs between anime, and is the same for the same anime', () => {
        const key = snapshotKey({ ...base, selection: SELECTION });
        expect(snapshotKey({ ...base, selection: { ...SELECTION, result: { index: 3, title: 'Bleach' } } })).not.toBe(key);
        expect(snapshotKey({ ...base, selection: { ...SELECTION } })).toBe(key);
    });
});

describe('useMouseNavigation', () => {
    it('uses the buttons 3 and 4 of the mouse', () => {
        expect(MOUSE_BACK_BUTTON).toBe(3);
        expect(MOUSE_FORWARD_BUTTON).toBe(4);
    });

    it('goes back and forward through the tabs', () => {
        mount();
        setTab('anime');
        setTab('settings');

        press(MOUSE_BACK_BUTTON);
        expect(useAppStore.getState().tab).toBe('anime');
        press(MOUSE_BACK_BUTTON);
        expect(useAppStore.getState().tab).toBe('downloads');
        press(MOUSE_FORWARD_BUTTON);
        expect(useAppStore.getState().tab).toBe('anime');
        press(MOUSE_FORWARD_BUTTON);
        expect(useAppStore.getState().tab).toBe('settings');
    });

    it('goes back and forward between the queue and the history of the video downloader', () => {
        mount();
        setDownloadsView('history');
        setTab('settings');

        press(MOUSE_BACK_BUTTON);
        expect(useAppStore.getState()).toMatchObject({ tab: 'downloads', downloadsView: 'history' });
        press(MOUSE_BACK_BUTTON);
        expect(useAppStore.getState()).toMatchObject({ tab: 'downloads', downloadsView: 'queue' });
        press(MOUSE_FORWARD_BUTTON);
        expect(useAppStore.getState()).toMatchObject({ tab: 'downloads', downloadsView: 'history' });
        press(MOUSE_FORWARD_BUTTON);
        expect(useAppStore.getState()).toMatchObject({ tab: 'settings', downloadsView: 'history' });
    });

    it('goes back to the history of the anime section', () => {
        useAppStore.setState({ tab: 'anime' });
        mount();
        setView('history');
        setView('library');

        press(MOUSE_BACK_BUTTON);
        expect(useAnimeStore.getState()).toMatchObject({ view: 'history', returnView: 'history' });
        press(MOUSE_BACK_BUTTON);
        expect(useAnimeStore.getState()).toMatchObject({ view: 'search', returnView: 'search' });
    });

    it('goes back to the settings of the video downloader and to the settings of the anime section', () => {
        useAppStore.setState({ tab: 'anime' });
        mount();
        setView('settings');
        setView('search');
        setTab('downloads');
        setDownloadsView('settings');

        press(MOUSE_BACK_BUTTON);
        expect(useAppStore.getState()).toMatchObject({ tab: 'downloads', downloadsView: 'queue' });
        press(MOUSE_BACK_BUTTON);
        expect(useAppStore.getState().tab).toBe('anime');
        expect(useAnimeStore.getState()).toMatchObject({ view: 'search' });
        press(MOUSE_BACK_BUTTON);
        expect(useAnimeStore.getState()).toMatchObject({ view: 'settings', returnView: 'settings' });
        press(MOUSE_FORWARD_BUTTON);
        press(MOUSE_FORWARD_BUTTON);
        press(MOUSE_FORWARD_BUTTON);
        expect(useAppStore.getState()).toMatchObject({ tab: 'downloads', downloadsView: 'settings' });
    });

    it('does not read the library when the history is shown', () => {
        useAppStore.setState({ tab: 'anime' });
        mount();
        setView('history');
        mock.api.listAnimeLibrary.mockClear();
        press(MOUSE_BACK_BUTTON);
        press(MOUSE_FORWARD_BUTTON);
        expect(useAnimeStore.getState().view).toBe('history');
        expect(mock.api.listAnimeLibrary).not.toHaveBeenCalled();
    });

    it('prevents the default action of the two buttons', () => {
        mount();
        setTab('anime');
        expect(press(MOUSE_BACK_BUTTON).defaultPrevented).toBe(true);
        expect(press(MOUSE_FORWARD_BUTTON).defaultPrevented).toBe(true);
    });

    it.each([0, 1, 2])('ignores the button %s of the mouse', (button) => {
        mount();
        setTab('anime');
        const event = press(button);
        expect(event.defaultPrevented).toBe(false);
        expect(useAppStore.getState().tab).toBe('anime');
    });

    it('stays where it is when there is no page to go to', () => {
        mount();
        press(MOUSE_BACK_BUTTON);
        press(MOUSE_FORWARD_BUTTON);
        expect(useAppStore.getState().tab).toBe('downloads');
        setTab('anime');
        press(MOUSE_FORWARD_BUTTON);
        expect(useAppStore.getState().tab).toBe('anime');
    });

    it('does not record the pages it shows, so forward still works after going back', () => {
        mount();
        setTab('anime');
        setTab('settings');
        press(MOUSE_BACK_BUTTON);
        press(MOUSE_BACK_BUTTON);
        press(MOUSE_FORWARD_BUTTON);
        press(MOUSE_FORWARD_BUTTON);
        expect(useAppStore.getState().tab).toBe('settings');
        press(MOUSE_FORWARD_BUTTON);
        expect(useAppStore.getState().tab).toBe('settings');
    });

    it('drops the pages ahead when a new page is opened after going back', () => {
        mount();
        setTab('anime');
        setTab('settings');
        press(MOUSE_BACK_BUTTON);
        setTab('downloads');

        press(MOUSE_FORWARD_BUTTON);
        expect(useAppStore.getState().tab).toBe('downloads');
        press(MOUSE_BACK_BUTTON);
        expect(useAppStore.getState().tab).toBe('anime');
    });

    it('goes back and forward through the views of the anime section and reads the library when it comes back to it', () => {
        useAppStore.setState({ tab: 'anime' });
        mount();
        setView('library');
        mock.api.listAnimeLibrary.mockClear();

        press(MOUSE_BACK_BUTTON);
        expect(useAnimeStore.getState()).toMatchObject({ view: 'search', returnView: 'search', libraryFocus: null });
        expect(mock.api.listAnimeLibrary).not.toHaveBeenCalled();

        press(MOUSE_FORWARD_BUTTON);
        expect(useAnimeStore.getState()).toMatchObject({ view: 'library', returnView: 'library', libraryFocus: null });
        expect(mock.api.listAnimeLibrary).toHaveBeenCalledTimes(1);
    });

    it('goes back from the downloads screen of the anime section to the view it came from', () => {
        useAppStore.setState({ tab: 'anime' });
        mount();
        setView('library');
        act(() => {
            useAnimeStore.getState().openDownloads();
        });
        expect(useAnimeStore.getState().view).toBe('downloads');

        press(MOUSE_BACK_BUTTON);
        expect(useAnimeStore.getState()).toMatchObject({ view: 'library', returnView: 'library' });
        press(MOUSE_FORWARD_BUTTON);
        expect(useAnimeStore.getState()).toMatchObject({ view: 'downloads', returnView: 'library' });
    });

    it('goes back from the detail of an anime, with its episodes, and forward to it again', () => {
        useAppStore.setState({ tab: 'anime' });
        mount();
        act(() => {
            useAnimeStore.setState({ selection: { ...SELECTION, status: 'loading', episodes: [] } });
        });
        act(() => {
            useAnimeStore.setState({ selection: SELECTION });
        });

        press(MOUSE_BACK_BUTTON);
        expect(useAnimeStore.getState().selection).toBeNull();
        press(MOUSE_FORWARD_BUTTON);
        expect(useAnimeStore.getState().selection).toEqual(SELECTION);
    });

    it('restores the focus on an anime of the library', () => {
        useAppStore.setState({ tab: 'anime' });
        useAnimeStore.setState({ library: [makeAnime([], { id: 4 })] });
        mount();
        act(() => {
            useAnimeStore.getState().showInLibrary(4);
        });
        setView('search');

        press(MOUSE_BACK_BUTTON);
        expect(useAnimeStore.getState()).toMatchObject({ view: 'library', libraryFocus: 4, librarySeries: 'anime-4' });
    });

    it('goes back from a series of the library to the cards, and not past the library, and forward to the series again', () => {
        useAppStore.setState({ tab: 'anime' });
        mount();
        setView('library');
        act(() => {
            useAnimeStore.getState().openSeries('series-frieren');
        });

        press(MOUSE_BACK_BUTTON);
        expect(useAnimeStore.getState()).toMatchObject({ view: 'library', returnView: 'library', librarySeries: null });

        press(MOUSE_FORWARD_BUTTON);
        expect(useAnimeStore.getState()).toMatchObject({ view: 'library', returnView: 'library', librarySeries: 'series-frieren' });

        press(MOUSE_BACK_BUTTON);
        press(MOUSE_BACK_BUTTON);
        expect(useAnimeStore.getState()).toMatchObject({ view: 'search', librarySeries: null });
    });

    it('goes back from the screen of a season to the screen of its series, and forward to the season again', () => {
        useAppStore.setState({ tab: 'anime' });
        mount();
        setView('library');
        act(() => {
            useAnimeStore.getState().openSeries('series-frieren');
        });
        act(() => {
            useAnimeStore.getState().openSeason(12);
        });

        press(MOUSE_BACK_BUTTON);
        expect(useAnimeStore.getState()).toMatchObject({ view: 'library', librarySeries: 'series-frieren', librarySeason: null });

        press(MOUSE_FORWARD_BUTTON);
        expect(useAnimeStore.getState()).toMatchObject({ view: 'library', librarySeries: 'series-frieren', librarySeason: 12 });

        press(MOUSE_BACK_BUTTON);
        press(MOUSE_BACK_BUTTON);
        expect(useAnimeStore.getState()).toMatchObject({ view: 'library', librarySeries: null, librarySeason: null });
    });

    it('takes the steps of one change of page as one page, and goes back past it at once', () => {
        useAppStore.setState({ tab: 'home' });
        mount();
        act(() => {
            batchNavigation(() => {
                useAppStore.getState().setTab('anime');
                useAnimeStore.getState().setView('library');
                useAnimeStore.getState().openSeries('series-frieren');
            });
        });
        expect(useAnimeStore.getState()).toMatchObject({ view: 'library', librarySeries: 'series-frieren' });

        press(MOUSE_BACK_BUTTON);
        expect(useAppStore.getState().tab).toBe('home');

        press(MOUSE_FORWARD_BUTTON);
        expect(useAppStore.getState().tab).toBe('anime');
        expect(useAnimeStore.getState()).toMatchObject({ view: 'library', librarySeries: 'series-frieren' });
    });

    it('takes a batch that changes nothing as no page', () => {
        setTab('settings');
        mount();
        act(() => {
            batchNavigation(() => {
                return undefined;
            });
        });
        setTab('downloads');
        press(MOUSE_BACK_BUTTON);
        expect(useAppStore.getState().tab).toBe('settings');
    });

    it('goes through the series that were opened one after the other, in the order they were opened', () => {
        useAppStore.setState({ tab: 'anime' });
        mount();
        setView('library');
        act(() => {
            useAnimeStore.getState().openSeries('series-frieren');
        });
        act(() => {
            useAnimeStore.getState().closeSeries();
        });
        act(() => {
            useAnimeStore.getState().openSeries('anime-4');
        });

        press(MOUSE_BACK_BUTTON);
        expect(useAnimeStore.getState().librarySeries).toBeNull();
        press(MOUSE_BACK_BUTTON);
        expect(useAnimeStore.getState().librarySeries).toBe('series-frieren');
        press(MOUSE_BACK_BUTTON);
        expect(useAnimeStore.getState().librarySeries).toBeNull();
        press(MOUSE_FORWARD_BUTTON);
        expect(useAnimeStore.getState().librarySeries).toBe('series-frieren');
        press(MOUSE_FORWARD_BUTTON);
        expect(useAnimeStore.getState().librarySeries).toBeNull();
        press(MOUSE_FORWARD_BUTTON);
        expect(useAnimeStore.getState().librarySeries).toBe('anime-4');
    });

    it('comes back to the series of the library from another view and from another tab', () => {
        mount();
        setTab('anime');
        setView('library');
        act(() => {
            useAnimeStore.getState().openSeries('series-frieren');
        });
        setView('history');
        setTab('settings');

        press(MOUSE_BACK_BUTTON);
        expect(useAppStore.getState().tab).toBe('anime');
        expect(useAnimeStore.getState()).toMatchObject({ view: 'history', librarySeries: null });
        press(MOUSE_BACK_BUTTON);
        expect(useAnimeStore.getState()).toMatchObject({ view: 'library', librarySeries: 'series-frieren' });
    });

    it.each([
        ['playing', { playing: { animeId: 1, episodeId: 2 } }, 'closePlayer'],
        ['streaming', { streaming: { title: 'Naruto', episode: '1', status: 'loading' as const, stream: null, error: null, nextEpisode: null } }, 'closeStream']
    ] as const)('only closes the player when it is %s, without leaving the page', (_name, state, closer) => {
        mount();
        setTab('anime');
        act(() => {
            useAnimeStore.setState(state);
        });
        const close = vi.fn(() => {
            useAnimeStore.setState({ playing: null, streaming: null });
        });
        useAnimeStore.setState({ [closer]: close });

        const event = press(MOUSE_BACK_BUTTON);
        expect(event.defaultPrevented).toBe(true);
        expect(close).toHaveBeenCalledTimes(1);
        expect(useAppStore.getState().tab).toBe('anime');

        press(MOUSE_BACK_BUTTON);
        expect(useAppStore.getState().tab).toBe('downloads');
    });

    it('only closes the preview of a cut, without leaving the page', () => {
        mount();
        setDownloadsView('history');
        act(() => {
            useAppStore.getState().openTools('cut');
        });
        act(() => {
            useCutStore.setState({ preview: PREVIEW });
        });

        const event = press(MOUSE_BACK_BUTTON);
        expect(event.defaultPrevented).toBe(true);
        expect(useCutStore.getState().preview).toBeNull();
        expect(useAppStore.getState()).toMatchObject({ tab: 'downloads', downloadsView: 'tools', toolsMode: 'cut' });

        press(MOUSE_BACK_BUTTON);
        expect(useAppStore.getState()).toMatchObject({ tab: 'downloads', downloadsView: 'history' });
    });

    it('goes back and forward between tool modes in the video downloader', () => {
        mount();
        act(() => {
            useAppStore.getState().openTools('cut');
        });
        act(() => {
            useAppStore.getState().setToolsMode('merge');
        });

        press(MOUSE_BACK_BUTTON);
        expect(useAppStore.getState()).toMatchObject({ tab: 'downloads', downloadsView: 'tools', toolsMode: 'cut' });
        press(MOUSE_FORWARD_BUTTON);
        expect(useAppStore.getState()).toMatchObject({ tab: 'downloads', downloadsView: 'tools', toolsMode: 'merge' });
    });

    it('does not go forward while the preview of a cut is open', () => {
        mount();
        setDownloadsView('history');
        press(MOUSE_BACK_BUTTON);
        act(() => {
            useCutStore.setState({ preview: PREVIEW });
        });

        const event = press(MOUSE_FORWARD_BUTTON);
        expect(event.defaultPrevented).toBe(true);
        expect(useAppStore.getState().downloadsView).toBe('queue');
        expect(useCutStore.getState().preview).toEqual(PREVIEW);
    });

    it('only closes the internal player of the explorer, without leaving the page', () => {
        const playing = {
            entry: {
                path: '/downloads/clip.mp4',
                name: 'clip.mp4',
                kind: 'video' as const,
                extension: '.mp4',
                sizeBytes: 1024,
                modifiedAt: 1000,
                token: 1,
                thumbnailUrl: 'pullwave-explorer://thumbnail/1',
                mediaUrl: 'pullwave-explorer://media/1'
            },
            status: 'ready' as const,
            url: 'pullwave-explorer://media/1',
            converted: false,
            error: null
        };
        mount();
        setDownloadsView('history');
        act(() => {
            useAppStore.getState().setDownloadsView('explorer');
        });
        act(() => {
            useExplorerStore.setState({ playing });
        });

        const backEvent = press(MOUSE_BACK_BUTTON);
        expect(backEvent.defaultPrevented).toBe(true);
        expect(useExplorerStore.getState().playing).toBeNull();
        expect(useAppStore.getState()).toMatchObject({ tab: 'downloads', downloadsView: 'explorer' });

        press(MOUSE_BACK_BUTTON);
        expect(useAppStore.getState()).toMatchObject({ tab: 'downloads', downloadsView: 'history' });
    });

    it('does not go forward while the internal player of the explorer is open', () => {
        const playing = {
            entry: {
                path: '/downloads/clip.mp4',
                name: 'clip.mp4',
                kind: 'video' as const,
                extension: '.mp4',
                sizeBytes: 1024,
                modifiedAt: 1000,
                token: 1,
                thumbnailUrl: 'pullwave-explorer://thumbnail/1',
                mediaUrl: 'pullwave-explorer://media/1'
            },
            status: 'ready' as const,
            url: 'pullwave-explorer://media/1',
            converted: false,
            error: null
        };
        mount();
        setDownloadsView('history');
        press(MOUSE_BACK_BUTTON);
        act(() => {
            useExplorerStore.setState({ playing });
        });

        const forwardEvent = press(MOUSE_FORWARD_BUTTON);
        expect(forwardEvent.defaultPrevented).toBe(true);
        expect(useAppStore.getState().downloadsView).toBe('queue');
        expect(useExplorerStore.getState().playing).toEqual(playing);
        act(() => {
            useExplorerStore.setState({ playing: null });
        });
    });

    describe('in the explorer', () => {
        function listingOf(directory: string): ExplorerListResponse {
            return {
                ok: true,
                listing: {
                    directory,
                    parent: directory === '/downloads' ? null : '/downloads',
                    breadcrumbs: [{ name: directory, path: directory }],
                    roots: [{ id: 'downloads', label: 'Downloads', path: '/downloads', kind: 'downloads' }],
                    entries: []
                }
            };
        }

        it('goes back and forward through visited folders, and leaves the explorer once at the start of its folder history', async () => {
            mock.api.explorer.list.mockImplementation(async (directory?: string) => {
                return listingOf(directory ?? '/downloads');
            });
            mount();
            setDownloadsView('history');
            act(() => {
                useAppStore.getState().setDownloadsView('explorer');
            });
            await act(async () => {
                await useExplorerStore.getState().open('/downloads');
                await useExplorerStore.getState().open('/downloads/sub1');
                await useExplorerStore.getState().open('/downloads/sub1/sub2');
            });
            expect(useExplorerStore.getState()).toMatchObject({ directory: '/downloads/sub1/sub2', history: ['/downloads', '/downloads/sub1', '/downloads/sub1/sub2'], historyIndex: 2 });

            await act(async () => {
                press(MOUSE_BACK_BUTTON);
            });
            expect(useExplorerStore.getState()).toMatchObject({ directory: '/downloads/sub1', historyIndex: 1 });
            expect(useAppStore.getState()).toMatchObject({ tab: 'downloads', downloadsView: 'explorer' });

            await act(async () => {
                press(MOUSE_BACK_BUTTON);
            });
            expect(useExplorerStore.getState()).toMatchObject({ directory: '/downloads', historyIndex: 0 });
            expect(useAppStore.getState()).toMatchObject({ tab: 'downloads', downloadsView: 'explorer' });

            press(MOUSE_BACK_BUTTON);
            expect(useAppStore.getState()).toMatchObject({ tab: 'downloads', downloadsView: 'history' });

            press(MOUSE_FORWARD_BUTTON);
            expect(useAppStore.getState()).toMatchObject({ tab: 'downloads', downloadsView: 'explorer' });
            expect(useExplorerStore.getState()).toMatchObject({ directory: '/downloads', historyIndex: 0 });

            await act(async () => {
                press(MOUSE_FORWARD_BUTTON);
            });
            expect(useExplorerStore.getState()).toMatchObject({ directory: '/downloads/sub1', historyIndex: 1 });

            await act(async () => {
                press(MOUSE_FORWARD_BUTTON);
            });
            expect(useExplorerStore.getState()).toMatchObject({ directory: '/downloads/sub1/sub2', historyIndex: 2 });
        });

        it('falls through to global forward navigation once at the end of explorer folder history', async () => {
            mock.api.explorer.list.mockImplementation(async (directory?: string) => {
                return listingOf(directory ?? '/downloads');
            });
            mount();
            act(() => {
                useAppStore.getState().setDownloadsView('explorer');
            });
            await act(async () => {
                await useExplorerStore.getState().open('/downloads');
                await useExplorerStore.getState().open('/downloads/sub1');
            });
            setTab('settings');
            press(MOUSE_BACK_BUTTON);
            expect(useAppStore.getState()).toMatchObject({ tab: 'downloads', downloadsView: 'explorer' });
            expect(useExplorerStore.getState()).toMatchObject({ directory: '/downloads/sub1', historyIndex: 1 });

            press(MOUSE_FORWARD_BUTTON);
            expect(useAppStore.getState().tab).toBe('settings');
        });

        it('does not touch explorer folder history when another section or downloads view is active', async () => {
            mock.api.explorer.list.mockImplementation(async (directory?: string) => {
                return listingOf(directory ?? '/downloads');
            });
            mount();
            act(() => {
                useAppStore.getState().setDownloadsView('explorer');
            });
            await act(async () => {
                await useExplorerStore.getState().open('/downloads');
                await useExplorerStore.getState().open('/downloads/sub1');
            });
            setDownloadsView('history');
            setTab('settings');

            press(MOUSE_BACK_BUTTON);
            expect(useAppStore.getState()).toMatchObject({ tab: 'downloads', downloadsView: 'history' });
            expect(useExplorerStore.getState()).toMatchObject({ directory: '/downloads/sub1', historyIndex: 1 });

            press(MOUSE_FORWARD_BUTTON);
            expect(useAppStore.getState().tab).toBe('settings');
            expect(useExplorerStore.getState()).toMatchObject({ directory: '/downloads/sub1', historyIndex: 1 });
        });

        it('closes the explorer player before stepping back in folder history, and does not step forward while playing', async () => {
            const playing = {
                entry: {
                    path: '/downloads/sub1/clip.mp4',
                    name: 'clip.mp4',
                    kind: 'video' as const,
                    extension: '.mp4',
                    sizeBytes: 1024,
                    modifiedAt: 1000,
                    token: 1,
                    thumbnailUrl: 'pullwave-explorer://thumbnail/1',
                    mediaUrl: 'pullwave-explorer://media/1'
                },
                status: 'ready' as const,
                url: 'pullwave-explorer://media/1',
                converted: false,
                error: null
            };
            mock.api.explorer.list.mockImplementation(async (directory?: string) => {
                return listingOf(directory ?? '/downloads');
            });
            mount();
            act(() => {
                useAppStore.getState().setDownloadsView('explorer');
            });
            await act(async () => {
                await useExplorerStore.getState().open('/downloads');
                await useExplorerStore.getState().open('/downloads/sub1');
                await useExplorerStore.getState().open('/downloads/sub2');
                await useExplorerStore.getState().goBack();
            });
            act(() => {
                useExplorerStore.setState({ playing });
            });

            press(MOUSE_FORWARD_BUTTON);
            expect(useExplorerStore.getState()).toMatchObject({ directory: '/downloads/sub1', historyIndex: 1, playing });

            press(MOUSE_BACK_BUTTON);
            expect(useExplorerStore.getState()).toMatchObject({ directory: '/downloads/sub1', historyIndex: 1, playing: null });

            await act(async () => {
                press(MOUSE_BACK_BUTTON);
            });
            expect(useExplorerStore.getState()).toMatchObject({ directory: '/downloads', historyIndex: 0 });
        });
    });

    it('does not go forward while a player is open', () => {
        mount();
        setTab('anime');
        setTab('settings');
        press(MOUSE_BACK_BUTTON);
        act(() => {
            useAnimeStore.setState({ playing: { animeId: 1, episodeId: 2 } });
        });

        const event = press(MOUSE_FORWARD_BUTTON);
        expect(event.defaultPrevented).toBe(true);
        expect(useAppStore.getState().tab).toBe('anime');
    });

    describe('in the manga section', () => {
        beforeEach(() => {
            useAppStore.setState({ tab: 'manga' });
        });

        it('goes back and forward through the screens of the section', () => {
            mount();
            act(() => {
                useMangaStore.getState().setView('library');
            });
            act(() => {
                useMangaStore.getState().setView('extensions');
            });

            press(MOUSE_BACK_BUTTON);
            expect(useMangaStore.getState().view).toBe('library');
            press(MOUSE_BACK_BUTTON);
            expect(useMangaStore.getState().view).toBe('browse');
            press(MOUSE_FORWARD_BUTTON);
            press(MOUSE_FORWARD_BUTTON);
            expect(useMangaStore.getState().view).toBe('extensions');
        });

        it('goes back from the downloads screen to the screen it came from', () => {
            mount();
            act(() => {
                useMangaStore.getState().setView('library');
            });
            act(() => {
                useMangaStore.getState().openDownloads();
            });
            press(MOUSE_BACK_BUTTON);
            expect(useMangaStore.getState()).toMatchObject({ view: 'library' });
            press(MOUSE_FORWARD_BUTTON);
            expect(useMangaStore.getState()).toMatchObject({ view: 'downloads', previousView: 'library' });
        });

        it('goes back from a source to the list of sources, and forward to the source again, with its mode', () => {
            mount();
            act(() => {
                useMangaStore.getState().openSource('5', 'latest');
            });
            act(() => {
                useMangaStore.getState().setMode('search');
            });

            press(MOUSE_BACK_BUTTON);
            expect(useMangaStore.getState().browse).toMatchObject({ sourceId: '5', mode: 'latest' });
            press(MOUSE_BACK_BUTTON);
            expect(useMangaStore.getState().browse.sourceId).toBeNull();
            press(MOUSE_FORWARD_BUTTON);
            expect(useMangaStore.getState().browse).toMatchObject({ sourceId: '5', mode: 'latest' });
            press(MOUSE_FORWARD_BUTTON);
            expect(useMangaStore.getState().browse).toMatchObject({ sourceId: '5', mode: 'search' });
        });

        it('goes from one source to another and back, opening each again', () => {
            mount();
            act(() => {
                useMangaStore.getState().openSource('5');
            });
            act(() => {
                useMangaStore.getState().openSource('6');
            });
            press(MOUSE_BACK_BUTTON);
            expect(useMangaStore.getState().browse).toMatchObject({ sourceId: '5', mode: 'popular', status: 'idle', items: [] });
            press(MOUSE_FORWARD_BUTTON);
            expect(useMangaStore.getState().browse.sourceId).toBe('6');
        });

        it('goes back from a manga to the list, and forward to the manga with what was loaded', async () => {
            mount();
            act(() => {
                useMangaStore.getState().openSource('5');
            });
            await act(async () => {
                await useMangaStore.getState().openManga(makeSummary({ remoteId: 7 }));
            });
            expect(useMangaStore.getState().selection?.status).toBe('ready');

            press(MOUSE_BACK_BUTTON);
            expect(useMangaStore.getState().selection).toBeNull();
            expect(useMangaStore.getState().browse.sourceId).toBe('5');
            press(MOUSE_FORWARD_BUTTON);
            expect(useMangaStore.getState().selection).toMatchObject({ manga: { remoteId: 7 }, status: 'ready', details: makeDetails() });
            expect(useMangaStore.getState().selectionFrom).toBe('browse');
        });

        it('goes back in one step from the latest or popular listing of a source opened from a library manga', async () => {
            mount();
            act(() => {
                useMangaStore.setState({
                    view: 'library',
                    browse: {
                        ...useMangaStore.getState().browse,
                        sources: [makeSource({ id: '123', supportsLatest: true }), makeSource({ id: '456', supportsLatest: false })],
                        sourcesStatus: 'ready'
                    }
                });
            });
            await act(async () => {
                await useMangaStore.getState().openManga(makeSummary({ remoteId: 7, sourceId: '123' }));
            });
            act(() => {
                useMangaStore.getState().openSourceLatest('123');
            });
            expect(useMangaStore.getState()).toMatchObject({ view: 'browse', selection: null });
            expect(useMangaStore.getState().browse).toMatchObject({ sourceId: '123', mode: 'latest' });

            press(MOUSE_BACK_BUTTON);
            expect(useMangaStore.getState()).toMatchObject({ view: 'library', selectionFrom: 'library' });
            expect(useMangaStore.getState().selection?.manga.remoteId).toBe(7);

            press(MOUSE_FORWARD_BUTTON);
            expect(useMangaStore.getState()).toMatchObject({ view: 'browse', selection: null });
            expect(useMangaStore.getState().browse).toMatchObject({ sourceId: '123', mode: 'latest' });

            press(MOUSE_BACK_BUTTON);
            act(() => {
                useMangaStore.getState().openSourceLatest('456');
            });
            expect(useMangaStore.getState()).toMatchObject({ view: 'browse', selection: null });
            expect(useMangaStore.getState().browse).toMatchObject({ sourceId: '456', mode: 'popular' });
            press(MOUSE_BACK_BUTTON);
            expect(useMangaStore.getState()).toMatchObject({ view: 'library', selectionFrom: 'library' });
        });

        it('resets library category filters when navigating back or forward across different group tabs', () => {
            mount();
            act(() => {
                useMangaStore.setState({
                    view: 'library',
                    groups: [
                        { id: 1, name: 'Romcoms' },
                        { id: 2, name: 'Shonen' }
                    ],
                    libraryGroup: 1
                });
            });
            act(() => {
                useMangaStore.getState().setLibraryGroup(2);
            });
            act(() => {
                useMangaStore.getState().setLibraryGenres(['Action'], 'and');
            });
            expect(useMangaStore.getState()).toMatchObject({ libraryGroup: 2, libraryGenres: ['Action'], libraryGenreMode: 'and' });

            press(MOUSE_BACK_BUTTON);
            expect(useMangaStore.getState()).toMatchObject({ libraryGroup: 1, libraryGenres: [], libraryGenreMode: 'or' });

            act(() => {
                useMangaStore.getState().setLibraryGenres(['Romance'], 'and');
            });
            press(MOUSE_FORWARD_BUTTON);
            expect(useMangaStore.getState()).toMatchObject({ libraryGroup: 2, libraryGenres: [], libraryGenreMode: 'or' });
        });

        it('opens and closes the settings of a source with the buttons', async () => {
            mount();
            act(() => {
                useMangaStore.getState().openSource('5');
            });
            await act(async () => {
                await useMangaStore.getState().openSourceSettings();
            });
            expect(useMangaStore.getState().sourceSettings.open).toBe(true);

            press(MOUSE_BACK_BUTTON);
            expect(useMangaStore.getState().sourceSettings.open).toBe(false);
            await act(async () => {
                press(MOUSE_FORWARD_BUTTON);
            });
            expect(useMangaStore.getState().sourceSettings.open).toBe(true);
        });

        it('reads the library again when it comes back to it', () => {
            mount();
            act(() => {
                useMangaStore.getState().setView('library');
            });
            act(() => {
                useMangaStore.getState().setView('extensions');
            });
            mock.api.manga.library.mockClear();
            press(MOUSE_BACK_BUTTON);
            expect(mock.api.manga.library).toHaveBeenCalledTimes(1);
        });

        it('closes the reader first: going back from it does not leave the page', () => {
            mount();
            act(() => {
                useMangaStore.getState().setView('library');
            });
            act(() => {
                useMangaStore.setState({ reader: { status: 'ready', mangaTitle: 'One Piece', chapters: [], index: 0, pages: [], local: false, missing: [], error: null } });
            });
            press(MOUSE_BACK_BUTTON);
            expect(useMangaStore.getState().reader.status).toBe('closed');
            expect(useMangaStore.getState().view).toBe('library');
            press(MOUSE_BACK_BUTTON);
            expect(useMangaStore.getState().view).toBe('browse');
        });

        it('does not go forward while the reader is open', () => {
            mount();
            act(() => {
                useMangaStore.getState().setView('library');
            });
            press(MOUSE_BACK_BUTTON);
            act(() => {
                useMangaStore.setState({ reader: { status: 'ready', mangaTitle: 'One Piece', chapters: [], index: 0, pages: [], local: false, missing: [], error: null } });
            });
            const event = press(MOUSE_FORWARD_BUTTON);
            expect(event.defaultPrevented).toBe(true);
            expect(useMangaStore.getState().view).toBe('browse');
        });

        it('stops recording the store of the manga when it is removed', () => {
            const { unmount } = mount();
            unmount();
            act(() => {
                useMangaStore.getState().setView('library');
            });
            press(MOUSE_BACK_BUTTON);
            expect(useMangaStore.getState().view).toBe('library');
        });
    });

    it('stops listening and recording when it is removed', () => {
        const remove = vi.spyOn(window, 'removeEventListener');
        const { unmount } = mount();
        setTab('anime');
        unmount();

        expect(remove).toHaveBeenCalledWith('mouseup', expect.any(Function));
        press(MOUSE_BACK_BUTTON);
        expect(useAppStore.getState().tab).toBe('anime');
    });

    describe('scroll of the pages', () => {
        let area: HTMLElement;
        let frames: Array<(time: number) => void>;

        beforeEach(() => {
            frames = [];
            vi.stubGlobal('requestAnimationFrame', (callback: (time: number) => void) => {
                frames.push(callback);
                return frames.length;
            });
            vi.stubGlobal('cancelAnimationFrame', () => {
                return undefined;
            });
            area = document.createElement('div');
            area.className = 'app__main';
            Object.defineProperty(area, 'clientHeight', { value: 800, configurable: true });
            Object.defineProperty(area, 'scrollHeight', { value: 4000, configurable: true });
            document.body.appendChild(area);
        });

        afterEach(() => {
            area.remove();
            vi.unstubAllGlobals();
        });

        function runFrame(time: number): void {
            act(() => {
                frames.splice(0).forEach((frame) => {
                    frame(time);
                });
            });
        }

        it('puts back where the page was scrolled to when going back and forward', () => {
            mount();
            area.scrollTop = 640;
            setTab('anime');
            area.scrollTop = 220;
            setTab('settings');
            area.scrollTop = 0;

            press(MOUSE_BACK_BUTTON);
            area.scrollTop = 0;
            runFrame(16);
            expect(useAppStore.getState().tab).toBe('anime');
            expect(area.scrollTop).toBe(220);

            press(MOUSE_BACK_BUTTON);
            area.scrollTop = 0;
            runFrame(32);
            expect(useAppStore.getState().tab).toBe('downloads');
            expect(area.scrollTop).toBe(640);

            press(MOUSE_FORWARD_BUTTON);
            area.scrollTop = 0;
            runFrame(48);
            expect(useAppStore.getState().tab).toBe('anime');
            expect(area.scrollTop).toBe(220);
        });

        it('keeps the scroll that the viewer left on the page when going back', () => {
            mount();
            setTab('anime');
            area.scrollTop = 1500;
            press(MOUSE_BACK_BUTTON);
            runFrame(16);
            press(MOUSE_FORWARD_BUTTON);
            runFrame(32);
            expect(useAppStore.getState().tab).toBe('anime');
            expect(area.scrollTop).toBe(1500);
        });

        it('does not scroll when the page was at the top', () => {
            mount();
            setTab('anime');
            press(MOUSE_BACK_BUTTON);
            expect(frames).toHaveLength(0);
        });

        it('does not scroll when there is no page to go to', () => {
            mount();
            area.scrollTop = 500;
            press(MOUSE_BACK_BUTTON);
            expect(frames).toHaveLength(0);
            expect(area.scrollTop).toBe(500);
        });

        it('goes back without the area that scrolls', () => {
            area.remove();
            mount();
            setTab('anime');
            press(MOUSE_BACK_BUTTON);
            expect(useAppStore.getState().tab).toBe('downloads');
            expect(frames).toHaveLength(0);
        });

        it('does not scroll the page when going back only closes the reader of the manga', () => {
            mount();
            setTab('manga' as 'anime');
            area.scrollTop = 900;
            useMangaStore.setState({ reader: { status: 'loading', mangaTitle: 'One Piece', chapters: [], index: 0, pages: [], local: false, missing: [], error: null } });
            press(MOUSE_BACK_BUTTON);
            expect(useMangaStore.getState().reader.status).toBe('closed');
            expect(frames).toHaveLength(0);
            expect(area.scrollTop).toBe(900);
        });
    });
});
