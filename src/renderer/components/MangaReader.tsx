import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useAutoScroll } from '../hooks/useAutoScroll';
import { useScrolledDown } from '../hooks/useScrolledDown';
import { useTranslator } from '../i18n/useTranslator';
import { useMangaStore } from '../store/mangaStore';
import { NumberField, SelectField } from './fields';
import {
    AUTO_SCROLL_STEP,
    loadProgress,
    loadReaderPrefs,
    MAX_AUTO_SCROLL_SPEED,
    MIN_AUTO_SCROLL_SPEED,
    progressKey,
    READER_BACKGROUNDS,
    READER_DIRECTIONS,
    READER_MODES,
    READER_SCALES,
    saveProgress,
    saveReaderPrefs,
    type ReaderPrefs
} from './readerPrefs';
import { SETTINGS_ICON } from './TabButton';
import { mangaErrorKey } from './mangaText';

const PRELOAD_AHEAD = 2;
const FIELD_TAGS = new Set(['INPUT', 'SELECT', 'TEXTAREA']);
// How far down the page is scrolled before the button to go back to the top shows.
const TOP_BUTTON_THRESHOLD = 400;

function chapterTitle(name: string, number: number | null): string {
    if (name.length > 0) {
        return name;
    }
    return number === null ? '' : `#${String(number)}`;
}

