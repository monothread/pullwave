import { useState } from 'react';
import type { MangaSource } from '@shared/manga';
import { useTranslator } from '../i18n/useTranslator';
import { useAppStore } from '../store/appStore';
import { useMangaStore } from '../store/mangaStore';
import { SelectField } from './fields';
import { ALL_LANGUAGES, listedSources } from './mangaText';
import { RowLink } from './RowLink';

// The language of a source that reads sites in several languages (the extension says "all").
const SEVERAL_LANGUAGES = 'all';

// The languages of the sources, each once; the sources of several languages go last, the others by code.
export function sourceLanguages(sources: readonly MangaSource[]): string[] {
    return [
        ...new Set(
            sources.map((source) => {
                return source.lang;
            })
        )
    ].sort((first, second) => {
        return Number(first === SEVERAL_LANGUAGES) - Number(second === SEVERAL_LANGUAGES) || first.localeCompare(second);
    });
}

interface MangaSourceIconProps {
    url: string | null;
}

// The icon of a source, served by the manga server; nothing is shown when there is none or it does not load.
function MangaSourceIcon({ url }: MangaSourceIconProps) {
    const [failedUrl, setFailedUrl] = useState<string | null>(null);
    if (url === null || url === failedUrl) {
        return <span className="manga__source-icon manga__source-icon--none" aria-hidden="true" />;
    }
    return (
        <img
            className="manga__source-icon"
            src={url}
            alt=""
            loading="lazy"
            width={40}
            height={40}
            onError={() => {
                setFailedUrl(url);
            }}
        />
    );
}

// The sources of the installed extensions, by language: a source is what has the mangas, so it is what is picked here.
export function MangaSources() {
    const t = useTranslator();
    const browse = useMangaStore((state) => {
        return state.browse;
    });
    const openSource = useMangaStore((state) => {
        return state.openSource;
    });
    const setSourceLanguage = useMangaStore((state) => {
        return state.setSourceLanguage;
    });
    const showAdult = useAppStore((state) => {
        return state.settings.mangaShowAdult;
    });
    const sources = listedSources(browse.sources, showAdult);

    const languages = sourceLanguages(sources);
    // A language that was remembered but is not there any more (its sources are gone or hidden) lists everything.
    const sourceLanguage = languages.includes(browse.sourceLanguage) ? browse.sourceLanguage : ALL_LANGUAGES;
    const shown = sources.filter((source) => {
        return sourceLanguage === ALL_LANGUAGES || source.lang === sourceLanguage;
    });
    const groups = languages
        .map((language) => {
            return {
                language,
                sources: shown.filter((source) => {
                    return source.lang === language;
                })
            };
        })
        .filter((group) => {
            return group.sources.length > 0;
        });

    function languageLabel(language: string): string {
        return language === SEVERAL_LANGUAGES ? t('manga.sources.multiLanguage') : language.toUpperCase();
    }

    return (
        <section className="manga__sources" aria-label={t('manga.nav.browse')}>
            <div className="field-row">
                <SelectField
                    label={t('manga.sources.language')}
                    value={sourceLanguage}
                    options={[ALL_LANGUAGES, ...languages]}
                    formatOption={(language) => {
                        return language === ALL_LANGUAGES ? t('manga.sources.allLanguages') : languageLabel(language);
                    }}
                    onChange={setSourceLanguage}
                />
            </div>
            <span className="section-label">{t('manga.sources.count', { count: shown.length })}</span>
            {groups.map((group) => {
                return (
                    <div key={group.language} className="manga__source-group" data-testid="manga-source-group">
                        <h3 className="section-label">{languageLabel(group.language)}</h3>
                        <ul className="history__list">
                            {group.sources.map((source: MangaSource) => {
                                return (
                                    <li key={source.id} className="history__item row--link" data-testid="manga-source">
                                        <MangaSourceIcon url={source.iconUrl} />
                                        <div className="history__main">
                                            <span className="history__title">
                                                <RowLink
                                                    label={`${t('manga.browse.open')}: ${source.name}`}
                                                    title={source.name}
                                                    onClick={() => {
                                                        openSource(source.id, 'popular');
                                                    }}
                                                >
                                                    {source.name}
                                                </RowLink>
                                            </span>
                                            {source.contentWarning === 'NSFW' && <span className="history__meta">{t('manga.ext.nsfw')}</span>}
                                        </div>
                                        <span className="anime__actions">
                                            <button
                                                type="button"
                                                className="btn btn--small btn--primary"
                                                aria-label={`${t('manga.browse.mode.popular')}: ${source.name}`}
                                                onClick={() => {
                                                    openSource(source.id, 'popular');
                                                }}
                                            >
                                                {t('manga.browse.mode.popular')}
                                            </button>
                                            {source.supportsLatest && (
                                                <button
                                                    type="button"
                                                    className="btn btn--small"
                                                    aria-label={`${t('manga.browse.mode.latest')}: ${source.name}`}
                                                    onClick={() => {
                                                        openSource(source.id, 'latest');
                                                    }}
                                                >
                                                    {t('manga.browse.mode.latest')}
                                                </button>
                                            )}
                                        </span>
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                );
            })}
        </section>
    );
}
