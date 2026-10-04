import { useEffect, useRef, useState } from 'react';
import type { AnimeEpisodeRecord, LibraryAnime } from '@shared/anime';
import type { Translator } from '@shared/i18n';
import { useTranslator } from '../i18n/useTranslator';
import { useAnimeStore } from '../store/animeStore';
import { animeErrorKey, animeStatusKey, downloadedCount, groupLibrary, matchesSearch, resumePosition, seasonLabel, type LibraryGroup } from './animeText';
import { AnimeCover } from './AnimeCover';
import { AnimeRemove } from './AnimeRemove';
import { cleanSeasonName, cleanSeriesName, foldSeries, isValidSeason, MAX_SEASON, MAX_SEASON_NAME_LENGTH, sameSeries } from '@shared/series';
import { NumberField, TextField } from './fields';
import { formatBytes, formatDuration } from './jobStatus';
import { RowLink } from './RowLink';
import { SeriesMenu } from './SeriesMenu';

interface EpisodeRowProps {
    anime: LibraryAnime;
    episode: AnimeEpisodeRecord;
    t: Translator;
}

function episodeMeta(episode: AnimeEpisodeRecord, t: Translator): string {
    const parts: string[] = [t(animeStatusKey(episode.status))];
    if (episode.sizeBytes !== null) {
        parts.push(formatBytes(episode.sizeBytes));
    }
    const resume = resumePosition(episode);
    if (!episode.watched && resume !== null) {
        parts.push(t('anime.resume', { time: formatDuration(resume) }));
    }
    return parts.join(' · ');
}

function EpisodeRow({ anime, episode, t }: EpisodeRowProps) {
    const play = useAnimeStore((state) => {
        return state.play;
    });
    const retryJob = useAnimeStore((state) => {
        return state.retryJob;
    });
    const resumeJob = useAnimeStore((state) => {
        return state.resumeJob;
    });
    const setWatched = useAnimeStore((state) => {
        return state.setWatched;
    });
    const label = t('anime.episode', { number: episode.number });
    // A downloaded episode whose file is there is played by clicking on its row.
    const openable = episode.status === 'done' && !episode.fileMissing;

    return (
        <li
            className={`history__item${episode.status === 'error' || episode.fileMissing ? ' history__item--error' : ''}${episode.watched ? ' history__item--watched' : ''}${openable ? ' row--link' : ''}`}
            data-testid="anime-episode"
        >
            <div className="history__main">
                <span className="history__title">
                    {episode.watched && (
                        <span className="watched-mark" role="img" aria-label={t('anime.watched')} title={t('anime.watched')}>
                            ✓
                        </span>
                    )}
                    {openable ? (
                        <RowLink
                            label={`${t('anime.play')}: ${anime.title} ${label}`}
                            onClick={() => {
                                play(anime.id, episode.id);
                            }}
                        >
                            {label}
                        </RowLink>
                    ) : (
                        label
                    )}
                    {episode.fileMissing && (
                        <span className="missing-mark" role="img" aria-label={t('anime.fileMissing')} title={t('anime.fileMissing.hint')}>
                            !
                        </span>
                    )}
                </span>
                <span className="history__meta">{episodeMeta(episode, t)}</span>
                {episode.error && (
                    <span className="history__meta" title={episode.error.raw}>
                        {t(animeErrorKey(episode.error.code))}
                    </span>
                )}
            </div>
            <span className="anime__actions">
                {episode.status === 'done' && (
                    <>
                        <button
                            type="button"
                            className="btn btn--small"
                            aria-pressed={episode.watched}
                            aria-label={`${t(episode.watched ? 'anime.markUnwatched' : 'anime.markWatched')}: ${anime.title} ${label}`}
                            onClick={() => {
                                void setWatched(episode.id, !episode.watched);
                            }}
                        >
                            {t(episode.watched ? 'anime.markUnwatched' : 'anime.markWatched')}
                        </button>
                    </>
                )}
                {episode.status === 'paused' && (
                    <button
                        type="button"
                        className="btn btn--small btn--primary"
                        aria-label={`${t('anime.job.resume')}: ${anime.title} ${label}`}
                        onClick={() => {
                            void resumeJob(episode.id);
                        }}
                    >
                        {t('anime.job.resume')}
                    </button>
                )}
                {episode.status === 'idle' && (
                    <button
                        type="button"
                        className="btn btn--small btn--primary"
                        aria-label={`${t('anime.episode.download')}: ${anime.title} ${label}`}
                        onClick={() => {
                            void retryJob(episode.id);
                        }}
                    >
                        {t('anime.episode.download')}
                    </button>
                )}
                {(episode.status === 'error' || episode.status === 'cancelled') && (
                    <button
                        type="button"
                        className="btn btn--small"
                        aria-label={`${t('anime.job.retry')}: ${anime.title} ${label}`}
                        onClick={() => {
                            void retryJob(episode.id);
                        }}
                    >
                        {t('anime.job.retry')}
                    </button>
                )}
            </span>
        </li>
    );
}