// Reads a chapter: the pages one at a time or in a scroll (vertical, or webtoon with no gap between them), in either direction, at the size
// and on the background the user likes. It remembers both, and the page each chapter was left on.
export function MangaReader() {
    const t = useTranslator();
    const reader = useMangaStore((state) => {
        return state.reader;
    });
    const goToChapter = useMangaStore((state) => {
        return state.goToChapter;
    });
    const goToChapterIndex = useMangaStore((state) => {
        return state.goToChapterIndex;
    });
    const closeReader = useMangaStore((state) => {
        return state.closeReader;
    });
    const [prefs, setPrefs] = useState<ReaderPrefs>(loadReaderPrefs);
    const [page, setPage] = useState(0);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [failed, setFailed] = useState<number[]>([]);
    const [attempt, setAttempt] = useState(0);
    // How many times each page was tried again: a page that is tried again is loaded again, and only that one.
    const [retries, setRetries] = useState<Record<number, number>>({});
    const [autoScrolling, setAutoScrolling] = useState(false);
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const sectionRef = useRef<HTMLElement | null>(null);

    // The page scrolls inside the main area of the app (or the document, where there is none).
    const scroller = useCallback((): HTMLElement => {
        return (sectionRef.current?.closest('.app__main') as HTMLElement | null) ?? (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
    }, []);

    const chapter = reader.chapters[reader.index];
    const key = chapter === undefined ? '' : progressKey(reader.mangaTitle, chapter.remoteId);
    const total = reader.pages.length;
    const continuous = prefs.mode !== 'single';
    const scale = prefs.mode === 'webtoon' ? 'width' : prefs.scale;
    const hasPrevious = reader.index > 0;
    const hasNext = reader.index < reader.chapters.length - 1;

    // A chapter that is ready starts where it was left (the last page counts as read, so it starts over); anything else starts at the first.
    // Done while rendering, so the first picture is the right one.
    const startKey = `${key}|${reader.status}|${String(total)}`;
    const [seenStart, setSeenStart] = useState('');
    if (seenStart !== startKey) {
        setSeenStart(startKey);
        const saved = reader.status === 'ready' ? loadProgress(key) : 0;
        setPage(saved >= total ? 0 : saved);
        setFailed([]);
        setRetries({});
    }

    useEffect(() => {
        if (reader.status === 'ready' && total > 0) {
            saveProgress(key, page >= total - 1 ? 0 : page);
        }
    }, [reader.status, key, page, total]);

    // In the scroll the chapter is brought to the page it starts on.
    useEffect(() => {
        if (reader.status === 'ready' && continuous && page > 0) {
            scrollRef.current?.querySelector<HTMLElement>(`[data-page="${String(page)}"]`)?.scrollIntoView?.();
        }
        // Only when the chapter or the mode changes: the page changes as the user scrolls.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [reader.status, key, continuous]);

    // In the scroll the page is the one the user has most of in view.
    useEffect(() => {
        const container = scrollRef.current;
        if (!continuous || container === null || typeof IntersectionObserver === 'undefined') {
            return undefined;
        }
        const visible = new Map<number, number>();
        const observer = new IntersectionObserver(
            (entries) => {
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
    }, [continuous, reader.pages, attempt]);

    // The pages that come next are loaded before they are needed.
    useEffect(() => {
        if (reader.status !== 'ready' || continuous) {
            return;
        }
        for (let ahead = 1; ahead <= PRELOAD_AHEAD; ahead += 1) {
            const address = reader.pages[page + ahead];
            if (address !== undefined) {
                new Image().src = address;
            }
        }
    }, [reader.status, reader.pages, page, continuous]);

    const scrolledDown = useScrolledDown(scroller, TOP_BUTTON_THRESHOLD);
    // Auto scroll only makes sense where the pages are in a scroll; it stops at the end of the chapter.
    const scrolling = autoScrolling && continuous && reader.status === 'ready';
    const stopAutoScroll = useCallback(() => {
        setAutoScrolling(false);
    }, []);
    useAutoScroll(scroller, scrolling, prefs.autoScrollSpeed, stopAutoScroll);

    const changePrefs = useCallback((patch: Partial<ReaderPrefs>) => {
        setPrefs((current) => {
            const next = { ...current, ...patch };
            saveReaderPrefs(next);
            return next;
        });
    }, []);

    const next = useCallback(() => {
        if (page < total - 1) {
            setPage(page + 1);
        } else {
            void goToChapter(1);
        }
    }, [page, total, goToChapter]);

    const previous = useCallback(() => {
        if (page > 0) {
            setPage(page - 1);
        } else {
            void goToChapter(-1);
        }
    }, [page, goToChapter]);

    useEffect(() => {
        function handleKey(event: KeyboardEvent): void {
            const target = event.target as HTMLElement | null;
            if (target !== null && FIELD_TAGS.has(target.tagName)) {
                return;
            }
            if (event.key === 'Escape') {
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
    }, [settingsOpen, continuous, reader.status, prefs.direction, total, next, previous, goToChapter, closeReader]);

    const pageError = useMemo(() => {
        return (index: number) => {
            return failed.includes(index);
        };
    }, [failed]);

    if (reader.status === 'closed' || chapter === undefined) {
        return null;
    }

    function handleStageClick(event: MouseEvent<HTMLDivElement>): void {
        const box = event.currentTarget.getBoundingClientRect();
        const onLeft = event.clientX - box.left < box.width / 2;
        if (onLeft === (prefs.direction === 'ltr')) {
            previous();
        } else {
            next();
        }
    }

    function renderPage(index: number) {
        const address = reader.pages[index];
        if (address === undefined) {
            return null;
        }
        if (pageError(index)) {
            return (
                <div className="reader__failed" data-page={index} key={`failed-${String(index)}`}>
                    <p className="field__warning" role="alert">
                        {t('manga.reader.pageError', { page: index + 1 })}
                    </p>
                    <button
                        type="button"
                        className="btn btn--small"
                        onClick={(event) => {
                            event.stopPropagation();
                            setFailed(
                                failed.filter((item) => {
                                    return item !== index;
                                })
                            );
                            setRetries({ ...retries, [index]: (retries[index] ?? 0) + 1 });
                            setAttempt(attempt + 1);
                        }}
                    >
                        {t('manga.reader.retry')}
                    </button>
                </div>
            );
        }
        return (
            <img
                key={`${address}-${String(retries[index] ?? 0)}`}
                className="reader__img"
                src={address}
                alt={t('manga.reader.pageAlt', { page: index + 1 })}
                data-page={index}
                loading={continuous ? 'lazy' : undefined}
                onError={() => {
                    setFailed((current) => {
                        return current.includes(index) ? current : [...current, index];
                    });
                }}
            />
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
                        {`${String(page + 1)} / ${String(total)}`}
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
                        className={`btn btn--small${scrolling ? ' btn--primary' : ''}`}
                        disabled={!continuous || reader.status !== 'ready'}
                        title={continuous ? undefined : t('manga.reader.autoScrollOnlyScroll')}
                        aria-pressed={scrolling}
                        onClick={() => {
                            setAutoScrolling(!autoScrolling);
                        }}
                    >
                        {scrolling ? t('manga.reader.autoScrollStop') : t('manga.reader.autoScroll')}
                    </button>
                    <button
                        type="button"
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
                        aria-valuenow={Math.round(((page + 1) / total) * 100)}
                    >
                        <div className="progress__bar" style={{ width: `${String(((page + 1) / total) * 100)}%` }} />
                    </div>
                )}
            {settingsOpen && (
                <div className="panel reader__settings">
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
            {reader.status === 'loading' && <p className="empty">{t('manga.reader.loading')}</p>}
            {reader.status === 'error' && reader.error && (
                <p className="field__warning" role="alert" title={reader.error.message}>
                    {t(mangaErrorKey(reader.error.code))}
                </p>
            )}
            {reader.status === 'ready' && total === 0 && <p className="empty">{t('manga.reader.empty')}</p>}
            {reader.status === 'ready' && total > 0 && !continuous && (
                <div
                    className={`reader__stage reader__stage--${scale}`}
                    data-testid="reader-stage"
                    onClick={handleStageClick}
                >
                    {renderPage(page)}
                </div>
            )}
            {reader.status === 'ready' && total > 0 && continuous && (
                <div ref={scrollRef} className={`reader__scroll reader__scroll--${prefs.mode} reader__stage--${scale}`} data-testid="reader-scroll">
                    {reader.pages.map((_address, index) => {
                        return renderPage(index);
                    })}
                </div>
            )}
            {scrolledDown && (
                <button
                    type="button"
                    className="btn btn--primary reader__top"
                    aria-label={t('manga.reader.top')}
                    title={t('manga.reader.top')}
                    onClick={() => {
                        scroller().scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                >
                    <span aria-hidden="true">↑</span>
                </button>
            )}
        </section>
    );
}
