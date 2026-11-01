import { useEffect, useMemo, useRef, useState } from 'react';
import { openActiveDownload } from '../home/homeActions';
import { activeDownloads, type ActiveDownloadKind } from '../home/homeData';
import { useTranslator } from '../i18n/useTranslator';
import { useAnimeStore } from '../store/animeStore';
import { useAppStore } from '../store/appStore';
import { useMangaStore } from '../store/mangaStore';

const KINDS: readonly ActiveDownloadKind[] = ['video', 'anime', 'manga'];

// How many downloads of each section are not over.
export function countByKind(kinds: readonly ActiveDownloadKind[]): Record<ActiveDownloadKind, number> {
    const counts: Record<ActiveDownloadKind, number> = { video: 0, anime: 0, manga: 0 };
    kinds.forEach((kind) => {
        counts[kind] += 1;
    });
    return counts;
}

// The arrow of the top bar with how many downloads are going on in the whole app; it opens a list with one line per section, which leads
// to the downloads of that section.
export function DownloadsIndicator() {
    const t = useTranslator();
    const [open, setOpen] = useState(false);
    const holderRef = useRef<HTMLDivElement>(null);
    const videoJobs = useAppStore((state) => {
        return state.jobs;
    });
    const animeJobs = useAnimeStore((state) => {
        return state.jobs;
    });
    const animeSupported = useAnimeStore((state) => {
        return state.status.supported;
    });
    const mangaJobs = useMangaStore((state) => {
        return state.jobs;
    });
    const mangaSupported = useMangaStore((state) => {
        return state.status.supported;
    });
    const counts = useMemo(() => {
        return countByKind(
            activeDownloads(videoJobs, animeJobs, mangaJobs).map((item) => {
                return item.kind;
            })
        );
    }, [videoJobs, animeJobs, mangaJobs]);
    const total = counts.video + counts.anime + counts.manga;
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
                        const section = t(`downloads.indicator.${kind}`);
                        return (
                            <button
                                key={kind}
                                type="button"
                                className="downloads-indicator__row"
                                aria-label={t('downloads.indicator.row', { section, count: counts[kind] })}
                                onClick={() => {
                                    setOpen(false);
                                    openActiveDownload(kind);
                                }}
                            >
                                <span className="downloads-indicator__section">{section}</span>
                                <span className="downloads-indicator__number">{counts[kind]}</span>
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
