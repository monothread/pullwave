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
import { chosenBrowserWarning, findChosenBrowser, NO_BROWSER_CHOSEN } from '@shared/browserChoice';
import { LANGUAGE_NAMES, type Translator } from '@shared/i18n';
import { hasUnboundedAutoSubtitles } from '@shared/subtitles';
import type { DetectedBrowser, LanguageSetting, ThemeName } from '@shared/types';
import { useAutoSaveSettings, type SaveStatus } from '../hooks/useAutoSaveSettings';
import { useTranslator } from '../i18n/useTranslator';
import { useAnimeStore } from '../store/animeStore';
import { useAppStore } from '../store/appStore';
import { NumberField, SelectField, TextField, ToggleField } from './fields';
import { formatResolution } from './settingsFormat';
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

// Where the settings are shown: the ones of the whole app, and the ones of the video downloader and of the anime section.
export type SettingsScope = 'global' | 'downloads' | 'anime';

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
    const binaries = useAppStore((state) => {
        return state.binaries;
    });
    const updatingYtdlp = useAppStore((state) => {
        return state.updating;
    });
    const updateYtdlp = useAppStore((state) => {
        return state.updateYtdlp;
    });
    const resetYtdlp = useAppStore((state) => {
        return state.resetYtdlp;
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
    const aniCli = useAnimeStore((state) => {
        return state.status.aniCli;
    });
    const updatingAniCli = useAnimeStore((state) => {
        return state.updatingCli;
    });
    const updateAniCli = useAnimeStore((state) => {
        return state.updateCli;
    });
    const resetAniCli = useAnimeStore((state) => {
        return state.resetCli;
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

    // The browsers are for the cookies of the video downloader; the tray is a setting of the whole app.
    useEffect(() => {
        if (scope === 'downloads') {
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

    async function handleChooseAnimeDirectory(): Promise<void> {
        const directory = await chooseDirectory();
        if (directory) {
            change('animeDownloadDir', directory);
        }
    }

    // With anime in the library the folder changes only by a migration, which moves the files too.
    const animeFolderLocked = library.length > 0;
    const migrating = migration !== null;

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
                                return t(startTab === 'anime' ? 'tab.anime' : 'tab.downloads');
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

                    <fieldset className="panel">
                        <legend>YT-DLP</legend>
                        <p className="update-status" aria-live="polite">
                            {binaries?.ytdlp.found
                                ? t('settings.ytdlp.installed', { version: binaries.ytdlp.version ?? t('settings.ytdlp.versionUnknown') })
                                : t('settings.ytdlp.notFound')}
                        </p>
                        <div className="field-row">
                            <button
                                type="button"
                                className="btn btn--small"
                                disabled={updatingYtdlp}
                                onClick={() => {
                                    void updateYtdlp();
                                }}
                            >
                                {updatingYtdlp ? t('settings.ytdlp.updating') : t('settings.ytdlp.update')}
                            </button>
                            {binaries?.ytdlp.source === 'updated' && (
                                <button
                                    type="button"
                                    className="btn btn--small"
                                    disabled={updatingYtdlp}
                                    onClick={() => {
                                        void resetYtdlp();
                                    }}
                                >
                                    {t('settings.ytdlp.reset')}
                                </button>
                            )}
                        </div>
                        <span className="field__hint">{t('settings.ytdlp.hint')}</span>
                    </fieldset>

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
                    <div className="field">
                        <span className="field__label">ani-cli</span>
                        <p className="update-status" aria-live="polite">
                            {aniCli?.found ? t('settings.anicli.installed', { version: aniCli.version ?? t('settings.ytdlp.versionUnknown') }) : t('settings.anicli.notFound')}
                        </p>
                        <div className="field-row">
                            <button
                                type="button"
                                className="btn btn--small"
                                disabled={updatingAniCli}
                                onClick={() => {
                                    void updateAniCli();
                                }}
                            >
                                {updatingAniCli ? t('settings.anicli.updating') : t('settings.anicli.update')}
                            </button>
                            {aniCli?.source === 'updated' && (
                                <button
                                    type="button"
                                    className="btn btn--small"
                                    disabled={updatingAniCli}
                                    onClick={() => {
                                        void resetAniCli();
                                    }}
                                >
                                    {t('settings.anicli.reset')}
                                </button>
                            )}
                        </div>
                        <span className="field__hint">{t('settings.anicli.hint')}</span>
                    </div>
                </fieldset>
            )}
        </section>
    );
}
