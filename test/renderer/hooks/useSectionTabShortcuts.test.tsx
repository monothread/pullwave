// @vitest-environment jsdom
import { fireEvent, render } from '@testing-library/react';
import { ANIME_TAB_IDS } from '@renderer/components/AnimePanel';
import { DOWNLOADS_TAB_IDS } from '@renderer/components/DownloadsPanel';
import { MANGA_TAB_IDS } from '@renderer/components/MangaPanel';
import { currentSectionTabs, useSectionTabShortcuts } from '@renderer/hooks/useSectionTabShortcuts';
import { UNSUPPORTED_STATUS, useAnimeStore, type AnimeView } from '@renderer/store/animeStore';
import { useAppStore, type DownloadsView, type Tab } from '@renderer/store/appStore';
import { useMangaStore, type MangaView } from '@renderer/store/mangaStore';
import { makeStatus } from '../../helpers/animeFixtures';
import { makeMangaStatus } from '../../helpers/mangaFixtures';
import { installMockApi } from '../../helpers/mockApi';

const initialApp = useAppStore.getState();
const initialAnime = useAnimeStore.getState();
const initialManga = useMangaStore.getState();

function Screen() {
    useSectionTabShortcuts();
    return <input aria-label="Field" />;
}

function enter(tab: Tab, views: { downloads?: DownloadsView; anime?: AnimeView; manga?: MangaView } = {}): void {
    useAppStore.setState({ ...initialApp, tab, downloadsView: views.downloads ?? 'queue' });
    useAnimeStore.setState({ ...initialAnime, status: makeStatus({ supported: true }), view: views.anime ?? 'schedule' });
    useMangaStore.setState({ ...initialManga, status: makeMangaStatus({ supported: true }), view: views.manga ?? 'browse' });
}

function press(key: 'PageUp' | 'PageDown', init: KeyboardEventInit = {}, target: Window | Element = window): boolean {
    return fireEvent.keyDown(target, { key, ctrlKey: true, ...init });
}

beforeEach(() => {
    installMockApi();
});

afterEach(() => {
    document.body.innerHTML = '';
});

describe('the tabs of each section', () => {
    it('are the ones of the bar, in its order, with the gear last', () => {
        expect(DOWNLOADS_TAB_IDS).toEqual(['queue', 'history', 'cut', 'settings']);
        expect(ANIME_TAB_IDS).toEqual(['schedule', 'updates', 'search', 'library', 'history', 'settings']);
        expect(MANGA_TAB_IDS).toEqual(['browse', 'search', 'updates', 'library', 'history', 'extensions', 'settings']);
    });
});

describe('currentSectionTabs', () => {
    it('gives the tabs of the section the user is in, which one is open, and a way to open another', () => {
        enter('downloads', { downloads: 'cut' });
        const downloads = currentSectionTabs();
        expect([downloads?.ids, downloads?.current]).toEqual([DOWNLOADS_TAB_IDS, 'cut']);
        downloads?.select('history');
        expect(useAppStore.getState().downloadsView).toBe('history');
        enter('anime', { anime: 'library' });
        const anime = currentSectionTabs();
        expect([anime?.ids, anime?.current]).toEqual([ANIME_TAB_IDS, 'library']);
        anime?.select('updates');
        expect(useAnimeStore.getState().view).toBe('updates');
        enter('manga', { manga: 'extensions' });
        const manga = currentSectionTabs();
        expect([manga?.ids, manga?.current]).toEqual([MANGA_TAB_IDS, 'extensions']);
        manga?.select('search');
        expect(useMangaStore.getState().view).toBe('search');
    });

    it('gives none on the home screen and in the settings of the whole app', () => {
        enter('home');
        expect(currentSectionTabs()).toBeNull();
        enter('settings');
        expect(currentSectionTabs()).toBeNull();
    });

    it('gives none for a section that does not exist here, nor for the list of downloads of the anime or of the manga, which is not a tab', () => {
        enter('anime');
        useAnimeStore.setState({ status: UNSUPPORTED_STATUS });
        expect(currentSectionTabs()).toBeNull();
        enter('anime', { anime: 'downloads' });
        expect(currentSectionTabs()).toBeNull();
        enter('manga');
        useMangaStore.setState({ status: makeMangaStatus({ supported: false, tool: null }) });
        expect(currentSectionTabs()).toBeNull();
        enter('manga', { manga: 'downloads' });
        expect(currentSectionTabs()).toBeNull();
    });

    it('gives none while a manga is being read', () => {
        enter('manga', { manga: 'library' });
        useMangaStore.setState({ reader: { ...initialManga.reader, status: 'ready' } });
        expect(currentSectionTabs()).toBeNull();
    });
});

