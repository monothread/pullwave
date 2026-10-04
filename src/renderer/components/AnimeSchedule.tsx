import { useEffect, useMemo, useState } from 'react';
import type { AnimeScheduleEntry } from '@shared/anime';
import type { Translator } from '@shared/i18n';
import { selectableTimeZones } from '@shared/timezone';
import { useAppLanguage, useTranslator } from '../i18n/useTranslator';
import { useAnimeStore, type AnimeScheduleView } from '../store/animeStore';
import { AnimeCover } from './AnimeCover';
import { animeErrorKey } from './animeText';
import { SelectField, TextField } from './fields';
import { RowLink } from './RowLink';
import { matchesSearch } from './scheduleSearch';

const VIEWS: readonly AnimeScheduleView[] = ['day', 'week'];

function viewLabel(view: AnimeScheduleView, t: Translator): string {
    return view === 'week' ? t('anime.schedule.view.week') : t('anime.schedule.view.day');
}

// What the badge of a card says about the anime in the source; nothing is known yet while it is being checked.
function availabilityLabel(state: 'available' | 'unavailable' | undefined, t: Translator): string {
    if (state === undefined) {
        return t('anime.schedule.checking');
    }
    return t(state === 'available' ? 'anime.schedule.available' : 'anime.schedule.unavailable');
}

function dayHeading(startOfDay: number, timeZone: string, language: string): string {
    return new Intl.DateTimeFormat(language, { timeZone, weekday: 'long', day: 'numeric', month: 'short' }).format(new Date(startOfDay * 1000));
}

function airingDate(entry: AnimeScheduleEntry, timeZone: string, language: string): string {
    return new Intl.DateTimeFormat(language, { timeZone, weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(entry.airingAt * 1000));
}

function airingTime(entry: AnimeScheduleEntry, timeZone: string, language: string): string {
    return new Date(entry.airingAt * 1000).toLocaleTimeString(language, { timeZone, hour: '2-digit', minute: '2-digit' });
}

// The episodes that air today or this week, one section for each day of the time zone that is set, in the order they air. Clicking one
// goes to the search, which looks the anime up by its names. A name typed in the search narrows the list to the anime that match it, each
// with the date and the time its episode airs.
export function AnimeSchedule() {
    const t = useTranslator();
    const language = useAppLanguage();
    const schedule = useAnimeStore((state) => {
        return state.schedule;
    });
    const loadSchedule = useAnimeStore((state) => {
        return state.loadSchedule;
    });
    const setView = useAnimeStore((state) => {
        return state.setScheduleView;
    });
    const setTimeZone = useAnimeStore((state) => {
        return state.setScheduleTimeZone;
    });
    const openEntry = useAnimeStore((state) => {
        return state.openScheduleEntry;
    });
    const availability = useAnimeStore((state) => {
        return state.availability;
    });
    const { view, timeZone, limits, status } = schedule;
    const [query, setQuery] = useState('');
    const searching = query.trim() !== '';
    const entries = useMemo(() => {
        return schedule.entries.filter((entry) => {
            return matchesSearch(entry, query);
        });
    }, [schedule.entries, query]);
    const timeZones = useMemo(() => {
        return selectableTimeZones(timeZone);
    }, [timeZone]);

    useEffect(() => {
        void loadSchedule(false);
    }, [loadSchedule, view, timeZone]);

    const loading = status === 'loading';
    const days = limits.slice(0, -1).map((start, position) => {
        const end = limits[position + 1] as number;
        return {
            start,
            entries: entries.filter((entry) => {
                return entry.airingAt >= start && entry.airingAt < end;
            })
        };
    });

    // While searching, the days where nothing matches are left out: they would be a column of empty days.
    const visibleDays = searching
        ? days.filter((day) => {
              return day.entries.length > 0;
          })
        : days;

    return (
        <section className="history" aria-label={t('anime.schedule.aria')}>
            <div className="field-row">
                <SelectField label={t('anime.schedule.view.label')} value={view} options={VIEWS} formatOption={(option) => {
                    return viewLabel(option, t);
                }} onChange={setView} />
                <SelectField
                    label={t('anime.schedule.timezone.label')}
                    value={timeZone}
                    options={timeZones}
                    formatOption={(zone) => {
                        return zone.replaceAll('_', ' ');
                    }}
                    onChange={setTimeZone}
                />
                <button
                    type="button"
                    className="btn"
                    disabled={loading}
                    onClick={() => {
                        void loadSchedule(true);
                    }}
                >
                    {t('anime.schedule.refresh')}
                </button>
            </div>
            <TextField label={t('anime.schedule.search.label')} value={query} placeholder={t('anime.schedule.search.placeholder')} onChange={setQuery} />
            <div className="queue__toolbar">
                <span className="section-label">{t('anime.schedule.count', { count: entries.length })}</span>
            </div>
            {status === 'error' && schedule.error && (
                <p className="field__warning" role="alert" title={schedule.error.raw}>
                    {t(animeErrorKey(schedule.error.code))}
                </p>
            )}
            {loading && entries.length === 0 && <p className="empty">{t('anime.schedule.loading')}</p>}
            {status === 'ready' && schedule.entries.length === 0 && <p className="empty">{t('anime.schedule.empty')}</p>}
            {status === 'ready' && schedule.entries.length > 0 && entries.length === 0 && <p className="empty">{t('anime.schedule.noMatch', { query: query.trim() })}</p>}
            {entries.length > 0 &&
                visibleDays.map((day, position) => {
                    const heading = dayHeading(day.start, timeZone, language);
                    return (
                        <section key={day.start} className="schedule__day" aria-label={heading}>
                            <h3 className={position === 0 ? 'section-label schedule__today' : 'section-label'}>
                                {position === 0 ? `${heading} · ${t('anime.schedule.today')}` : heading}
                            </h3>
                            {day.entries.length === 0 && <p className="field__hint">{t('anime.schedule.emptyDay')}</p>}
                            <ul className="cover-grid">
                                {day.entries.map((entry) => {
                                    const known = availability[entry.anilistId];
                                    const unavailable = known?.state === 'unavailable';
                                    return (
                                        <li
                                            key={`${entry.anilistId}-${entry.episode}`}
                                            className={`history__item cover-card cover-card--bottom-meta${unavailable ? ' cover-card--unavailable' : ' row--link'}`}
                                            aria-disabled={unavailable ? true : undefined}
                                            title={unavailable ? t('anime.schedule.unavailable.hint') : undefined}
                                        >
                                            <AnimeCover title={entry.title} url={entry.coverUrl} />
                                            <div className="history__main">
                                                <span className="history__title">
                                                    {unavailable ? (
                                                        <span className="row-link__text">{entry.title}</span>
                                                    ) : (
                                                        <RowLink
                                                            label={t('anime.schedule.open', { title: entry.title, episode: entry.episode })}
                                                            title={entry.title}
                                                            onClick={() => {
                                                                void openEntry(entry);
                                                            }}
                                                        >
                                                            {entry.title}
                                                        </RowLink>
                                                    )}
                                                </span>
                                                <span className="history__meta">
                                                    {t('anime.schedule.episode', { episode: entry.episode })} · {searching ? `${airingDate(entry, timeZone, language)} · ` : ''}
                                                    {airingTime(entry, timeZone, language)}
                                                </span>
                                                {known?.state !== 'unknown' && (
                                                    <span className={`badge${known?.state === 'available' ? ' badge--done' : ''}`}>{availabilityLabel(known?.state, t)}</span>
                                                )}
                                            </div>
                                        </li>
                                    );
                                })}
                            </ul>
                        </section>
                    );
                })}
        </section>
    );
}
