import { useState } from 'react';
import { useTranslator } from '../i18n/useTranslator';

interface AnimeRemoveProps {
    label: string;
    // What the button says to the screen readers: it also names what is removed.
    ariaLabel: string;
    onRemove: () => void;
    // Why it cannot be removed, when it cannot: the button is then off and says it.
    blocked?: string;
}

// Removing takes two steps, and the second one warns that the files on the disk go too.
export function AnimeRemove({ label, ariaLabel, onRemove, blocked }: AnimeRemoveProps) {
    const t = useTranslator();
    const [asking, setAsking] = useState(false);

    if (blocked !== undefined) {
        return (
            <button type="button" className="btn btn--small btn--ghost" aria-label={ariaLabel} title={blocked} disabled>
                {label}
            </button>
        );
    }
    if (!asking) {
        return (
            <button
                type="button"
                className="btn btn--small btn--ghost"
                aria-label={ariaLabel}
                onClick={() => {
                    setAsking(true);
                }}
            >
                {label}
            </button>
        );
    }
    return (
        <span className="anime-remove" role="group" aria-label={ariaLabel}>
            <span className="field__warning">{t('anime.remove.warning')}</span>
            <button
                type="button"
                className="btn btn--small btn--hot"
                onClick={() => {
                    onRemove();
                    setAsking(false);
                }}
            >
                {t('anime.remove.confirm')}
            </button>
            <button
                type="button"
                className="btn btn--small"
                onClick={() => {
                    setAsking(false);
                }}
            >
                {t('anime.remove.keep')}
            </button>
        </span>
    );
}