// What can be changed in an anime that is in a series: its place in it (the order) and the name it is shown with. The series itself
// cannot change (it is renamed with the whole series, and leaving it is removing the anime).
function SeasonEditor({ anime, series, t, onClose }: { anime: LibraryAnime; series: string; t: Translator; onClose: () => void }) {
    const setSeries = useAnimeStore((state) => {
        return state.setSeries;
    });
    const [season, setSeason] = useState(anime.season ?? 1);
    const [seasonName, setSeasonName] = useState(anime.seasonName ?? '');
    const [problem, setProblem] = useState<string | null>(null);

    async function save(): Promise<void> {
        const name = cleanSeasonName(seasonName);
        if (!isValidSeason(season) || name === undefined) {
            setProblem(t('anime.season.error.invalid'));
            return;
        }
        const response = await setSeries(anime.id, series, season, name);
        if (response.ok) {
            onClose();
            return;
        }
        setProblem(response.reason === 'season-taken' ? t('anime.series.error.taken', { order: season, suggested: response.suggested }) : t('anime.season.error.invalid'));
    }

    return (
        <div className="series-editor" role="group" aria-label={`${t('anime.season.edit')}: ${anime.title}`}>
            <div className="field-row series-name" title={t('anime.series.nameHint')}>
                <TextField
                    label={t('anime.season.name')}
                    value={seasonName}
                    placeholder={t('anime.season.namePlaceholder', { number: season })}
                    onChange={(value) => {
                        setSeasonName(value.slice(0, MAX_SEASON_NAME_LENGTH));
                    }}
                />
            </div>
            <div className="field-row series-fields">
                <NumberField label={t('anime.season.label')} value={season} min={1} max={MAX_SEASON} onChange={setSeason} />
            </div>
            {problem !== null && (
                <p className="field__warning" role="alert">
                    {problem}
                </p>
            )}
            <div className="job__actions">
                <button
                    type="button"
                    className="btn btn--small btn--primary"
                    onClick={() => {
                        void save();
                    }}
                >
                    {t('anime.series.save')}
                </button>
                <button type="button" className="btn btn--small btn--ghost" onClick={onClose}>
                    {t('anime.series.cancel')}
                </button>
            </div>
        </div>
    );
}

