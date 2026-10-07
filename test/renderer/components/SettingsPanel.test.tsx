// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { AUTOSAVE_DELAY_MS } from '@renderer/hooks/useAutoSaveSettings';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { SettingsPanel } from '@renderer/components/SettingsPanel';
import { UNSUPPORTED_STATUS, useAnimeStore } from '@renderer/store/animeStore';
import { INITIAL_APP_UPDATE, useAppStore } from '@renderer/store/appStore';
import { ANI_CLI_INFO, makeAnime, makeEpisode, makeStatus } from '../../helpers/animeFixtures';
import { APP_UPDATE_IDLE, installMockApi, type MockApiHandle } from '../../helpers/mockApi';

let mock: MockApiHandle;
const initial = useAppStore.getState();

beforeEach(() => {
    vi.useFakeTimers();
    mock = installMockApi();
    useAnimeStore.setState({ status: UNSUPPORTED_STATUS, library: [], migration: null });
    useAppStore.setState({ ...initial, settings: DEFAULT_SETTINGS, notice: null, appUpdate: INITIAL_APP_UPDATE, traySupport: null, browsers: null });
});

afterEach(() => {
    vi.useRealTimers();
});

async function advance(ms: number): Promise<void> {
    await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
    });
}

async function flushPromises(): Promise<void> {
    await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
    });
}

function type(label: string, value: string): void {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe('SettingsPanel layout', () => {
    it('renders the sections of the whole app with the stored values', () => {
        render(<SettingsPanel scope="global" />);
        ['APPEARANCE & WINDOW', 'APP UPDATES'].forEach((legend) => {
            expect(screen.getByText(legend)).toBeInTheDocument();
        });
        ['OUTPUT', 'QUALITY & FORMAT', 'PLAYLISTS & SUBTITLES', 'LIVE STREAMS', 'BROWSER COOKIES', 'YT-DLP', 'ADVANCED', 'ANIME'].forEach((legend) => {
            expect(screen.queryByText(legend, { selector: 'legend' })).not.toBeInTheDocument();
        });
        expect(screen.getByLabelText('Theme')).toHaveValue('device');
        expect(screen.getByLabelText('Language')).toHaveValue('device');
        expect(screen.getByLabelText('Keep running in the system tray when the window is closed')).not.toBeChecked();
        expect(screen.getByLabelText('Check for updates on startup')).toBeChecked();
        expect(screen.queryByLabelText('Download folder')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Anime download folder')).not.toBeInTheDocument();
    });

    it('renders the sections of the video downloader with the stored values', () => {
        render(<SettingsPanel scope="downloads" />);
        ['OUTPUT', 'QUALITY & FORMAT', 'PLAYLISTS & SUBTITLES', 'LIVE STREAMS', 'BROWSER COOKIES', 'YT-DLP', 'ADVANCED'].forEach((legend) => {
            expect(screen.getByText(legend)).toBeInTheDocument();
        });
        ['APPEARANCE & WINDOW', 'APP UPDATES', 'ANIME'].forEach((legend) => {
            expect(screen.queryByText(legend)).not.toBeInTheDocument();
        });
        expect(screen.queryByLabelText('Theme')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Language')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Check for updates on startup')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Anime download folder')).not.toBeInTheDocument();
        expect(screen.getByLabelText('Download folder')).toHaveValue('');
        expect(screen.getByLabelText('Max title length (characters)')).toHaveValue(80);
        expect(screen.getByLabelText('Video quality')).toHaveValue('best');
        expect(screen.getByLabelText('Video container')).toHaveValue('mp4');
        expect(screen.getByLabelText('Audio only')).not.toBeChecked();
        expect(screen.getByLabelText('Audio format')).toHaveValue('mp3');
        expect(screen.getByLabelText('Use cookies from my browser')).not.toBeChecked();
        expect(screen.getByLabelText('Browser')).toHaveValue('');
        expect(screen.queryByLabelText('Simultaneous downloads')).not.toBeInTheDocument();
        expect(screen.queryByText('Simultaneous downloads')).not.toBeInTheDocument();
    });

    it('renders the section of the anime with the stored values and nothing else', () => {
        useAnimeStore.setState({ status: makeStatus() });
        render(<SettingsPanel scope="anime" />);
        expect(screen.getByText('ANIME')).toBeInTheDocument();
        ['APPEARANCE & WINDOW', 'APP UPDATES', 'OUTPUT', 'QUALITY & FORMAT', 'PLAYLISTS & SUBTITLES', 'LIVE STREAMS', 'BROWSER COOKIES', 'YT-DLP', 'ADVANCED'].forEach((legend) => {
            expect(screen.queryByText(legend)).not.toBeInTheDocument();
        });
        expect(screen.getByLabelText('Anime download folder')).toHaveValue('');
        expect(screen.getByLabelText('Anime quality')).toHaveValue('best');
        expect(screen.getByLabelText('Anime audio')).toHaveValue('sub');
        expect(screen.queryByLabelText('Download folder')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Theme')).not.toBeInTheDocument();
    });

    it.each(['global', 'downloads', 'anime'] as const)('has no save button and explains that changes are saved automatically in the %s settings', (scope) => {
        useAnimeStore.setState({ status: makeStatus() });
        render(<SettingsPanel scope={scope} />);
        expect(screen.queryByRole('button', { name: 'SAVE SETTINGS' })).not.toBeInTheDocument();
        expect(screen.getByText('Changes are saved automatically.')).toBeInTheDocument();
    });

    it('lists the resolution options with readable labels', () => {
        render(<SettingsPanel scope="downloads" />);
        const options = Array.from(screen.getByLabelText('Video quality').querySelectorAll('option')).map((option) => {
            return option.textContent;
        });
        expect(options).toEqual(['Best available', 'Up to 2160p', 'Up to 1440p', 'Up to 1080p', 'Up to 720p', 'Up to 480p']);
    });
});

describe('SettingsPanel start tab', () => {
    it('lists the video downloader and the anime, opening on the video downloader by default, with its hint', () => {
        render(<SettingsPanel scope="global" />);
        const select = screen.getByLabelText('Open on');
        expect(select).toHaveValue('downloads');
        const options = Array.from(select.querySelectorAll('option')).map((option) => {
            return [option.getAttribute('value'), option.textContent];
        });
        expect(options).toEqual([
            ['downloads', 'VIDEO DOWNLOADER'],
            ['anime', 'ANIME']
        ]);
        expect(screen.getByText('The tab the app shows when it starts. If the anime section is not available, the video downloader opens.')).toBeInTheDocument();
    });

    it('shows the one that is saved', () => {
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, startTab: 'anime' } });
        render(<SettingsPanel scope="global" />);
        expect(screen.getByLabelText('Open on')).toHaveValue('anime');
    });

    it.each(['downloads', 'anime'] as const)('saves right away when the start tab changes to "%s"', async (startTab) => {
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, startTab: startTab === 'anime' ? 'downloads' : 'anime' } });
        render(<SettingsPanel scope="global" />);
        fireEvent.change(screen.getByLabelText('Open on'), { target: { value: startTab } });
        await flushPromises();
        expect(mock.api.saveSettings).toHaveBeenCalledTimes(1);
        expect(mock.api.saveSettings).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, startTab });
    });

    it('is only in the global settings', () => {
        render(<SettingsPanel scope="anime" />);
        expect(screen.queryByLabelText('Open on')).not.toBeInTheDocument();
    });
});

