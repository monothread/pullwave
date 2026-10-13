import { useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import type { LibraryManga, MangaChapter, MangaDetails, MangaSource, MangaSummary } from '@shared/manga';
import { droppedChapters, keptUnmatched, matchChapters } from '@shared/mangaSourceMigration';
import { useModalDialog } from '../hooks/useModalDialog';
import { useTranslator } from '../i18n/useTranslator';
import { useAppStore } from '../store/appStore';
import { useMangaStore } from '../store/mangaStore';
import { SelectField, TextField } from './fields';
import { migrationSources, RESULTS_PER_SOURCE } from './mangaSearchSources';
import { ALL_LANGUAGES, mangaErrorKey } from './mangaText';
import { sourceLanguageLabel, sourceLanguages } from './MangaSources';
import { RowLink } from './RowLink';

const ALL_SOURCES = 'all';

interface MangaMigrateSourceProps {
    manga: LibraryManga;
    onClose: () => void;
}

interface Candidate {
    source: MangaSource;
    item: MangaSummary;
}

interface Chosen {
    candidate: Candidate;
    status: 'loading' | 'ready' | 'error';
    details: MangaDetails | null;
    chapters: MangaChapter[];
    errorKey: ReturnType<typeof mangaErrorKey> | null;
}

// A window to move a manga of the library to the same manga in another source: the sources are limited by language (and can be one only), they
// are searched for the title (one of them, or all of them one after the other), the user picks the manga, and what the move does to the
// chapters is shown before it is done. It is also the way to give a manga whose extension is gone a source that works.
export function MangaMigrateSource({ manga, onClose }: MangaMigrateSourceProps) {
    const t = useTranslator();
    const titleId = useId();
    const sourcesStatus = useMangaStore((state) => {
        return state.browse.sourcesStatus;
    });
    const allSources = useMangaStore((state) => {
        return state.browse.sources;
    });
    const loadSources = useMangaStore((state) => {
        return state.loadSources;
    });
    const migrateSource = useMangaStore((state) => {
        return state.migrateSource;
    });
    const showAdult = useAppStore((state) => {
        return state.settings.mangaShowAdult;
    });
    const [language, setLanguage] = useState(ALL_LANGUAGES);
    const [choice, setChoice] = useState(ALL_SOURCES);
    const [query, setQuery] = useState(manga.title);
    const [searching, setSearching] = useState<{ done: number; total: number; name: string } | null>(null);
    const [results, setResults] = useState<Candidate[] | null>(null);
    const [chosen, setChosen] = useState<Chosen | null>(null);
    const [problem, setProblem] = useState<string | null>(null);
    const [working, setWorking] = useState(false);
    const { dialogRef, handleKeyDown } = useModalDialog(onClose, !working);

    useEffect(() => {
        if (sourcesStatus === 'idle') {
            void loadSources();
        }
    }, [sourcesStatus, loadSources]);

    // The languages of the sources the manga can move to; a chosen language that is not there any more stands for all of them.
    const languages = sourceLanguages(migrationSources(allSources, manga.sourceId, ALL_LANGUAGES, showAdult));
    const shownLanguage = languages.includes(language) ? language : ALL_LANGUAGES;
    const sources = migrationSources(allSources, manga.sourceId, shownLanguage, showAdult);
    const shownChoice = sources.some((source) => {
        return source.id === choice;
    })
        ? choice
        : ALL_SOURCES;

    async function search(): Promise<void> {
        const wanted =
            shownChoice === ALL_SOURCES
                ? sources
                : sources.filter((source) => {
                      return source.id === shownChoice;
                  });
        setChosen(null);
        setProblem(null);
        setResults([]);
        for (const [index, source] of wanted.entries()) {
            setSearching({ done: index, total: wanted.length, name: source.name });
            const response = await window.api.manga.list({ sourceId: source.id, kind: 'search', page: 1, query: query.trim() });
            if (response.ok) {
                const found = response.value.items.slice(0, RESULTS_PER_SOURCE).map((item) => {
                    return { source, item };
                });
                setResults((current) => {
                    return [...(current ?? []), ...found];
                });
            }
        }
        setSearching(null);
    }

    async function pick(candidate: Candidate): Promise<void> {
        setProblem(null);
        setChosen({ candidate, status: 'loading', details: null, chapters: [], errorKey: null });
        const response = await window.api.manga.details(candidate.item.remoteId);
        setChosen(
            response.ok
                ? { candidate, status: 'ready', details: response.value.details, chapters: response.value.chapters, errorKey: null }
                : { candidate, status: 'error', details: null, chapters: [], errorKey: mangaErrorKey(response.error.code) }
        );
    }

    async function confirm(): Promise<void> {
        if (chosen === null || chosen.status !== 'ready') {
            return;
        }
        setWorking(true);
        const response = await migrateSource({
            mangaId: manga.id,
            target: { manga: chosen.candidate.item, details: chosen.details, chapters: chosen.chapters }
        });
        setWorking(false);
        if (response.ok) {
            onClose();
            return;
        }
        setProblem(response.reason === 'exists' ? t('manga.migrateSource.error.exists') : response.reason === 'busy' ? t('manga.migrateSource.error.busy') : t('manga.migrateSource.error.failed'));
    }

    const matching = chosen?.status === 'ready' ? matchChapters(manga.chapters, chosen.chapters) : null;

    return createPortal(
        <div
            className="modal-backdrop"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget && !working) {
                    onClose();
                }
            }}
        >
            <div ref={dialogRef} className="modal modal--wide manga__migrate" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={handleKeyDown}>
                <h2 id={titleId} className="modal__title">
                    {t('manga.migrateSource.title')}
                </h2>
                <p className="modal__hint">{t('manga.migrateSource.hint')}</p>
                {sources.length === 0 && languages.length === 0 ? (
                    <p className="empty">{t('manga.migrateSource.noSources')}</p>
                ) : (
                    <form
                        className="manga__migrate-filters"
                        onSubmit={(event) => {
                            event.preventDefault();
                            void search();
                        }}
                    >
                        <SelectField
                            label={t('manga.sources.language')}
                            value={shownLanguage}
                            options={[ALL_LANGUAGES, ...languages]}
                            formatOption={(option) => {
                                return option === ALL_LANGUAGES ? t('manga.sources.allLanguages') : sourceLanguageLabel(option, t);
                            }}
                            onChange={(option) => {
                                setLanguage(option);
                                setChoice(ALL_SOURCES);
                            }}
                        />
                        <SelectField
                            label={t('manga.migrateSource.source')}
                            value={shownChoice}
                            options={[ALL_SOURCES, ...sources.map((source) => {
                                return source.id;
                            })]}
                            formatOption={(option) => {
                                const found = sources.find((source) => {
                                    return source.id === option;
                                });
                                return found === undefined ? t('manga.migrateSource.allSources') : `${found.name} (${found.lang})`;
                            }}
                            onChange={setChoice}
                        />
                        <TextField label={t('manga.migrateSource.query')} value={query} onChange={setQuery} />
                        <button type="submit" className="btn btn--primary" disabled={searching !== null || sources.length === 0 || query.trim().length === 0}>
                            {t('manga.migrateSource.search')}
                        </button>
                    </form>
                )}
                <div className="manga__migrate-body">
                    {searching !== null && <p className="empty">{t('manga.migrateSource.searching', { name: searching.name, done: searching.done + 1, total: searching.total })}</p>}
                    {results !== null && searching === null && results.length === 0 && <p className="empty">{t('manga.migrateSource.none')}</p>}
                    {results !== null && results.length > 0 && (
                        <ul className="history__list manga__candidates">
                            {results.map((candidate) => {
                                const selected = chosen?.candidate === candidate;
                                return (
                                    <li key={`${candidate.source.id}-${String(candidate.item.remoteId)}`} className={`history__item row--link${selected ? ' history__item--selected' : ''}`} data-testid="manga-candidate">
                                        <div className="history__main">
                                            <span className="history__title">
                                                <RowLink
                                                    label={t('manga.migrateSource.pick', { title: candidate.item.title, source: candidate.source.name })}
                                                    title={candidate.item.title}
                                                    onClick={() => {
                                                        void pick(candidate);
                                                    }}
                                                >
                                                    {candidate.item.title}
                                                </RowLink>
                                            </span>
                                            <span className="history__meta">{`${candidate.source.name} · ${candidate.source.lang}`}</span>
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                    {chosen?.status === 'loading' && <p className="empty">{t('manga.migrateSource.reading')}</p>}
                    {chosen?.status === 'error' && chosen.errorKey !== null && (
                        <p className="field__warning" role="alert">
                            {t(chosen.errorKey)}
                        </p>
                    )}
                </div>
                {matching !== null && (
                    <p className="field__hint" data-testid="manga-migration-preview">
                        {t('manga.migrateSource.preview', {
                            matched: matching.matched.length,
                            total: manga.chapters.length,
                            added: matching.added.length,
                            kept: keptUnmatched(matching).length,
                            dropped: droppedChapters(matching).length
                        })}
                    </p>
                )}
                {problem !== null && (
                    <p className="field__warning" role="alert">
                        {problem}
                    </p>
                )}
                <div className="modal__actions">
                    <button type="button" className="btn btn--small" disabled={working} onClick={onClose}>
                        {t('manga.migrateSource.cancel')}
                    </button>
                    <button
                        type="button"
                        className="btn btn--small btn--primary"
                        disabled={matching === null || working}
                        onClick={() => {
                            void confirm();
                        }}
                    >
                        {t('manga.migrateSource.confirm')}
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
}
