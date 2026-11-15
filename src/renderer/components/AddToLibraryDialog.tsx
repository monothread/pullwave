import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { flyCoverToLibrary } from '../fx/flyCover';
import { useTranslator } from '../i18n/useTranslator';
import { nextFreeOrder, orderFor } from './animeText';
import { SeriesFields } from './SeriesFields';
import type { SeriesChoice } from '@shared/series';

const FOCUSABLE = 'button:not([disabled]), select:not([disabled]), input:not([disabled])';

interface AddToLibraryDialogProps {
    initial: SeriesChoice;
    suggestions: readonly string[];
    usedOrders: (series: string) => readonly number[];
    onConfirm: (choice: SeriesChoice | null) => Promise<boolean>;
    onClose: () => void;
}

export function AddToLibraryDialog({ initial, suggestions, usedOrders, onConfirm, onClose }: AddToLibraryDialogProps) {
    const t = useTranslator();
    const usedIn = (name: string): readonly number[] => {
        return name.trim().length > 0 ? usedOrders(name) : [];
    };
    const [series, setSeries] = useState(initial.series);
    const [season, setSeason] = useState(() => {
        return orderFor(usedIn(initial.series), initial.season);
    });
    const [seasonName, setSeasonName] = useState(initial.seasonName ?? '');
    const [busy, setBusy] = useState(false);
    const dialogRef = useRef<HTMLDivElement>(null);
    const used = usedIn(series);
    const taken = used.includes(season);
    const suggestedOrder = nextFreeOrder(used);

    useEffect(() => {
        const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
        return () => {
            opener?.focus();
        };
    }, []);

    function changeSeries(value: string): void {
        setSeries(value);
        setSeason(orderFor(usedIn(value), season));
    }

    async function confirm(): Promise<void> {
        if (taken) {
            return;
        }
        setBusy(true);
        const added = await onConfirm(series.trim().length > 0 ? { series, season, seasonName } : null);
        setBusy(false);
        if (added) {
            flyCoverToLibrary('anime');
            onClose();
        }
    }

    function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
        if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
            return;
        }
        if (event.key !== 'Tab') {
            return;
        }
        const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
        const first = focusable[0];
        const last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
        }
    }

    return (
        <div
            className="modal-backdrop"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                    onClose();
                }
            }}
        >
            <div ref={dialogRef} className="modal" role="dialog" aria-modal="true" aria-labelledby="add-to-library-title" onKeyDown={handleKeyDown}>
                <h2 id="add-to-library-title" className="modal__title">
                    {t('anime.add.title')}
                </h2>
                <p className="modal__hint">{t('anime.add.intro')}</p>
                <ul className="modal__list">
                    <li>{t('anime.add.series')}</li>
                    <li>{t('anime.add.order')}</li>
                </ul>
                <p className="modal__hint">{t('anime.add.fixed')}</p>
                <SeriesFields
                    series={series}
                    season={season}
                    seasonName={seasonName}
                    suggestions={suggestions}
                    onSeriesChange={changeSeries}
                    onSeasonChange={setSeason}
                    onSeasonNameChange={setSeasonName}
                />
                {taken && (
                    <p className="field__warning" role="alert">
                        {t('anime.series.error.taken', { order: season, suggested: suggestedOrder })}
                    </p>
                )}
                <div className="modal__actions">
                    <button type="button" className="btn btn--small btn--ghost" onClick={onClose}>
                        {t('anime.series.cancel')}
                    </button>
                    <button
                        type="button"
                        className="btn btn--small btn--primary"
                        disabled={busy || taken}
                        onClick={() => {
                            void confirm();
                        }}
                    >
                        {t('anime.add.confirm')}
                    </button>
                </div>
            </div>
        </div>
    );
}
