import {
    AUDIO_FORMATS,
    LANGUAGE_SETTINGS,
    MAX_LIVE_END_CHECK_SECONDS,
    MAX_TITLE_LENGTH,
    MIN_LIVE_END_CHECK_SECONDS,
    MIN_TITLE_LENGTH,
    RESOLUTIONS,
    START_TABS,
    THEMES,
    VIDEO_CONTAINERS
} from '@shared/constants';
import { useEffect } from 'react';
import { ANIME_AUDIOS, ANIME_QUALITIES, ANIME_SUBTITLE_SETTINGS, type AnimeAudio, type AnimeQuality, type AnimeSubtitleSetting } from '@shared/anime';
import { MANGA_OUTPUT_FORMATS } from '@shared/manga';
import { chosenBrowserWarning, findChosenBrowser, NO_BROWSER_CHOSEN } from '@shared/browserChoice';
import { LANGUAGE_NAMES, type Translator } from '@shared/i18n';
import { hasUnboundedAutoSubtitles } from '@shared/subtitles';
import type { DetectedBrowser, LanguageSetting, SiteBrowser, ThemeName } from '@shared/types';
import { useAutoSaveSettings, type SaveStatus } from '../hooks/useAutoSaveSettings';
import { useTranslator } from '../i18n/useTranslator';
import { useAnimeStore } from '../store/animeStore';
import { useAppStore } from '../store/appStore';
import { useMangaStore } from '../store/mangaStore';
import { NumberField, SelectField, TextField, ToggleField } from './fields';
import { MangaHealthSettings } from './MangaHealthSettings';
import { ProgramsStatusBlock } from './ProgramsStatusBlock';
import { MangaHelperSettings } from './MangaHelperSettings';
import { MangaStoreSettings } from './MangaStoreSettings';
import { formatResolution } from './settingsFormat';
import { TranslationSettings } from './TranslationSettings';
import { UpdateActions } from './UpdateActions';
import { updateSummary } from './updateText';

function formatSaveStatus(status: SaveStatus, t: Translator): string {
    return t(`settings.save.${status}`);
}

function formatTheme(theme: ThemeName, t: Translator): string {
    return t(`theme.${theme}`);
}

function formatLanguage(language: LanguageSetting, t: Translator): string {
    return language === 'device' ? t('language.device') : LANGUAGE_NAMES[language];
}

function formatAnimeQuality(quality: AnimeQuality, t: Translator): string {
    if (quality === 'best') {
        return t('anime.quality.best');
    }
    return quality === 'worst' ? t('anime.quality.worst') : quality;
}

function formatAnimeSubtitles(setting: AnimeSubtitleSetting, t: Translator): string {
    if (setting === 'auto') {
        return t('anime.subtitles.auto');
    }
    return setting === 'default' ? t('anime.subtitles.default') : setting;
}

function formatAnimeAudio(audio: AnimeAudio, t: Translator): string {
    return audio === 'dub' ? t('anime.audio.dub') : t('anime.audio.sub');
}

function findBrowserByDir(browsers: readonly DetectedBrowser[], dataDir: string): DetectedBrowser | undefined {
    return browsers.find((browser) => {
        return browser.dataDir === dataDir;
    });
}

// The browsers the pages of the mangas can be opened in: the one of the system and the kinds of browser found (one entry for each, even if it
// has several profiles), with the one that is saved even when it is no longer found, so the field never shows something that is not saved.
function siteBrowserOptions(browsers: readonly DetectedBrowser[], saved: SiteBrowser): SiteBrowser[] {
    const found = browsers
        .map((browser) => {
            return browser.engine;
        })
        .filter((engine, index, all) => {
            return all.indexOf(engine) === index;
        });
    return ['default', ...found, ...(saved !== 'default' && !found.includes(saved) ? [saved] : [])];
}

function formatSiteBrowser(browsers: readonly DetectedBrowser[], browser: SiteBrowser, t: Translator): string {
    if (browser === 'default') {
        return t('settings.mangaSiteBrowser.default');
    }
    return (
        browsers.find((item) => {
            return item.engine === browser;
        })?.label ?? browser
    );
}

