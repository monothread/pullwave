import { ANIME_AUDIOS, type AnimeAudio } from '@shared/anime';
import type { Translator } from '@shared/i18n';
import { useTranslator } from '../i18n/useTranslator';
import { useAppStore } from '../store/appStore';
import { effectiveAudio, useAnimeStore } from '../store/animeStore';
import { animeErrorKey, libraryEntry, seasonLabel } from './animeText';
import { AnimeCover } from './AnimeCover';
import { AnimeDetail } from './AnimeDetail';
import { SelectField, TextField } from './fields';
import { RowLink } from './RowLink';

function audioLabel(audio: AnimeAudio, t: Translator): string {
    return audio === 'dub' ? t('anime.audio.dub') : t('anime.audio.sub');
}

export function AnimeSearch() {
    const t = useTranslator();
    const search = useAnimeStore((state) => {
        return state.search;
    });
    const selection = useAnimeStore((state) => {
        return state.selection;
    });
    const setQuery = useAnimeStore((state) => {
        return state.setQuery;
    });
    const setAudio = useAnimeStore((state) => {
        return state.setAudio;
    });
    const runSearch = useAnimeStore((state) => {
        return state.runSearch;
    });
    const openResult = useAnimeStore((state) => {
        return state.openResult;
    });
    const library = useAnimeStore((state) => {
        return state.library;
    });
    const showInLibrary = useAnimeStore((state) => {
        return state.showInLibrary;
    });
    const settingsAudio = useAppStore((state) => {
        return state.settings.animeAudio;
    });

    if (selection) {
        return <AnimeDetail />;
    }
    const searching = search.status === 'searching';

    return (
        <section className="anime__search" aria-label={t('anime.search.aria')}>
            <form
                className="field-row"
                onSubmit={(event) => {
                    event.preventDefault();
                    void runSearch();
                }}
            >
                <TextField label={t('anime.search.label')} value={search.query} placeholder={t('anime.search.placeholder')} onChange={setQuery} />
                <SelectField
                    label={t('anime.audio.label')}
                    value={effectiveAudio(search, settingsAudio)}
                    options={ANIME_AUDIOS}
                    formatOption={(audio) => {
                        return audioLabel(audio, t);
                    }}
                    onChange={setAudio}
                />
                <button type="submit" className="btn btn--primary" disabled={searching || search.query.trim().length === 0}>
                    {searching ? t('anime.search.searching') : t('anime.search.button')}
                </button>
            </form>
            {search.status === 'error' && search.error && (
                <p className="field__warning" role="alert" title={search.error.raw}>
                    {t(animeErrorKey(search.error.code))}
                </p>
            )}
            {search.status === 'done' && search.results.length === 0 && <p className="empty">{t('anime.results.none')}</p>}
            {search.status === 'done' && search.results.length > 0 && (
                <>
                    <span className="section-label">{t('anime.results.label', { count: search.results.length })}</span>
                    <ul className="cover-grid">
                        {search.results.map((result) => {
                            // An anime is in the library from the moment it is added, whether or not an episode of it was downloaded.
                            const saved = libraryEntry(library, result.title, search.searchedAudio);
                            const joined = saved;
                            const inSeries = joined?.series != null && joined.season !== null;
                            return (
                                <li key={result.index} className="history__item cover-card row--link">
                                    <AnimeCover title={result.title} />
                                    <div className="history__main">
                                        <span className="history__title">
                                            <RowLink
                                                label={`${t('anime.open')}: ${result.title}`}
                                                title={result.title}
                                                onClick={() => {
                                                    void openResult(result);
                                                }}
                                            >
                                                {result.title}
                                            </RowLink>
                                        </span>
                                        {(saved || inSeries) && (
                                            <div className="cover-card__footer">
                                                {joined?.series != null && joined.season !== null && (
                                                    <span className="history__meta">{t('anime.series.tag', { series: joined.series, label: seasonLabel(joined, t) })}</span>
                                                )}
                                                {saved && (
                                                    <button
                                                        type="button"
                                                        className="btn btn--small btn--ghost cover-card__action"
                                                        aria-label={`${t('anime.library.view')}: ${result.title}`}
                                                        onClick={() => {
                                                            showInLibrary(saved.id);
                                                        }}
                                                    >
                                                        {t('anime.library.view')}
                                                    </button>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                </>
            )}
        </section>
    );
}