describe('SettingsPanel language', () => {
    it('lists "device" and every language named in itself', () => {
        render(<SettingsPanel scope="global" />);
        const select = screen.getByLabelText('Language');
        expect(select).toHaveValue('device');
        const options = Array.from(select.querySelectorAll('option')).map((option) => {
            return [option.getAttribute('value'), option.textContent];
        });
        expect(options).toEqual([
            ['device', 'Device (follows the system)'],
            ['en', 'English'],
            ['pt', 'Português'],
            ['es', 'Español'],
            ['zh', '中文'],
            ['ja', '日本語']
        ]);
        expect(screen.getByText('Device uses the language of your system when it is available, otherwise English.')).toBeInTheDocument();
    });

    it.each(['en', 'pt', 'es', 'zh', 'ja'] as const)('saves right away when the language changes to "%s"', async (language) => {
        render(<SettingsPanel scope="global" />);
        fireEvent.change(screen.getByLabelText('Language'), { target: { value: language } });
        await flushPromises();
        expect(mock.api.saveSettings).toHaveBeenCalledTimes(1);
        expect(mock.api.saveSettings).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, language });
    });

    it('renders the sections of the whole app in the saved language', () => {
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, language: 'pt' } });
        render(<SettingsPanel scope="global" />);
        ['APARÊNCIA E JANELA', 'ATUALIZAÇÕES DO APLICATIVO'].forEach((legend) => {
            expect(screen.getByText(legend)).toBeInTheDocument();
        });
        expect(screen.getByLabelText('Idioma')).toHaveValue('pt');
        expect(screen.getByLabelText('Tema')).toBeInTheDocument();
        expect(screen.getByText('As alterações são salvas automaticamente.')).toBeInTheDocument();
    });

    it('renders the sections of the video downloader in the saved language', () => {
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, language: 'pt' } });
        render(<SettingsPanel scope="downloads" />);
        ['SAÍDA', 'QUALIDADE E FORMATO', 'PLAYLISTS E LEGENDAS', 'TRANSMISSÕES AO VIVO', 'COOKIES DO NAVEGADOR', 'YT-DLP', 'AVANÇADO'].forEach((legend) => {
            expect(screen.getByText(legend)).toBeInTheDocument();
        });
        expect(screen.getByText('As alterações são salvas automaticamente.')).toBeInTheDocument();
        const resolutions = Array.from(screen.getByLabelText('Qualidade do vídeo').querySelectorAll('option')).map((option) => {
            return option.textContent;
        });
        expect(resolutions).toEqual(['A melhor disponível', 'Até 2160p', 'Até 1440p', 'Até 1080p', 'Até 720p', 'Até 480p']);
    });

    it('translates the browser warning', async () => {
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, language: 'es', useBrowserCookies: true } });
        mock.api.listBrowsers.mockResolvedValue([]);
        render(<SettingsPanel scope="downloads" />);
        await flushPromises();
        expect(screen.getByText('No se encontró ningún navegador con cookies guardadas en este sistema.')).toBeInTheDocument();
    });

    it('translates the tray warning', async () => {
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, language: 'es', closeToTray: true } });
        mock.api.getTraySupport.mockResolvedValue({ available: false, reason: 'Sin bandeja.' });
        render(<SettingsPanel scope="global" />);
        await flushPromises();
        expect(screen.getByText('Sin bandeja.')).toBeInTheDocument();
    });

    it('translates the yt-dlp status', () => {
        useAppStore.setState({
            settings: { ...DEFAULT_SETTINGS, language: 'ja' },
            binaries: { ytdlp: { found: true, path: '/bin/yt-dlp', version: '2026.08.19', source: 'bundled' }, ffmpeg: { found: false, path: '', version: null, source: 'system' } }
        });
        render(<SettingsPanel scope="downloads" />);
        expect(screen.getByText('インストール済みのバージョン：2026.08.19')).toBeInTheDocument();
    });

    it('translates the app update summary', () => {
        useAppStore.setState({
            settings: { ...DEFAULT_SETTINGS, language: 'ja' },
            appUpdate: { ...INITIAL_APP_UPDATE, status: 'not-available', currentVersion: '0.4.1' }
        });
        render(<SettingsPanel scope="global" />);
        expect(screen.getByText('最新バージョンです（0.4.1）。')).toBeInTheDocument();
    });
});

describe('SettingsPanel auto-save of toggles and selects (immediate)', () => {
    it.each([
        ['Restrict file names (ASCII only)', 'restrictFilenames'],
        ['Audio only', 'audioOnly'],
        ['Use cookies from my browser', 'useBrowserCookies'],
        ['Download whole playlist', 'downloadPlaylist'],
        ['Download subtitles', 'writeSubtitles'],
        ['Include auto-generated subtitles', 'autoSubtitles'],
        ['Embed subtitles in the video', 'embedSubtitles'],
        ['Record live streams from the start', 'liveFromStart'],
        ['Wait for scheduled live streams to start', 'waitForLive']
    ] as const)('saves right away when "%s" is toggled', async (label, key) => {
        render(<SettingsPanel scope="downloads" />);
        fireEvent.click(screen.getByLabelText(label));
        await flushPromises();
        expect(mock.api.saveSettings).toHaveBeenCalledTimes(1);
        expect(mock.api.saveSettings).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, [key]: true });
    });

    it('saves right away when "Keep running in the system tray when the window is closed" is toggled', async () => {
        render(<SettingsPanel scope="global" />);
        fireEvent.click(screen.getByLabelText('Keep running in the system tray when the window is closed'));
        await flushPromises();
        expect(mock.api.saveSettings).toHaveBeenCalledTimes(1);
        expect(mock.api.saveSettings).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, closeToTray: true });
    });

    it('has the partial file cleanup on by default and saves right away when it is turned off', async () => {
        render(<SettingsPanel scope="downloads" />);
        const toggle = screen.getByLabelText('Delete partial files when a download fails or is cancelled');
        expect(toggle).toBeChecked();
        expect(screen.getByText('Live recordings are always kept, because they can still be saved. A retry starts over once the partial file is gone.')).toBeInTheDocument();
        fireEvent.click(toggle);
        await flushPromises();
        expect(mock.api.saveSettings).toHaveBeenCalledTimes(1);
        expect(mock.api.saveSettings).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, deletePartialsOnFailure: false });
    });

    it('saves right away when "Check for updates on startup" is turned off', async () => {
        render(<SettingsPanel scope="global" />);
        fireEvent.click(screen.getByLabelText('Check for updates on startup'));
        await flushPromises();
        expect(mock.api.saveSettings).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, checkUpdatesOnStart: false });
    });

    it.each([
        ['Video quality', '1080', 'maxResolution'],
        ['Video container', 'webm', 'videoContainer'],
        ['Audio format', 'opus', 'audioFormat']
    ] as const)('saves right away when "%s" changes', async (label, value, key) => {
        render(<SettingsPanel scope="downloads" />);
        fireEvent.change(screen.getByLabelText(label), { target: { value } });
        await flushPromises();
        expect(mock.api.saveSettings).toHaveBeenCalledTimes(1);
        expect(mock.api.saveSettings).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, [key]: value });
    });

    it('shows the saved status after saving', async () => {
        render(<SettingsPanel scope="downloads" />);
        fireEvent.click(screen.getByLabelText('Audio only'));
        await flushPromises();
        expect(screen.getByText('All changes saved.')).toBeInTheDocument();
    });
});

describe('SettingsPanel auto-save of text and number fields (2 s after typing)', () => {
    it.each([
        ['Download folder', '/media', 'downloadDir', '/media'],
        ['Max title length (characters)', '60', 'maxTitleLength', 60],
        ['Browser profile (optional)', 'Profile 1', 'cookiesProfile', 'Profile 1'],
        ['Subtitle languages', 'fr', 'subtitleLangs', 'fr'],
        ['Speed limit', '2M', 'rateLimit', '2M'],
        ['yt-dlp path', '/opt/yt-dlp', 'ytdlpPath', '/opt/yt-dlp'],
        ['ffmpeg path', '/opt/ffmpeg', 'ffmpegPath', '/opt/ffmpeg'],
        ['JavaScript runtime', 'node', 'jsRuntime', 'node'],
        ['Extra yt-dlp arguments', '--no-mtime', 'extraArgs', '--no-mtime']
    ] as const)('saves "%s" only after the delay', async (label, typed, key, expected) => {
        render(<SettingsPanel scope="downloads" />);
        type(label, typed);
        expect(screen.getByText('Unsaved changes…')).toBeInTheDocument();
        await advance(AUTOSAVE_DELAY_MS - 1);
        expect(mock.api.saveSettings).not.toHaveBeenCalled();
        await advance(1);
        expect(mock.api.saveSettings).toHaveBeenCalledTimes(1);
        expect(mock.api.saveSettings).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, [key]: expected });
        expect(screen.getByText('All changes saved.')).toBeInTheDocument();
    });

    it('waits for the user to stop typing and saves a single time with the final value', async () => {
        render(<SettingsPanel scope="downloads" />);
        type('Download folder', '/m');
        await advance(1500);
        type('Download folder', '/media');
        await advance(1500);
        expect(mock.api.saveSettings).not.toHaveBeenCalled();
        await advance(500);
        expect(mock.api.saveSettings).toHaveBeenCalledTimes(1);
        expect(mock.api.saveSettings).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, downloadDir: '/media' });
    });

    it('shows the sanitized value returned by the save', async () => {
        mock.api.saveSettings.mockResolvedValueOnce({ ...DEFAULT_SETTINGS, maxTitleLength: 200 });
        render(<SettingsPanel scope="downloads" />);
        type('Max title length (characters)', '9999');
        expect(screen.getByLabelText('Max title length (characters)')).toHaveValue(9999);
        await advance(AUTOSAVE_DELAY_MS);
        expect(screen.getByLabelText('Max title length (characters)')).toHaveValue(200);
    });

    it('updates the store settings after saving', async () => {
        render(<SettingsPanel scope="downloads" />);
        type('Download folder', '/media');
        await advance(AUTOSAVE_DELAY_MS);
        expect(useAppStore.getState().settings.downloadDir).toBe('/media');
    });

    it('saves pending edits when the panel is closed before the delay ends', () => {
        const { unmount } = render(<SettingsPanel scope="downloads" />);
        type('Download folder', '/media');
        unmount();
        expect(mock.api.saveSettings).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, downloadDir: '/media' });
    });

    it('shows an error status when saving fails', async () => {
        mock.api.saveSettings.mockRejectedValueOnce(new Error('disk full'));
        render(<SettingsPanel scope="downloads" />);
        fireEvent.click(screen.getByLabelText('Audio only'));
        await flushPromises();
        expect(screen.getByText('Could not save the settings.')).toBeInTheDocument();
    });

    it('keeps every edit when several fields change in a row', async () => {
        render(<SettingsPanel scope="downloads" />);
        fireEvent.click(screen.getByLabelText('Audio only'));
        type('Download folder', '/media');
        fireEvent.change(screen.getByLabelText('Audio format'), { target: { value: 'opus' } });
        await advance(AUTOSAVE_DELAY_MS);
        expect(mock.api.saveSettings).toHaveBeenLastCalledWith({
            ...DEFAULT_SETTINGS,
            audioOnly: true,
            downloadDir: '/media',
            audioFormat: 'opus'
        });
    });
});

