import { useState } from 'react';
import { useTranslator } from '../i18n/useTranslator';
import { ConfirmDialog } from './ConfirmDialog';

interface MangaRemoveProps {
    label: string;
    ariaLabel: string;
    title: string;
    message: string;
    confirmLabel?: string;
    onRemove: () => void;
    blocked?: string;
    quiet?: boolean;
}

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
