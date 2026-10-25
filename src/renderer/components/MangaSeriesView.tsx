import { useState } from 'react';
import type { LibraryManga } from '@shared/manga';
import { cleanSeriesName } from '@shared/series';
import { useTranslator } from '../i18n/useTranslator';
import { useMangaStore } from '../store/mangaStore';
import { TextField } from './fields';
import { MangaCover } from './MangaCover';
import { ConfirmButton } from './ConfirmButton';
import { MangaGroupChips } from './MangaGroupChips';
import { NewChaptersBadge } from './MangaLibrary';
import { downloadedCount, downloadedTotals, newChapterCount, seasonLabel, type MangaLibraryGroup } from './mangaText';
import { RowLink } from './RowLink';
import { SeriesMenu } from './SeriesMenu';

interface SeriesRenameProps {
    group: MangaLibraryGroup;
    onClose: () => void;
    onRenamed: (name: string) => void;
}

// The name of the series, changed for all the mangas in it: when the name is one another series has, the seasons of both join, and a
// season they both have is refused with the one the other series could give.
function SeriesRename({ group, onClose, onRenamed }: SeriesRenameProps) {
    const t = useTranslator();
    const renameSeries = useMangaStore((state) => {
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
            group.entries.map((manga) => {
                return manga.id;
            }),
            cleaned
        );
        if (response.ok) {
            onRenamed(cleaned);
            return;
        }
        setProblem(
            response.reason === 'season-taken'
                ? t('manga.series.error.renameTaken', { order: response.season, manga: response.manga, series: cleaned, suggested: response.suggested })
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
                <button type="button" className="btn btn--small btn--primary" onClick={() => {
                    void save();
                }}>
                    {t('anime.series.save')}
                </button>
                <button type="button" className="btn btn--small btn--ghost" onClick={onClose}>
                    {t('anime.series.cancel')}
                </button>
            </div>
        </div>
    );
}

interface MangaSeriesViewProps {
    group: MangaLibraryGroup;
    onBack: () => void;
    onRenamed: (name: string) => void;
}

// The screen of one series: its seasons, the groups it is in, and the way back.
export function MangaSeriesView({ group, onBack, onRenamed }: MangaSeriesViewProps) {
    const t = useTranslator();
    const removeManga = useMangaStore((state) => {
        return state.removeManga;
    });
    const setSeries = useMangaStore((state) => {
        return state.setSeries;
    });
    const downloadMissing = useMangaStore((state) => {
        return state.downloadMissing;
    });
    const openManga = useMangaStore((state) => {
        return state.openManga;
    });
    const [renaming, setRenaming] = useState(false);
    const name = group.series;
    const totals = downloadedTotals(group.entries);
    const ids = group.entries.map((manga) => {
        return manga.id;
    });

    // The manga leaves the series and stays in the library, with its chapters and files. When it was the only one the series has no more
    // mangas, so there is no series: the screen goes back to the library.
    async function takeOutOfSeries(manga: LibraryManga): Promise<void> {
        const response = await setSeries({ mangaId: manga.id, series: null, season: null, seasonName: null });
        if (response.ok && group.entries.length === 1) {
            onBack();
        }
    }

    return (
        <section className="library__view manga__series-view" aria-label={name}>
            <div className="queue__toolbar">
                <button type="button" className="btn btn--small btn--ghost" onClick={onBack}>
                    {t('anime.library.back')}
                </button>
                <span className="section-label">{name}</span>
            </div>
            <article className="job job--done series" data-testid="manga-series-view">
                <header className="job__head">
                    <h3 className="series__title" title={name}>
                        {name}
                    </h3>
                    <span className="job__badges">
                        {totals.done < totals.total && (
                            <button
                                type="button"
                                className="btn btn--small btn--primary"
                                aria-label={`${t('manga.series.downloadAll')}: ${name}`}
                                onClick={() => {
                                    group.entries.forEach((manga) => {
                                        void downloadMissing(manga.id);
                                    });
                                }}
                            >
                                {t('manga.series.downloadAll')}
                            </button>
                        )}
                        <span className="badge">{group.entries.length === 1 ? t('anime.series.seasonOne') : t('anime.series.seasons', { count: group.entries.length })}</span>
                        <SeriesMenu
                            name={name}
                            onRename={() => {
                                setRenaming(true);
                            }}
                            onRemove={() => {
                                void group.entries.reduce(async (previous, manga) => {
                                    await previous;
                                    await removeManga(manga.id);
                                }, Promise.resolve());
                            }}
                            confirmation={{
                                title: t('manga.remove.series.title', { name }),
                                message: t('manga.remove.series.message'),
                                confirmLabel: t('manga.remove.confirm'),
                                cancelLabel: t('manga.remove.cancel')
                            }}
                        >
                            <section className="series-menu__section" aria-label={t('manga.library.groups')}>
                                <span className="section-label">{t('manga.library.groups')}</span>
                                <MangaGroupChips mangaIds={ids} title={name} />
                            </section>
                        </SeriesMenu>
                    </span>
                </header>
                {renaming && (
                    <SeriesRename
                        group={group}
                        onClose={() => {
                            setRenaming(false);
                        }}
                        onRenamed={(renamed) => {
                            setRenaming(false);
                            onRenamed(renamed);
                        }}
                    />
                )}
                <div className="cover-grid season-grid">
                    {group.entries.map((manga) => {
                        return (
                            <section key={manga.id} className="series__season season-card cover-card row--link" data-testid="manga-season">
                                <span className="season__cover" data-testid="manga-season-cover">
                                    <MangaCover url={manga.thumbnailUrl} />
                                </span>
                                <div className="cover-card__body">
                                    <span className="season__chip" title={seasonLabel(manga, t)}>
                                        {seasonLabel(manga, t)}
                                    </span>
                                    <h4 className="season__title">
                                        <RowLink
                                            label={`${t('manga.browse.open')}: ${manga.title}`}
                                            title={manga.title}
                                            onClick={() => {
                                                void openManga({ remoteId: manga.remoteId, sourceId: manga.sourceId, title: manga.title, thumbnailUrl: manga.thumbnailUrl });
                                            }}
                                        >
                                            {manga.title}
                                        </RowLink>
                                    </h4>
                                    <div className="cover-card__footer">
                                        <span className="job__badges">
                                            <span className="season__meta">{t('manga.library.progress', { done: downloadedCount(manga), total: manga.chapters.length })}</span>
                                            <NewChaptersBadge count={newChapterCount([manga])} />
                                        </span>
                                        <div className="job__actions library__footer">
                                            <ConfirmButton
                                                className="btn btn--small btn--ghost"
                                                ariaLabel={`${t('manga.series.removeFrom')}: ${manga.title}`}
                                                dialog={{ title: t('confirm.removeFromSeries.title', { name: manga.title }), message: t('confirm.removeFromSeries.message'), confirmLabel: t('manga.series.removeFrom') }}
                                                onConfirm={() => {
                                                    void takeOutOfSeries(manga);
                                                }}
                                            >
                                                {t('manga.series.removeFrom')}
                                            </ConfirmButton>
                                        </div>
                                    </div>
                                </div>
                            </section>
                        );
                    })}
                </div>
            </article>
        </section>
    );
}