describe('Ctrl+Page Down and Ctrl+Page Up in the video downloader', () => {
    it('go to the next tab and to the one before, going round at the ends, and hold the key back', () => {
        enter('downloads');
        render(<Screen />);
        const seen = ['queue'];
        for (let step = 0; step < 4; step += 1) {
            expect(press('PageDown')).toBe(false);
            seen.push(useAppStore.getState().downloadsView);
        }
        expect(seen).toEqual(['queue', 'history', 'cut', 'settings', 'queue']);
        expect(press('PageUp')).toBe(false);
        expect(useAppStore.getState().downloadsView).toBe('settings');
        press('PageUp');
        expect(useAppStore.getState().downloadsView).toBe('cut');
    });
});

describe('Ctrl+Page Down and Ctrl+Page Up in the anime section', () => {
    it('go through every tab of the bar and round again', () => {
        enter('anime');
        render(<Screen />);
        const seen: string[] = [];
        for (let step = 0; step < ANIME_TAB_IDS.length; step += 1) {
            press('PageDown');
            seen.push(useAnimeStore.getState().view);
        }
        expect(seen).toEqual(['updates', 'search', 'library', 'history', 'settings', 'schedule']);
        press('PageUp');
        expect(useAnimeStore.getState().view).toBe('settings');
    });

    it('do nothing on the list of downloads, which is not a tab, and let the key through', () => {
        enter('anime', { anime: 'downloads' });
        render(<Screen />);
        expect(press('PageDown')).toBe(true);
        expect(useAnimeStore.getState().view).toBe('downloads');
    });
});

describe('Ctrl+Page Down and Ctrl+Page Up in the manga section', () => {
    it('go through every tab of the bar and round again', () => {
        enter('manga');
        render(<Screen />);
        const seen: string[] = [];
        for (let step = 0; step < MANGA_TAB_IDS.length; step += 1) {
            press('PageDown');
            seen.push(useMangaStore.getState().view);
        }
        expect(seen).toEqual(['search', 'updates', 'library', 'history', 'extensions', 'settings', 'browse']);
        press('PageUp');
        expect(useMangaStore.getState().view).toBe('settings');
    });

    it('do nothing while a manga is being read, and let the key through', () => {
        enter('manga', { manga: 'library' });
        useMangaStore.setState({ reader: { ...initialManga.reader, status: 'ready' } });
        render(<Screen />);
        expect(press('PageDown')).toBe(true);
        expect(useMangaStore.getState().view).toBe('library');
    });
});

describe('Ctrl+Page Down and Ctrl+Page Up where there are no tabs, or the keys belong to something else', () => {
    it('do nothing on the home screen and in the settings of the whole app', () => {
        enter('home');
        render(<Screen />);
        expect(press('PageDown')).toBe(true);
        enter('settings');
        expect(press('PageUp')).toBe(true);
        expect(useAppStore.getState().tab).toBe('settings');
    });

    it('do nothing without Ctrl, or with Shift, Alt or Meta too', () => {
        enter('downloads');
        render(<Screen />);
        expect(fireEvent.keyDown(window, { key: 'PageDown' })).toBe(true);
        expect(press('PageDown', { shiftKey: true })).toBe(true);
        expect(press('PageDown', { altKey: true })).toBe(true);
        expect(press('PageDown', { metaKey: true })).toBe(true);
        expect(useAppStore.getState().downloadsView).toBe('queue');
    });

    it('leave the keys to a window that is open, to the player and to the reader', () => {
        enter('downloads');
        const { container } = render(<Screen />);
        const dialog = document.createElement('div');
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        container.appendChild(dialog);
        expect(press('PageDown')).toBe(true);
        dialog.remove();
        const player = document.createElement('div');
        player.className = 'player';
        container.appendChild(player);
        expect(press('PageDown')).toBe(true);
        player.className = 'reader';
        expect(press('PageDown')).toBe(true);
        expect(useAppStore.getState().downloadsView).toBe('queue');
        player.remove();
        expect(press('PageDown')).toBe(false);
        expect(useAppStore.getState().downloadsView).toBe('history');
    });

    it('work with the cursor in a field', () => {
        enter('downloads');
        const { getByLabelText } = render(<Screen />);
        const field = getByLabelText('Field');
        field.focus();
        expect(press('PageDown', {}, field)).toBe(false);
        expect(useAppStore.getState().downloadsView).toBe('history');
    });

    it('stop when the app goes away', () => {
        enter('downloads');
        const { unmount } = render(<Screen />);
        unmount();
        expect(press('PageDown')).toBe(true);
        expect(useAppStore.getState().downloadsView).toBe('queue');
    });
});