const AUTOMATIC_PROFILE = '';

// The profiles with cookies, plus the saved one when it is gone, so the menu never shows a value that is not in it.
function profileOptions(browser: DetectedBrowser, saved: string): string[] {
    const ids = browser.profiles.map((profile) => {
        return profile.id;
    });
    return [AUTOMATIC_PROFILE, ...ids, ...(saved.length > 0 && !ids.includes(saved) ? [saved] : [])];
}

function formatProfile(browser: DetectedBrowser, id: string, t: Translator): string {
    if (id === AUTOMATIC_PROFILE) {
        return t('profile.automatic');
    }
    const profile = browser.profiles.find((candidate) => {
        return candidate.id === id;
    });
    if (!profile) {
        return t('profile.notFound', { id });
    }
    return profile.name === profile.id ? profile.id : `${profile.name} (${profile.id})`;
}

function formatBrowser(browsers: readonly DetectedBrowser[], dataDir: string, t: Translator): string {
    return findBrowserByDir(browsers, dataDir)?.label ?? t('settings.browser.choose');
}

// Where the settings are shown: the ones of the whole app, and the ones of the video downloader, of the anime section and of the manga
// section.
export type SettingsScope = 'global' | 'downloads' | 'anime' | 'manga';

interface SettingsPanelProps {
    scope: SettingsScope;
}