// An anime of the library, as a season of its series: a row that opens to show what can be done with it.
function AnimeEntry({ anime, seriesName, t }: { anime: LibraryAnime; seriesName: string; t: Translator }) {
    const removeAnime = useAnimeStore((state) => {
        return state.removeAnime;
    });
    const openLibraryAnime = useAnimeStore((state) => {
        return state.openLibraryAnime;
    });
    const downloadMissing = useAnimeStore((state) => {
        return state.downloadMissing;
    });
    // Coming from a redirect (the search, the schedule) the season is brought into view. Every season starts closed, always.
    const focused = useAnimeStore((state) => {
        return state.libraryFocus === anime.id;
    });
    const [expanded, setExpanded] = useState(false);
    const [editing, setEditing] = useState(false);
    const card = useRef<HTMLElement | null>(null);

    useEffect(() => {
        if (focused) {
            card.current?.scrollIntoView?.({ block: 'center' });
        }
    }, [focused]);

    const audio = <span className="badge">{anime.audio === 'dub' ? t('anime.audio.dub') : t('anime.audio.sub')}</span>;
    const progress = t('anime.library.progress', { done: downloadedCount(anime), total: anime.episodes.length });
    const source = (
        <button
            type="button"
            className="btn btn--small btn--primary"
            aria-label={`${t('anime.library.source')}: ${anime.title}`}
            onClick={() => {
                void openLibraryAnime(anime);
            }}
        >
            {t('anime.library.source')}
        </button>
    );
    // Only what is missing in this season: the other seasons of the series are left alone.
    const downloadSeason = hasMissingInAnime(anime) && (
        <button
            type="button"
            className="btn btn--small"
            aria-label={`${t('anime.season.downloadAll')}: ${anime.title}`}
            onClick={() => {
                void downloadMissing([anime.id]);
            }}
        >
            {t('anime.season.downloadAll')}
        </button>
    );
    // An anime on its own has nothing to order; one in a series has its season to edit (the series itself cannot change).
    const edit = anime.series !== null && (
        <button
            type="button"
            className="btn btn--small"
            aria-expanded={editing}
            aria-label={`${t('anime.season.edit')}: ${anime.title}`}
            onClick={() => {
                setEditing(!editing);
            }}
        >
            {t('anime.season.edit')}
        </button>
    );
    // The anime that gives its name to the series is not removed alone: to remove it, the whole series goes.
    const remove = (
        <AnimeRemove
            label={t('anime.remove.anime')}
            ariaLabel={`${t('anime.remove.anime')}: ${anime.title}`}
            blocked={sameSeries(anime.title, seriesName) ? t('anime.remove.blocked') : undefined}
            onRemove={() => {
                void removeAnime(anime.id);
            }}
        />
    );
    const editor = editing && anime.series !== null && (
        <SeasonEditor
            anime={anime}
            series={anime.series}
            t={t}
            onClose={() => {
                setEditing(false);
            }}
        />
    );
    const episodes = expanded && (
        <ul className="history__list">
            {anime.episodes.map((episode) => {
                return <EpisodeRow key={episode.id} anime={anime} episode={episode} t={t} />;
            })}
        </ul>
    );

    return (
        <section ref={card} className="series__season" data-testid="anime-season">
            <div className="season__row row--link">
                <span className="season__chip" title={seasonLabel(anime, t)}>
                    {seasonLabel(anime, t)}
                </span>
                <h4 className="season__title">
                    <RowLink
                        label={`${expanded ? t('anime.library.hide') : t('anime.library.show')}: ${anime.title}`}
                        expanded={expanded}
                        title={anime.title}
                        onClick={() => {
                            setExpanded(!expanded);
                        }}
                    >
                        {anime.title}
                    </RowLink>
                </h4>
                <span className="season__meta">{progress}</span>
                {audio}
                <span className="season__actions">
                    {downloadSeason}
                    {source}
                </span>
            </div>
            {expanded && (
                <div className="season__panel">
                    <div className="job__actions">
                        {edit}
                        {remove}
                    </div>
                    {editor}
                    {episodes}
                </div>
            )}
        </section>
    );
}

// How many seasons a series has, in words.
function seasonsText(group: LibraryGroup, t: Translator): string {
    return group.entries.length === 1 ? t('anime.series.seasonOne') : t('anime.series.seasons', { count: group.entries.length });
}

// Whether the anime has an episode that is not downloaded and is not being downloaded (or waiting to be) either.
function hasMissingInAnime(anime: LibraryAnime): boolean {
    return anime.episodes.some((episode) => {
        return episode.status !== 'done' && episode.status !== 'queued' && episode.status !== 'downloading';
    });
}

// The same for a series: any of its seasons.
function hasMissingEpisodes(group: LibraryGroup): boolean {
    return group.entries.some(hasMissingInAnime);
}