describe('SettingsPanel folder chooser', () => {
    it('fills the folder from the directory chooser and saves it right away', async () => {
        mock.api.chooseDirectory.mockResolvedValueOnce('/picked/dir');
        render(<SettingsPanel scope="downloads" />);
        fireEvent.click(screen.getByRole('button', { name: 'BROWSE' }));
        await flushPromises();
        expect(screen.getByLabelText('Download folder')).toHaveValue('/picked/dir');
        expect(mock.api.saveSettings).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, downloadDir: '/picked/dir' });
    });

    it('keeps the folder unchanged and does not save when the chooser is cancelled', async () => {
        mock.api.chooseDirectory.mockResolvedValueOnce(null);
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, downloadDir: '/keep' } });
        render(<SettingsPanel scope="downloads" />);
        fireEvent.click(screen.getByRole('button', { name: 'BROWSE' }));
        await flushPromises();
        expect(mock.api.chooseDirectory).toHaveBeenCalledTimes(1);
        expect(screen.getByLabelText('Download folder')).toHaveValue('/keep');
        expect(mock.api.saveSettings).not.toHaveBeenCalled();
    });
});

describe('SettingsPanel app updates', () => {
    it('shows the startup update check enabled by default', () => {
        render(<SettingsPanel scope="global" />);
        expect(screen.getByLabelText('Check for updates on startup')).toBeChecked();
    });

    it('shows the app update summary and checks for updates on demand', async () => {
        useAppStore.setState({ appUpdate: { ...APP_UPDATE_IDLE, currentVersion: '0.1.0' } });
        render(<SettingsPanel scope="global" />);
        expect(screen.getByText('Current version: 0.1.0')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'CHECK FOR UPDATES' }));
        await flushPromises();
        expect(mock.api.checkAppUpdate).toHaveBeenCalledTimes(1);
    });

    it.each(['checking', 'downloading'] as const)('disables the check button while %s', (status) => {
        useAppStore.setState({ appUpdate: { ...APP_UPDATE_IDLE, status, version: '0.2.0' } });
        render(<SettingsPanel scope="global" />);
        expect(screen.getByRole('button', { name: 'CHECK FOR UPDATES' })).toBeDisabled();
    });

    it('offers the update action when a new version is available', async () => {
        useAppStore.setState({ appUpdate: { ...APP_UPDATE_IDLE, status: 'available', version: '0.2.0' } });
        render(<SettingsPanel scope="global" />);
        expect(screen.getByText('Version 0.2.0 is available.')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'UPDATE TO 0.2.0' }));
        await flushPromises();
        expect(mock.api.downloadAppUpdate).toHaveBeenCalledTimes(1);
    });
});

describe('SettingsPanel scopes and what they load', () => {
    it.each(['global', 'anime'] as const)('does not look for browsers in the %s settings', async (scope) => {
        useAnimeStore.setState({ status: makeStatus() });
        render(<SettingsPanel scope={scope} />);
        await flushPromises();
        expect(mock.api.listBrowsers).not.toHaveBeenCalled();
    });

    it.each(['downloads', 'anime'] as const)('does not check the system tray in the %s settings', async (scope) => {
        useAnimeStore.setState({ status: makeStatus() });
        render(<SettingsPanel scope={scope} />);
        await flushPromises();
        expect(mock.api.getTraySupport).not.toHaveBeenCalled();
    });

    it('shows the same saved settings in every scope', () => {
        useAnimeStore.setState({ status: makeStatus() });
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, theme: 'dark', downloadDir: '/media', animeDownloadDir: '/anime' } });
        const global = render(<SettingsPanel scope="global" />);
        expect(screen.getByLabelText('Theme')).toHaveValue('dark');
        global.unmount();
        const downloads = render(<SettingsPanel scope="downloads" />);
        expect(screen.getByLabelText('Download folder')).toHaveValue('/media');
        downloads.unmount();
        render(<SettingsPanel scope="anime" />);
        expect(screen.getByLabelText('Anime download folder')).toHaveValue('/anime');
    });

    it('keeps what was edited in one scope when another one is shown next', async () => {
        render(<SettingsPanel scope="downloads" />).unmount();
        const first = render(<SettingsPanel scope="downloads" />);
        type('Download folder', '/media');
        first.unmount();
        expect(mock.api.saveSettings).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, downloadDir: '/media' });
        await flushPromises();
        render(<SettingsPanel scope="global" />);
        fireEvent.change(screen.getByLabelText('Theme'), { target: { value: 'dark' } });
        await flushPromises();
        expect(mock.api.saveSettings).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, downloadDir: '/media', theme: 'dark' });
    });
});

