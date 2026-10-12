import { useTranslator } from '../i18n/useTranslator';

interface ReaderChapterZoneProps {
    // Below the last page (the next chapter) or above the first one (the previous chapter).
    edge: 'start' | 'end';
    // The name of the chapter on the other side, or null when there is none.
    title: string | null;
    // How much of the zone is in view, from 0 to 1.
    progress: number;
    // Whether going through the zone switches the chapter by itself (otherwise only the button does).
    automatic: boolean;
    height: number;
    onGo: () => void;
    zoneRef: React.RefObject<HTMLDivElement | null>;
}

// The zone between two chapters in the scroll: it says which chapter is on the other side, fills a bar as the user goes through it and has
// a button to go at once. Where there is no chapter on the other side it only says so.
export function ReaderChapterZone({ edge, title, progress, automatic, height, onGo, zoneRef }: ReaderChapterZoneProps) {
    const t = useTranslator();
    const label = edge === 'end' ? t('manga.reader.zone.next') : t('manga.reader.zone.previous');
    return (
        <div ref={zoneRef} className={`reader__zone reader__zone--${edge}`} style={{ height: `${String(height)}px` }} data-testid={`reader-zone-${edge}`} aria-label={label} role="region">
            {title === null ? (
                <p className="reader__zone-none">{edge === 'end' ? t('manga.reader.zone.noNext') : t('manga.reader.zone.noPrevious')}</p>
            ) : (
                <>
                    <span className="reader__zone-label">{label}</span>
                    <strong className="reader__zone-title">{title}</strong>
                    {automatic && (
                        <>
                            <div
                                className="progress reader__zone-bar"
                                role="progressbar"
                                aria-label={t('manga.reader.zone.progress')}
                                aria-valuemin={0}
                                aria-valuemax={100}
                                aria-valuenow={Math.round(progress * 100)}
                            >
                                <div className="progress__bar progress__bar--smooth" style={{ width: `${String(progress * 100)}%` }} />
                            </div>
                            <span className="reader__zone-hint">{edge === 'end' ? t('manga.reader.zone.keepNext') : t('manga.reader.zone.keepPrevious')}</span>
                        </>
                    )}
                    <button type="button" className="btn btn--small btn--primary" onClick={onGo}>
                        {edge === 'end' ? t('manga.reader.zone.goNext') : t('manga.reader.zone.goPrevious')}
                    </button>
                </>
            )}
        </div>
    );
}
