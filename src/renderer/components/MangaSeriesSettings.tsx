import { useState } from 'react';
import type { LibraryManga } from '@shared/manga';
import { cleanSeasonName, cleanSeriesName, isValidSeason, suggestSeries } from '@shared/series';
import { useTranslator } from '../i18n/useTranslator';
import { useMangaStore } from '../store/mangaStore';
import { seriesNames } from './mangaText';
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

    async function save(): Promise<void> {
        const name = cleanSeriesName(series);
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

    async function leave(): Promise<void> {
        const response = await setSeries({ mangaId: manga.id, series: null, season: null, seasonName: null });
        if (response.ok) {
            setSeriesName('');
            setSeason(1);
            setSeasonName('');
            setProblem(null);
        }
    }

    function suggest(): void {
        const suggestion = suggestSeries(manga.title);
        setSeriesName(suggestion.series);
        setSeason(suggestion.season);
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
                onSeriesChange={setSeriesName}
                onSeasonChange={setSeason}
                onSeasonNameChange={setSeasonName}
            />
            {problem !== null && (
                <p className="field__warning" role="alert">
                    {problem}
                </p>
            )}
            <div className="job__actions">
                <button type="button" className="btn btn--small btn--primary" onClick={() => {
                    void save();
                }}>
                    {t('manga.series.save')}
                </button>
                <button type="button" className="btn btn--small" onClick={suggest}>
                    {t('manga.series.suggest')}
                </button>
                {manga.series !== null && (
                    <button type="button" className="btn btn--small btn--hot" onClick={() => {
                        void leave();
                    }}>
                        {t('manga.series.leave')}
                    </button>
                )}
            </div>
        </section>
    );
}
