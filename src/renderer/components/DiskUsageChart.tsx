import { useEffect, useId, useState } from 'react';
import type { DiskSection, DiskUsage } from '@shared/types';
import { useTranslator } from '../i18n/useTranslator';
import { useRevealProgress } from '../hooks/useRevealProgress';
import { diskShares } from './diskUsageShares';
import { formatBytes } from './jobStatus';

type LoadStatus = 'loading' | 'ready' | 'error';

interface DiskUsageChartProps {
    section: DiskSection;
    // When it changes the disk is read again (the folder was changed, or files were added or removed).
    refreshKey: string;
}

const RING_RADIUS = 52;

interface DiskReading {
    key: string;
    usage: DiskUsage | null;
}

interface RingSegmentProps {
    className: string;
    // Where the segment starts and how long it is, in percent of the ring.
    start: number;
    length: number;
    stroke?: string;
}

// The ring has a path length of 100, so a percentage is the length of the segment as it is.
function RingSegment({ className, start, length, stroke }: RingSegmentProps) {
    return (
        <circle
            className={`disk__segment ${className}`}
            cx="60"
            cy="60"
            r={RING_RADIUS}
            pathLength={100}
            stroke={stroke}
            strokeDasharray={`${length} ${100 - length}`}
            strokeDashoffset={-start}
        />
    );
}

// The space of the disk the folder of a section is on: a ring that grows when it opens, with the part the folder takes, the part other files
// take and the free part.
export function DiskUsageChart({ section, refreshKey }: DiskUsageChartProps) {
    const t = useTranslator();
    const gradientId = useId();
    const [reloads, setReloads] = useState(0);
    const [reading, setReading] = useState<DiskReading | null>(null);
    const readingKey = `${section}|${refreshKey}|${reloads}`;
    // What was read belongs to the key it was asked for: with another key (the folder changed, or REFRESH) the disk is being read again.
    const current = reading?.key === readingKey ? reading : null;
    const status: LoadStatus = current === null ? 'loading' : current.usage === null ? 'error' : 'ready';
    const usage = current?.usage ?? null;
    const progress = useRevealProgress(status === 'ready');

    useEffect(() => {
        let cancelled = false;
        void window.api.getDiskUsage(section).then(
            (result) => {
                if (!cancelled) {
                    setReading({ key: readingKey, usage: result });
                }
            },
            () => {
                if (!cancelled) {
                    setReading({ key: readingKey, usage: null });
                }
            }
        );
        return () => {
            cancelled = true;
        };
    }, [section, readingKey]);

    const shares = usage ? diskShares(usage) : null;
    const grown = (percent: number): number => {
        return percent * progress;
    };
    const summary =
        usage && shares
            ? t('settings.disk.summary', {
                  folder: formatBytes(usage.folderBytes),
                  others: formatBytes(shares.othersBytes),
                  free: formatBytes(usage.freeBytes),
                  total: formatBytes(usage.totalBytes)
              })
            : '';

    return (
        <fieldset className="panel disk" data-testid={`disk-usage-${section}`}>
            <legend>{t('settings.disk.title')}</legend>
            {status === 'loading' && <p className="field__hint disk__loading">{t('settings.disk.loading')}</p>}
            {status === 'error' && <p className="field__hint disk__error">{t('settings.disk.error')}</p>}
            {status === 'ready' && usage && shares && (
                <div className="disk__body">
                    <div className="disk__ring">
                        <svg viewBox="0 0 120 120" role="img" aria-label={summary}>
                            <defs>
                                <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
                                    <stop offset="0%" stopColor="var(--cyan)" />
                                    <stop offset="100%" stopColor="var(--magenta)" />
                                </linearGradient>
                            </defs>
                            <circle className="disk__track" cx="60" cy="60" r={RING_RADIUS} />
                            <RingSegment className="disk__segment--others" start={grown(shares.folderPercent)} length={grown(shares.othersPercent)} />
                            <RingSegment className="disk__segment--folder" start={0} length={grown(shares.folderPercent)} stroke={`url(#${gradientId})`} />
                        </svg>
                        <div className="disk__center" aria-hidden="true">
                            <span className="disk__percent" data-testid="disk-percent">
                                {Math.round(grown(shares.usedPercent))}%
                            </span>
                            <span className="disk__percent-label">{t('settings.disk.used')}</span>
                        </div>
                    </div>
                    <ul className="disk__legend">
                        <li className="disk__item disk__item--folder">
                            <span className="disk__swatch" aria-hidden="true" />
                            <span className="disk__item-label">{t('settings.disk.folder')}</span>
                            <strong className="disk__item-value" data-testid="disk-folder">
                                {formatBytes(usage.folderBytes * progress)}
                            </strong>
                        </li>
                        <li className="disk__item disk__item--others">
                            <span className="disk__swatch" aria-hidden="true" />
                            <span className="disk__item-label">{t('settings.disk.others')}</span>
                            <strong className="disk__item-value" data-testid="disk-others">
                                {formatBytes(shares.othersBytes * progress)}
                            </strong>
                        </li>
                        <li className="disk__item disk__item--free">
                            <span className="disk__swatch" aria-hidden="true" />
                            <span className="disk__item-label">{t('settings.disk.free')}</span>
                            <strong className="disk__item-value" data-testid="disk-free">
                                {formatBytes(usage.freeBytes * progress)}
                            </strong>
                        </li>
                        <li className="disk__total">{formatBytes(usage.totalBytes)}</li>
                    </ul>
                </div>
            )}
            <div className="field-row">
                <button
                    type="button"
                    className="btn btn--small"
                    disabled={status === 'loading'}
                    onClick={() => {
                        setReloads((count) => {
                            return count + 1;
                        });
                    }}
                >
                    {t('settings.disk.refresh')}
                </button>
            </div>
        </fieldset>
    );
}