describe('SettingsPanel browser cookies', () => {
    const ORIGIN = {
        label: 'Brave Origin',
        engine: 'brave' as const,
        dataDir: '/home/a/.config/BraveSoftware/Brave-Origin',
        profiles: [
            { id: 'Default', name: 'Personal' },
            { id: 'Profile 1', name: 'Work' }
        ]
    };
    const FIREFOX = {
        label: 'Firefox',
        engine: 'firefox' as const,
        dataDir: '/home/a/.mozilla/firefox',
        profiles: [{ id: 'abc.default-release', name: 'abc.default-release' }]
    };

    function optionTexts(): Array<string | null> {
        return Array.from(screen.getByLabelText('Browser').querySelectorAll('option')).map((option) => {
            return option.textContent;
        });
    }

    it('loads the detected browsers when opened', async () => {
        render(<SettingsPanel scope="downloads" />);
        await flushPromises();
        expect(mock.api.listBrowsers).toHaveBeenCalledTimes(1);
        expect(mock.api.listBrowsers).toHaveBeenCalledWith(false);
    });

    it('lists only the detected browsers, with a placeholder while none is chosen', async () => {
        mock.api.listBrowsers.mockResolvedValue([FIREFOX, ORIGIN]);
        render(<SettingsPanel scope="downloads" />);
        await flushPromises();
        expect(optionTexts()).toEqual(['Choose a browser…', 'Firefox', 'Brave Origin']);
        expect(screen.getByLabelText('Browser')).toHaveValue('');
    });

    it('selects the saved browser and drops the placeholder', async () => {
        mock.api.listBrowsers.mockResolvedValue([FIREFOX, ORIGIN]);
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, useBrowserCookies: true, cookiesBrowser: 'brave', cookiesBrowserDir: ORIGIN.dataDir } });
        render(<SettingsPanel scope="downloads" />);
        await flushPromises();
        expect(optionTexts()).toEqual(['Firefox', 'Brave Origin']);
        expect(screen.getByLabelText('Browser')).toHaveValue(ORIGIN.dataDir);
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('saves the engine and the folder together, right away, when a browser is chosen', async () => {
        mock.api.listBrowsers.mockResolvedValue([FIREFOX, ORIGIN]);
        render(<SettingsPanel scope="downloads" />);
        await flushPromises();
        fireEvent.change(screen.getByLabelText('Browser'), { target: { value: ORIGIN.dataDir } });
        await flushPromises();
        expect(mock.api.saveSettings).toHaveBeenCalledTimes(1);
        expect(mock.api.saveSettings).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, cookiesBrowser: 'brave', cookiesBrowserDir: ORIGIN.dataDir, cookiesProfile: '' });
    });

    it('clears the saved profile when another browser is chosen', async () => {
        mock.api.listBrowsers.mockResolvedValue([FIREFOX, ORIGIN]);
        useAppStore.setState({
            settings: { ...DEFAULT_SETTINGS, useBrowserCookies: true, cookiesBrowser: 'brave', cookiesBrowserDir: ORIGIN.dataDir, cookiesProfile: 'Profile 1' }
        });
        render(<SettingsPanel scope="downloads" />);
        await flushPromises();
        fireEvent.change(screen.getByLabelText('Browser'), { target: { value: FIREFOX.dataDir } });
        await flushPromises();
        expect(mock.api.saveSettings).toHaveBeenCalledWith({
            ...DEFAULT_SETTINGS,
            useBrowserCookies: true,
            cookiesBrowser: 'firefox',
            cookiesBrowserDir: FIREFOX.dataDir,
            cookiesProfile: ''
        });
    });

    function profileOptionTexts(): Array<string | null> {
        return Array.from(screen.getByLabelText('Browser profile (optional)').querySelectorAll('option')).map((option) => {
            return option.textContent;
        });
    }

    it('shows the profiles of the chosen browser as a menu, with the names the user gave them', async () => {
        mock.api.listBrowsers.mockResolvedValue([ORIGIN]);
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, cookiesBrowser: 'brave', cookiesBrowserDir: ORIGIN.dataDir } });
        render(<SettingsPanel scope="downloads" />);
        await flushPromises();
        expect(screen.getByLabelText('Browser profile (optional)').tagName).toBe('SELECT');
        expect(profileOptionTexts()).toEqual(['Automatic (most recently used)', 'Personal (Default)', 'Work (Profile 1)']);
        expect(screen.getByLabelText('Browser profile (optional)')).toHaveValue('');
    });

    it('shows a profile whose name is its folder only once', async () => {
        mock.api.listBrowsers.mockResolvedValue([FIREFOX]);
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, cookiesBrowser: 'firefox', cookiesBrowserDir: FIREFOX.dataDir } });
        render(<SettingsPanel scope="downloads" />);
        await flushPromises();
        expect(profileOptionTexts()).toEqual(['Automatic (most recently used)', 'abc.default-release']);
    });

    it('saves the chosen profile right away', async () => {
        mock.api.listBrowsers.mockResolvedValue([ORIGIN]);
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, cookiesBrowser: 'brave', cookiesBrowserDir: ORIGIN.dataDir } });
        render(<SettingsPanel scope="downloads" />);
        await flushPromises();
        fireEvent.change(screen.getByLabelText('Browser profile (optional)'), { target: { value: 'Profile 1' } });
        await flushPromises();
        expect(mock.api.saveSettings).toHaveBeenCalledTimes(1);
        expect(mock.api.saveSettings).toHaveBeenCalledWith({
            ...DEFAULT_SETTINGS,
            cookiesBrowser: 'brave',
            cookiesBrowserDir: ORIGIN.dataDir,
            cookiesProfile: 'Profile 1'
        });
    });

    it('keeps a saved profile that no longer exists in the menu and marks it', async () => {
        mock.api.listBrowsers.mockResolvedValue([ORIGIN]);
        useAppStore.setState({
            settings: { ...DEFAULT_SETTINGS, cookiesBrowser: 'brave', cookiesBrowserDir: ORIGIN.dataDir, cookiesProfile: 'Profile 9' }
        });
        render(<SettingsPanel scope="downloads" />);
        await flushPromises();
        expect(profileOptionTexts()).toEqual(['Automatic (most recently used)', 'Personal (Default)', 'Work (Profile 1)', 'Profile 9 (not found)']);
        expect(screen.getByLabelText('Browser profile (optional)')).toHaveValue('Profile 9');
    });

    it('keeps a text field for the profile while no detected browser is chosen', async () => {
        mock.api.listBrowsers.mockResolvedValue([ORIGIN]);
        render(<SettingsPanel scope="downloads" />);
        await flushPromises();
        expect(screen.getByLabelText('Browser profile (optional)').tagName).toBe('INPUT');
    });

    it('keeps a text field for the profile when the chosen browser reports no profile', async () => {
        mock.api.listBrowsers.mockResolvedValue([{ ...FIREFOX, profiles: [] }]);
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, cookiesBrowser: 'firefox', cookiesBrowserDir: FIREFOX.dataDir } });
        render(<SettingsPanel scope="downloads" />);
        await flushPromises();
        expect(screen.getByLabelText('Browser profile (optional)').tagName).toBe('INPUT');
    });

    it('warns that the saved browser was not found when the cookies are on', async () => {
        mock.api.listBrowsers.mockResolvedValue([FIREFOX]);
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, useBrowserCookies: true, cookiesBrowser: 'brave' } });
        render(<SettingsPanel scope="downloads" />);
        await flushPromises();
        expect(screen.getByRole('alert')).toHaveTextContent('The saved browser (brave) was not found on this system. Choose one of the detected browsers.');
    });

    it('warns when no browser is found at all', async () => {
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, useBrowserCookies: true } });
        render(<SettingsPanel scope="downloads" />);
        await flushPromises();
        expect(screen.getByRole('alert')).toHaveTextContent('No browser with saved cookies was found on this system.');
        expect(optionTexts()).toEqual(['Choose a browser…']);
    });

    it('does not warn while the cookies are off', async () => {
        mock.api.listBrowsers.mockResolvedValue([FIREFOX]);
        render(<SettingsPanel scope="downloads" />);
        await flushPromises();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('scans again and shows the new browsers when RESCAN BROWSERS is clicked', async () => {
        mock.api.listBrowsers.mockResolvedValueOnce([FIREFOX]).mockResolvedValueOnce([FIREFOX, ORIGIN]);
        render(<SettingsPanel scope="downloads" />);
        await flushPromises();
        expect(optionTexts()).toEqual(['Choose a browser…', 'Firefox']);
        fireEvent.click(screen.getByRole('button', { name: 'RESCAN BROWSERS' }));
        await flushPromises();
        expect(mock.api.listBrowsers).toHaveBeenLastCalledWith(true);
        expect(optionTexts()).toEqual(['Choose a browser…', 'Firefox', 'Brave Origin']);
    });
});

describe('SettingsPanel auto-generated subtitles warning', () => {
    const WARNING =
        'Auto-generated subtitles need a language. Fill in "Subtitle languages" in Settings (e.g. ja), or turn off "Include auto-generated subtitles".';

    it('warns when auto-generated subtitles are on and no language is set', () => {
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, writeSubtitles: true, autoSubtitles: true, subtitleLangs: '' } });
        render(<SettingsPanel scope="downloads" />);
        expect(screen.getByRole('alert')).toHaveTextContent(WARNING);
    });

    it('warns when the language is "all"', () => {
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, writeSubtitles: true, autoSubtitles: true, subtitleLangs: 'all' } });
        render(<SettingsPanel scope="downloads" />);
        expect(screen.getByRole('alert')).toHaveTextContent(WARNING);
    });

    it('does not warn when a language is set', () => {
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, writeSubtitles: true, autoSubtitles: true, subtitleLangs: 'ja' } });
        render(<SettingsPanel scope="downloads" />);
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('does not warn when auto-generated subtitles are off', () => {
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, writeSubtitles: true, autoSubtitles: false, subtitleLangs: '' } });
        render(<SettingsPanel scope="downloads" />);
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('does not warn when subtitles are off', () => {
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, writeSubtitles: false, autoSubtitles: true, subtitleLangs: '' } });
        render(<SettingsPanel scope="downloads" />);
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('shows and hides the warning as the languages field is edited', () => {
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, writeSubtitles: true, autoSubtitles: true, subtitleLangs: '' } });
        render(<SettingsPanel scope="downloads" />);
        expect(screen.getByRole('alert')).toHaveTextContent(WARNING);
        fireEvent.change(screen.getByLabelText('Subtitle languages'), { target: { value: 'ja' } });
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
});