// The card of a series: its name, how many seasons it has and the way into its own screen.
function SeriesCard({ group, t, onOpen }: { group: LibraryGroup; t: Translator; onOpen: () => void }) {
    const removeAnime = useAnimeStore((state) => {
        return state.removeAnime;
    });
    const name = group.series;

    return (
        <article className="job job--done series library__card cover-card row--link" data-testid="anime-card" aria-label={name}>
            <AnimeCover title={group.entries[0]?.title ?? name} />
            <div className="cover-card__body">
                <header className="job__head">
                    <h3 className="series__title">
                        <RowLink label={`${t('anime.series.open')}: ${name}`} title={name} onClick={onOpen}>
                            {name}
                        </RowLink>
                    </h3>
                </header>
                <div className="cover-card__footer">
                    <span className="job__badges">
                        <span className="badge">{seasonsText(group, t)}</span>
                    </span>
                    <div className="job__actions library__footer">
                        <AnimeRemove
                            label={t('anime.series.remove')}
                            ariaLabel={`${t('anime.series.remove')}: ${name}`}
                            onRemove={() => {
                                void group.entries.reduce(async (previous, anime) => {
                                    await previous;
                                    await removeAnime(anime.id);
                                }, Promise.resolve());
                            }}
                        />
                    </div>
                </div>
            </div>
        </article>
    );
}

// What is open on the screen of the library besides the cards: one series (by the key of its card).
type LibraryView = { key: string };

// The name of the series, changed for all the anime in it: when the name is one another series has, the seasons of both join, and a season
// they both have is refused with the one the other series could give.
function SeriesRename({ group, t, onClose, onRenamed }: { group: LibraryGroup; t: Translator; onClose: () => void; onRenamed: (name: string) => void }) {
    const renameSeries = useAnimeStore((state) => {
        return state.renameSeries;
    });
    const [name, setName] = useState(group.series);
    const [problem, setProblem] = useState<string | null>(null);

    async function save(): Promise<void> {
        const cleaned = cleanSeriesName(name);
        if (cleaned === null) {
            setProblem(t('anime.series.error.name'));
            return;
        }
        const response = await renameSeries(
            group.entries.map((anime) => {
                return anime.id;
            }),
            cleaned
        );
        if (response.ok) {
            onRenamed(cleaned);
            return;
        }
        setProblem(
            response.reason === 'season-taken'
                ? t('anime.series.error.renameTaken', { order: response.season, anime: response.anime, series: cleaned, suggested: response.suggested })
                : t('anime.series.error.name')
        );
    }

    return (
        <div className="series-editor" role="group" aria-label={`${t('anime.series.rename')}: ${group.series}`}>
            <TextField label={t('anime.series.rename.label')} value={name} onChange={setName} />
            {problem !== null && (
                <p className="field__warning" role="alert">
                    {problem}
                </p>
            )}
            <div className="job__actions">
                <button
                    type="button"
                    className="btn btn--small btn--primary"
                    onClick={() => {
                        void save();
                    }}
                >
                    {t('anime.series.save')}
                </button>
                <button type="button" className="btn btn--small btn--ghost" onClick={onClose}>
                    {t('anime.series.cancel')}
                </button>
            </div>
        </div>
    );
}

