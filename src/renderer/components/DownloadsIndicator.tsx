import { useEffect, useMemo, useRef, useState } from 'react';
import { openActiveDownload, openSubtitleJobs } from '../home/homeActions';
import { activeTotal, type ActiveDownloadKind } from '../home/homeData';
import { useActiveCounts } from '../hooks/useActiveCounts';
import { useTranslator } from '../i18n/useTranslator';
import { useAnimeStore } from '../store/animeStore';
import { useMangaStore } from '../store/mangaStore';

const KINDS: readonly ActiveDownloadKind[] = ['video', 'anime', 'manga'];

interface IndicatorRowProps {
    section: string;
    count: number;
    onOpen: () => void;
}

// A line of the list of the arrow: the name of what it leads to and how many are going on there.
function IndicatorRow({ section, count, onOpen }: IndicatorRowProps) {
    const t = useTranslator();
    return (
        <button type="button" className="downloads-indicator__row" aria-label={t('downloads.indicator.row', { section, count })} onClick={onOpen}>
            <span className="downloads-indicator__section">{section}</span>
            <span className="downloads-indicator__number">{count}</span>
        </button>
    );
}

// The arrow of the top bar with how many downloads are going on in the whole app; it opens a list with one line per section, which leads
// to the downloads of that section.
export function DownloadsIndicator() {
    const t = useTranslator();
    const [open, setOpen] = useState(false);
    const holderRef = useRef<HTMLDivElement>(null);
    const animeSupported = useAnimeStore((state) => {
        return state.status.supported;
    });
    // The subtitles being translated or made: they have a line of their own, and count with the downloads.
    const subtitleJobs = useAnimeStore((state) => {
        return state.subtitleJobs.length;
    });
    const mangaSupported = useMangaStore((state) => {
        return state.status.supported;
    });
    const active = useActiveCounts();
    const counts = useMemo(() => {
        return { video: activeTotal(active.video), anime: activeTotal(active.anime), manga: activeTotal(active.manga) };
    }, [active]);
    const total = counts.video + counts.anime + counts.manga + subtitleJobs;
    const kinds = KINDS.filter((kind) => {
        return (kind !== 'anime' || animeSupported) && (kind !== 'manga' || mangaSupported);
    });

    useEffect(() => {
        if (!open) {
            return undefined;
        }
        const onPointerDown = (event: PointerEvent): void => {
            if (!holderRef.current?.contains(event.target as Node)) {
                setOpen(false);
            }
        };
        const onKeyDown = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') {
                setOpen(false);
            }
        };
        document.addEventListener('pointerdown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('pointerdown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [open]);

    return (
        <div ref={holderRef} className="downloads-indicator">
            <button
                type="button"
                className={`topbar__button downloads-indicator__button${total > 0 ? ' downloads-indicator__button--busy' : ''}`}
                aria-label={t('downloads.indicator', { count: total })}
                aria-expanded={open}
                aria-haspopup="true"
                onClick={() => {
                    setOpen(!open);
                }}
            >
                <span className="downloads-indicator__arrow" aria-hidden="true">
                    ⬇
                </span>
                {total > 0 && (
                    <span className="downloads-indicator__count" aria-hidden="true">
                        {total}
                    </span>
                )}
            </button>
            {open && (
                <div className="downloads-indicator__panel">
                    {total === 0 && <p className="downloads-indicator__empty">{t('downloads.indicator.empty')}</p>}
                    {kinds.map((kind) => {
                        return (
                            <IndicatorRow
                                key={kind}
                                section={t(`downloads.indicator.${kind}`)}
                                count={counts[kind]}
                                onOpen={() => {
                                    setOpen(false);
                                    openActiveDownload(kind);
                                }}
                            />
                        );
                    })}
                    {animeSupported && (
                        <IndicatorRow
                            section={t('downloads.indicator.subtitles')}
                            count={subtitleJobs}
                            onOpen={() => {
                                setOpen(false);
                                openSubtitleJobs();
                            }}
                        />
                    )}
                </div>
            )}
        </div>
    );
}
