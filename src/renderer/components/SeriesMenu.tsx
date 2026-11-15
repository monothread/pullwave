import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslator } from '../i18n/useTranslator';
import { ConfirmDialog } from './ConfirmDialog';
import { SETTINGS_ICON } from './TabButton';

interface SeriesMenuProps {
    name: string;
    onRename: () => void;
    onRemove: () => void;
    confirmation: { title: string; message: string; confirmLabel: string; cancelLabel: string };
    children?: ReactNode;
}

export function SeriesMenu({ name, onRename, onRemove, confirmation, children }: SeriesMenuProps) {
    const t = useTranslator();
    const [open, setOpen] = useState(false);
    const [asking, setAsking] = useState(false);
    const root = useRef<HTMLSpanElement>(null);

    useEffect(() => {
        if (!open) {
            return undefined;
        }
        const onKeyDown = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') {
                event.stopPropagation();
                setOpen(false);
            }
        };
        const onMouseDown = (event: MouseEvent): void => {
            if (event.target instanceof Node && !root.current?.contains(event.target)) {
                setOpen(false);
            }
        };
        document.addEventListener('keydown', onKeyDown, true);
        document.addEventListener('mousedown', onMouseDown);
        return () => {
            document.removeEventListener('keydown', onKeyDown, true);
            document.removeEventListener('mousedown', onMouseDown);
        };
    }, [open]);

    return (
        <span ref={root} className="series-menu">
            <button
                type="button"
                className="btn btn--small btn--ghost series-menu__button"
                aria-haspopup="true"
                aria-expanded={open}
                aria-label={`${t('anime.series.options')}: ${name}`}
                title={t('anime.series.options')}
                onClick={() => {
                    setOpen(!open);
                }}
            >
                <span aria-hidden="true">{SETTINGS_ICON}</span>
            </button>
            {open && (
                <div className="series-menu__panel" role="group" aria-label={`${t('anime.series.options')}: ${name}`}>
                    <button
                        type="button"
                        className="btn btn--small"
                        aria-label={`${t('anime.series.rename')}: ${name}`}
                        onClick={() => {
                            setOpen(false);
                            onRename();
                        }}
                    >
                        {t('anime.series.rename')}
                    </button>
                    <button
                        type="button"
                        className="btn btn--small btn--hot"
                        aria-label={`${t('anime.series.remove')}: ${name}`}
                        onClick={() => {
                            setOpen(false);
                            setAsking(true);
                        }}
                    >
                        {t('anime.series.remove')}
                    </button>
                    {children}
                </div>
            )}
            {asking && (
                <ConfirmDialog
                    title={confirmation.title}
                    message={confirmation.message}
                    confirmLabel={confirmation.confirmLabel}
                    cancelLabel={confirmation.cancelLabel}
                    onConfirm={() => {
                        setAsking(false);
                        onRemove();
                    }}
                    onCancel={() => {
                        setAsking(false);
                    }}
                />
            )}
        </span>
    );
}