describe('SettingsPanel system tray', () => {
    const TRAY_LABEL = 'Keep running in the system tray when the window is closed';

    it('is off by default and explains how to quit', () => {
        render(<SettingsPanel scope="global" />);
        expect(screen.getByLabelText(TRAY_LABEL)).not.toBeChecked();
        expect(screen.getByText('Downloads keep going in the background. Right-click the tray icon to quit completely.')).toBeInTheDocument();
    });

    it('reflects the stored value', () => {
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, closeToTray: true } });
        render(<SettingsPanel scope="global" />);
        expect(screen.getByLabelText(TRAY_LABEL)).toBeChecked();
    });

    it('checks the tray support when opened and again when the option changes', async () => {
        render(<SettingsPanel scope="global" />);
        await flushPromises();
        expect(mock.api.getTraySupport).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByLabelText(TRAY_LABEL));
        await flushPromises();
        expect(mock.api.getTraySupport).toHaveBeenCalledTimes(2);
    });

    it('warns when the option is on and the environment has no tray', async () => {
        mock.api.getTraySupport.mockResolvedValue({ available: false, reason: 'No system tray was detected.' });
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, closeToTray: true } });
        render(<SettingsPanel scope="global" />);
        await flushPromises();
        expect(screen.getByRole('alert')).toHaveTextContent('No system tray was detected.');
    });

    it('does not warn when the option is off, even without a tray', async () => {
        mock.api.getTraySupport.mockResolvedValue({ available: false, reason: 'No system tray was detected.' });
        render(<SettingsPanel scope="global" />);
        await flushPromises();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('does not warn when a tray is available', async () => {
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, closeToTray: true } });
        render(<SettingsPanel scope="global" />);
        await flushPromises();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('shows the warning as soon as the option is turned on', async () => {
        mock.api.getTraySupport.mockResolvedValue({ available: false, reason: 'No system tray was detected.' });
        render(<SettingsPanel scope="global" />);
        await flushPromises();
        fireEvent.click(screen.getByLabelText(TRAY_LABEL));
        await flushPromises();
        expect(screen.getByRole('alert')).toHaveTextContent('No system tray was detected.');
    });
});

describe('SettingsPanel start at login', () => {
    const LOGIN_LABEL = 'Start Pullwave when I log in';
    const MINIMIZED_LABEL = 'Start minimized to the system tray';

    beforeEach(() => {
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS } });
    });

    it('are off by default and explain what they do', () => {
        render(<SettingsPanel scope="global" />);
        expect(screen.getByLabelText(LOGIN_LABEL)).not.toBeChecked();
        expect(screen.getByLabelText(MINIMIZED_LABEL)).not.toBeChecked();
        expect(screen.getByText('Opens the app automatically every time you log in to the computer.')).toBeInTheDocument();
        expect(
            screen.getByText('Only when started at login, and only with the tray option above on and a tray available; otherwise the window opens normally.')
        ).toBeInTheDocument();
    });

    it('reflect the stored values', () => {
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, launchAtLogin: true, startMinimized: true } });
        render(<SettingsPanel scope="global" />);
        expect(screen.getByLabelText(LOGIN_LABEL)).toBeChecked();
        expect(screen.getByLabelText(MINIMIZED_LABEL)).toBeChecked();
    });

    it('are not in the settings of the downloads', () => {
        render(<SettingsPanel scope="downloads" />);
        expect(screen.queryByLabelText(LOGIN_LABEL)).not.toBeInTheDocument();
        expect(screen.queryByLabelText(MINIMIZED_LABEL)).not.toBeInTheDocument();
    });

    it('save the choice of starting at login', async () => {
        render(<SettingsPanel scope="global" />);
        fireEvent.click(screen.getByLabelText(LOGIN_LABEL));
        await flushPromises();
        expect(mock.api.saveSettings).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, launchAtLogin: true });
    });

    it('save the choice of starting minimized', async () => {
        render(<SettingsPanel scope="global" />);
        fireEvent.click(screen.getByLabelText(MINIMIZED_LABEL));
        await flushPromises();
        expect(mock.api.saveSettings).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, startMinimized: true });
    });

    it('are translated', () => {
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, language: 'pt' } });
        render(<SettingsPanel scope="global" />);
        expect(screen.getByLabelText('Abrir o Pullwave quando eu fizer login')).toBeInTheDocument();
        expect(screen.getByLabelText('Iniciar minimizado na bandeja do sistema')).toBeInTheDocument();
    });
});

describe('SettingsPanel live streams', () => {
    it('are off by default and explain what they do', () => {
        render(<SettingsPanel scope="downloads" />);
        expect(screen.getByLabelText('Record live streams from the start')).not.toBeChecked();
        expect(screen.getByLabelText('Wait for scheduled live streams to start')).not.toBeChecked();
        expect(screen.getByText(/keeps the past part of the stream available \(DVR\)/)).toBeInTheDocument();
        expect(screen.getByText('Keeps checking every 30 seconds until the stream goes live. Cancel to stop waiting.')).toBeInTheDocument();
    });

    it('double-check the end of a live stream for 10 seconds by default', () => {
        render(<SettingsPanel scope="downloads" />);
        expect(screen.getByLabelText('Double-check that a live stream really ended')).toBeChecked();
        expect(screen.getByLabelText('Seconds to keep checking')).toHaveValue(10);
        expect(screen.getByLabelText('Seconds to keep checking')).toBeEnabled();
        expect(screen.getByLabelText('Seconds to keep checking')).toHaveAttribute('min', '1');
        expect(screen.getByLabelText('Seconds to keep checking')).toHaveAttribute('max', '120');
        expect(screen.getByText('When a live recording stops, keeps looking for the stream for a few seconds. If it comes back, recording continues in a new file of the same download.')).toBeInTheDocument();
        expect(screen.getByText('How long to look for the stream again after it stops (1 to 120).')).toBeInTheDocument();
    });

    it('saves right away when the end check is turned off and then disables its seconds', async () => {
        render(<SettingsPanel scope="downloads" />);
        fireEvent.click(screen.getByLabelText('Double-check that a live stream really ended'));
        await flushPromises();
        expect(mock.api.saveSettings).toHaveBeenCalledTimes(1);
        expect(mock.api.saveSettings).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, verifyLiveEnd: false });
        expect(screen.getByLabelText('Seconds to keep checking')).toBeDisabled();
    });

    it('saves the seconds two seconds after typing', async () => {
        render(<SettingsPanel scope="downloads" />);
        fireEvent.change(screen.getByLabelText('Seconds to keep checking'), { target: { value: '25' } });
        expect(mock.api.saveSettings).not.toHaveBeenCalled();
        await advance(AUTOSAVE_DELAY_MS);
        expect(mock.api.saveSettings).toHaveBeenCalledTimes(1);
        expect(mock.api.saveSettings).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, verifyLiveEndSeconds: 25 });
    });

    it('shows the stored end check values', () => {
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, verifyLiveEnd: false, verifyLiveEndSeconds: 45 } });
        render(<SettingsPanel scope="downloads" />);
        expect(screen.getByLabelText('Double-check that a live stream really ended')).not.toBeChecked();
        expect(screen.getByLabelText('Seconds to keep checking')).toHaveValue(45);
        expect(screen.getByLabelText('Seconds to keep checking')).toBeDisabled();
    });

    it('reflect the stored values', () => {
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, liveFromStart: true, waitForLive: true } });
        render(<SettingsPanel scope="downloads" />);
        expect(screen.getByLabelText('Record live streams from the start')).toBeChecked();
        expect(screen.getByLabelText('Wait for scheduled live streams to start')).toBeChecked();
    });
});

describe('SettingsPanel theme', () => {
    it('offers every theme, device being the default', () => {
        render(<SettingsPanel scope="global" />);
        const select = screen.getByLabelText('Theme') as HTMLSelectElement;
        expect(select).toHaveValue('device');
        expect(
            Array.from(select.options).map((option) => {
                return [option.value, option.textContent];
            })
        ).toEqual([
            ['device', 'Device (follows the system)'],
            ['cyberpunk', 'Cyberpunk (neon)'],
            ['synthwave', 'Synthwave (neon)'],
            ['terminal', 'Terminal (green)'],
            ['dark', 'Dark'],
            ['tokyo-night', 'Tokyo Night'],
            ['nord', 'Nord'],
            ['dracula', 'Dracula'],
            ['gruvbox', 'Gruvbox'],
            ['amoled', 'AMOLED (pure black)'],
            ['high-contrast', 'High contrast'],
            ['light', 'Light'],
            ['sakura', 'Sakura (pink, light)']
        ]);
        expect(screen.getByText('Device follows the light or dark mode of your system. Saved and restored the next time the app opens.')).toBeInTheDocument();
    });

    it.each(['cyberpunk', 'synthwave', 'terminal', 'dark', 'tokyo-night', 'nord', 'dracula', 'gruvbox', 'amoled', 'high-contrast', 'light', 'sakura'] as const)('saves right away when %s is chosen', async (theme) => {
        render(<SettingsPanel scope="global" />);
        fireEvent.change(screen.getByLabelText('Theme'), { target: { value: theme } });
        await flushPromises();
        expect(mock.api.saveSettings).toHaveBeenCalledTimes(1);
        expect(mock.api.saveSettings).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, theme });
    });

    it('reflects the stored theme', () => {
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, theme: 'light' } });
        render(<SettingsPanel scope="global" />);
        expect(screen.getByLabelText('Theme')).toHaveValue('light');
    });
});

