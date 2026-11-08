// @vitest-environment jsdom
import { fireEvent, render } from '@testing-library/react';
import { useMainSectionShortcuts, walkableSections } from '@renderer/hooks/useMainSectionShortcuts';
import { UNSUPPORTED_STATUS, useAnimeStore } from '@renderer/store/animeStore';
import { useAppStore, type Tab } from '@renderer/store/appStore';
import { useMangaStore } from '@renderer/store/mangaStore';
import { makeStatus } from '../../helpers/animeFixtures';
import { makeMangaStatus } from '../../helpers/mangaFixtures';

const initialApp = useAppStore.getState();
const initialAnime = useAnimeStore.getState();
const initialManga = useMangaStore.getState();

function Screen() {
    useMainSectionShortcuts();
    return (
        <div>
            <input aria-label="Field" />
            <input type="checkbox" aria-label="Switch" />
        </div>
    );
}

function enter(tab: Tab, supported = { anime: true, manga: true }): void {
    useAppStore.setState({ ...initialApp, tab });
    useAnimeStore.setState({ ...initialAnime, status: supported.anime ? makeStatus({ supported: true }) : UNSUPPORTED_STATUS });
    useMangaStore.setState({ ...initialManga, status: makeMangaStatus({ supported: supported.manga, tool: supported.manga ? initialManga.status.tool : null }) });
}

function press(key: 'Home' | 'End', init: KeyboardEventInit = {}, target: Window | Element = window): boolean {
    return fireEvent.keyDown(target, { key, ctrlKey: true, ...init });
}

// Without view transitions in the window the section just changes.
beforeEach(() => {
    Reflect.deleteProperty(document, 'startViewTransition');
});

afterEach(() => {
    document.body.innerHTML = '';
});

describe('walkableSections', () => {
    it('are the home screen and the three sections in the order of the menu, without the settings of the whole app', () => {
        enter('home');
        expect(walkableSections()).toEqual(['home', 'downloads', 'anime', 'manga']);
    });

    it('leave out the section that does not exist here', () => {
        enter('home', { anime: false, manga: true });
        expect(walkableSections()).toEqual(['home', 'downloads', 'manga']);
        enter('home', { anime: true, manga: false });
        expect(walkableSections()).toEqual(['home', 'downloads', 'anime']);
        enter('home', { anime: false, manga: false });
        expect(walkableSections()).toEqual(['home', 'downloads']);
    });
});

describe('Ctrl+End and Ctrl+Home', () => {
    it('go to the next section and to the one before, going round, and hold the key back', () => {
        enter('home');
        render(<Screen />);
        const seen = ['home'];
        for (let step = 0; step < 4; step += 1) {
            expect(press('End')).toBe(false);
            seen.push(useAppStore.getState().tab);
        }
        expect(seen).toEqual(['home', 'downloads', 'anime', 'manga', 'home']);
        expect(press('Home')).toBe(false);
        expect(useAppStore.getState().tab).toBe('manga');
        press('Home');
        expect(useAppStore.getState().tab).toBe('anime');
    });

    it('skip the section that does not exist here', () => {
        enter('downloads', { anime: false, manga: true });
        render(<Screen />);
        press('End');
        expect(useAppStore.getState().tab).toBe('manga');
        press('Home');
        expect(useAppStore.getState().tab).toBe('downloads');
    });

    it('go to the home screen from the settings of the whole app, in either direction', () => {
        enter('settings');
        render(<Screen />);
        press('End');
        expect(useAppStore.getState().tab).toBe('home');
        enter('settings');
        press('Home');
        expect(useAppStore.getState().tab).toBe('home');
    });

    it('change the section with a slide where the window can, and without it where it cannot', () => {
        enter('home');
        const start = vi.fn((update: () => void) => {
            update();
            return { finished: Promise.resolve() };
        });
        Object.defineProperty(document, 'startViewTransition', { configurable: true, value: start, writable: true });
        render(<Screen />);
        press('End');
        expect(start).toHaveBeenCalledTimes(1);
        expect(useAppStore.getState().tab).toBe('downloads');
    });

    it('leave the keys to a field of text: they move the cursor through the text there', () => {
        enter('home');
        const { getByLabelText } = render(<Screen />);
        const field = getByLabelText('Field');
        field.focus();
        expect(press('End', {}, field)).toBe(true);
        expect(press('Home', {}, field)).toBe(true);
        expect(useAppStore.getState().tab).toBe('home');
    });

    it('work with the focus on a switch, which does not use Home and End', () => {
        enter('home');
        const { getByLabelText } = render(<Screen />);
        const toggle = getByLabelText('Switch');
        toggle.focus();
        expect(press('End', {}, toggle)).toBe(false);
        expect(useAppStore.getState().tab).toBe('downloads');
    });

    it('do nothing without Ctrl, or with Shift, Alt or Meta too', () => {
        enter('home');
        render(<Screen />);
        expect(fireEvent.keyDown(window, { key: 'End' })).toBe(true);
        expect(press('End', { shiftKey: true })).toBe(true);
        expect(press('End', { altKey: true })).toBe(true);
        expect(press('End', { metaKey: true })).toBe(true);
        expect(useAppStore.getState().tab).toBe('home');
    });

    it('leave the keys to a window that is open, to the player and to the reader', () => {
        enter('home');
        const { container } = render(<Screen />);
        const dialog = document.createElement('div');
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        container.appendChild(dialog);
        expect(press('End')).toBe(true);
        dialog.remove();
        const player = document.createElement('div');
        player.className = 'player';
        container.appendChild(player);
        expect(press('End')).toBe(true);
        player.className = 'reader';
        expect(press('End')).toBe(true);
        expect(useAppStore.getState().tab).toBe('home');
        player.remove();
        expect(press('End')).toBe(false);
        expect(useAppStore.getState().tab).toBe('downloads');
    });

    it('stop when the app goes away', () => {
        enter('home');
        const { unmount } = render(<Screen />);
        unmount();
        expect(press('End')).toBe(true);
        expect(useAppStore.getState().tab).toBe('home');
    });
});
