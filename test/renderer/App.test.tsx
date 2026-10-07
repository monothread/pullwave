// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SETTINGS, THEME_STYLES } from '@shared/constants';
import { App } from '@renderer/App';
import { SETTINGS_ICON } from '@renderer/components/TabButton';
import { UNSUPPORTED_STATUS, useAnimeStore } from '@renderer/store/animeStore';
import { useAppStore } from '@renderer/store/appStore';
import { makeStatus } from '../helpers/animeFixtures';
import { APP_UPDATE_IDLE, installMockApi, makeJob, type MockApiHandle } from '../helpers/mockApi';

let mock: MockApiHandle;
const initial = useAppStore.getState();

beforeEach(() => {
    mock = installMockApi();
    useAnimeStore.setState({ status: UNSUPPORTED_STATUS, jobs: [], library: [], selection: null, playing: null });
    useAppStore.setState({ ...initial, tab: 'downloads', jobs: [], history: [], settings: DEFAULT_SETTINGS, binaries: null, notice: null, updating: false, appUpdate: { ...APP_UPDATE_IDLE, currentVersion: '' } });
});

describe('App', () => {
    it('shows a boot message until the binaries are checked, then the downloads tab', async () => {
        render(<App />);
        expect(screen.getByText('// BOOTING SYSTEMS…')).toBeInTheDocument();
        await waitFor(() => {
            expect(screen.getByLabelText('Link 1')).toBeInTheDocument();
        });
        expect(screen.queryByText('// BOOTING SYSTEMS…')).not.toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'PULLWAVE' })).toBeInTheDocument();
        expect(screen.getByText('yt-dlp 2026.08.19')).toBeInTheDocument();
    });

    it('marks the active tab and switches between sections', async () => {
        const user = userEvent.setup();
        render(<App />);
        await screen.findByLabelText('Link 1');
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
        await screen.findByLabelText('Link 1');
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
        await screen.findByLabelText('Link 1');
        act(() => {
            mock.emitJobUpdate(makeJob({ id: 'x', title: 'Pushed Video' }));
        });
        expect(screen.getByRole('heading', { name: 'Pushed Video' })).toBeInTheDocument();
    });

    it('shows the update banner when a new version is pushed', async () => {
        render(<App />);
        await screen.findByLabelText('Link 1');
        expect(screen.queryByText('Version 0.2.0 is available.')).not.toBeInTheDocument();
        act(() => {
            mock.emitAppUpdateState({ ...APP_UPDATE_IDLE, status: 'available', version: '0.2.0' });
        });
        expect(screen.getByText('Version 0.2.0 is available.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'UPDATE TO 0.2.0' })).toBeInTheDocument();
    });

    it('unsubscribes from events on unmount', async () => {
        const { unmount } = render(<App />);
        await screen.findByLabelText('Link 1');
        unmount();
        expect(mock.unsubscribers).toHaveLength(5);
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
            expect(mock.unsubscribers).toHaveLength(5);
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

    it.each(['cyberpunk', 'synthwave', 'terminal', 'dark', 'tokyo-night', 'nord', 'dracula', 'gruvbox', 'amoled', 'high-contrast', 'light', 'sakura'] as const)('applies the %s theme, with its style, from the stored settings', async (theme) => {
        mock.api.getSettings.mockResolvedValue({ ...DEFAULT_SETTINGS, theme });
        render(<App />);
        await screen.findByLabelText('Link 1');
        expect(document.documentElement.dataset.theme).toBe(theme);
        expect(document.documentElement.dataset.themeStyle).toBe(THEME_STYLES[theme]);
    });

    it('uses device by default and follows a dark system', async () => {
        prefersDark = true;
        render(<App />);
        await screen.findByLabelText('Link 1');
        expect(DEFAULT_SETTINGS.theme).toBe('device');
        expect(document.documentElement.dataset.theme).toBe('dark');
    });

    it('uses device by default and follows a light system', async () => {
        render(<App />);
        await screen.findByLabelText('Link 1');
        expect(document.documentElement.dataset.theme).toBe('light');
    });

    it('follows the system when it switches between light and dark while open', async () => {
        render(<App />);
        await screen.findByLabelText('Link 1');
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

    it.each(['cyberpunk', 'synthwave', 'terminal', 'dark', 'tokyo-night', 'nord', 'dracula', 'gruvbox', 'amoled', 'high-contrast', 'light', 'sakura'] as const)('does not follow the system with the %s theme', async (theme) => {
        mock.api.getSettings.mockResolvedValue({ ...DEFAULT_SETTINGS, theme });
        render(<App />);
        await screen.findByLabelText('Link 1');
        expect(listeners.size).toBe(0);
    });

    it('stops following the system once a fixed theme is chosen', async () => {
        const user = userEvent.setup();
        render(<App />);
        await screen.findByLabelText('Link 1');
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
        await screen.findByLabelText('Link 1');
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
        await screen.findByLabelText('Link 1');
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
        await screen.findByLabelText('Link 1');
        expect(document.documentElement.dataset.theme).toBe('nord');
        expect(window.localStorage.getItem('cyber-dl-theme')).toBe('nord');
    });

    it('does not make a neon follow the mouse in the cyberpunk theme', async () => {
        mock.api.getSettings.mockResolvedValue({ ...DEFAULT_SETTINGS, theme: 'cyberpunk' });
        render(<App />);
        await screen.findByLabelText('Link 1');
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
        await screen.findByLabelText('Link 1');
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
        await screen.findByLabelText('Link 1');
        expect(screen.queryByRole('button', { name: 'ANIME' })).not.toBeInTheDocument();
        expect(within(screen.getByRole('navigation', { name: 'Sections' })).getAllByRole('button')).toHaveLength(2);
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
        ).toEqual(['VIDEO DOWNLOADER', 'ANIME', 'SETTINGS (GLOBAL)']);
        // The settings are a gear at the right end of the bar, not a word.
        const settings = screen.getByRole('button', { name: 'SETTINGS (GLOBAL)' });
        expect(settings).toHaveClass('tab--icon');
        expect(settings).toHaveTextContent(SETTINGS_ICON);
        expect(settings).not.toHaveTextContent('SETTINGS');
        expect(settings).toHaveAttribute('title', 'SETTINGS (GLOBAL)');
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

    it('opens on the anime section when the settings say so', async () => {
        mock.api.getSettings.mockResolvedValue({ ...DEFAULT_SETTINGS, startTab: 'anime' });
        mock.api.getAnimeStatus.mockResolvedValue(supported);
        render(<App />);
        expect(await screen.findByRole('region', { name: 'Anime' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'ANIME' })).toHaveAttribute('aria-current', 'page');
        expect(screen.queryByLabelText('Link 1')).not.toBeInTheDocument();
    });

    it('opens on the video downloader when the settings say anime but the section does not exist', async () => {
        mock.api.getSettings.mockResolvedValue({ ...DEFAULT_SETTINGS, startTab: 'anime' });
        render(<App />);
        expect(await screen.findByLabelText('Link 1')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'VIDEO DOWNLOADER' })).toHaveAttribute('aria-current', 'page');
        expect(useAppStore.getState().tab).toBe('downloads');
    });

    it('loads the library and the jobs of the section', async () => {
        mock.api.getAnimeStatus.mockResolvedValue(supported);
        render(<App />);
        await screen.findByRole('button', { name: 'ANIME' });
        expect(mock.api.listAnimeLibrary).toHaveBeenCalledTimes(1);
        expect(mock.api.listAnimeJobs).toHaveBeenCalledTimes(1);
    });

    it('unsubscribes from the events of the section too on unmount', async () => {
        mock.api.getAnimeStatus.mockResolvedValue(supported);
        const { unmount } = render(<App />);
        await screen.findByRole('button', { name: 'ANIME' });
        unmount();
        expect(mock.unsubscribers).toHaveLength(10);
        mock.unsubscribers.forEach((unsubscribe) => {
            expect(unsubscribe).toHaveBeenCalledTimes(1);
        });
    });
});
