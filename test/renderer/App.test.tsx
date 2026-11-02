// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SETTINGS, THEME_STYLES } from '@shared/constants';
import { App } from '@renderer/App';
import { UNSUPPORTED_STATUS, useAnimeStore } from '@renderer/store/animeStore';
import { useAppStore } from '@renderer/store/appStore';
import { useMangaStore } from '@renderer/store/mangaStore';
import { makeStatus } from '../helpers/animeFixtures';
import { makeMangaStatus, makeTool } from '../helpers/mangaFixtures';
import { APP_UPDATE_IDLE, installMockApi, makeJob, type MockApiHandle } from '../helpers/mockApi';

let mock: MockApiHandle;
const initial = useAppStore.getState();

// The app opens on the home screen: the tests of the video downloader go to it first.
async function openDownloader(): Promise<void> {
    await screen.findByRole('region', { name: 'Home' });
    fireEvent.click(screen.getByRole('button', { name: 'VIDEO DOWNLOADER' }));
    await screen.findByLabelText('Link 1');
}

beforeEach(() => {
    mock = installMockApi();
    useAnimeStore.setState({ status: UNSUPPORTED_STATUS, jobs: [], library: [], selection: null, playing: null });
    useMangaStore.setState({ status: makeMangaStatus({ supported: false, tool: null }), jobs: [], library: [], selection: null, view: 'browse' });
    useAppStore.setState({ ...initial, tab: 'home', jobs: [], history: [], settings: DEFAULT_SETTINGS, binaries: null, notice: null, appUpdate: { ...APP_UPDATE_IDLE, currentVersion: '' } });
});

