import { type MouseEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReadingRecord } from '@shared/manga';
import { useFxStore } from '../fx/fxStore';
import { AUTO_SCROLL_RAMP_MS, useAutoScroll } from '../hooks/useAutoScroll';
import { useScrolledDown } from '../hooks/useScrolledDown';
import { useTranslator } from '../i18n/useTranslator';
import { playUiSound } from '../sound/uiSound';
import { useMangaStore } from '../store/mangaStore';
import { useUiPrefsStore } from '../store/uiPrefsStore';
import { NumberField, SelectField, ToggleField } from './fields';
import { MangaCloudflareNotice } from './MangaCloudflareNotice';
import {
    AUTO_SCROLL_STEP,
    loadLastPosition,
    loadProgress,
    loadReaderPrefs,
    MAX_AUTO_SCROLL_SPEED,
    MAX_PAGE_GAP,
    MIN_AUTO_SCROLL_SPEED,
    MIN_PAGE_GAP,
    PAGE_GAP_STEP,
    progressKey,
    READER_BACKGROUNDS,
    READER_DIRECTIONS,
    READER_MODES,
    READER_SCALES,
    saveLastChapter,
    saveLastPosition,
    saveProgress,
    saveReaderPrefs,
    type ReaderPrefs
} from './readerPrefs';
import { SETTINGS_ICON } from './TabButton';
import { neighbourChapter } from './mangaText';
import { buildSpreads, singleSpreads, spreadIndexOf, type Spread } from './readerSpreads';
import { clickZone, type ClickZone } from './readerClickZones';
import { MangaErrorNotice } from './MangaErrorNotice';
import { useScrollFraction } from '../hooks/useScrollFraction';
import { useChapterZones } from '../hooks/useChapterZones';
import { ReaderChapterZone } from './ReaderChapterZone';
import { chapterStartScrollTop, zoneHeight } from './chapterZones';
import { noop, scrollToTopSmoothly } from '../hooks/smoothScroll';
import { useReaderFullscreen } from '../hooks/useReaderFullscreen';
import { useReadingSpotKeeper } from '../hooks/useReadingSpotKeeper';

const PRELOAD_AHEAD = 3;
const RESTORE_LIMIT_MS = 8000;
const READING_RECORD_DELAY_MS = 800;
export const CHAPTER_END_ZONE_SHARE = 0.25;
const FIELD_TAGS = new Set(['INPUT', 'SELECT', 'TEXTAREA']);
const TOP_BUTTON_THRESHOLD = 400;

function chapterTitle(name: string, number: number | null): string {
    if (name.length > 0) {
        return name;
    }
    return number === null ? '' : `#${String(number)}`;
}

