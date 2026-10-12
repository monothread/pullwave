import { useState } from 'react';
import { useTranslator } from '../i18n/useTranslator';
import { ConfirmDialog } from './ConfirmDialog';

interface MangaRemoveProps {
    // The button that opens the window, and what it says to the screen readers (it also names what is removed).
    label: string;
    ariaLabel: string;
    // What the window asks and warns about.
    title: string;
    message: string;
    // The button that confirms; "remove" when not given.
    confirmLabel?: string;
    onRemove: () => void;
    // Why it cannot be removed, when it cannot: the button is then off and says it.
    blocked?: string;
    // The button looks like the other buttons of its row instead of a warning.
    quiet?: boolean;
}

// The button of a removal. It opens a window to confirm instead of asking in the row.
export function MangaRemove({ label, ariaLabel, title, message, confirmLabel, onRemove, blocked, quiet = false }: MangaRemoveProps) {
    const t = useTranslator();
    const [asking, setAsking] = useState(false);
    const classes = `btn btn--small ${quiet ? 'btn--ghost' : 'btn--hot'}`;

    if (blocked !== undefined) {
        return (
            <button type="button" className={classes} aria-label={ariaLabel} title={blocked} disabled>
                {label}
            </button>
        );
    }
    return (
        <>
            <button
                type="button"
                className={classes}
                aria-label={ariaLabel}
                onClick={() => {
                    setAsking(true);
                }}
            >
                {label}
            </button>
            {asking && (
                <ConfirmDialog
                    title={title}
                    message={message}
                    confirmLabel={confirmLabel ?? t('manga.remove.confirm')}
                    cancelLabel={t('manga.remove.cancel')}
                    onConfirm={() => {
                        setAsking(false);
                        onRemove();
                    }}
                    onCancel={() => {
                        setAsking(false);
                    }}
                />
            )}
        </>
    );
}
