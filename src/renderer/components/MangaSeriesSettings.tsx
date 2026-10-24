import { useState } from 'react';
import type { LibraryManga } from '@shared/manga';
import { cleanSeasonName, cleanSeriesName, isValidSeason, suggestSeries } from '@shared/series';
import { useTranslator } from '../i18n/useTranslator';
import { useMangaStore } from '../store/mangaStore';
import { ConfirmButton } from './ConfirmButton';
import { nextSeason, seriesNames, takenSeasons } from './mangaText';
import { SeriesFields } from './SeriesFields';

interface MangaSeriesSettingsProps {
    manga: LibraryManga;
}

// What joins a manga of the library to the others of its series: the name of the series, its place in it and the name it is shown with.
export function MangaSeriesSettings({ manga }: MangaSeriesSettingsProps) {
    const t = useTranslator();
    const library = useMangaStore((state) => {
        return state.library;
    });
    const setSeries = useMangaStore((state) => {
        return state.setSeries;
    });
    const [series, setSeriesName] = useState(manga.series ?? '');
    const [season, setSeason] = useState(manga.season ?? 1);
    const [seasonName, setSeasonName] = useState(manga.seasonName ?? '');
    const [problem, setProblem] = useState<string | null>(null);

    // With no name the series is named after the manga.
    const effectiveSeries = series.trim().length === 0 ? manga.title : series;
    const taken = takenSeasons(library, effectiveSeries, manga.id);
    const seasonTaken = taken.includes(season);
    const suggestedSeason = nextSeason(taken);

    // Choosing a series that has the order wanted already offers the next one.
    function changeSeries(value: string): void {
        setSeriesName(value);
        const takenThere = takenSeasons(library, value.trim().length === 0 ? manga.title : value, manga.id);
        if (takenThere.includes(season)) {
            setSeason(nextSeason(takenThere));
        }
    }

    async function save(): Promise<void> {
        const name = cleanSeriesName(effectiveSeries);
        const label = cleanSeasonName(seasonName);
        if (name === null || !isValidSeason(season) || label === undefined) {
            setProblem(t('anime.series.error.invalid'));
            return;
        }
        const response = await setSeries({ mangaId: manga.id, series: name, season, seasonName: label });
        if (response.ok) {
            setProblem(null);
            return;
        }
        setProblem(response.reason === 'season-taken' ? t('manga.series.error.taken', { order: season, suggested: response.suggested }) : t('anime.series.error.invalid'));
    }

    // The name of the series is made from the title: with it the order starts at the next free one.
    function suggest(): void {
        const suggestion = suggestSeries(manga.title);
        const takenThere = takenSeasons(library, suggestion.series, manga.id);
        setSeriesName(suggestion.series);
        setSeason(takenThere.includes(suggestion.season) ? nextSeason(takenThere) : suggestion.season);
    }

    async function leave(): Promise<void> {
        const response = await setSeries({ mangaId: manga.id, series: null, season: null, seasonName: null });
        if (response.ok) {
            setSeriesName('');
            setSeason(1);
            setSeasonName('');
            setProblem(null);
        }
    }


    return (
        <section className="panel manga__series">
            <span className="section-label">{t('manga.series.title')}</span>
            {manga.series !== null && manga.season !== null && <p className="field__hint">{t('manga.series.in', { series: manga.series, order: manga.season })}</p>}
            <SeriesFields
                series={series}
                season={season}
                seasonName={seasonName}
                suggestions={seriesNames(library)}
                hint={t('manga.series.hint')}
                nameHint={t('manga.series.nameHint')}
                onSeriesChange={changeSeries}
                seriesPlaceholder={t('manga.series.placeholder', { title: manga.title })}
                seasonProblem={seasonTaken ? t('manga.series.error.takenNow', { order: season, suggested: suggestedSeason }) : undefined}
                onSeasonChange={setSeason}
                onSeasonNameChange={setSeasonName}
            />
            {problem !== null && (
                <p className="field__warning" role="alert">
                    {problem}
                </p>
            )}
            <div className="job__actions">
                <button type="button" className="btn btn--small btn--primary" disabled={seasonTaken} onClick={() => {
                    void save();
                }}>
                    {t('manga.series.save')}
                </button>
                <button type="button" className="btn btn--small" onClick={suggest}>
                    {t('manga.series.suggest')}
                </button>
                {manga.series !== null && (
                    <ConfirmButton
                        className="btn btn--small btn--hot"
                        dialog={{ title: t('confirm.removeFromSeries.title', { name: manga.title }), message: t('confirm.removeFromSeries.message'), confirmLabel: t('manga.series.leave') }}
                        onConfirm={() => {
                            void leave();
                        }}
                    >
                        {t('manga.series.leave')}
                    </ConfirmButton>
                )}
            </div>
        </section>
    );
}
