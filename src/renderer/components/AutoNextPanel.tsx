import { useEffect, useRef, useState } from 'react';
import { useTranslator } from '../i18n/useTranslator';

// How long the panel counts before the next episode starts by itself.
export const AUTO_NEXT_DELAY_MS = 10_000;
// How often the bar and the seconds left are brought up to date.
export const AUTO_NEXT_TICK_MS = 100;

interface AutoNextPanelProps {
    // The name of the next episode (the anime and its number).
    title: string;
    onGo: () => void;
    onCancel: () => void;
    delayMs?: number;
}

// Over the video, once an episode ended: which episode comes next, a bar that fills as the time passes (as the zone between two chapters of
// the reader does), a button to go at once and one to stay. When the bar is full the next episode starts.
export function AutoNextPanel({ title, onGo, onCancel, delayMs = AUTO_NEXT_DELAY_MS }: AutoNextPanelProps) {
    const t = useTranslator();
    const [elapsed, setElapsed] = useState(0);
    // The last onGo given: the count is not started again when the player draws itself again.
    const go = useRef(onGo);
    useEffect(() => {
        go.current = onGo;
    }, [onGo]);

    useEffect(() => {
        const startedAt = Date.now();
        const timer = window.setInterval(() => {
            const passed = Math.min(delayMs, Date.now() - startedAt);
            setElapsed(passed);
            if (passed >= delayMs) {
                window.clearInterval(timer);
                go.current();
            }
        }, AUTO_NEXT_TICK_MS);
        return () => {
            window.clearInterval(timer);
        };
    }, [delayMs]);

    const fraction = delayMs > 0 ? elapsed / delayMs : 1;
    const secondsLeft = Math.ceil((delayMs - elapsed) / 1000);
    return (
        <div className="player__auto-next" role="region" aria-label={t('anime.player.next')} data-testid="auto-next">
            <span className="player__auto-next-label">{t('anime.player.next')}</span>
            <strong className="player__auto-next-title">{title}</strong>
            <div
                className="progress player__auto-next-bar"
                role="progressbar"
                aria-label={t('anime.player.autoNext.progress')}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(fraction * 100)}
            >
                <div className="progress__bar progress__bar--smooth" style={{ width: `${String(fraction * 100)}%` }} />
            </div>
            <span className="player__auto-next-hint" aria-live="polite">
                {t('anime.player.autoNext.countdown', { seconds: secondsLeft })}
            </span>
            <span className="player__auto-next-actions">
                <button type="button" className="btn btn--small btn--primary" autoFocus onClick={onGo}>
                    {t('anime.player.autoNext.go')}
                </button>
                <button type="button" className="btn btn--small" onClick={onCancel}>
                    {t('anime.player.autoNext.cancel')}
                </button>
            </span>
        </div>
    );
}
