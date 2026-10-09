// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import type { AnimeSearchResult } from '@shared/anime';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { MOUSE_BACK_BUTTON, MOUSE_FORWARD_BUTTON, snapshotKey, useMouseNavigation, type NavigationSnapshot } from '@renderer/hooks/useMouseNavigation';
import { INITIAL_SEARCH, useAnimeStore, type AnimeSelection } from '@renderer/store/animeStore';
import { useAppStore } from '@renderer/store/appStore';
import { makeAnime } from '../../helpers/animeFixtures';
import { installMockApi, type MockApiHandle } from '../../helpers/mockApi';

const initialApp = useAppStore.getState();
const initialAnime = useAnimeStore.getState();
const RESULT: AnimeSearchResult = { index: 2, title: 'Naruto' };
const SELECTION: AnimeSelection = { result: RESULT, query: 'naruto', audio: 'sub', status: 'ready', episodes: ['1', '2'], error: null };

let mock: MockApiHandle;

beforeEach(() => {
    mock = installMockApi();
    mock.api.listAnimeLibrary.mockResolvedValue([]);
    useAppStore.setState({ ...initialApp, tab: 'downloads', downloadsView: 'queue', settings: DEFAULT_SETTINGS });
    useAnimeStore.setState({
        ...initialAnime,
        view: 'search',
        returnView: 'search',
        library: [],
        search: INITIAL_SEARCH,
        selection: null,
        libraryFocus: null,
        librarySeries: null,
        playing: null,
        streaming: null
    });
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
    const base: NavigationSnapshot = { tab: 'anime', downloadsView: 'queue', view: 'library', returnView: 'library', selection: null, libraryFocus: null, librarySeries: null };

    it('joins the parts that make a page', () => {
        expect(snapshotKey(base)).toBe('anime|queue|library|library|||');
        expect(snapshotKey({ ...base, selection: SELECTION, libraryFocus: 7, librarySeries: 'series-frieren' })).toBe('anime|queue|library|library|2:sub|7|series-frieren');
    });

    it('differs between the cards of the library and each series open', () => {
        const key = snapshotKey(base);
        expect(snapshotKey({ ...base, librarySeries: 'series-frieren' })).not.toBe(key);
        expect(snapshotKey({ ...base, librarySeries: 'series-frieren' })).not.toBe(snapshotKey({ ...base, librarySeries: 'anime-4' }));
    });

    it('does not change when the content of the same selection loads', () => {
        expect(snapshotKey({ ...base, selection: { ...SELECTION, status: 'loading', episodes: [] } })).toBe(snapshotKey({ ...base, selection: SELECTION }));
    });

    it('differs between anime and between audios', () => {
        const key = snapshotKey({ ...base, selection: SELECTION });
        expect(snapshotKey({ ...base, selection: { ...SELECTION, result: { index: 3, title: 'Bleach' } } })).not.toBe(key);
        expect(snapshotKey({ ...base, selection: { ...SELECTION, audio: 'dub' } })).not.toBe(key);
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
        ['streaming', { streaming: { title: 'Naruto', episode: '1', status: 'loading' as const, stream: null, error: null } }, 'closeStream']
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

    it('stops listening and recording when it is removed', () => {
        const remove = vi.spyOn(window, 'removeEventListener');
        const { unmount } = mount();
        setTab('anime');
        unmount();

        expect(remove).toHaveBeenCalledWith('mouseup', expect.any(Function));
        press(MOUSE_BACK_BUTTON);
        expect(useAppStore.getState().tab).toBe('anime');
    });
});