export function SettingsPanel({ scope }: SettingsPanelProps) {
    const t = useTranslator();
    const stored = useAppStore((state) => {
        return state.settings;
    });
    const saveSettings = useAppStore((state) => {
        return state.saveSettings;
    });
    const chooseDirectory = useAppStore((state) => {
        return state.chooseDirectory;
    });
    const appUpdate = useAppStore((state) => {
        return state.appUpdate;
    });
    const checkAppUpdate = useAppStore((state) => {
        return state.checkAppUpdate;
    });
    const traySupport = useAppStore((state) => {
        return state.traySupport;
    });
    const refreshTraySupport = useAppStore((state) => {
        return state.refreshTraySupport;
    });
    const browsers = useAppStore((state) => {
        return state.browsers;
    });
    const loadBrowsers = useAppStore((state) => {
        return state.loadBrowsers;
    });
    const animeSupported = useAnimeStore((state) => {
        return state.status.supported;
    });
    const library = useAnimeStore((state) => {
        return state.library;
    });
    const migration = useAnimeStore((state) => {
        return state.migration;
    });
    const migrateFolder = useAnimeStore((state) => {
        return state.migrateFolder;
    });
    const mangaLibraryCount = useMangaStore((state) => {
        return state.library.length;
    });
    const mangaMigration = useMangaStore((state) => {
        return state.migration;
    });
    const migrateMangaFolder = useMangaStore((state) => {
        return state.migrateFolder;
    });
    const { draft, status, change, edit, changeMany } = useAutoSaveSettings(stored, saveSettings);
    const detectedBrowsers = browsers ?? [];
    const chosenBrowser = findChosenBrowser(detectedBrowsers, draft);
    const browserWarning = chosenBrowserWarning(browsers, draft, t);
    const detectedDirs = detectedBrowsers.map((browser) => {
        return browser.dataDir;
    });
    const browserOptions = chosenBrowser ? detectedDirs : [NO_BROWSER_CHOSEN, ...detectedDirs];
    const unboundedAutoSubtitles = hasUnboundedAutoSubtitles(draft);
    const trayWarning = draft.closeToTray && traySupport !== null && !traySupport.available ? traySupport.reason : null;

    // The browsers are for the cookies of the video downloader and for the pages of the mangas; the tray is a setting of the whole app.
    useEffect(() => {
        if (scope === 'downloads' || scope === 'manga') {
            void loadBrowsers();
        }
    }, [scope, loadBrowsers]);

    useEffect(() => {
        if (scope === 'global') {
            void refreshTraySupport();
        }
    }, [scope, draft.closeToTray, refreshTraySupport]);
    const updateInProgress = appUpdate.status === 'checking' || appUpdate.status === 'downloading';

    async function handleChooseDirectory(): Promise<void> {
        const directory = await chooseDirectory();
        if (directory) {
            change('downloadDir', directory);
        }
    }

    async function handleChooseMangaDirectory(): Promise<void> {
        const directory = await chooseDirectory();
        if (directory) {
            change('mangaDirectory', directory);
        }
    }

    async function handleChooseAnimeDirectory(): Promise<void> {
        const directory = await chooseDirectory();
        if (directory) {
            change('animeDownloadDir', directory);
        }
    }

    // With anime in the library the folder changes only by a migration, which moves the files too.
    const animeFolderLocked = library.length > 0;
    const migrating = migration !== null;

    // With manga in the library the folder changes only by a migration, which moves the files too.
    const mangaFolderLocked = mangaLibraryCount > 0;
    const mangaMigrating = mangaMigration !== null;

    async function handleMigrateMangaFolder(): Promise<void> {
        const response = await migrateMangaFolder();
        if (response.ok) {
            change('mangaDirectory', response.destination);
        }
    }

    async function handleMigrateAnimeFolder(): Promise<void> {
        const response = await migrateFolder();
        if (response.ok) {
            change('animeDownloadDir', response.destination);
        }
    }

    return (
        <section className="settings" aria-label={t('settings.aria')}>
            <p className={`save-status save-status--${status}`} aria-live="polite">
                {formatSaveStatus(status, t)}
            </p>

            {scope === 'global' && (
                <>
                    <fieldset className="panel">
                        <legend>{t('settings.appearance')}</legend>
                        <SelectField
                            label={t('settings.theme')}
                            value={draft.theme}
                            options={THEMES}
                            formatOption={(theme) => {
                                return formatTheme(theme, t);
                            }}
                            hint={t('settings.theme.hint')}
                            onChange={(value) => {
                                change('theme', value);
                            }}
                        />
                        <SelectField
                            label={t('settings.language')}
                            value={draft.language}
                            options={LANGUAGE_SETTINGS}
                            formatOption={(language) => {
                                return formatLanguage(language, t);
                            }}
                            hint={t('settings.language.hint')}
                            onChange={(value) => {
                                change('language', value);
                            }}
                        />
                        <SelectField
                            label={t('settings.startTab')}
                            value={draft.startTab}
                            options={START_TABS}
                            formatOption={(startTab) => {
                                return t(startTab === 'anime' ? 'tab.anime' : startTab === 'manga' ? 'tab.manga' : 'tab.downloads');
                            }}
                            hint={t('settings.startTab.hint')}
                            onChange={(value) => {
                                change('startTab', value);
                            }}
                        />
                        <ToggleField
                            label={t('settings.closeToTray')}
                            checked={draft.closeToTray}
                            hint={t('settings.closeToTray.hint')}
                            onChange={(value) => {
                                change('closeToTray', value);
                            }}
                        />
                        {trayWarning && (
                            <p className="field__warning" role="alert">
                                {trayWarning}
                            </p>
                        )}
                        <ToggleField
                            label={t('settings.launchAtLogin')}
                            checked={draft.launchAtLogin}
                            hint={t('settings.launchAtLogin.hint')}
                            onChange={(value) => {
                                change('launchAtLogin', value);
                            }}
                        />
                        <ToggleField
                            label={t('settings.startMinimized')}
                            checked={draft.startMinimized}
                            hint={t('settings.startMinimized.hint')}
                            onChange={(value) => {
                                change('startMinimized', value);
                            }}
                        />
                    </fieldset>

                    <fieldset className="panel">
                        <legend>{t('settings.appUpdates')}</legend>
                        <p className="update-status" aria-live="polite">
                            {updateSummary(appUpdate, t)}
                        </p>
                        <div className="field-row">
                            <button
                                type="button"
                                className="btn btn--small"
                                disabled={updateInProgress}
                                onClick={() => {
                                    void checkAppUpdate();
                                }}
                            >
                                {t('settings.checkUpdates')}
                            </button>
                            <UpdateActions />
                        </div>
                        <ToggleField
                            label={t('settings.checkOnStart')}
                            checked={draft.checkUpdatesOnStart}
                            onChange={(value) => {
                                change('checkUpdatesOnStart', value);
                            }}
                        />
                    </fieldset>

                    <ProgramsStatusBlock place="global" />
                </>
            )}

            {scope === 'downloads' && (
                <>
                    <fieldset className="panel">
                        <legend>{t('settings.output')}</legend>
                        <div className="field-row">
                            <TextField
                                label={t('settings.downloadDir')}
                                value={draft.downloadDir}
                                placeholder={t('settings.downloadDir.placeholder')}
                                onChange={(value) => {
                                    edit('downloadDir', value);
                                }}
                            />
                            <button
                                type="button"
                                className="btn btn--small"
                                onClick={() => {
                                    void handleChooseDirectory();
                                }}
                            >
                                {t('settings.browse')}
                            </button>
                        </div>
                        <NumberField
                            label={t('settings.maxTitleLength')}
                            value={draft.maxTitleLength}
                            min={MIN_TITLE_LENGTH}
                            max={MAX_TITLE_LENGTH}
                            hint={t('settings.maxTitleLength.hint')}
                            onChange={(value) => {
                                edit('maxTitleLength', value);
                            }}
                        />
                        <ToggleField
                            label={t('settings.restrictFilenames')}
                            checked={draft.restrictFilenames}
                            onChange={(value) => {
                                change('restrictFilenames', value);
                            }}
                        />
                        <ToggleField
                            label={t('settings.deletePartials')}
                            checked={draft.deletePartialsOnFailure}
                            hint={t('settings.deletePartials.hint')}
                            onChange={(value) => {
                                change('deletePartialsOnFailure', value);
                            }}
                        />
                    </fieldset>

                    <fieldset className="panel">
                        <legend>{t('settings.quality')}</legend>
                        <SelectField
                            label={t('settings.maxResolution')}
                            value={draft.maxResolution}
                            options={RESOLUTIONS}
                            formatOption={(resolution) => {
                                return formatResolution(resolution, t);
                            }}
                            hint={t('settings.maxResolution.hint')}
                            onChange={(value) => {
                                change('maxResolution', value);
                            }}
                        />
                        <SelectField
                            label={t('settings.videoContainer')}
                            value={draft.videoContainer}
                            options={VIDEO_CONTAINERS}
                            onChange={(value) => {
                                change('videoContainer', value);
                            }}
                        />
                        <ToggleField
                            label={t('settings.audioOnly')}
                            checked={draft.audioOnly}
                            onChange={(value) => {
                                change('audioOnly', value);
                            }}
                        />
                        <SelectField
                            label={t('settings.audioFormat')}
                            value={draft.audioFormat}
                            options={AUDIO_FORMATS}
                            onChange={(value) => {
                                change('audioFormat', value);
                            }}
                        />
                    </fieldset>

                    <fieldset className="panel">
                        <legend>{t('settings.subtitles')}</legend>
                        <ToggleField
                            label={t('settings.playlist')}
                            checked={draft.downloadPlaylist}
                            onChange={(value) => {
                                change('downloadPlaylist', value);
                            }}
                        />
                        <ToggleField
                            label={t('settings.writeSubtitles')}
                            checked={draft.writeSubtitles}
                            onChange={(value) => {
                                change('writeSubtitles', value);
                            }}
                        />
                        <TextField
                            label={t('settings.subtitleLangs')}
                            value={draft.subtitleLangs}
                            hint={t('settings.subtitleLangs.hint')}
                            onChange={(value) => {
                                edit('subtitleLangs', value);
                            }}
                        />
                        <ToggleField
                            label={t('settings.autoSubtitles')}
                            checked={draft.autoSubtitles}
                            hint={t('settings.autoSubtitles.hint')}
                            onChange={(value) => {
                                change('autoSubtitles', value);
                            }}
                        />
                        {unboundedAutoSubtitles && (
                            <p className="field__warning" role="alert">
                                {t('subtitles.unbounded')}
                            </p>
                        )}
                        <ToggleField
                            label={t('settings.embedSubtitles')}
                            checked={draft.embedSubtitles}
                            onChange={(value) => {
                                change('embedSubtitles', value);
                            }}
                        />
                    </fieldset>

                    <fieldset className="panel">
                        <legend>{t('settings.live')}</legend>
                        <ToggleField
                            label={t('settings.liveFromStart')}
                            checked={draft.liveFromStart}
                            hint={t('settings.liveFromStart.hint')}
                            onChange={(value) => {
                                change('liveFromStart', value);
                            }}
                        />
                        <ToggleField
                            label={t('settings.waitForLive')}
                            checked={draft.waitForLive}
                            hint={t('settings.waitForLive.hint')}
                            onChange={(value) => {
                                change('waitForLive', value);
                            }}
                        />
                        <ToggleField
                            label={t('settings.verifyLiveEnd')}
                            checked={draft.verifyLiveEnd}
                            hint={t('settings.verifyLiveEnd.hint')}
                            onChange={(value) => {
                                change('verifyLiveEnd', value);
                            }}
                        />
                        <NumberField
                            label={t('settings.verifyLiveEndSeconds')}
                            value={draft.verifyLiveEndSeconds}
                            min={MIN_LIVE_END_CHECK_SECONDS}
                            max={MAX_LIVE_END_CHECK_SECONDS}
                            hint={t('settings.verifyLiveEndSeconds.hint')}
                            disabled={!draft.verifyLiveEnd}
                            onChange={(value) => {
                                edit('verifyLiveEndSeconds', value);
                            }}
                        />
                    </fieldset>

                    <fieldset className="panel">
                        <legend>{t('settings.cookies')}</legend>
                        <ToggleField
                            label={t('settings.useCookies')}
                            checked={draft.useBrowserCookies}
                            hint={t('settings.useCookies.hint')}
                            onChange={(value) => {
                                change('useBrowserCookies', value);
                            }}
                        />
                        <SelectField
                            label={t('settings.browser')}
                            value={chosenBrowser?.dataDir ?? NO_BROWSER_CHOSEN}
                            options={browserOptions}
                            formatOption={(dataDir) => {
                                return formatBrowser(detectedBrowsers, dataDir, t);
                            }}
                            hint={t('settings.browser.hint')}
                            onChange={(dataDir) => {
                                const browser = findBrowserByDir(detectedBrowsers, dataDir);
                                if (browser) {
                                    changeMany({ cookiesBrowser: browser.engine, cookiesBrowserDir: browser.dataDir, cookiesProfile: '' });
                                }
                            }}
                        />
                        {browserWarning && (
                            <p className="field__warning" role="alert">
                                {browserWarning}
                            </p>
                        )}
                        <div className="field-row">
                            <button
                                type="button"
                                className="btn btn--small"
                                onClick={() => {
                                    void loadBrowsers(true);
                                }}
                            >
                                {t('settings.rescan')}
                            </button>
                        </div>
                        {chosenBrowser && chosenBrowser.profiles.length > 0 ? (
                            <SelectField
                                label={t('settings.profile')}
                                value={draft.cookiesProfile}
                                options={profileOptions(chosenBrowser, draft.cookiesProfile)}
                                formatOption={(id) => {
                                    return formatProfile(chosenBrowser, id, t);
                                }}
                                onChange={(id) => {
                                    change('cookiesProfile', id);
                                }}
                            />
                        ) : (
                            <TextField
                                label={t('settings.profile')}
                                value={draft.cookiesProfile}
                                onChange={(value) => {
                                    edit('cookiesProfile', value);
                                }}
                            />
                        )}
                    </fieldset>

                    <ProgramsStatusBlock place="downloads" />

                    <fieldset className="panel">
                        <legend>{t('settings.advanced')}</legend>
                        <TextField
                            label={t('settings.rateLimit')}
                            value={draft.rateLimit}
                            placeholder={t('settings.rateLimit.placeholder')}
                            onChange={(value) => {
                                edit('rateLimit', value);
                            }}
                        />
                        <TextField
                            label={t('settings.ytdlpPath')}
                            value={draft.ytdlpPath}
                            placeholder={t('settings.ytdlpPath.placeholder')}
                            onChange={(value) => {
                                edit('ytdlpPath', value);
                            }}
                        />
                        <TextField
                            label={t('settings.ffmpegPath')}
                            value={draft.ffmpegPath}
                            placeholder={t('settings.ffmpegPath.placeholder')}
                            onChange={(value) => {
                                edit('ffmpegPath', value);
                            }}
                        />
                        <TextField
                            label={t('settings.jsRuntime')}
                            value={draft.jsRuntime}
                            placeholder={t('settings.jsRuntime.placeholder')}
                            hint={t('settings.jsRuntime.hint')}
                            onChange={(value) => {
                                edit('jsRuntime', value);
                            }}
                        />
                        <TextField
                            label={t('settings.extraArgs')}
                            value={draft.extraArgs}
                            hint={t('settings.extraArgs.hint')}
                            onChange={(value) => {
                                edit('extraArgs', value);
                            }}
                        />
                    </fieldset>
                </>
            )}

            {scope === 'manga' && (
                <>
                <fieldset className="panel">
                    <legend>{t('settings.manga')}</legend>
                    <div className="field-row">
                        <TextField
                            label={t('settings.mangaDir')}
                            value={draft.mangaDirectory}
                            placeholder={t('settings.mangaDir.placeholder')}
                            hint={mangaFolderLocked ? t('settings.mangaDir.locked') : undefined}
                            disabled={mangaFolderLocked}
                            onChange={(value) => {
                                edit('mangaDirectory', value);
                            }}
                        />
                        <button
                            type="button"
                            className="btn btn--small"
                            disabled={mangaFolderLocked}
                            onClick={() => {
                                void handleChooseMangaDirectory();
                            }}
                        >
                            {t('settings.browse')}
                        </button>
                    </div>
                    <div className="field">
                        <div className="field-row">
                            <button
                                type="button"
                                className="btn btn--small btn--primary"
                                disabled={mangaMigrating}
                                onClick={() => {
                                    void handleMigrateMangaFolder();
                                }}
                            >
                                {mangaMigration === null ? t('settings.mangaMigrate') : t('settings.mangaMigrate.running', { done: mangaMigration.done, total: mangaMigration.total })}
                            </button>
                        </div>
                        <span className="field__hint">{t('settings.mangaMigrate.hint')}</span>
                    </div>
                    <SelectField
                        label={t('settings.mangaFormat')}
                        value={draft.mangaFormat}
                        options={MANGA_OUTPUT_FORMATS}
                        formatOption={(format) => {
                            return format === 'cbz' ? t('settings.mangaFormat.cbz') : t('settings.mangaFormat.folder');
                        }}
                        hint={t('settings.mangaFormat.hint')}
                        onChange={(value) => {
                            change('mangaFormat', value);
                        }}
                    />
                    <TextField
                        label={t('settings.mangaFlaresolverrUrl')}
                        value={draft.mangaFlaresolverrUrl}
                        placeholder={t('settings.mangaFlaresolverrUrl.placeholder')}
                        hint={t('settings.mangaFlaresolverrUrl.hint')}
                        onChange={(value) => {
                            edit('mangaFlaresolverrUrl', value);
                        }}
                    />
                    <ToggleField
                        label={t('settings.mangaShowAdult')}
                        checked={draft.mangaShowAdult}
                        hint={t('settings.mangaShowAdult.hint')}
                        onChange={(value) => {
                            change('mangaShowAdult', value);
                        }}
                    />
                    <ToggleField
                        label={t('settings.mangaCheckNewChapters')}
                        checked={draft.mangaCheckNewChapters}
                        hint={t('settings.mangaCheckNewChapters.hint')}
                        onChange={(value) => {
                            change('mangaCheckNewChapters', value);
                        }}
                    />
                    <ToggleField
                        label={t('settings.mangaAutoDownloadNew')}
                        checked={draft.mangaAutoDownloadNew}
                        hint={t('settings.mangaAutoDownloadNew.hint')}
                        onChange={(value) => {
                            change('mangaAutoDownloadNew', value);
                        }}
                    />
                    <SelectField
                        label={t('settings.mangaSiteBrowser')}
                        value={draft.mangaSiteBrowser}
                        options={siteBrowserOptions(detectedBrowsers, draft.mangaSiteBrowser)}
                        formatOption={(browser) => {
                            return formatSiteBrowser(detectedBrowsers, browser, t);
                        }}
                        hint={t('settings.mangaSiteBrowser.hint')}
                        onChange={(browser) => {
                            change('mangaSiteBrowser', browser);
                        }}
                    />
                </fieldset>
                <MangaStoreSettings />
                <MangaHealthSettings />
                <MangaHelperSettings
                    enabled={draft.mangaFlaresolverrEnabled}
                    external={draft.mangaFlaresolverrUrl.trim().length > 0}
                    onEnabledChange={(value) => {
                        change('mangaFlaresolverrEnabled', value);
                    }}
                />
                </>
            )}

            {scope === 'anime' && animeSupported && (
                <fieldset className="panel">
                    <legend>{t('settings.anime')}</legend>
                    <div className="field-row">
                        <TextField
                            label={t('settings.animeDownloadDir')}
                            value={draft.animeDownloadDir}
                            placeholder={t('settings.animeDownloadDir.placeholder')}
                            hint={animeFolderLocked ? t('settings.animeDownloadDir.locked') : undefined}
                            disabled={animeFolderLocked}
                            onChange={(value) => {
                                edit('animeDownloadDir', value);
                            }}
                        />
                        <button
                            type="button"
                            className="btn btn--small"
                            disabled={animeFolderLocked}
                            onClick={() => {
                                void handleChooseAnimeDirectory();
                            }}
                        >
                            {t('settings.browse')}
                        </button>
                    </div>
                    <div className="field">
                        <div className="field-row">
                            <button
                                type="button"
                                className="btn btn--small btn--primary"
                                disabled={migrating}
                                onClick={() => {
                                    void handleMigrateAnimeFolder();
                                }}
                            >
                                {migrating ? t('settings.animeMigrate.running', { done: migration.done, total: migration.total }) : t('settings.animeMigrate')}
                            </button>
                        </div>
                        <span className="field__hint">{t('settings.animeMigrate.hint')}</span>
                    </div>
                    <SelectField
                        label={t('settings.animeQuality')}
                        value={draft.animeQuality}
                        options={ANIME_QUALITIES}
                        formatOption={(quality) => {
                            return formatAnimeQuality(quality, t);
                        }}
                        hint={t('settings.animeQuality.hint')}
                        onChange={(value) => {
                            change('animeQuality', value);
                        }}
                    />
                    <SelectField
                        label={t('settings.animeAudio')}
                        value={draft.animeAudio}
                        options={ANIME_AUDIOS}
                        formatOption={(audio) => {
                            return formatAnimeAudio(audio, t);
                        }}
                        hint={t('settings.animeAudio.hint')}
                        onChange={(value) => {
                            change('animeAudio', value);
                        }}
                    />
                    <SelectField
                        label={t('settings.animeSubtitles')}
                        value={draft.animeSubtitles}
                        options={ANIME_SUBTITLE_SETTINGS}
                        formatOption={(setting) => {
                            return formatAnimeSubtitles(setting, t);
                        }}
                        hint={t('settings.animeSubtitles.hint')}
                        onChange={(value) => {
                            change('animeSubtitles', value);
                        }}
                    />
                    <ToggleField
                        label={t('settings.animeCheckNewEpisodes')}
                        checked={draft.animeCheckNewEpisodes}
                        hint={t('settings.animeCheckNewEpisodes.hint')}
                        onChange={(value) => {
                            change('animeCheckNewEpisodes', value);
                        }}
                    />
                    <ToggleField
                        label={t('settings.animeAutoDownloadNew')}
                        checked={draft.animeAutoDownloadNew}
                        hint={t('settings.animeAutoDownloadNew.hint')}
                        onChange={(value) => {
                            change('animeAutoDownloadNew', value);
                        }}
                    />
                    <TranslationSettings draft={draft} change={change} edit={edit} changeMany={changeMany} />
                </fieldset>
            )}

            {scope === 'anime' && animeSupported && <ProgramsStatusBlock place="anime" />}
        </section>
    );
}
