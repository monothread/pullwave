import type { CSSProperties } from 'react';
import type { Translator } from '@shared/i18n';
import type { DownloadPart } from '@shared/types';
import { Drawn } from './Drawn';
import { formatPercent } from './jobStatus';

export function hasParts(parts: DownloadPart[] | null): parts is DownloadPart[] {
    return parts !== null && parts.length > 1;
}

export function partName(part: DownloadPart, position: number, t: Translator): string {
    if (part.kind === 'video') {
        return t('job.part.video');
    }
    if (part.kind === 'audio') {
        return t('job.part.audio');
    }
    return t('job.part.other', { number: position + 1 });
}

interface PartBarsProps {
    parts: DownloadPart[];
    t: Translator;
    barClassName?: string;
    flowDuration?: string;
    drawn?: boolean;
}

function barStyle(percent: number, flowDuration: string): CSSProperties {
    const width = `${String(percent)}%`;
    return flowDuration.length > 0 ? { width, animationDuration: flowDuration } : { width };
}

function PartText({ className, text, drawn }: { className: string; text: string; drawn: boolean }) {
    if (drawn) {
        return <Drawn className={className} text={text} />;
    }
    return <span className={className}>{text}</span>;
}

export function PartBars({ parts, t, barClassName = '', flowDuration = '', drawn = false }: PartBarsProps) {
    return (
        <div className="job-parts" data-testid="job-parts">
            {parts.map((part, position) => {
                const name = partName(part, position, t);
                return (
                    <div className={`job-part job-part--${part.kind}`} key={`${part.kind}-${String(position)}`} data-testid="job-part">
                        <PartText className="job-part__name" text={name} drawn={drawn} />
                        <div
                            className={barClassName.length > 0 ? `progress ${barClassName}` : 'progress'}
                            role="progressbar"
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={Math.round(part.percent)}
                            aria-label={t('job.partLabel', { part: name })}
                        >
                            <div className="progress__bar" style={barStyle(part.percent, flowDuration)} />
                        </div>
                        <PartText className="job-part__percent" text={formatPercent(part.percent)} drawn={drawn} />
                    </div>
                );
            })}
        </div>
    );
}