// The screen of one series: its seasons, each with its buttons and episodes, and the way back.
function SeriesView({ group, t, onBack, onRenamed }: { group: LibraryGroup; t: Translator; onBack: () => void; onRenamed: (name: string) => void }) {
    const removeAnime = useAnimeStore((state) => {
        return state.removeAnime;
    });
    const downloadMissing = useAnimeStore((state) => {
        return state.downloadMissing;
    });
    const [renaming, setRenaming] = useState(false);
    const name = group.series;
    // The folder of the series is opened through an anime of it that has something downloaded.
    const downloaded = group.entries.find((anime) => {
        return downloadedCount(anime) > 0;
    });
    return (
        <section className="library__view" aria-label={name}>
            <div className="queue__toolbar">
                <button type="button" className="btn btn--small btn--ghost" onClick={onBack}>
                    {t('anime.library.back')}
                </button>
                <span className="section-label">{name}</span>
            </div>
            <article className="job job--done series" data-testid="series-view">
                <header className="job__head">
                    <h3 className="series__title" title={name}>
                        {name}
                    </h3>
                    <span className="job__badges">
                        {hasMissingEpisodes(group) && (
                            <button
                                type="button"
                                className="btn btn--small btn--primary"
                                aria-label={`${t('anime.series.downloadAll')}: ${name}`}
                                onClick={() => {
                                    void downloadMissing(
                                        group.entries.map((anime) => {
                                            return anime.id;
                                        })
                                    );
                                }}
                            >
                                {t('anime.series.downloadAll')}
                            </button>
                        )}
                        <span className="badge">{seasonsText(group, t)}</span>
                        {downloaded && (
                            <button
                                type="button"
                                className="btn btn--small"
                                aria-label={`${t('anime.openFolder')}: ${name}`}
                                onClick={() => {
                                    void window.api.openAnimeSeriesFolder(downloaded.id);
                                }}
                            >
                                {t('anime.openFolder')}
                            </button>
                        )}
                        <SeriesMenu
                            name={name}
                            onRename={() => {
                                setRenaming(true);
                            }}
                            onRemove={() => {
                                void group.entries.reduce(async (previous, anime) => {
                                    await previous;
                                    await removeAnime(anime.id);
                                }, Promise.resolve());
                            }}
                        />
                    </span>
                </header>
                {renaming && (
                    <SeriesRename
                        group={group}
                        t={t}
                        onClose={() => {
                            setRenaming(false);
                        }}
                        onRenamed={(renamed) => {
                            setRenaming(false);
                            onRenamed(renamed);
                        }}
                    />
                )}
                {group.entries.map((anime) => {
                    return <AnimeEntry key={anime.id} anime={anime} seriesName={name} t={t} />;
                })}
            </article>
        </section>
    );
}

export function AnimeLibrary() {
    const t = useTranslator();
    const library = useAnimeStore((state) => {
        return state.library;
    });
    const importLibrary = useAnimeStore((state) => {
        return state.importLibrary;
    });
    const [search, setSearch] = useState('');
    // Coming from the search ("VIEW IN LIBRARY") the series of the anime that was being looked at is open.
    const [view, setView] = useState<LibraryView | null>(() => {
        const state = useAnimeStore.getState();
        const focus = state.libraryFocus;
        const group = focus === null ? undefined : groupLibrary(state.library).find((candidate) => {
            return candidate.entries.some((entry) => {
                return entry.id === focus;
            });
        });
        return group ? { key: group.key } : null;
    });

    const importButton = (
        <button
            type="button"
            className="btn"
            title={t('anime.import.hint')}
            onClick={() => {
                void importLibrary();
            }}
        >
            {t('anime.import.button')}
        </button>
    );
    if (library.length === 0) {
        return (
            <section className="queue" aria-label={t('anime.library.aria')}>
                <div className="field-row">{importButton}</div>
                <p className="empty">{t('anime.library.empty')}</p>
            </section>
        );
    }
    const openGroup = view ? groupLibrary(library).find((group) => { return group.key === view.key; }) : undefined;
    if (openGroup) {
        return (
            <SeriesView
                group={openGroup}
                t={t}
                onBack={() => {
                    setView(null);
                }}
                onRenamed={(renamed) => {
                    // The key of a series is made of its name, so the screen goes on with the series under its new one.
                    setView({ key: `series-${foldSeries(renamed)}` });
                }}
            />
        );
    }
    const shown = library.filter((anime) => {
        return matchesSearch(anime.title, search) || (anime.series !== null && matchesSearch(anime.series, search));
    });
    const groups = groupLibrary(shown);
    return (
        <section className="queue library" aria-label={t('anime.library.aria')}>
            <div className="field-row">
                <TextField label={t('anime.library.search.label')} value={search} placeholder={t('anime.library.search.placeholder')} onChange={setSearch} />
                {importButton}
            </div>
            <span className="section-label">{t('anime.library.label', { count: groups.length })}</span>
            {shown.length === 0 && <p className="empty">{t('anime.library.search.none')}</p>}
            <div className="cover-grid">
                {groups.map((group) => {
                    return (
                        <SeriesCard
                            key={group.key}
                            group={group}
                            t={t}
                            onOpen={() => {
                                setView({ key: group.key });
                            }}
                        />
                    );
                })}
            </div>
        </section>
    );
}