describe('App', () => {
    it('shows a boot message until the binaries are checked, then the home screen', async () => {
        render(<App />);
        expect(screen.getByText('// BOOTING SYSTEMS…')).toBeInTheDocument();
        await waitFor(() => {
            expect(screen.getByRole('region', { name: 'Home' })).toBeInTheDocument();
        });
        expect(screen.getByRole('button', { name: 'HOME' })).toHaveAttribute('aria-current', 'page');
        expect(screen.queryByLabelText('Link 1')).not.toBeInTheDocument();
        expect(screen.queryByText('// BOOTING SYSTEMS…')).not.toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'PULLWAVE' })).toBeInTheDocument();
        // The programs are installed and run: the header has no chip about them.
        expect(screen.queryByText(/^yt-dlp /)).not.toBeInTheDocument();
        expect(document.querySelectorAll('.chip')).toHaveLength(0);
    });

    it('marks the active tab and switches between sections', async () => {
        const user = userEvent.setup();
        render(<App />);
        await openDownloader();
        expect(screen.getByRole('button', { name: 'VIDEO DOWNLOADER' })).toHaveAttribute('aria-current', 'page');
        expect(screen.getByRole('button', { name: 'HISTORY' })).not.toHaveAttribute('aria-current');

        await user.click(screen.getByRole('button', { name: 'HISTORY' }));
        expect(screen.getByText('// HISTORY IS EMPTY.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'HISTORY' })).toHaveAttribute('aria-current', 'page');

        await user.click(screen.getByRole('button', { name: 'SETTINGS (GLOBAL)' }));
        expect(screen.getByText('Changes are saved automatically.')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'SAVE SETTINGS' })).not.toBeInTheDocument();

        // The video downloader opens on the screen it was left on.
        await user.click(screen.getByRole('button', { name: 'VIDEO DOWNLOADER' }));
        expect(screen.getByText('// HISTORY IS EMPTY.')).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'QUEUE' }));
        expect(screen.getByLabelText('Link 1')).toBeInTheDocument();
    });

    it('goes back and forward through the visited tabs with the side buttons of the mouse', async () => {
        const user = userEvent.setup();
        render(<App />);
        await openDownloader();
        await user.click(screen.getByRole('button', { name: 'HISTORY' }));
        await user.click(screen.getByRole('button', { name: 'SETTINGS (GLOBAL)' }));

        fireEvent.mouseUp(window, { button: 3 });
        expect(screen.getByRole('button', { name: 'HISTORY' })).toHaveAttribute('aria-current', 'page');
        expect(screen.getByText('// HISTORY IS EMPTY.')).toBeInTheDocument();

        fireEvent.mouseUp(window, { button: 3 });
        expect(screen.getByRole('button', { name: 'VIDEO DOWNLOADER' })).toHaveAttribute('aria-current', 'page');
        expect(screen.getByLabelText('Link 1')).toBeInTheDocument();

        fireEvent.mouseUp(window, { button: 4 });
        fireEvent.mouseUp(window, { button: 4 });
        expect(screen.getByRole('button', { name: 'SETTINGS (GLOBAL)' })).toHaveAttribute('aria-current', 'page');
        expect(screen.getByText('Changes are saved automatically.')).toBeInTheDocument();
    });

    it('renders jobs pushed from the main process', async () => {
        render(<App />);
        await openDownloader();
        act(() => {
            mock.emitJobUpdate(makeJob({ id: 'x', title: 'Pushed Video' }));
        });
        expect(screen.getByRole('heading', { name: 'Pushed Video' })).toBeInTheDocument();
    });

    it('shows the update banner when a new version is pushed', async () => {
        render(<App />);
        await openDownloader();
        expect(screen.queryByText('Version 0.2.0 is available.')).not.toBeInTheDocument();
        act(() => {
            mock.emitAppUpdateState({ ...APP_UPDATE_IDLE, status: 'available', version: '0.2.0' });
        });
        expect(screen.getByText('Version 0.2.0 is available.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'UPDATE TO 0.2.0' })).toBeInTheDocument();
    });

    it('unsubscribes from events on unmount', async () => {
        const { unmount } = render(<App />);
        await openDownloader();
        unmount();
        expect(mock.unsubscribers).toHaveLength(6);
        mock.unsubscribers.forEach((unsubscribe) => {
            expect(unsubscribe).toHaveBeenCalledTimes(1);
        });
    });

    it('unsubscribes even when unmounted before initialization finishes', async () => {
        let release: () => void = () => {
            return undefined;
        };
        mock.api.checkBinaries.mockReturnValueOnce(
            new Promise((resolve) => {
                release = () => {
                    resolve({
                        ytdlp: { found: true, path: 'yt-dlp', version: '1', source: 'system' },
                        ffmpeg: { found: true, path: 'ffmpeg', version: '1', source: 'system' }
                    });
                };
            })
        );
        const { unmount } = render(<App />);
        unmount();
        release();
        await waitFor(() => {
            expect(mock.unsubscribers).toHaveLength(6);
        });
        mock.unsubscribers.forEach((unsubscribe) => {
            expect(unsubscribe).toHaveBeenCalledTimes(1);
        });
    });
});

