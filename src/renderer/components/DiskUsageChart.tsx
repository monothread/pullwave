import { useEffect, useId, useState } from 'react';
import type { MessageKey } from '@shared/i18n';
import type { DiskSection, DiskSiblingPlacement, DiskUsage } from '@shared/types';
import { useTranslator } from '../i18n/useTranslator';
import { useRevealProgress } from '../hooks/useRevealProgress';
import { diskShares } from './diskUsageShares';
import { formatBytes } from './jobStatus';

type LoadStatus = 'loading' | 'ready' | 'error';

interface DiskUsageChartProps {
    section: DiskSection;
    refreshKey: string;
    busy?: boolean;
}

const RING_RADIUS = 52;

const SIBLING_LABELS: Record<DiskSection, MessageKey> = {
    anime: 'settings.disk.sibling.anime',
    manga: 'settings.disk.sibling.manga'
};

const SIBLING_NOTES: Record<Exclude<DiskSiblingPlacement, 'same-disk'>, MessageKey> = {
    'other-disk': 'settings.disk.note.otherDisk',
    overlap: 'settings.disk.note.overlap'
};

interface DiskReading {
    key: string;
    usage: DiskUsage | null;
}

interface RingSegmentProps {
    className: string;
    start: number;
    length: number;
    stroke?: string;
}

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

interface LegendItemProps {
    kind: 'folder' | 'sibling' | 'others' | 'free';
    label: string;
    value: string;
    valueTestId: string;
    note?: string;
}

function LegendItem({ kind, label, value, valueTestId, note }: LegendItemProps) {
    return (
        <li className={`disk__item disk__item--${kind}`}>
            <span className="disk__swatch" aria-hidden="true" />
            <span className="disk__item-label">{label}</span>
            <strong className="disk__item-value" data-testid={valueTestId}>
                {value}
            </strong>
            {note && (
                <span className="disk__note" data-testid="disk-sibling-note">
                    {note}
                </span>
            )}
        </li>
    );
}

export function DiskUsageChart({ section, refreshKey, busy = false }: DiskUsageChartProps) {
    const t = useTranslator();
    const gradientId = useId();
    const [reloads, setReloads] = useState(0);
    const [reading, setReading] = useState<DiskReading | null>(null);
    const readingKey = `${section}|${refreshKey}|${reloads}`;
    const current = reading?.key === readingKey ? reading : null;
    const status: LoadStatus = current === null ? 'loading' : current.usage === null ? 'error' : 'ready';
    const usage = current?.usage ?? null;
    const progress = useRevealProgress(status === 'ready');

    useEffect(() => {
        if (busy) {
            return undefined;
        }
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
    }, [section, readingKey, busy]);

    const shares = usage ? diskShares(usage) : null;
    const grown = (percent: number): number => {
        return percent * progress;
    };
    const summary =
        usage && shares
            ? t('settings.disk.summary', {
                  folder: formatBytes(usage.folderBytes),
                  siblingLabel: t(SIBLING_LABELS[usage.sibling.section]),
                  sibling: formatBytes(usage.sibling.bytes),
                  others: formatBytes(shares.othersBytes),
                  free: formatBytes(usage.freeBytes),
                  total: formatBytes(usage.totalBytes)
              })
            : '';

    return (
        <fieldset className="panel disk" data-testid={`disk-usage-${section}`}>
            <legend>{t('settings.disk.title')}</legend>
            {status === 'loading' && (
                <p className="field__hint disk__loading">
                    <span className="disk__spinner" aria-hidden="true" />
                    {t('settings.disk.loading')}
                </p>
            )}
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
                            <RingSegment className="disk__segment--others" start={grown(shares.folderPercent + shares.siblingPercent)} length={grown(shares.othersPercent)} />
                            <RingSegment className="disk__segment--sibling" start={grown(shares.folderPercent)} length={grown(shares.siblingPercent)} />
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
                        <LegendItem kind="folder" label={t('settings.disk.folder')} value={formatBytes(usage.folderBytes * progress)} valueTestId="disk-folder" />
                        <LegendItem
                            kind="sibling"
                            label={t(SIBLING_LABELS[usage.sibling.section])}
                            value={formatBytes(usage.sibling.bytes * progress)}
                            valueTestId="disk-sibling"
                            note={usage.sibling.placement === 'same-disk' ? undefined : t(SIBLING_NOTES[usage.sibling.placement])}
                        />
                        <LegendItem kind="others" label={t('settings.disk.others')} value={formatBytes(shares.othersBytes * progress)} valueTestId="disk-others" />
                        <LegendItem kind="free" label={t('settings.disk.free')} value={formatBytes(usage.freeBytes * progress)} valueTestId="disk-free" />
                        <li className="disk__total">{formatBytes(usage.totalBytes)}</li>
                    </ul>
                </div>
            )}
            <div className="field-row">
                <button
                    type="button"
                    className="btn btn--small"
                    disabled={status === 'loading' || busy}
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
