import { IncrementalItems } from './IncrementalItems';
import { useEffect, useMemo, useState } from 'react';
import type { MangaExtension } from '@shared/manga';
import { useMangaLanguage } from '../hooks/useMangaLanguage';
import { useShownLibrary } from '../hooks/useShownManga';
import { useTranslator } from '../i18n/useTranslator';
import { useAppStore } from '../store/appStore';
import { UPDATE_ALL_KEY, useMangaStore } from '../store/mangaStore';
import { ConfirmButton } from './ConfirmButton';
import { MangaExtensionsAbout } from './MangaExtensionsAbout';
import { TextField, ToggleField } from './fields';
import { extensionLanguages, filterExtensions, isListed, libraryByExtension } from './mangaText';
import { MangaExtensionLibraryDialog } from './MangaExtensionLibraryDialog';
import { MangaErrorNotice } from './MangaErrorNotice';
import { NotFound } from './NotFound';

interface LibraryCountButtonProps {
    extension: MangaExtension;
    count: number;
    onOpen: (extension: MangaExtension) => void;
}

function LibraryCountButton({ extension, count, onOpen }: LibraryCountButtonProps) {
    const t = useTranslator();
    return (
        <button
            type="button"
            className="btn btn--small"
            disabled={count === 0}
            title={t('manga.ext.library.hint', { count })}
            aria-label={`${t('manga.ext.library.hint', { count })}: ${extension.name}`}
            data-testid="manga-extension-library-count"
            onClick={() => {
                onOpen(extension);
            }}
        >
            {count}
        </button>
    );
}