export function MangaReader() {
    const t = useTranslator();
    const reader = useMangaStore((state) => {
        return state.reader;
    });
    const library = useMangaStore((state) => {
        return state.library;
    });
    const goToChapter = useMangaStore((state) => {
        return state.goToChapter;
    });
    const goToChapterIndex = useMangaStore((state) => {
        return state.goToChapterIndex;
    });
    const repairReaderPage = useMangaStore((state) => {
        return state.repairReaderPage;
    });
    const closeReader = useMangaStore((state) => {
        return state.closeReader;
    });
    const markRead = useMangaStore((state) => {
        return state.markRead;
    });
    const recordReading = useMangaStore((state) => {
        return state.recordReading;
    });
    const [prefs, setPrefs] = useState<ReaderPrefs>(() => {
        return loadReaderPrefs(reader.mangaTitle);
    });
    const [prefsOf, setPrefsOf] = useState(reader.mangaTitle);
    if (prefsOf !== reader.mangaTitle) {
        setPrefsOf(reader.mangaTitle);
        setPrefs(loadReaderPrefs(reader.mangaTitle));
    }
    const [page, setPage] = useState(0);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const settingsRef = useRef<HTMLDivElement | null>(null);
    const gearRef = useRef<HTMLButtonElement | null>(null);
    const [failed, setFailed] = useState<number[]>([]);
    const [loaded, setLoaded] = useState<number[]>([]);
    const [attempt, setAttempt] = useState(0);
    const [retries, setRetries] = useState<Record<number, number>>({});
    const [repairing, setRepairing] = useState<number | null>(null);
    const [repairFailed, setRepairFailed] = useState<number[]>([]);
    const [autoScrolling, setAutoScrolling] = useState(false);
    const [restoreTo, setRestoreTo] = useState<number | null>(null);
    const [restoredPage, setRestoredPage] = useState<number | null>(null);
    const restoringRef = useRef(false);
    const settledRef = useRef(new Set<number>());
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const flowRef = useRef<HTMLDivElement | null>(null);
    const sectionRef = useRef<HTMLElement | null>(null);
    const startZoneRef = useRef<HTMLDivElement | null>(null);
    const endZoneRef = useRef<HTMLDivElement | null>(null);
    const [zoneHeightPx, setZoneHeightPx] = useState(() => {
        return zoneHeight(window.innerHeight);
    });
    const startTopRef = useRef(0);
    const enteredRef = useRef('');

    const scroller = useCallback((): HTMLElement => {
        return (sectionRef.current?.closest('.app__main') as HTMLElement | null) ?? (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
    }, []);

    const bar = useCallback((): HTMLElement | null => {
        return sectionRef.current?.querySelector<HTMLElement>('.reader__bar') ?? null;
    }, []);

    const chapterStartTop = useCallback((): number => {
        const area = scroller();
        const pages = scrollRef.current;
        if (pages === null) {
            return 0;
        }
        const wanted = (bar()?.getBoundingClientRect().bottom ?? area.getBoundingClientRect().top) + 8;
        return chapterStartScrollTop(area.scrollTop, pages.getBoundingClientRect().top, wanted);
    }, [scroller, bar]);

    const chapter = reader.chapters[reader.index];
    const key = chapter === undefined ? '' : progressKey(reader.mangaTitle, chapter.remoteId);
    const total = reader.pages.length;
    const continuous = prefs.mode !== 'single';
    const scale = prefs.mode === 'webtoon' ? 'width' : prefs.scale;
    const twoPages = prefs.twoPages && !continuous;
    const spreads = useMemo((): Spread[] => {
        return twoPages ? buildSpreads(total) : singleSpreads(total);
    }, [twoPages, total]);
    const spreadIndex = spreadIndexOf(spreads, page);
    const view: Spread = spreads[spreadIndex] ?? [page];
    const firstShown = view[0] ?? page;
    const lastShown = view[view.length - 1] ?? page;
    const previousChapter = neighbourChapter(library, reader, -1);
    const nextChapter = neighbourChapter(library, reader, 1);
    const hasPrevious = previousChapter !== undefined;
    const hasNext = nextChapter !== undefined;

    const startKey = `${key}|${reader.status}|${String(total)}`;
    const [seenStart, setSeenStart] = useState('');
    if (seenStart !== startKey) {
        setSeenStart(startKey);
        const position = reader.resume === true && chapter !== undefined ? loadLastPosition(reader.mangaTitle) : null;
        const resumeAt = position !== null && chapter !== undefined && position.chapterRemoteId === chapter.remoteId ? position.page : null;
        const saved = reader.status === 'ready' ? (resumeAt ?? loadProgress(key)) : 0;
        let start = saved >= total ? 0 : saved;
        if (reader.status === 'ready' && reader.entry === 'start') {
            start = 0;
        } else if (reader.status === 'ready' && reader.entry === 'end' && total > 0) {
            start = total - 1;
        }
        setPage(start);
        setRestoreTo(continuous && start > 0 ? start : null);
        setRestoredPage(continuous && start > 0 ? start : null);
        setFailed([]);
        setLoaded([]);
        setRetries({});
        setRepairFailed([]);
    }

    const [turn, setTurn] = useState<{ page: number; direction: 'forward' | 'back' | null }>({ page: 0, direction: null });
    if (turn.page !== page) {
        setTurn({ page, direction: page > turn.page ? 'forward' : 'back' });
    }

    const soundedPage = useRef(page);
    useEffect(() => {
        if (!continuous && reader.status === 'ready' && soundedPage.current !== page && useUiPrefsStore.getState().sounds) {
            playUiSound('page');
        }
        soundedPage.current = page;
    }, [page, continuous, reader.status]);

    useEffect(() => {
        if (reader.status === 'ready' && total > 0) {
            saveProgress(key, lastShown >= total - 1 ? 0 : page);
        }
    }, [reader.status, key, page, lastShown, total]);

    const manga = reader.manga;
    const pendingReading = useRef<ReadingRecord | null>(null);
    const flushReading = useCallback(() => {
        if (pendingReading.current !== null) {
            void recordReading(pendingReading.current);
            pendingReading.current = null;
        }
    }, [recordReading]);
    useEffect(() => {
        if (reader.status !== 'ready' || total === 0 || chapter === undefined || manga === undefined || manga === null) {
            return undefined;
        }
        const record: ReadingRecord = {
            sourceId: manga.sourceId,
            mangaRemoteId: manga.remoteId,
            title: manga.title,
            thumbnailUrl: manga.thumbnailUrl,
            chapterRemoteId: chapter.remoteId,
            chapterName: chapter.name,
            chapterNumber: chapter.number,
            page: Math.min(page, total - 1),
            pageCount: total
        };
        pendingReading.current = record;
        const timer = window.setTimeout(flushReading, READING_RECORD_DELAY_MS);
        return () => {
            window.clearTimeout(timer);
        };
    }, [reader.status, total, chapter, manga, page, flushReading]);

    useEffect(() => {
        return flushReading;
    }, [chapter, flushReading]);

    useEffect(() => {
        if (reader.status === 'ready' && chapter !== undefined) {
            saveLastChapter(reader.mangaTitle, chapter.remoteId);
        }
    }, [reader.status, reader.mangaTitle, chapter]);
    useEffect(() => {
        if (reader.status === 'ready' && chapter !== undefined && total > 0) {
            saveLastPosition(reader.mangaTitle, chapter.remoteId, Math.min(page, total - 1));
        }
    }, [reader.status, reader.mangaTitle, chapter, page, total]);
    useEffect(() => {
        if (reader.status === 'ready' && total > 0 && lastShown >= total - 1) {
            markRead([key], true);
        }
    }, [reader.status, total, lastShown, key, markRead]);

    const toTheEnd = reader.entry === 'end';
    const bringToPage = useCallback(
        (target: number) => {
            scrollRef.current?.querySelector<HTMLElement>(`[data-page="${String(target)}"]`)?.scrollIntoView?.(toTheEnd && target === total - 1 ? { block: 'end' } : undefined);
        },
        [toTheEnd, total]
    );

    useEffect(() => {
        restoringRef.current = restoreTo !== null;
        settledRef.current = new Set();
        if (reader.status === 'ready' && continuous && restoreTo !== null) {
            bringToPage(restoreTo);
        }
    }, [reader.status, key, continuous, restoreTo, bringToPage]);

    useEffect(() => {
        if (restoreTo === null) {
            return undefined;
        }
        const finish = (): void => {
            setRestoreTo(null);
        };
        const events = ['wheel', 'touchstart', 'mousedown', 'keydown'] as const;
        events.forEach((name) => {
            window.addEventListener(name, finish, { once: true, passive: true });
        });
        const timer = window.setTimeout(finish, RESTORE_LIMIT_MS);
        return () => {
            events.forEach((name) => {
                window.removeEventListener(name, finish);
            });
            window.clearTimeout(timer);
        };
    }, [restoreTo]);

    const pageSettled = useCallback(
        (index: number) => {
            if (restoreTo === null || index > restoreTo) {
                return;
            }
            settledRef.current.add(index);
            bringToPage(restoreTo);
            if (settledRef.current.size > restoreTo) {
                setRestoreTo(null);
            }
        },
        [restoreTo, bringToPage]
    );

    const settledLoadedRef = useRef<number[]>([]);
    useLayoutEffect(() => {
        const before = settledLoadedRef.current;
        settledLoadedRef.current = loaded;
        loaded
            .filter((index) => {
                return !before.includes(index);
            })
            .forEach((index) => {
                pageSettled(index);
            });
    }, [loaded, pageSettled]);

    useEffect(() => {
        const container = scrollRef.current;
        if (!continuous || container === null || typeof IntersectionObserver === 'undefined') {
            return undefined;
        }
        const visible = new Map<number, number>();
        const observer = new IntersectionObserver(
            (entries) => {
                if (restoringRef.current) {
                    return;
                }
                entries.forEach((entry) => {
                    visible.set(Number((entry.target as HTMLElement).dataset['page']), entry.isIntersecting ? entry.intersectionRatio : 0);
                });
                const best = [...visible.entries()].sort((first, second) => {
                    return second[1] - first[1];
                })[0];
                if (best !== undefined && best[1] > 0) {
                    setPage(best[0]);
                }
            },
            { threshold: [0, 0.25, 0.5, 0.75, 1] }
        );
        container.querySelectorAll('[data-page]').forEach((element) => {
            observer.observe(element);
        });
        return () => {
            observer.disconnect();
        };
    }, [continuous, reader.pages, attempt, loaded]);

    const preloaded = useRef(new Map<string, HTMLImageElement>());
    useEffect(() => {
        const held = preloaded.current;
        return () => {
            held.clear();
        };
    }, [key]);
    useEffect(() => {
        if (reader.status !== 'ready' || continuous) {
            return;
        }
        for (let ahead = 1; ahead <= PRELOAD_AHEAD; ahead += 1) {
            const address = reader.pages[lastShown + ahead];
            if (address !== undefined && !preloaded.current.has(address)) {
                const image = new Image();
                image.src = address;
                if (typeof image.decode === 'function') {
                    image.decode().catch(() => {
                        // A picture that cannot be decoded ahead of time is decoded when it is shown.
                    });
                }
                preloaded.current.set(address, image);
            }
        }
    }, [reader.status, reader.pages, lastShown, continuous]);

    const zonesOn = continuous && reader.status === 'ready' && total > 0;
    const fullscreen = useReaderFullscreen(scroller, reader.status !== 'closed');
    useReadingSpotKeeper(scroller, flowRef, zonesOn);
    const scrolledDown = useScrolledDown(scroller, () => {
        return TOP_BUTTON_THRESHOLD + startTopRef.current;
    });
    const stopTopScroll = useRef<() => void>(noop);
    useEffect(() => {
        return () => {
            stopTopScroll.current();
        };
    }, []);
    const scrolled = useScrollFraction(scroller, scrollRef, continuous && reader.status === 'ready');
    const progress = continuous ? scrolled : (lastShown + 1) / total;
    const scrolling = autoScrolling && continuous && reader.status === 'ready';
    const stopAutoScroll = useCallback(() => {
        setAutoScrolling(false);
    }, []);
    const handleAutoScrollEnd = useCallback((): boolean => {
        if (hasNext && prefs.chapterSwitch) {
            return true;
        }
        setAutoScrolling(false);
        return false;
    }, [hasNext, prefs.chapterSwitch]);
    useAutoScroll(scroller, scrolling, prefs.autoScrollSpeed, handleAutoScrollEnd, AUTO_SCROLL_RAMP_MS);

    const zones = useChapterZones({
        area: scroller,
        bar,
        startZone: startZoneRef,
        endZone: endZoneRef,
        enabled: zonesOn,
        chapterKey: key,
        automatic: prefs.chapterSwitch,
        hasPrevious,
        hasNext,
        onPrevious: () => {
            void goToChapter(-1, true);
        },
        onNext: () => {
            void goToChapter(1, true);
        }
    });

    const reachedEnd = reader.status === 'ready' && total > 0 && reader.entry !== 'end' && (continuous ? zones.end >= CHAPTER_END_ZONE_SHARE : lastShown >= total - 1 && turn.direction === 'forward');
    const [celebratedKey, setCelebratedKey] = useState('');
    if (reachedEnd && celebratedKey !== key) {
        setCelebratedKey(key);
    }
    useEffect(() => {
        if (celebratedKey !== '') {
            useFxStore.getState().celebrate();
        }
    }, [celebratedKey]);

    useLayoutEffect(() => {
        if (!zonesOn) {
            startTopRef.current = 0;
            return;
        }
        const entry = `${key}|${String(total)}`;
        if (enteredRef.current !== entry) {
            enteredRef.current = entry;
            if (restoreTo === null) {
                scroller().scrollTop = chapterStartTop();
            }
        }
        startTopRef.current = chapterStartTop();
    }, [zonesOn, key, total, restoreTo, zoneHeightPx, scroller, chapterStartTop]);

    useEffect(() => {
        if (!zonesOn) {
            return undefined;
        }
        const resize = (): void => {
            const wanted = zoneHeight(window.innerHeight);
            setZoneHeightPx((current) => {
                if (current !== wanted) {
                    scroller().scrollTop += wanted - current;
                }
                return wanted;
            });
        };
        window.addEventListener('resize', resize);
        return () => {
            window.removeEventListener('resize', resize);
        };
    }, [zonesOn, scroller]);

    const changePrefs = useCallback((patch: Partial<ReaderPrefs>) => {
        setPrefs((current) => {
            const next = { ...current, ...patch };
            saveReaderPrefs(next, reader.mangaTitle);
            return next;
        });
    }, [reader.mangaTitle]);

    const next = useCallback(() => {
        const following = spreads[spreadIndex + 1]?.[0];
        if (following !== undefined) {
            setPage(following);
        } else {
            void goToChapter(1);
        }
    }, [spreads, spreadIndex, goToChapter]);

    const previous = useCallback(() => {
        const preceding = spreads[spreadIndex - 1]?.[0];
        if (preceding !== undefined) {
            setPage(preceding);
        } else {
            void goToChapter(-1);
        }
    }, [spreads, spreadIndex, goToChapter]);

    useEffect(() => {
        function handleKey(event: KeyboardEvent): void {
            const target = event.target as HTMLElement | null;
            if (target !== null && FIELD_TAGS.has(target.tagName)) {
                return;
            }
            if (event.key === 'Escape') {
                if (fullscreen.takesEscape()) {
                    fullscreen.exit();
                    return;
                }
                if (settingsOpen) {
                    setSettingsOpen(false);
                } else {
                    closeReader();
                }
                return;
            }
            if (event.key === 'n' || event.key === 'N') {
                void goToChapter(1);
                return;
            }
            if (event.key === 'p' || event.key === 'P') {
                void goToChapter(-1);
                return;
            }
            if (continuous || reader.status !== 'ready') {
                return;
            }
            const forward = prefs.direction === 'ltr' ? 'ArrowRight' : 'ArrowLeft';
            const backward = prefs.direction === 'ltr' ? 'ArrowLeft' : 'ArrowRight';
            if (event.key === forward || event.key === 'ArrowDown' || event.key === 'PageDown' || (event.key === ' ' && !event.shiftKey)) {
                event.preventDefault();
                next();
            } else if (event.key === backward || event.key === 'ArrowUp' || event.key === 'PageUp' || (event.key === ' ' && event.shiftKey)) {
                event.preventDefault();
                previous();
            } else if (event.key === 'Home') {
                setPage(0);
            } else if (event.key === 'End') {
                setPage(Math.max(0, total - 1));
            }
        }
        window.addEventListener('keydown', handleKey);
        return () => {
            window.removeEventListener('keydown', handleKey);
        };
    }, [settingsOpen, continuous, reader.status, prefs.direction, total, next, previous, goToChapter, closeReader, fullscreen]);

    useEffect(() => {
        if (!settingsOpen) {
            return undefined;
        }
        const closeOutside = (event: Event): void => {
            const target = event.target as Node | null;
            if (target !== null && (settingsRef.current?.contains(target) === true || gearRef.current?.contains(target) === true)) {
                return;
            }
            event.stopPropagation();
            setSettingsOpen(false);
        };
        document.addEventListener('click', closeOutside, true);
        return () => {
            document.removeEventListener('click', closeOutside, true);
        };
    }, [settingsOpen]);

    const pageError = useMemo(() => {
        return (index: number) => {
            return failed.includes(index);
        };
    }, [failed]);

    if (reader.status === 'closed' || chapter === undefined) {
        return null;
    }

    function zoneOf(event: MouseEvent<HTMLDivElement>): ClickZone {
        const box = event.currentTarget.getBoundingClientRect();
        return clickZone((event.clientX - box.left) / box.width, twoPages, prefs.direction);
    }

    function handleStageClick(event: MouseEvent<HTMLDivElement>): void {
        const zone = zoneOf(event);
        if (zone === 'previous') {
            previous();
        } else if (zone === 'next') {
            next();
        }
    }

    function handleStageDoubleClick(event: MouseEvent<HTMLDivElement>): void {
        if ((event.target as HTMLElement).closest('button') === null && zoneOf(event) === 'middle') {
            fullscreen.toggle();
        }
    }

    async function retryPage(index: number, isMissing: boolean): Promise<void> {
        if (isMissing) {
            setRepairing(index);
            const error = await repairReaderPage(index);
            setRepairing(null);
            if (error !== null) {
                setRepairFailed((current) => {
                    return current.includes(index) ? current : [...current, index];
                });
                return;
            }
            setRepairFailed((current) => {
                return current.filter((item) => {
                    return item !== index;
                });
            });
        }
        setFailed((current) => {
            return current.filter((item) => {
                return item !== index;
            });
        });
        setRetries((current) => {
            return { ...current, [index]: (current[index] ?? 0) + 1 };
        });
        setAttempt((current) => {
            return current + 1;
        });
    }

    function renderPage(index: number) {
        const address = reader.pages[index];
        if (address === undefined) {
            return null;
        }
        if (pageError(index)) {
            const isMissing = reader.missing.includes(index);
            return (
                <div className="reader__failed" data-page={index} key={`failed-${String(index)}`}>
                    <p className="field__warning" role="alert">
                        {t(isMissing ? 'manga.reader.pageMissing' : 'manga.reader.pageError', { page: index + 1 })}
                    </p>
                    {repairFailed.includes(index) && (
                        <p className="field__warning" role="alert">
                            {t('manga.reader.repairFailed')}
                        </p>
                    )}
                    <button
                        type="button"
                        className="btn btn--small"
                        disabled={repairing === index}
                        onClick={(event) => {
                            event.stopPropagation();
                            void retryPage(index, isMissing);
                        }}
                    >
                        {t(isMissing ? 'manga.reader.downloadPage' : 'manga.reader.retry')}
                    </button>
                </div>
            );
        }
        const arrived = loaded.includes(index);
        return (
            <div
                className={`reader__slot${arrived ? '' : ' reader__slot--pending'}`}
                data-testid={`reader-slot-${String(index)}`}
                key={`${address}-${String(retries[index] ?? 0)}`}
            >
                {!arrived && (
                    <div className="reader__loading-page" data-page={index} role="status">
                        {t('manga.reader.pageLoading', { page: index + 1 })}
                    </div>
                )}
                <img
                    className={`reader__img${arrived ? '' : ' reader__img--pending'}${arrived && restoredPage === index ? ' reader__img--restored' : ''}`}
                    src={address}
                    alt={t('manga.reader.pageAlt', { page: index + 1 })}
                    data-page={arrived ? index : undefined}
                    loading={continuous && !(restoreTo !== null && index <= restoreTo + 1) ? 'lazy' : undefined}
                    onLoad={() => {
                        setLoaded((current) => {
                            return current.includes(index) ? current : [...current, index];
                        });
                    }}
                    onError={() => {
                        setFailed((current) => {
                            return current.includes(index) ? current : [...current, index];
                        });
                        pageSettled(index);
                    }}
                />
            </div>
        );
    }

    return (
        <section ref={sectionRef} className={`manga__reader reader reader--${prefs.background}`} aria-label={t('manga.reader.aria')}>
            <header className="reader__bar">
                <button type="button" className="btn btn--small btn--ghost" onClick={closeReader}>
                    {t('manga.reader.close')}
                </button>
                <span className="reader__title history__title">{`${reader.mangaTitle} · ${chapterTitle(chapter.name, chapter.number)}`}</span>
                {reader.status === 'ready' && total > 0 && (
                    <span className="reader__page" aria-live="polite">
                        <span key={firstShown} className="reader__page-text">
                            {`${view.length === 2 ? `${String(firstShown + 1)}–${String(lastShown + 1)}` : String(firstShown + 1)} / ${String(total)}`}
                        </span>
                    </span>
                )}
                <span className="job__actions">
                    <button type="button" className="btn btn--small" disabled={!hasPrevious} onClick={() => {return void goToChapter(-1)}}>
                        {t('manga.reader.prevChapter')}
                    </button>
                    <select
                        className="input reader__chapters"
                        aria-label={t('manga.reader.chapterSelect')}
                        value={reader.index}
                        onChange={(event) => {
                            void goToChapterIndex(Number(event.target.value));
                        }}
                    >
                        {reader.chapters.map((item, index) => {
                            return (
                                <option key={item.remoteId} value={index}>
                                    {chapterTitle(item.name, item.number)}
                                </option>
                            );
                        })}
                    </select>
                    <button type="button" className="btn btn--small" disabled={!hasNext} onClick={() => {return void goToChapter(1)}}>
                        {t('manga.reader.nextChapter')}
                    </button>
                    <button
                        type="button"
                        ref={gearRef}
                        className="btn btn--ghost manga__gear"
                        aria-label={t('manga.reader.settings')}
                        title={t('manga.reader.settings')}
                        aria-expanded={settingsOpen}
                        onClick={() => {
                            setSettingsOpen(!settingsOpen);
                        }}
                    >
                        <span aria-hidden="true">{SETTINGS_ICON}</span>
                    </button>
                </span>
                {reader.status === 'ready' && total > 0 && (
                    <div
                        className="progress reader__progress"
                        role="progressbar"
                        aria-label={t('manga.reader.progress')}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round(progress * 100)}
                    >
                        <div className="progress__bar" style={{ width: `${String(progress * 100)}%` }} />
                    </div>
                )}
            {settingsOpen && (
                <div ref={settingsRef} className="panel reader__settings">
                    <SelectField
                        label={t('manga.reader.mode')}
                        value={prefs.mode}
                        options={READER_MODES}
                        formatOption={(mode) => {
                            return t(`manga.reader.mode.${mode}`);
                        }}
                        onChange={(mode) => {
                            changePrefs({ mode });
                        }}
                    />
                    <SelectField
                        label={t('manga.reader.direction')}
                        value={prefs.direction}
                        options={READER_DIRECTIONS}
                        disabled={continuous}
                        formatOption={(direction) => {
                            return t(`manga.reader.direction.${direction}`);
                        }}
                        onChange={(direction) => {
                            changePrefs({ direction });
                        }}
                    />
                    <ToggleField
                        label={t('manga.reader.twoPages')}
                        checked={prefs.twoPages}
                        hint={t('manga.reader.twoPagesHint')}
                        onChange={(value) => {
                            changePrefs({ twoPages: value });
                        }}
                    />
                    <SelectField
                        label={t('manga.reader.scale')}
                        value={prefs.scale}
                        options={READER_SCALES}
                        disabled={prefs.mode === 'webtoon'}
                        formatOption={(option) => {
                            return t(`manga.reader.scale.${option}`);
                        }}
                        onChange={(option) => {
                            changePrefs({ scale: option });
                        }}
                    />
                    <SelectField
                        label={t('manga.reader.background')}
                        value={prefs.background}
                        options={READER_BACKGROUNDS}
                        formatOption={(background) => {
                            return t(`manga.reader.background.${background}`);
                        }}
                        onChange={(background) => {
                            changePrefs({ background });
                        }}
                    />
                    <NumberField
                        label={t('manga.reader.pageGap')}
                        value={prefs.pageGap}
                        min={MIN_PAGE_GAP}
                        max={MAX_PAGE_GAP}
                        step={PAGE_GAP_STEP}
                        disabled={prefs.mode !== 'vertical'}
                        hint={prefs.mode === 'vertical' ? undefined : t('manga.reader.pageGapOnlyVertical')}
                        onChange={(pageGap) => {
                            changePrefs({ pageGap: Math.min(MAX_PAGE_GAP, Math.max(MIN_PAGE_GAP, Math.round(pageGap))) });
                        }}
                    />
                    <ToggleField
                        label={t('manga.reader.chapterSwitch')}
                        checked={prefs.chapterSwitch}
                        hint={t('manga.reader.chapterSwitchHint')}
                        onChange={(chapterSwitch) => {
                            changePrefs({ chapterSwitch });
                        }}
                    />
                    <NumberField
                        label={t('manga.reader.autoScrollSpeed')}
                        value={prefs.autoScrollSpeed}
                        min={MIN_AUTO_SCROLL_SPEED}
                        max={MAX_AUTO_SCROLL_SPEED}
                        step={AUTO_SCROLL_STEP}
                        onChange={(autoScrollSpeed) => {
                            changePrefs({ autoScrollSpeed: Math.min(MAX_AUTO_SCROLL_SPEED, Math.max(MIN_AUTO_SCROLL_SPEED, Math.round(autoScrollSpeed))) });
                        }}
                    />
                </div>
            )}
            </header>
            {reader.status === 'loading' && <MangaCloudflareNotice />}
            {reader.status === 'loading' && (
                <div className="reader__stage reader__chapter-loading" data-testid="reader-loading" role="status">
                    {t('manga.reader.loading')}
                </div>
            )}
            {reader.status === 'error' && reader.error && (
                <MangaErrorNotice error={reader.error} />
            )}
            {reader.status === 'ready' && total === 0 && <p className="empty">{t('manga.reader.empty')}</p>}
            {reader.status === 'ready' && total > 0 && !continuous && (
                <div
                    className={`reader__stage reader__stage--${scale}`}
                    data-testid="reader-stage"
                    data-turn={turn.direction ?? undefined}
                    data-direction={prefs.direction}
                    onClick={handleStageClick}
                    onDoubleClick={handleStageDoubleClick}
                >
                    {twoPages ? (
                        <div className={`reader__spread reader__spread--${view.length === 2 ? 'pair' : 'single'}`} data-testid="reader-spread" data-direction={prefs.direction}>
                            {view.map((index) => {
                                return renderPage(index);
                            })}
                        </div>
                    ) : (
                        renderPage(page)
                    )}
                </div>
            )}
            {reader.status === 'ready' && total > 0 && continuous && (
                <div ref={flowRef} className="reader__flow">
                    <ReaderChapterZone
                        edge="start"
                        zoneRef={startZoneRef}
                        title={previousChapter === undefined ? null : chapterTitle(previousChapter.name, previousChapter.number)}
                        progress={zones.start}
                        automatic={prefs.chapterSwitch}
                        height={zoneHeightPx}
                        onGo={() => {
                            void goToChapter(-1, true);
                        }}
                    />
                    <div
                        ref={scrollRef}
                        className={`reader__scroll reader__scroll--${prefs.mode} reader__stage--${scale}`}
                        style={prefs.mode === 'vertical' ? { gap: `${String(prefs.pageGap)}px` } : undefined}
                        data-testid="reader-scroll"
                        data-fullscreen={fullscreen.active}
                        onDoubleClick={(event) => {
                            if ((event.target as HTMLElement).closest('button') === null) {
                                fullscreen.toggle();
                            }
                        }}
                    >
                        {reader.pages.map((_address, index) => {
                            return renderPage(index);
                        })}
                    </div>
                    <ReaderChapterZone
                        edge="end"
                        zoneRef={endZoneRef}
                        title={nextChapter === undefined ? null : chapterTitle(nextChapter.name, nextChapter.number)}
                        progress={zones.end}
                        automatic={prefs.chapterSwitch}
                        height={zoneHeightPx}
                        onGo={() => {
                            void goToChapter(1, true);
                        }}
                    />
                </div>
            )}
            {celebratedKey === key && (
                <div key={celebratedKey} className="reader__complete" role="status" data-testid="reader-complete">
                    {t('manga.reader.complete')}
                </div>
            )}
            {reader.status === 'ready' && total > 0 && (
                <div className="reader__float">
                    <button
                        type="button"
                        className={`btn reader__auto${scrolling ? ' btn--primary' : ''}`}
                        disabled={!continuous}
                        title={continuous ? undefined : t('manga.reader.autoScrollOnlyScroll')}
                        aria-pressed={scrolling}
                        onClick={() => {
                            setAutoScrolling(!autoScrolling);
                        }}
                    >
                        {scrolling ? t('manga.reader.autoScrollStop') : t('manga.reader.autoScroll')}
                        {scrolling && (
                            <span className="reader__auto-flow" aria-hidden="true" data-testid="reader-auto-flow">
                                <span>▼</span>
                                <span>▼</span>
                                <span>▼</span>
                                <span className="reader__auto-speed">{`${String(prefs.autoScrollSpeed)} px/s`}</span>
                            </span>
                        )}
                    </button>
                    {scrolledDown && (
                        <button
                            type="button"
                            className="btn btn--primary reader__top"
                            aria-label={t('manga.reader.top')}
                            title={t('manga.reader.top')}
                            onClick={() => {
                                stopAutoScroll();
                                stopTopScroll.current();
                                stopTopScroll.current = scrollToTopSmoothly(scroller(), startTopRef.current);
                            }}
                        >
                            <svg className="reader__top-ring" viewBox="0 0 44 44" aria-hidden="true" focusable="false" data-testid="reader-top-ring">
                                <circle className="reader__top-ring-track" cx="22" cy="22" r="19" />
                                <circle className="reader__top-ring-fill" cx="22" cy="22" r="19" pathLength={100} strokeDasharray={100} strokeDashoffset={100 - Math.min(1, Math.max(0, progress)) * 100} />
                            </svg>
                            <span aria-hidden="true">↑</span>
                        </button>
                    )}
                </div>
            )}
        </section>
    );
}