describe('SettingsPanel yt-dlp update', () => {
    const BINARIES = {
        ytdlp: { found: true, path: '/data/bin/yt-dlp', version: '2026.08.19', source: 'updated' as const },
        ffmpeg: { found: true, path: '/app/bin/ffmpeg', version: '7.0', source: 'bundled' as const }
    };

    it('shows the installed version and the update button', () => {
        useAppStore.setState({ binaries: BINARIES, updating: false });
        render(<SettingsPanel scope="downloads" />);
        expect(screen.getByText('Installed version: 2026.08.19')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'UPDATE YT-DLP' })).toBeEnabled();
    });

    it('says when the version is unknown or yt-dlp was not found', () => {
        useAppStore.setState({ binaries: { ...BINARIES, ytdlp: { ...BINARIES.ytdlp, version: null } } });
        const { unmount } = render(<SettingsPanel scope="downloads" />);
        expect(screen.getByText('Installed version: unknown')).toBeInTheDocument();
        unmount();
        useAppStore.setState({ binaries: { ...BINARIES, ytdlp: { ...BINARIES.ytdlp, found: false } } });
        render(<SettingsPanel scope="downloads" />);
        expect(screen.getByText('yt-dlp was not found.')).toBeInTheDocument();
    });

    it('updates yt-dlp when the button is clicked', async () => {
        useAppStore.setState({ binaries: BINARIES, updating: false });
        render(<SettingsPanel scope="downloads" />);
        fireEvent.click(screen.getByRole('button', { name: 'UPDATE YT-DLP' }));
        await flushPromises();
        expect(mock.api.updateYtdlp).toHaveBeenCalledTimes(1);
    });

    it('offers to go back to the yt-dlp that ships with the app only when an updated one is the one in use', () => {
        useAppStore.setState({ binaries: BINARIES, updating: false });
        const { unmount } = render(<SettingsPanel scope="downloads" />);
        expect(screen.getByRole('button', { name: 'USE THE ONE THAT SHIPS WITH THE APP' })).toBeEnabled();
        unmount();
        for (const source of ['bundled', 'system', 'custom'] as const) {
            useAppStore.setState({ binaries: { ...BINARIES, ytdlp: { ...BINARIES.ytdlp, source } } });
            const { unmount: next } = render(<SettingsPanel scope="downloads" />);
            expect(screen.queryByRole('button', { name: 'USE THE ONE THAT SHIPS WITH THE APP' })).not.toBeInTheDocument();
            next();
        }
    });

    it('does not offer it while the binaries have not been read', () => {
        useAppStore.setState({ binaries: null, updating: false });
        render(<SettingsPanel scope="downloads" />);
        expect(screen.queryByRole('button', { name: 'USE THE ONE THAT SHIPS WITH THE APP' })).not.toBeInTheDocument();
    });

    it('goes back to the yt-dlp that ships with the app when its button is clicked, and reads the binaries again', async () => {
        useAppStore.setState({ binaries: BINARIES, updating: false });
        render(<SettingsPanel scope="downloads" />);
        fireEvent.click(screen.getByRole('button', { name: 'USE THE ONE THAT SHIPS WITH THE APP' }));
        await flushPromises();
        expect(mock.api.resetYtdlp).toHaveBeenCalledTimes(1);
        expect(mock.api.updateYtdlp).not.toHaveBeenCalled();
        expect(useAppStore.getState().notice).toEqual({ kind: 'info', message: 'Using the bundled yt-dlp' });
    });

    it('disables the button to go back while it is updating', () => {
        useAppStore.setState({ binaries: BINARIES, updating: true });
        render(<SettingsPanel scope="downloads" />);
        expect(screen.getByRole('button', { name: 'USE THE ONE THAT SHIPS WITH THE APP' })).toBeDisabled();
    });

    it('disables the button and says it is updating', () => {
        useAppStore.setState({ binaries: BINARIES, updating: true });
        render(<SettingsPanel scope="downloads" />);
        expect(screen.getByRole('button', { name: 'UPDATING…' })).toBeDisabled();
    });
});


