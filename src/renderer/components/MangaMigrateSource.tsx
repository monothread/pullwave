import { useEffect, useState } from 'react';
import type { LibraryManga, MangaChapter, MangaDetails, MangaSource, MangaSummary } from '@shared/manga';
import { droppedChapters, keptUnmatched, matchChapters } from '@shared/mangaSourceMigration';
import { useTranslator } from '../i18n/useTranslator';
import { useAppStore } from '../store/appStore';
import { useMangaStore } from '../store/mangaStore';
import { TextField } from './fields';
import { RESULTS_PER_SOURCE } from './mangaSearchSources';
import { listedSources, mangaErrorKey } from './mangaText';
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

// Moves a manga of the library to the same manga in another source: the other sources are searched for its title (one of them, or all of
// them one after the other), the user picks the manga, and what the move does to the chapters is shown before it is done.
export function MangaMigrateSource({ manga, onClose }: MangaMigrateSourceProps) {
    const t = useTranslator();
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
    const [choice, setChoice] = useState(ALL_SOURCES);
    const [query, setQuery] = useState(manga.title);
    const [searching, setSearching] = useState<{ done: number; total: number; name: string } | null>(null);
    const [results, setResults] = useState<Candidate[] | null>(null);
    const [chosen, setChosen] = useState<Chosen | null>(null);
    const [problem, setProblem] = useState<string | null>(null);
    const [working, setWorking] = useState(false);

    useEffect(() => {
        if (sourcesStatus === 'idle') {
            void loadSources();
        }
    }, [sourcesStatus, loadSources]);

    // The sources the manga can move to: not the one it is in, and not the ones for adults unless they are asked for. In alphabetical order,
    // which is also the order they are searched in.
    const sources = listedSources(allSources, showAdult)
        .filter((source) => {
            return source.id !== manga.sourceId;
        })
        .sort((first, second) => {
            return first.name.localeCompare(second.name, undefined, { sensitivity: 'base' }) || first.lang.localeCompare(second.lang);
        });

    async function search(): Promise<void> {
        const wanted = choice === ALL_SOURCES ? sources : sources.filter((source) => {
            return source.id === choice;
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
        if (!response.ok) {
            setProblem(response.reason === 'exists' ? t('manga.migrateSource.error.exists') : response.reason === 'busy' ? t('manga.migrateSource.error.busy') : t('manga.migrateSource.error.failed'));
        }
    }

    const matching = chosen?.status === 'ready' ? matchChapters(manga.chapters, chosen.chapters) : null;

    return (
        <section className="panel manga__migrate" aria-label={t('manga.migrateSource.title')}>
            <span className="section-label">{t('manga.migrateSource.title')}</span>
            <p className="field__hint">{t('manga.migrateSource.hint')}</p>
            {sources.length === 0 ? (
                <p className="empty">{t('manga.migrateSource.noSources')}</p>
            ) : (
                <form
                    className="field-row"
                    onSubmit={(event) => {
                        event.preventDefault();
                        void search();
                    }}
                >
                    <label className="field">
                        <span className="field__label">{t('manga.migrateSource.source')}</span>
                        <select
                            className="input"
                            aria-label={t('manga.migrateSource.source')}
                            value={choice}
                            onChange={(event) => {
                                setChoice(event.target.value);
                            }}
                        >
                            <option value={ALL_SOURCES}>{t('manga.migrateSource.allSources')}</option>
                            {sources.map((source) => {
                                return (
                                    <option key={source.id} value={source.id}>
                                        {`${source.name} (${source.lang})`}
                                    </option>
                                );
                            })}
                        </select>
                    </label>
                    <TextField label={t('manga.migrateSource.query')} value={query} onChange={setQuery} />
                    <button type="submit" className="btn btn--primary" disabled={searching !== null || query.trim().length === 0}>
                        {t('manga.migrateSource.search')}
                    </button>
                </form>
            )}
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
            <div className="job__actions">
                <button type="button" className="btn btn--small btn--primary" disabled={matching === null || working} onClick={() => {
                    void confirm();
                }}>
                    {t('manga.migrateSource.confirm')}
                </button>
                <button type="button" className="btn btn--small btn--ghost" onClick={onClose}>
                    {t('manga.migrateSource.cancel')}
                </button>
            </div>
        </section>
    );
}