describe('App theme', () => {
    let prefersDark = false;
    const listeners = new Set<() => void>();

    beforeEach(() => {
        prefersDark = false;
        listeners.clear();
        window.localStorage.clear();
        Object.defineProperty(window, 'matchMedia', {
            configurable: true,
            writable: true,
            value: (query: string) => {
                return {
                    media: query,
                    get matches() {
                        return prefersDark;
                    },
                    addEventListener: (_type: string, listener: () => void) => {
                        listeners.add(listener);
                    },
                    removeEventListener: (_type: string, listener: () => void) => {
                        listeners.delete(listener);
                    }
                };
            }
        });
    });

    afterEach(() => {
        delete document.documentElement.dataset.theme;
        delete document.documentElement.dataset.themeStyle;
        Reflect.deleteProperty(window, 'matchMedia');
    });

    it.each(['cyberpunk', 'synthwave', 'terminal', 'dark', 'tokyo-night', 'nord', 'dracula', 'gruvbox', 'amoled', 'high-contrast', 'light', 'sakura', 'sakura-dark'] as const)('applies the %s theme, with its style, from the stored settings', async (theme) => {
        mock.api.getSettings.mockResolvedValue({ ...DEFAULT_SETTINGS, theme });
        render(<App />);
        await openDownloader();
        expect(document.documentElement.dataset.theme).toBe(theme);
        expect(document.documentElement.dataset.themeStyle).toBe(THEME_STYLES[theme]);
    });

    it('uses device by default and follows a dark system', async () => {
        prefersDark = true;
        render(<App />);
        await openDownloader();
        expect(DEFAULT_SETTINGS.theme).toBe('device');
        expect(document.documentElement.dataset.theme).toBe('dark');
    });

    it('uses device by default and follows a light system', async () => {
        render(<App />);
        await openDownloader();
        expect(document.documentElement.dataset.theme).toBe('light');
    });

    it('follows the system when it switches between light and dark while open', async () => {
        render(<App />);
        await openDownloader();
        expect(document.documentElement.dataset.theme).toBe('light');
        expect(listeners.size).toBe(1);
        prefersDark = true;
        act(() => {
            listeners.forEach((listener) => {
                listener();
            });
        });
        expect(document.documentElement.dataset.theme).toBe('dark');
    });

    it.each(['cyberpunk', 'synthwave', 'terminal', 'dark', 'tokyo-night', 'nord', 'dracula', 'gruvbox', 'amoled', 'high-contrast', 'light', 'sakura', 'sakura-dark'] as const)('does not follow the system with the %s theme', async (theme) => {
        mock.api.getSettings.mockResolvedValue({ ...DEFAULT_SETTINGS, theme });
        render(<App />);
        await openDownloader();
        expect(listeners.size).toBe(0);
    });

    it('stops following the system once a fixed theme is chosen', async () => {
        const user = userEvent.setup();
        render(<App />);
        await openDownloader();
        await user.click(screen.getByRole('button', { name: 'SETTINGS (GLOBAL)' }));
        await user.selectOptions(screen.getByLabelText('Theme'), 'cyberpunk');
        await waitFor(() => {
            expect(document.documentElement.dataset.theme).toBe('cyberpunk');
        });
        expect(listeners.size).toBe(0);
    });

    it('changes the theme as soon as it is chosen in the settings and saves it', async () => {
        const user = userEvent.setup();
        render(<App />);
        await openDownloader();
        await user.click(screen.getByRole('button', { name: 'SETTINGS (GLOBAL)' }));
        await user.selectOptions(screen.getByLabelText('Theme'), 'dark');
        await waitFor(() => {
            expect(document.documentElement.dataset.theme).toBe('dark');
        });
        expect(mock.api.saveSettings).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, theme: 'dark' });
    });

    it('remembers the applied theme for the next start', async () => {
        mock.api.getSettings.mockResolvedValue({ ...DEFAULT_SETTINGS, theme: 'cyberpunk' });
        render(<App />);
        await openDownloader();
        expect(window.localStorage.getItem('cyber-dl-theme')).toBe('cyberpunk');
    });

    it('keeps the remembered theme while the settings are still loading, instead of flashing the default', async () => {
        window.localStorage.setItem('cyber-dl-theme', 'nord');
        document.documentElement.dataset.theme = 'nord';
        document.documentElement.dataset.themeStyle = THEME_STYLES.nord;
        let resolveSettings: (settings: typeof DEFAULT_SETTINGS) => void = () => {
            return undefined;
        };
        mock.api.getSettings.mockReturnValue(
            new Promise((resolve) => {
                resolveSettings = resolve;
            })
        );
        render(<App />);
        expect(screen.getByText('// BOOTING SYSTEMS…')).toBeInTheDocument();
        expect(document.documentElement.dataset.theme).toBe('nord');
        expect(document.documentElement.dataset.themeStyle).toBe(THEME_STYLES.nord);
        expect(window.localStorage.getItem('cyber-dl-theme')).toBe('nord');

        await act(async () => {
            resolveSettings({ ...DEFAULT_SETTINGS, theme: 'nord' });
        });
        await screen.findByRole('region', { name: 'Home' });
        expect(document.documentElement.dataset.theme).toBe('nord');
        expect(window.localStorage.getItem('cyber-dl-theme')).toBe('nord');
    });

    it('does not make a neon follow the mouse in the cyberpunk theme', async () => {
        mock.api.getSettings.mockResolvedValue({ ...DEFAULT_SETTINGS, theme: 'cyberpunk' });
        render(<App />);
        await openDownloader();
        await act(async () => {
            window.dispatchEvent(new MouseEvent('pointermove', { clientX: 33, clientY: 44 }));
            await new Promise((resolve) => {
                window.requestAnimationFrame(resolve);
            });
        });
        expect(document.documentElement.dataset.theme).toBe('cyberpunk');
        expect(document.documentElement.style.getPropertyValue('--mx')).toBe('');
        expect(document.documentElement.style.getPropertyValue('--my')).toBe('');
        expect(document.documentElement.getAttribute('data-glow')).toBeNull();
    });

    it('does not follow the mouse in the dark theme', async () => {
        mock.api.getSettings.mockResolvedValue({ ...DEFAULT_SETTINGS, theme: 'dark' });
        render(<App />);
        await openDownloader();
        await act(async () => {
            window.dispatchEvent(new MouseEvent('pointermove', { clientX: 33, clientY: 44 }));
            await new Promise((resolve) => {
                window.requestAnimationFrame(resolve);
            });
        });
        expect(document.documentElement.style.getPropertyValue('--mx')).toBe('');
        expect(document.documentElement.getAttribute('data-glow')).toBeNull();
    });
});