describe('SettingsPanel anime section', () => {
    it('is left out where the section does not exist', () => {
        render(<SettingsPanel scope="anime" />);
        expect(screen.queryByText('ANIME')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Anime download folder')).not.toBeInTheDocument();
    });

    it.each(['global', 'downloads'] as const)('is not in the %s settings, even where it exists', (scope) => {
        useAnimeStore.setState({ status: makeStatus() });
        render(<SettingsPanel scope={scope} />);
        expect(screen.queryByText('ANIME', { selector: 'legend' })).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Anime download folder')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'UPDATE ANI-CLI' })).not.toBeInTheDocument();
    });

    describe('where it exists', () => {
        beforeEach(() => {
            useAnimeStore.setState({ status: makeStatus() });
        });

        it('shows the stored values', () => {
            useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, animeDownloadDir: '/media/anime', animeQuality: '720p', animeAudio: 'dub' } });
            render(<SettingsPanel scope="anime" />);
            expect(screen.getByText('ANIME')).toBeInTheDocument();
            expect(screen.getByLabelText('Anime download folder')).toHaveValue('/media/anime');
            expect(screen.getByLabelText('Anime download folder')).toHaveAttribute('placeholder', 'Default: Downloads/Pullwave Anime');
            expect(screen.getByLabelText('Anime quality')).toHaveValue('720p');
            expect(screen.getByLabelText('Anime audio')).toHaveValue('dub');
            expect(screen.getByLabelText('Anime subtitles')).toHaveValue('auto');
        });

        describe('the translation of subtitles', () => {
            it('has its own part, after the options of the anime, with the default values', async () => {
                render(<SettingsPanel scope="anime" />);
                await flushPromises();
                expect(screen.getByText('SUBTITLE TRANSLATION (LANGUAGE MODEL)')).toBeInTheDocument();
                expect(screen.getByLabelText('Provider')).toHaveValue('openai');
                expect(screen.getByLabelText('Model')).toHaveValue('');
                expect(screen.getByLabelText('Address (optional)')).toHaveValue('');
                expect(screen.getByLabelText('Default language')).toHaveValue('Portuguese (Brazil)');
                expect(screen.getByLabelText('Token (API key)')).toHaveValue('');
                expect(mock.api.getLlmStatus).toHaveBeenCalledTimes(1);
            });

            it('shows the stored values', async () => {
                useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, translateProvider: 'kimi', translateModel: 'moonshot-x', translateBaseUrl: 'http://x/v1', translateLanguage: 'Italian' } });
                render(<SettingsPanel scope="anime" />);
                await flushPromises();
                expect(screen.getByLabelText('Provider')).toHaveValue('kimi');
                expect(screen.getByLabelText('Model')).toHaveValue('moonshot-x');
                expect(screen.getByLabelText('Address (optional)')).toHaveValue('http://x/v1');
                expect(screen.getByLabelText('Default language')).toHaveValue('Italian');
            });

            it('is not in the settings of the whole app nor in the ones of the video downloader', async () => {
                useAnimeStore.setState({ status: makeStatus() });
                const { unmount } = render(<SettingsPanel scope="global" />);
                await flushPromises();
                expect(screen.queryByText('SUBTITLE TRANSLATION (LANGUAGE MODEL)')).not.toBeInTheDocument();
                unmount();
                render(<SettingsPanel scope="downloads" />);
                await flushPromises();
                expect(screen.queryByText('SUBTITLE TRANSLATION (LANGUAGE MODEL)')).not.toBeInTheDocument();
                expect(mock.api.getLlmStatus).not.toHaveBeenCalled();
            });

            it('saves the provider and the language right away', async () => {
                render(<SettingsPanel scope="anime" />);
                await flushPromises();
                fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'gemini' } });
                await advance(AUTOSAVE_DELAY_MS);
                expect(mock.api.saveSettings).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, translateProvider: 'gemini' });
                fireEvent.change(screen.getByLabelText('Default language'), { target: { value: 'Japanese' } });
                await advance(AUTOSAVE_DELAY_MS);
                expect(mock.api.saveSettings).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, translateProvider: 'gemini', translateLanguage: 'Japanese' });
            });

            it('saves the model and the address after the user stops typing', async () => {
                render(<SettingsPanel scope="anime" />);
                await flushPromises();
                type('Model', 'my-model');
                type('Address (optional)', 'http://localhost:1234/v1');
                await advance(AUTOSAVE_DELAY_MS);
                expect(mock.api.saveSettings).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, translateModel: 'my-model', translateBaseUrl: 'http://localhost:1234/v1' });
            });

            it('has a part for the speech to text with the default values', async () => {
                render(<SettingsPanel scope="anime" />);
                await flushPromises();
                expect(screen.getByText('SUBTITLE CREATION (SPEECH TO TEXT)')).toBeInTheDocument();
                expect(screen.getByLabelText('Speech-to-text service')).toHaveValue('openai');
                expect(screen.getByLabelText('Speech-to-text model')).toHaveValue('whisper-1');
                expect(screen.getByLabelText('Speech-to-text address (optional)')).toHaveValue('');
                expect(screen.queryByLabelText('Language spoken in the audio')).not.toBeInTheDocument();
                expect(screen.getByLabelText('Speech-to-text token (API key)')).toHaveValue('');
            });

            it('shows the stored values of the speech to text', async () => {
                useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, transcribeProvider: 'custom', transcribeModel: 'whisper-large', transcribeBaseUrl: 'http://stt/v1' } });
                render(<SettingsPanel scope="anime" />);
                await flushPromises();
                expect(screen.getByLabelText('Speech-to-text service')).toHaveValue('custom');
                expect(screen.getByLabelText('Speech-to-text model')).toHaveValue('whisper-large');
                expect(screen.getByLabelText('Speech-to-text address (optional)')).toHaveValue('http://stt/v1');
            });

            it('saves the service right away', async () => {
                render(<SettingsPanel scope="anime" />);
                await flushPromises();
                fireEvent.change(screen.getByLabelText('Speech-to-text service'), { target: { value: 'custom' } });
                await advance(AUTOSAVE_DELAY_MS);
                expect(mock.api.saveSettings).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, transcribeProvider: 'custom' });
            });

            it('takes the model of OpenAI away when Gemini is chosen, since its models have other names, and saves both together', async () => {
                render(<SettingsPanel scope="anime" />);
                await flushPromises();
                fireEvent.change(screen.getByLabelText('Speech-to-text service'), { target: { value: 'gemini' } });
                await advance(AUTOSAVE_DELAY_MS);
                expect(mock.api.saveSettings).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, transcribeProvider: 'gemini', transcribeModel: '' });
                expect(screen.getByLabelText('Speech-to-text model')).toHaveValue('');
                expect(screen.getByLabelText('Speech-to-text address (optional)')).toHaveAttribute('placeholder', 'https://generativelanguage.googleapis.com/v1beta');
            });

            it('keeps the model the user wrote when Gemini is chosen', async () => {
                useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, transcribeModel: 'my-gemini-model' } });
                render(<SettingsPanel scope="anime" />);
                await flushPromises();
                fireEvent.change(screen.getByLabelText('Speech-to-text service'), { target: { value: 'gemini' } });
                await advance(AUTOSAVE_DELAY_MS);
                expect(mock.api.saveSettings).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, transcribeProvider: 'gemini', transcribeModel: 'my-gemini-model' });
            });

            it('puts the model of OpenAI back when a service of the protocol of OpenAI is chosen again with the model empty', async () => {
                useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, transcribeProvider: 'gemini', transcribeModel: '' } });
                render(<SettingsPanel scope="anime" />);
                await flushPromises();
                fireEvent.change(screen.getByLabelText('Speech-to-text service'), { target: { value: 'openai' } });
                await advance(AUTOSAVE_DELAY_MS);
                expect(mock.api.saveSettings).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, transcribeProvider: 'openai', transcribeModel: 'whisper-1' });
            });

            it('saves the model and the address of the speech to text after the user stops typing', async () => {
                render(<SettingsPanel scope="anime" />);
                await flushPromises();
                type('Speech-to-text model', 'whisper-2');
                type('Speech-to-text address (optional)', 'http://localhost:9000/v1');
                await advance(AUTOSAVE_DELAY_MS);
                expect(mock.api.saveSettings).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, transcribeModel: 'whisper-2', transcribeBaseUrl: 'http://localhost:9000/v1' });
            });

            it('keeps the token of the speech to text out of the settings that are saved', async () => {
                render(<SettingsPanel scope="anime" />);
                await flushPromises();
                type('Speech-to-text token (API key)', 'sk-speech-secret');
                type('Speech-to-text model', 'whisper-2');
                await advance(AUTOSAVE_DELAY_MS);
                expect(JSON.stringify(mock.api.saveSettings.mock.calls)).not.toContain('sk-speech-secret');
                expect(mock.api.setLlmToken).not.toHaveBeenCalled();
            });

            it('keeps the token out of the settings that are saved', async () => {
                render(<SettingsPanel scope="anime" />);
                await flushPromises();
                type('Token (API key)', 'sk-secret');
                type('Model', 'my-model');
                await advance(AUTOSAVE_DELAY_MS);
                expect(JSON.stringify(mock.api.saveSettings.mock.calls)).not.toContain('sk-secret');
                expect(mock.api.setLlmToken).not.toHaveBeenCalled();
            });
        });

        it('lists the qualities and the audios with readable labels', () => {
            render(<SettingsPanel scope="anime" />);
            const options = (label: string): Array<string | null> => {
                return Array.from(screen.getByLabelText(label).querySelectorAll('option')).map((option) => {
                    return option.textContent;
                });
            };
            expect(options('Anime quality')).toEqual(['BEST', '1080p', '720p', '480p', '360p', 'WORST (SMALLEST)']);
            expect(options('Anime audio')).toEqual(['SUBTITLED', 'DUBBED']);
            expect(options('Anime subtitles')).toEqual(['FOLLOW THE APP LANGUAGE', 'WHAT ANI-CLI PICKS', 'English', 'Portuguese', 'Spanish', 'French', 'German', 'Italian', 'Russian']);
        });

        it('saves the quality and the audio at once', async () => {
            render(<SettingsPanel scope="anime" />);
            fireEvent.change(screen.getByLabelText('Anime quality'), { target: { value: '480p' } });
            fireEvent.change(screen.getByLabelText('Anime audio'), { target: { value: 'dub' } });
            await flushPromises();
            expect(mock.api.saveSettings).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, animeQuality: '480p', animeAudio: 'dub' });
        });

        it('shows the version of ani-cli', () => {
            render(<SettingsPanel scope="anime" />);
            expect(screen.getByText('ani-cli version: 5.1.4')).toBeInTheDocument();
            expect(screen.getByText(/finds the episodes/)).toBeInTheDocument();
        });

        it('says when the version is not known or ani-cli is missing', () => {
            useAnimeStore.setState({ status: makeStatus({ aniCli: { ...ANI_CLI_INFO, version: null } }) });
            const { unmount } = render(<SettingsPanel scope="anime" />);
            expect(screen.getByText('ani-cli version: unknown')).toBeInTheDocument();
            unmount();

            useAnimeStore.setState({ status: makeStatus({ aniCli: { ...ANI_CLI_INFO, found: false } }) });
            render(<SettingsPanel scope="anime" />);
            expect(screen.getByText('ani-cli was not found.')).toBeInTheDocument();
        });

        it('updates ani-cli and shows the new version', async () => {
            let finish: () => void = () => {
                return undefined;
            };
            mock.api.updateAniCli.mockReturnValue(
                new Promise((resolve) => {
                    finish = () => {
                        resolve({ ok: true, output: 'Updated ani-cli 5.1.4 → 5.2.0.' });
                    };
                })
            );
            mock.api.getAnimeStatus.mockResolvedValue(makeStatus({ aniCli: { ...ANI_CLI_INFO, version: '5.2.0', source: 'updated' } }));
            render(<SettingsPanel scope="anime" />);

            fireEvent.click(screen.getByRole('button', { name: 'UPDATE ANI-CLI' }));
            await flushPromises();
            expect(screen.getByRole('button', { name: 'UPDATING…' })).toBeDisabled();

            finish();
            await flushPromises();
            expect(screen.getByRole('button', { name: 'UPDATE ANI-CLI' })).toBeEnabled();
            expect(screen.getByText('ani-cli version: 5.2.0')).toBeInTheDocument();
            expect(useAppStore.getState().notice).toEqual({ kind: 'info', message: 'Updated ani-cli 5.1.4 → 5.2.0.' });
        });

        it('offers to go back to the ani-cli that ships with the app only when an updated one is the one in use', () => {
            useAnimeStore.setState({ status: makeStatus({ aniCli: { ...ANI_CLI_INFO, source: 'updated' } }) });
            const { unmount } = render(<SettingsPanel scope="anime" />);
            expect(screen.getByRole('button', { name: 'USE THE ONE THAT SHIPS WITH THE APP' })).toBeEnabled();
            unmount();
            for (const source of ['bundled', 'custom'] as const) {
                useAnimeStore.setState({ status: makeStatus({ aniCli: { ...ANI_CLI_INFO, source } }) });
                const { unmount: next } = render(<SettingsPanel scope="anime" />);
                expect(screen.queryByRole('button', { name: 'USE THE ONE THAT SHIPS WITH THE APP' })).not.toBeInTheDocument();
                next();
            }
        });

        it('goes back to the ani-cli that ships with the app when its button is clicked, and shows the version in use', async () => {
            useAnimeStore.setState({ status: makeStatus({ aniCli: { ...ANI_CLI_INFO, version: '5.2.0', source: 'updated' } }) });
            mock.api.getAnimeStatus.mockResolvedValue(makeStatus({ aniCli: { ...ANI_CLI_INFO, version: '5.1.4', source: 'bundled' } }));
            render(<SettingsPanel scope="anime" />);
            expect(screen.getByText('ani-cli version: 5.2.0')).toBeInTheDocument();

            fireEvent.click(screen.getByRole('button', { name: 'USE THE ONE THAT SHIPS WITH THE APP' }));
            await flushPromises();

            expect(mock.api.resetAniCli).toHaveBeenCalledTimes(1);
            expect(mock.api.updateAniCli).not.toHaveBeenCalled();
            expect(screen.getByText('ani-cli version: 5.1.4')).toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'USE THE ONE THAT SHIPS WITH THE APP' })).not.toBeInTheDocument();
            expect(useAppStore.getState().notice).toEqual({ kind: 'info', message: 'Using the bundled ani-cli' });
        });

        it('saves the language of the subtitles at once', async () => {
            render(<SettingsPanel scope="anime" />);
            fireEvent.change(screen.getByLabelText('Anime subtitles'), { target: { value: 'Portuguese' } });
            await flushPromises();
            expect(mock.api.saveSettings).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, animeSubtitles: 'Portuguese' });
        });

        it('saves the folder after the user stops typing', async () => {
            render(<SettingsPanel scope="anime" />);
            type('Anime download folder', '/media/anime');
            expect(mock.api.saveSettings).not.toHaveBeenCalled();
            await advance(AUTOSAVE_DELAY_MS);
            expect(mock.api.saveSettings).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, animeDownloadDir: '/media/anime' });
        });

        it('lets the user pick the folder and saves it', async () => {
            mock.api.chooseDirectory.mockResolvedValue('/picked/anime');
            render(<SettingsPanel scope="anime" />);
            fireEvent.click(screen.getByRole('button', { name: 'BROWSE' }));
            await flushPromises();
            expect(mock.api.chooseDirectory).toHaveBeenCalledTimes(1);
            expect(mock.api.saveSettings).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, animeDownloadDir: '/picked/anime' });
        });

        it('has the MIGRATE FOLDER button, with what it does as a visible hint', () => {
            render(<SettingsPanel scope="anime" />);
            const button = screen.getByRole('button', { name: 'MIGRATE FOLDER' });
            expect(button).toBeEnabled();
            expect(screen.getByText('Choose a new folder: the app copies all the anime there, checks the copies and then removes the old files')).toHaveClass('field__hint');
        });

        it('leaves the folder free to edit while the library is empty', () => {
            render(<SettingsPanel scope="anime" />);
            expect(screen.getByLabelText('Anime download folder')).toBeEnabled();
            expect(screen.getByRole('button', { name: 'BROWSE' })).toBeEnabled();
            expect(screen.queryByText('With anime in the library, the folder only changes through MIGRATE FOLDER, which moves the files too.')).not.toBeInTheDocument();
        });

        describe('with anime in the library', () => {
            beforeEach(() => {
                useAnimeStore.setState({ library: [makeAnime([makeEpisode({ id: 1, status: 'done' })])] });
                useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, animeDownloadDir: '/media/anime' } });
            });

            it('fixes the folder: it cannot be typed nor browsed, and the hint says to use MIGRATE FOLDER', () => {
                render(<SettingsPanel scope="anime" />);
                expect(screen.getByLabelText('Anime download folder')).toBeDisabled();
                expect(screen.getByLabelText('Anime download folder')).toHaveValue('/media/anime');
                expect(screen.getByRole('button', { name: 'BROWSE' })).toBeDisabled();
                expect(screen.getByText('With anime in the library, the folder only changes through MIGRATE FOLDER, which moves the files too.')).toBeInTheDocument();
                expect(screen.getByRole('button', { name: 'MIGRATE FOLDER' })).toBeEnabled();
            });

            it('migrates, then shows and saves the new folder', async () => {
                mock.api.migrateAnimeFolder.mockResolvedValue({ ok: true, episodes: 1, files: 2, destination: '/new/anime' });
                render(<SettingsPanel scope="anime" />);
                fireEvent.click(screen.getByRole('button', { name: 'MIGRATE FOLDER' }));
                await flushPromises();

                expect(mock.api.migrateAnimeFolder).toHaveBeenCalledTimes(1);
                expect(screen.getByLabelText('Anime download folder')).toHaveValue('/new/anime');
                expect(mock.api.saveSettings).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, animeDownloadDir: '/new/anime' });
                expect(useAppStore.getState().notice).toEqual({ kind: 'info', message: 'MIGRATION DONE: 1 EPISODES MOVED TO /new/anime' });
            });

            it.each([
                ['cancelled', null],
                ['busy', 'A download or a migration is running. Wait for it to finish.'],
                ['same', 'That is already the anime folder.'],
                ['inside', 'Choose a folder that is not inside the current anime folder.'],
                ['conflict', 'The new folder already has files where the anime would be copied. Choose another folder.'],
                ['failed', 'The migration failed. What was copied was removed and nothing changed.']
            ] as const)('keeps the folder when the migration answers %s', async (reason, message) => {
                mock.api.migrateAnimeFolder.mockResolvedValue({ ok: false, reason });
                render(<SettingsPanel scope="anime" />);
                fireEvent.click(screen.getByRole('button', { name: 'MIGRATE FOLDER' }));
                await flushPromises();
                await advance(AUTOSAVE_DELAY_MS);

                expect(screen.getByLabelText('Anime download folder')).toHaveValue('/media/anime');
                expect(mock.api.saveSettings).not.toHaveBeenCalled();
                expect(useAppStore.getState().notice).toEqual(message === null ? null : { kind: 'error', message });
            });

            it('shows how far the migration is and disables the button meanwhile', async () => {
                let finish: (response: { ok: false; reason: 'cancelled' }) => void = () => {
                    return;
                };
                mock.api.migrateAnimeFolder.mockReturnValue(
                    new Promise((resolve) => {
                        finish = resolve;
                    })
                );
                mock.api.getAnimeStatus.mockResolvedValue(makeStatus());
                mock.api.listAnimeLibrary.mockResolvedValue([makeAnime([makeEpisode({ id: 1, status: 'done' })])]);
                await useAnimeStore.getState().init();
                render(<SettingsPanel scope="anime" />);
                fireEvent.click(screen.getByRole('button', { name: 'MIGRATE FOLDER' }));
                await flushPromises();
                expect(screen.getByRole('button', { name: 'MIGRATING 0/0…' })).toBeDisabled();

                act(() => {
                    mock.emitAnimeMigrationProgress({ done: 3, total: 8 });
                });
                expect(screen.getByRole('button', { name: 'MIGRATING 3/8…' })).toBeDisabled();

                await act(async () => {
                    finish({ ok: false, reason: 'cancelled' });
                    await vi.advanceTimersByTimeAsync(0);
                });
                expect(screen.getByRole('button', { name: 'MIGRATE FOLDER' })).toBeEnabled();
            });
        });

        it('keeps the folder when the dialog is cancelled', async () => {
            mock.api.chooseDirectory.mockResolvedValue(null);
            useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, animeDownloadDir: '/keep' } });
            render(<SettingsPanel scope="anime" />);
            fireEvent.click(screen.getByRole('button', { name: 'BROWSE' }));
            await flushPromises();
            await advance(AUTOSAVE_DELAY_MS);
            expect(screen.getByLabelText('Anime download folder')).toHaveValue('/keep');
            expect(mock.api.saveSettings).not.toHaveBeenCalled();
        });
    });
});
