import { useEffect, useRef, useState } from 'react';
import { useTranslator } from '../i18n/useTranslator';
import { AnimeRemove } from './AnimeRemove';
import { SETTINGS_ICON } from './TabButton';

interface SeriesMenuProps {
    // The name of the series, to tell what the buttons are about.
    name: string;
    onRename: () => void;
    onRemove: () => void;
}

// The gear at the end of the row of a series, with what changes the whole series: renaming it and removing it. It closes with Escape,
// with a click anywhere else and when one of its buttons is used (removing asks for a second click first, and stays open for it).
export function SeriesMenu({ name, onRename, onRemove }: SeriesMenuProps) {
    const t = useTranslator();
    const [open, setOpen] = useState(false);
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
                    <AnimeRemove label={t('anime.series.remove')} ariaLabel={`${t('anime.series.remove')}: ${name}`} onRemove={onRemove} />
                </div>
            )}
        </span>
    );
}