export function MangaExtensions() {
    const t = useTranslator();
    const extensions = useMangaStore((state) => {
        return state.extensions;
    });
    const loadExtensions = useMangaStore((state) => {
        return state.loadExtensions;
    });
    const updateAllExtensions = useMangaStore((state) => {
        return state.updateAllExtensions;
    });
    const setView = useMangaStore((state) => {
        return state.setView;
    });
    const changeExtension = useMangaStore((state) => {
        return state.changeExtension;
    });
    const setExtensionFilter = useMangaStore((state) => {
        return state.setExtensionFilter;
    });
    const showAdult = useAppStore((state) => {
        return state.settings.mangaShowAdult;
    });
    const sources = useMangaStore((state) => {
        return state.browse.sources;
    });
    const sourcesStatus = useMangaStore((state) => {
        return state.browse.sourcesStatus;
    });
    const loadSources = useMangaStore((state) => {
        return state.loadSources;
    });
    const openLibraryManga = useMangaStore((state) => {
        return state.openLibraryManga;
    });
    const library = useShownLibrary();
    const mangasByExtension = useMemo(() => {
        return libraryByExtension(library, sources);
    }, [library, sources]);
    const [libraryOf, setLibraryOf] = useState<MangaExtension | null>(null);
    const { stores, status, error, busy, filter } = extensions;

    useEffect(() => {
        if (status === 'idle') {
            void loadExtensions(false);
        }
    }, [status, loadExtensions]);

    const hasLibrary = library.length > 0;
    useEffect(() => {
        if (hasLibrary && sourcesStatus === 'idle' && useMangaStore.getState().browse.sourcesStatus === 'idle') {
            void loadSources();
        }
    }, [hasLibrary, sourcesStatus, loadSources]);

    const listedExtensions = extensions.extensions.filter((extension) => {
        return isListed(extension.contentWarning, showAdult);
    });
    const lang = useMangaLanguage(extensionLanguages(listedExtensions));
    const shown = filterExtensions(extensions.extensions, { ...filter, lang }, showAdult);
    const updatable = listedExtensions.filter((extension) => {
        return extension.isInstalled && extension.hasUpdate;
    }).length;

    const onlyInstalledHidesAll =
        filter.onlyInstalled &&
        filter.query.trim().length === 0 &&
        listedExtensions.length > 0 &&
        filterExtensions(listedExtensions, { ...filter, lang, onlyInstalled: false }, showAdult).length > 0;

    return (
        <section className="manga__extensions" aria-label={t('manga.nav.extensions')}>
            <MangaExtensionsAbout />
            {stores.length === 0 && status !== 'loading' && (
                <div className="panel">
                    <p className="empty">{t('manga.ext.noStores')}</p>
                    <div className="job__actions">
                        <button
                            type="button"
                            className="btn btn--small btn--primary"
                            onClick={() => {
                                setView('settings');
                            }}
                        >
                            {t('manga.ext.openSettings')}
                        </button>
                    </div>
                </div>
            )}
            {error && (
                <MangaErrorNotice error={error} />
            )}
            {status === 'loading' && <p className="empty">{t('manga.ext.loading')}</p>}
            {stores.length > 0 && (
                <>
                    <div className="field-row">
                        <TextField
                            search
                            label={t('manga.ext.filter')}
                            value={filter.query}
                            onChange={(query) => {
                                setExtensionFilter({ query });
                            }}
                        />
                        <ToggleField
                            label={t('manga.ext.onlyInstalled')}
                            checked={filter.onlyInstalled}
                            onChange={(onlyInstalled) => {
                                setExtensionFilter({ onlyInstalled });
                            }}
                        />
                        <button
                            type="button"
                            className="btn btn--small"
                            disabled={status === 'loading'}
                            onClick={() => {
                                void loadExtensions(true);
                            }}
                        >
                            {t('manga.ext.refresh')}
                        </button>
                        {updatable > 0 && (
                            <button
                                type="button"
                                className="btn btn--small btn--primary"
                                disabled={busy.includes(UPDATE_ALL_KEY)}
                                onClick={() => {
                                    void updateAllExtensions();
                                }}
                            >
                                {busy.includes(UPDATE_ALL_KEY) ? t('manga.ext.updatingAll') : t('manga.ext.updateAll', { count: updatable })}
                            </button>
                        )}
                    </div>
                    {status === 'ready' && shown.length === 0 && onlyInstalledHidesAll && <p className="empty">{t('manga.ext.noneInstalled')}</p>}
                    {status === 'ready' && shown.length === 0 && !onlyInstalledHidesAll && <NotFound text={t('manga.ext.none')} />}
                    <ul className="history__list">
                        <IncrementalItems items={shown} listKey="manga-extensions" end="li" renderItem={(extension) => {
                            const working = busy.includes(extension.pkgName);
                            return (
                                <li key={extension.pkgName} className="history__item" data-testid="manga-extension">
                                    <div className="history__main">
                                        <span className="history__title">{extension.name}</span>
                                        <span className="history__meta">{`${extension.lang} · ${extension.versionName}`}</span>
                                    </div>
                                    {extension.contentWarning === 'NSFW' && <span className="badge badge--error">{t('manga.ext.nsfw')}</span>}
                                    {!extension.isCompatible && (
                                        <span className="badge badge--error" title={t('manga.ext.incompatibleHint', { lib: extension.extensionLib ?? '?' })}>
                                            {t('manga.ext.incompatible')}
                                        </span>
                                    )}
                                    {extension.isObsolete && <span className="badge badge--cancelled">{t('manga.ext.obsolete')}</span>}
                                    {extension.isInstalled && (
                                        <>
                                            <LibraryCountButton
                                                extension={extension}
                                                count={mangasByExtension.get(extension.pkgName)?.length ?? 0}
                                                onOpen={setLibraryOf}
                                            />
                                            <span className="badge badge--done">{t('manga.ext.installed')}</span>
                                        </>
                                    )}
                                    <span className="anime__actions">
                                        {!extension.isInstalled && extension.isCompatible && (
                                            <button
                                                type="button"
                                                className="btn btn--small btn--primary"
                                                disabled={working}
                                                aria-label={`${t('manga.ext.install')}: ${extension.name}`}
                                                onClick={() => {
                                                    void changeExtension(extension.pkgName, 'install');
                                                }}
                                            >
                                                {working ? t('manga.ext.working') : t('manga.ext.install')}
                                            </button>
                                        )}
                                        {extension.isInstalled && extension.hasUpdate && (
                                            <button
                                                type="button"
                                                className="btn btn--small btn--primary"
                                                disabled={working}
                                                aria-label={`${t('manga.ext.update')}: ${extension.name}`}
                                                onClick={() => {
                                                    void changeExtension(extension.pkgName, 'update');
                                                }}
                                            >
                                                {working ? t('manga.ext.working') : t('manga.ext.update')}
                                            </button>
                                        )}
                                        {extension.isInstalled && (
                                            <ConfirmButton
                                                className="btn btn--small btn--hot"
                                                disabled={working}
                                                ariaLabel={`${t('manga.ext.uninstall')}: ${extension.name}`}
                                                dialog={{ title: t('confirm.uninstallExtension.title', { name: extension.name }), message: t('confirm.uninstallExtension.message'), confirmLabel: t('manga.ext.uninstall') }}
                                                onConfirm={() => {
                                                    void changeExtension(extension.pkgName, 'uninstall');
                                                }}
                                            >
                                                {t('manga.ext.uninstall')}
                                            </ConfirmButton>
                                        )}
                                    </span>
                                </li>
                            );
                        }} />
                    </ul>
                </>
            )}
            {libraryOf !== null && (
                <MangaExtensionLibraryDialog
                    extensionName={libraryOf.name}
                    mangas={mangasByExtension.get(libraryOf.pkgName) ?? []}
                    onOpen={(mangaId) => {
                        setLibraryOf(null);
                        void openLibraryManga(mangaId);
                    }}
                    onClose={() => {
                        setLibraryOf(null);
                    }}
                />
            )}
        </section>
    );
}
