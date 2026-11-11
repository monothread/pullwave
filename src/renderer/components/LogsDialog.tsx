import { memo, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { LogLine, LogSource } from '@shared/logs';
import type { MessageKey } from '@shared/i18n';
import { useModalDialog } from '../hooks/useModalDialog';
import { useLogLines } from '../hooks/useLogLines';
import { useTranslator } from '../i18n/useTranslator';
import { useAppStore } from '../store/appStore';
import { highlightLog, logLevelOf, type LogToken } from './logHighlight';
import { filterLogLines, formatLogText, formatLogTime, LOG_FILTERS, type LogFilter } from './logView';

// The names of the programs are their own: they are not translated.
export const LOG_SOURCE_LABELS: Record<LogSource, string> = {
    'yt-dlp': 'yt-dlp',
    'ani-cli': 'ani-cli',
    ffmpeg: 'ffmpeg',
    suwayomi: 'Suwayomi',
    flaresolverr: 'FlareSolverr'
};

const FILTER_LABELS: Record<LogFilter, MessageKey> = {
    all: 'logs.filter.all',
    warnings: 'logs.filter.warnings',
    errors: 'logs.filter.errors'
};

// How close to the end of the list (in pixels) still counts as being at the end: the list follows the new lines only from there.
const FOLLOW_MARGIN_PX = 24;

function tokenClassName(token: LogToken): string | undefined {
    if (token.ansi !== null) {
        return ['ansi', token.ansi.color === null ? '' : `ansi--${token.ansi.color}`, token.ansi.bold ? 'ansi--bold' : ''].filter(Boolean).join(' ');
    }
    return token.kind === 'text' ? undefined : `log-token log-token--${token.kind}`;
}

interface LogRowProps {
    line: LogLine;
}

// A line of the log: its time, then its text colored piece by piece; the whole line takes the color of how serious it is.
const LogRow = memo(function LogRow({ line }: LogRowProps) {
    return (
        <li className={`log-line log-line--${logLevelOf(line)}`} data-stream={line.stream}>
            <span className="log-line__time">{formatLogTime(line.at)}</span>
            <span className="log-line__text">
                {highlightLog(line.text).map((token, index) => {
                    return (
                        <span key={index} className={tokenClassName(token)}>
                            {token.text}
                        </span>
                    );
                })}
            </span>
        </li>
    );
});

interface LogsPaneProps {
    source: LogSource;
    filter: LogFilter;
    query: string;
    onClose: () => void;
}

// The log of one program: its lines, following the new ones while the list is at its end, and what can be done with them.
function LogsPane({ source, filter, query, onClose }: LogsPaneProps) {
    const t = useTranslator();
    const pushToast = useAppStore((state) => {
        return state.pushToast;
    });
    const { lines, loaded, clear } = useLogLines(source);
    const listRef = useRef<HTMLOListElement>(null);
    const [following, setFollowing] = useState(true);
    const shown = filterLogLines(lines, filter, query);

    useLayoutEffect(() => {
        const list = listRef.current;
        if (following && list !== null) {
            list.scrollTop = list.scrollHeight;
        }
    }, [shown.length, following]);

    function handleScroll(): void {
        const list = listRef.current;
        if (list !== null) {
            setFollowing(list.scrollHeight - list.scrollTop - list.clientHeight < FOLLOW_MARGIN_PX);
        }
    }

    async function copy(): Promise<void> {
        try {
            await navigator.clipboard.writeText(formatLogText(shown));
            pushToast(t('logs.copied'));
        } catch {
            pushToast(t('logs.copyFailed'));
        }
    }

    function emptyText(): string {
        if (!loaded) {
            return t('logs.loading');
        }
        return lines.length === 0 ? t('logs.empty') : t('logs.noMatch');
    }

    return (
        <>
            <p className="logs__count" aria-live="polite">
                {t('logs.count', { shown: shown.length, total: lines.length })}
            </p>
            <div className="logs__screen">
                {shown.length === 0 ? (
                    <p className="logs__empty">{emptyText()}</p>
                ) : (
                    <ol ref={listRef} className="logs__lines" aria-label={t('logs.lines', { program: LOG_SOURCE_LABELS[source] })} tabIndex={0} onScroll={handleScroll}>
                        {shown.map((line) => {
                            return <LogRow key={line.id} line={line} />;
                        })}
                    </ol>
                )}
                {!following && shown.length > 0 && (
                    <button
                        type="button"
                        className="btn btn--small logs__follow"
                        onClick={() => {
                            setFollowing(true);
                        }}
                    >
                        {t('logs.follow')}
                    </button>
                )}
            </div>
            <div className="modal__actions">
                <button
                    type="button"
                    className="btn btn--small"
                    disabled={shown.length === 0}
                    onClick={() => {
                        void copy();
                    }}
                >
                    {t('logs.copy')}
                </button>
                <button
                    type="button"
                    className="btn btn--small"
                    disabled={lines.length === 0}
                    onClick={() => {
                        void clear();
                    }}
                >
                    {t('logs.clear')}
                </button>
                <button
                    type="button"
                    className="btn btn--small btn--hot"
                    onClick={() => {
                        onClose();
                    }}
                >
                    {t('logs.close')}
                </button>
            </div>
        </>
    );
}

interface LogsDialogProps {
    // The programs whose logs the window shows, one tab each (no tabs for one program).
    sources: readonly LogSource[];
    onClose: () => void;
}

// A window over the screen with the recent output of the programs of a section, for a quick look at what went wrong. The lines are kept
// in memory by the app (none is written to the disk), and the secrets in them are already hidden.
export function LogsDialog({ sources, onClose }: LogsDialogProps) {
    const t = useTranslator();
    const titleId = useId();
    const { dialogRef, handleKeyDown } = useModalDialog(onClose, true);
    const [active, setActive] = useState<LogSource>(sources[0] ?? 'yt-dlp');
    const [filter, setFilter] = useState<LogFilter>('all');
    const [query, setQuery] = useState('');

    return createPortal(
        <div
            className="modal-backdrop"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                    onClose();
                }
            }}
            onClick={(event) => {
                event.stopPropagation();
            }}
        >
            <div ref={dialogRef} className="modal modal--logs" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={handleKeyDown}>
                <h2 id={titleId} className="modal__title">
                    {t('logs.heading', { program: sources.map((source) => {
                        return LOG_SOURCE_LABELS[source];
                    }).join(' · ') })}
                </h2>
                {sources.length > 1 && (
                    <div className="logs__tabs" role="tablist" aria-label={t('logs.tabs')}>
                        {sources.map((source) => {
                            return (
                                <button
                                    key={source}
                                    type="button"
                                    role="tab"
                                    aria-selected={source === active}
                                    className={`btn btn--small logs__tab${source === active ? ' logs__tab--active' : ''}`}
                                    onClick={() => {
                                        setActive(source);
                                    }}
                                >
                                    {LOG_SOURCE_LABELS[source]}
                                </button>
                            );
                        })}
                    </div>
                )}
                <div className="logs__toolbar">
                    <label className="logs__control">
                        <span>{t('logs.filter')}</span>
                        <select
                            className="input"
                            value={filter}
                            onChange={(event) => {
                                setFilter(event.target.value as LogFilter);
                            }}
                        >
                            {LOG_FILTERS.map((option) => {
                                return (
                                    <option key={option} value={option}>
                                        {t(FILTER_LABELS[option])}
                                    </option>
                                );
                            })}
                        </select>
                    </label>
                    <label className="logs__control logs__control--search">
                        <span>{t('logs.search')}</span>
                        <input
                            className="input"
                            type="search"
                            value={query}
                            placeholder={t('logs.search.placeholder')}
                            onChange={(event) => {
                                setQuery(event.target.value);
                            }}
                        />
                    </label>
                </div>
                <LogsPane key={active} source={active} filter={filter} query={query} onClose={onClose} />
            </div>
        </div>,
        document.body
    );
}
