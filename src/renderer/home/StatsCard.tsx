import { useMemo } from 'react';
import type { MessageKey } from '@shared/i18n';
import { zonedHour } from '@shared/timezone';
import { CountUp } from '../fx/CountUp';
import { useAppTimeZone } from '../hooks/useAppTimeZone';
import { useShownHistory } from '../hooks/useShownManga';
import { useClock } from '../hooks/useClock';
import { useTranslator } from '../i18n/useTranslator';
import { useAnimeStore } from '../store/animeStore';
import { useAppStore } from '../store/appStore';
import { greetingPeriod, weekStats, type WeekStats } from './statsData';

interface StatLine {
    key: keyof WeekStats;
    label: MessageKey;
}

export const STAT_LINES: readonly StatLine[] = [
    { key: 'downloads', label: 'stats.downloads' },
    { key: 'watched', label: 'stats.watched' },
    { key: 'read', label: 'stats.read' },
    { key: 'streak', label: 'stats.streak' }
];

export function StatsCard() {
    const t = useTranslator();
    const timeZone = useAppTimeZone();
    const now = useClock();
    const history = useAppStore((state) => {
        return state.history;
    });
    const animeHistory = useAnimeStore((state) => {
        return state.history;
    });
    const readingHistory = useShownHistory();
    const moment = now.getTime();
    const period = greetingPeriod(zonedHour(moment, timeZone));
    const input = useMemo(() => {
        return { history, animeHistory, readingHistory, now: moment, timeZone };
    }, [history, animeHistory, readingHistory, moment, timeZone]);
    const stats = useMemo(() => {
        return weekStats(input);
    }, [input]);
    return (
        <section className="stats" aria-label={t('stats.aria')} data-testid="home-stats">
            <header className="stats__head">
                <div className="stats__who">
                    <p className="stats__greeting">{t(`home.greeting.${period}`)}</p>
                </div>
                <span className="stats__title">{t('stats.title')}</span>
            </header>
            <dl className="stats__numbers">
                {STAT_LINES.map((line) => {
                    return (
                        <div key={line.key} className="stats__number" data-stat={line.key}>
                            <dt>{t(line.label)}</dt>
                            <dd>
                                <CountUp value={stats[line.key]} />
                            </dd>
                        </div>
                    );
                })}
            </dl>
        </section>
    );
}