describe('App anime section', () => {
    const supported = makeStatus();

    it('has no anime tab where the section does not exist', async () => {
        render(<App />);
        await openDownloader();
        expect(screen.queryByRole('button', { name: 'ANIME' })).not.toBeInTheDocument();
        expect(within(screen.getByRole('navigation', { name: 'Sections' })).getAllByRole('button')).toHaveLength(3);
    });

    it('adds the anime tab, between downloads and settings, where it exists', async () => {
        mock.api.getAnimeStatus.mockResolvedValue(supported);
        render(<App />);
        await screen.findByRole('button', { name: 'ANIME' });
        expect(
            within(screen.getByRole('navigation', { name: 'Sections' }))
                .getAllByRole('button')
                .map((button) => {
                    return button.getAttribute('aria-label') ?? button.textContent;
                })
        ).toEqual(['HOME', 'VIDEO DOWNLOADER', 'ANIME', 'SETTINGS (GLOBAL)']);
        // The settings are the drawn gear at the bottom of the menu, like the pictures of the sections; the name is kept for the screen readers
        // and shown when the menu opens.
        const settings = screen.getByRole('button', { name: 'SETTINGS (GLOBAL)' });
        expect(settings).not.toHaveClass('tab--icon');
        expect(settings.querySelector('.tab__decoration svg.section-icon--settings')).not.toBeNull();
        expect(settings.querySelector('.tab__label')).toHaveTextContent('SETTINGS (GLOBAL)');
        expect(settings).not.toHaveAttribute('title');
    });

    it('shows the anime section when its tab is chosen', async () => {
        const user = userEvent.setup();
        mock.api.getAnimeStatus.mockResolvedValue(supported);
        render(<App />);
        await user.click(await screen.findByRole('button', { name: 'ANIME' }));

        expect(screen.getByRole('button', { name: 'ANIME' })).toHaveAttribute('aria-current', 'page');
        expect(screen.getByRole('region', { name: 'Anime' })).toBeInTheDocument();
        // The section opens on the schedule, the first of its tabs.
        expect(screen.getByRole('button', { name: 'SCHEDULE' })).toHaveAttribute('aria-current', 'page');
        expect(screen.getByRole('region', { name: 'Anime schedule' })).toBeInTheDocument();
        expect(screen.queryByLabelText('Anime name')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Link 1')).not.toBeInTheDocument();
    });

    it('opens on the home screen, with the welcome (with no button) and the blocks in the order of the menu, where the anime section exists', async () => {
        mock.api.getAnimeStatus.mockResolvedValue(supported);
        render(<App />);
        const home = await screen.findByRole('region', { name: 'Home' });
        expect(screen.getByRole('button', { name: 'HOME' })).toHaveAttribute('aria-current', 'page');
        expect(useAppStore.getState().tab).toBe('home');
        expect(
            within(home)
                .getAllByRole('heading', { level: 2 })
                .map((heading) => {
                    return heading.textContent;
                })
        ).toEqual(['WELCOME TO PULLWAVE']);
        expect(within(screen.getByRole('region', { name: 'WELCOME TO PULLWAVE' })).queryByRole('button')).not.toBeInTheDocument();
        expect(within(home).getByRole('button', { name: 'SEARCH: ANIME' })).toBeInTheDocument();
        expect(
            within(home)
                .getAllByRole('heading', { level: 3 })
                .map((heading) => {
                    return heading.textContent;
                })
        ).toEqual(['VIDEO DOWNLOADER', 'ANIME']);
    });

    it('opens on the home screen without the block of the anime where the section does not exist', async () => {
        render(<App />);
        const home = await screen.findByRole('region', { name: 'Home' });
        expect(useAppStore.getState().tab).toBe('home');
        expect(
            within(home)
                .getAllByRole('heading', { level: 2 })
                .map((heading) => {
                    return heading.textContent;
                })
        ).toEqual(['WELCOME TO PULLWAVE']);
        expect(
            within(home)
                .getAllByRole('heading', { level: 3 })
                .map((heading) => {
                    return heading.textContent;
                })
        ).toEqual(['VIDEO DOWNLOADER']);
    });

    it('loads the library and the jobs of the section', async () => {
        mock.api.getAnimeStatus.mockResolvedValue(supported);
        render(<App />);
        await screen.findByRole('button', { name: 'ANIME' });
        expect(mock.api.listAnimeLibrary).toHaveBeenCalledTimes(1);
        expect(mock.api.listAnimeJobs).toHaveBeenCalledTimes(1);
    });

    it('opens on the home screen, with the blocks in the order of the menu, when only the manga section exists', async () => {
        mock.api.manga.status.mockResolvedValue(makeMangaStatus());
        render(<App />);
        const home = await screen.findByRole('region', { name: 'Home' });
        expect(useAppStore.getState().tab).toBe('home');
        expect(
            within(home)
                .getAllByRole('heading', { level: 2 })
                .map((heading) => {
                    return heading.textContent;
                })
        ).toEqual(['WELCOME TO PULLWAVE']);
        expect(
            within(home)
                .getAllByRole('heading', { level: 3 })
                .map((heading) => {
                    return heading.textContent;
                })
        ).toEqual(['VIDEO DOWNLOADER', 'MANGA']);
        expect(within(home).getByRole('button', { name: 'EXTENSIONS: MANGA' })).toBeInTheDocument();
    });

    it('unsubscribes from the events of the section too on unmount', async () => {
        mock.api.getAnimeStatus.mockResolvedValue(supported);
        const { unmount } = render(<App />);
        await screen.findByRole('button', { name: 'ANIME' });
        unmount();
        expect(mock.unsubscribers).toHaveLength(12);
        mock.unsubscribers.forEach((unsubscribe) => {
            expect(unsubscribe).toHaveBeenCalledTimes(1);
        });
    });
});

describe('App manga section', () => {
    const supported = makeMangaStatus();

    it('has no manga tab where the section does not exist', async () => {
        render(<App />);
        await openDownloader();
        expect(screen.queryByRole('button', { name: 'MANGA' })).not.toBeInTheDocument();
        expect(mock.api.manga.status).toHaveBeenCalledTimes(1);
    });

    it('adds the manga tab, after the anime one and before the settings, where it exists', async () => {
        mock.api.manga.status.mockResolvedValue(supported);
        mock.api.getAnimeStatus.mockResolvedValue(makeStatus());
        render(<App />);
        await screen.findByRole('button', { name: 'MANGA' });
        expect(
            within(screen.getByRole('navigation', { name: 'Sections' }))
                .getAllByRole('button')
                .map((button) => {
                    return button.getAttribute('aria-label') ?? button.textContent;
                })
        ).toEqual(['HOME', 'VIDEO DOWNLOADER', 'ANIME', 'MANGA', 'SETTINGS (GLOBAL)']);
    });

    it('shows the manga section when its tab is chosen', async () => {
        const user = userEvent.setup();
        mock.api.manga.status.mockResolvedValue(supported);
        mock.api.manga.sources.mockResolvedValue({ ok: true, value: [] });
        render(<App />);
        await user.click(await screen.findByRole('button', { name: 'MANGA' }));
        expect(screen.getByRole('button', { name: 'MANGA' })).toHaveAttribute('aria-current', 'page');
        expect(screen.getByRole('region', { name: 'Manga' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'BROWSE' })).toHaveAttribute('aria-current', 'page');
        expect(screen.queryByLabelText('Link 1')).not.toBeInTheDocument();
    });

    it('shows the preparation of the program in the manga section until it is downloaded', async () => {
        const user = userEvent.setup();
        mock.api.manga.status.mockResolvedValue(makeMangaStatus({ tool: makeTool({ status: 'downloading', percent: 30 }) }));
        render(<App />);
        await user.click(await screen.findByRole('button', { name: 'MANGA' }));
        expect(screen.getByText('PREPARING THE MANGA SERVER')).toBeInTheDocument();
        expect(screen.getByText('Downloading… 30%')).toBeInTheDocument();
        expect(mock.api.manga.sources).not.toHaveBeenCalled();
    });

    it('moves on from the preparation when the program is ready', async () => {
        const user = userEvent.setup();
        mock.api.manga.status.mockResolvedValue(makeMangaStatus({ tool: makeTool({ status: 'downloading', percent: 30 }) }));
        mock.api.manga.sources.mockResolvedValue({ ok: true, value: [] });
        render(<App />);
        await user.click(await screen.findByRole('button', { name: 'MANGA' }));
        mock.api.manga.status.mockResolvedValue(supported);
        act(() => {
            mock.emitMangaTool(makeTool({ status: 'ready' }));
        });
        expect(await screen.findByRole('button', { name: 'BROWSE' })).toBeInTheDocument();
        expect(screen.queryByText('PREPARING THE MANGA SERVER')).not.toBeInTheDocument();
    });

    it('loads the library and the downloads of the section', async () => {
        mock.api.manga.status.mockResolvedValue(supported);
        render(<App />);
        await screen.findByRole('button', { name: 'MANGA' });
        expect(mock.api.manga.library).toHaveBeenCalledTimes(1);
        expect(mock.api.manga.jobs).toHaveBeenCalledTimes(1);
    });

    it('leaves the block of the manga out of the home screen when the section does not exist', async () => {
        render(<App />);
        const home = await screen.findByRole('region', { name: 'Home' });
        expect(useAppStore.getState().tab).toBe('home');
        expect(within(home).queryByRole('heading', { level: 3, name: 'MANGA' })).not.toBeInTheDocument();
        expect(within(home).getByRole('heading', { level: 3, name: 'VIDEO DOWNLOADER' })).toBeInTheDocument();
    });

    it('unsubscribes from the events of the section too on unmount', async () => {
        mock.api.manga.status.mockResolvedValue(supported);
        const { unmount } = render(<App />);
        await screen.findByRole('button', { name: 'MANGA' });
        const before = mock.unsubscribers.length;
        unmount();
        expect(before).toBe(16);
        mock.unsubscribers.forEach((unsubscribe) => {
            expect(unsubscribe).toHaveBeenCalledTimes(1);
        });
    });
});

describe('App console shell', () => {
    function placeAt(element: HTMLElement, left: number, top: number): void {
        vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
            x: left,
            y: top,
            left,
            top,
            width: 90,
            height: 40,
            right: left + 90,
            bottom: top + 40,
            toJSON: () => {
                return {};
            }
        });
    }

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        window.localStorage.removeItem('pullwave-ui-sounds');
    });

    it('lays the top bar out as the start (menu, name with its wave), search, then the downloads, the sounds, the programs and the clock', async () => {
        render(<App />);
        await screen.findByRole('region', { name: 'Home' });
        const header = document.querySelector('.app__header') as HTMLElement;
        expect(header).toHaveClass('app__header', 'topbar');
        expect(Array.from(header.children).map((child) => {
            return child.className;
        })).toEqual(['topbar__start', 'global-search', 'topbar__end']);
        expect(Array.from((header.querySelector('.topbar__start') as HTMLElement).children).map((child) => {
            return child.className;
        })).toEqual(['topbar__button topbar__menu', 'brand']);
        const brand = header.querySelector('.brand') as HTMLElement;
        expect(within(brand).getByRole('heading', { level: 1, name: 'PULLWAVE' })).toHaveAttribute('data-text', 'PULLWAVE');
        expect(brand.querySelector('.brand__wave')).toHaveAttribute('aria-hidden', 'true');
        expect(brand.querySelectorAll('.brand__bar')).toHaveLength(5);
        const end = header.querySelector('.topbar__end') as HTMLElement;
        expect(Array.from(end.children).map((child) => {
            return child.className;
        })).toEqual(['downloads-indicator', 'topbar__button sound-toggle', 'binary-status', 'topbar__clock']);
    });

    it('shows the time in the language of the interface', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(2026, 10, 1, 14, 5, 0));
        mock.api.getSettings.mockResolvedValue({ ...DEFAULT_SETTINGS, language: 'pt' });
        render(<App />);
        const clock = await screen.findByLabelText('Hora: 14:05');
        expect(clock.tagName).toBe('TIME');
        expect(clock).toHaveAttribute('datetime', '14:05');
        expect(clock).toHaveTextContent('14:05');
    });

    it('draws a picture beside each section of the menu and the gear of the settings, hidden from the screen readers', async () => {
        mock.api.getAnimeStatus.mockResolvedValue(makeStatus());
        mock.api.manga.status.mockResolvedValue(makeMangaStatus());
        render(<App />);
        await screen.findByRole('button', { name: 'MANGA' });
        const nav = screen.getByRole('navigation', { name: 'Sections' });
        expect(nav).toHaveAttribute('id', 'side-nav');
        expect(nav).toHaveClass('tabs', 'tabs--main', 'sidenav');
        expect(nav).not.toHaveClass('sidenav--open');
        const buttons = within(nav).getAllByRole('button');
        expect(buttons.map((button) => {
            return button.querySelector('.tab__decoration svg')?.getAttribute('class') ?? null;
        })).toEqual(['section-icon section-icon--home', 'section-icon section-icon--downloads', 'section-icon section-icon--anime', 'section-icon section-icon--manga', 'section-icon section-icon--settings']);
        buttons.forEach((button) => {
            expect(button.querySelector('.tab__decoration')).toHaveAttribute('aria-hidden', 'true');
        });
        expect(screen.getByRole('button', { name: 'ANIME' })).toHaveTextContent(/^ANIME$/);
    });

    it('opens the menu with the button of the top bar and closes it with a choice, Esc or the shade', async () => {
        render(<App />);
        await screen.findByRole('region', { name: 'Home' });
        const menu = screen.getByRole('button', { name: 'Open the menu' });
        expect(menu).toHaveAttribute('aria-expanded', 'false');
        expect(menu).toHaveAttribute('aria-controls', 'side-nav');

        fireEvent.click(menu);
        const nav = screen.getByRole('navigation', { name: 'Sections' });
        expect(nav).toHaveClass('sidenav--open');
        expect(screen.getByRole('button', { name: 'Close the menu' })).toHaveAttribute('aria-expanded', 'true');
        expect(document.querySelector('.app')).toHaveClass('app--menu-open');
        // The section that is open takes the focus.
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'HOME' }));

        fireEvent.keyDown(document, { key: 'Escape' });
        expect(nav).not.toHaveClass('sidenav--open');

        fireEvent.click(screen.getByRole('button', { name: 'Open the menu' }));
        fireEvent.click(document.querySelector('.sidenav__scrim') as HTMLElement);
        expect(nav).not.toHaveClass('sidenav--open');

        fireEvent.click(screen.getByRole('button', { name: 'Open the menu' }));
        fireEvent.click(screen.getByRole('button', { name: 'VIDEO DOWNLOADER' }));
        expect(nav).not.toHaveClass('sidenav--open');
        expect(await screen.findByLabelText('Link 1')).toBeInTheDocument();
        expect(document.querySelector('.sidenav__scrim')).toBeNull();
    });

    it('says on the page which section it shows, for the theme', async () => {
        render(<App />);
        await openDownloader();
        expect(document.querySelector('.app__main')).toHaveAttribute('data-section', 'downloads');
        fireEvent.click(screen.getByRole('button', { name: 'SETTINGS (GLOBAL)' }));
        expect(document.querySelector('.app__main')).toHaveAttribute('data-section', 'settings');
        fireEvent.click(screen.getByRole('button', { name: 'HOME' }));
        expect(document.querySelector('.app__main')).toHaveAttribute('data-section', 'home');
    });

    it('moves the focus between the sections of the rail with the arrow keys', async () => {
        render(<App />);
        await screen.findByRole('region', { name: 'Home' });
        Element.prototype.scrollIntoView = vi.fn();
        const home = screen.getByRole('button', { name: 'HOME' });
        const downloads = screen.getByRole('button', { name: 'VIDEO DOWNLOADER' });
        placeAt(home, 0, 80);
        placeAt(downloads, 0, 140);
        home.focus();
        fireEvent.keyDown(home, { key: 'ArrowDown' });
        expect(document.activeElement).toBe(downloads);
        fireEvent.keyDown(downloads, { key: 'ArrowUp' });
        expect(document.activeElement).toBe(home);
    });

    it('turns the sounds of the navigation off and on with the button of the top bar, and remembers it', async () => {
        render(<App />);
        await screen.findByRole('region', { name: 'Home' });
        const on = screen.getByRole('button', { name: 'Turn the sounds off' });
        expect(on).toHaveAttribute('aria-pressed', 'true');
        fireEvent.click(on);
        expect(screen.getByRole('button', { name: 'Turn the sounds on' })).toHaveAttribute('aria-pressed', 'false');
        expect(window.localStorage.getItem('pullwave-ui-sounds')).toBe('off');
        fireEvent.click(screen.getByRole('button', { name: 'Turn the sounds on' }));
        expect(window.localStorage.getItem('pullwave-ui-sounds')).toBe('on');
    });

    it('changes the section with the bumpers of a gamepad, going round the visible ones', async () => {
        let pads: Gamepad[] = [];
        const frames: FrameRequestCallback[] = [];
        const originalRequest = window.requestAnimationFrame;
        window.requestAnimationFrame = (callback: FrameRequestCallback): number => {
            frames.push(callback);
            return frames.length;
        };
        Object.defineProperty(navigator, 'getGamepads', {
            configurable: true,
            value: () => {
                return pads;
            }
        });
        const holding = (index: number | null): Gamepad => {
            return {
                buttons: Array.from({ length: 17 }, (_, button) => {
                    return { pressed: button === index, touched: false, value: button === index ? 1 : 0 };
                }),
                axes: [0, 0]
            } as unknown as Gamepad;
        };
        const runFrame = (): void => {
            act(() => {
                frames.shift()?.(0);
            });
        };
        const press = (index: number): void => {
            pads = [holding(index)];
            runFrame();
            pads = [holding(null)];
            runFrame();
        };
        try {
            render(<App />);
            await screen.findByRole('region', { name: 'Home' });
            pads = [holding(null)];
            fireEvent(window, new Event('gamepadconnected'));
            press(5);
            expect(screen.getByRole('button', { name: 'VIDEO DOWNLOADER' })).toHaveAttribute('aria-current', 'page');
            press(5);
            expect(screen.getByRole('button', { name: 'SETTINGS (GLOBAL)' })).toHaveAttribute('aria-current', 'page');
            press(5);
            expect(screen.getByRole('button', { name: 'HOME' })).toHaveAttribute('aria-current', 'page');
            press(4);
            expect(screen.getByRole('button', { name: 'SETTINGS (GLOBAL)' })).toHaveAttribute('aria-current', 'page');
        } finally {
            window.requestAnimationFrame = originalRequest;
            Reflect.deleteProperty(navigator, 'getGamepads');
        }
    });
});
