import { useLayoutEffect, useRef, type CSSProperties } from 'react';
import type { Translator } from '@shared/i18n';
import type { DownloadPart } from '@shared/types';
import { ZIP_CLOSE_MS, ZIP_SETTLE_MS, ZIP_SPLIT_MS, type ZipPhase } from '../hooks/useZipPhase';
import { PartBars } from './PartBars';

// The height of one bar, the height the box shrinks to once the bars are one.
const ONE_BAR_HEIGHT = 14;

interface PartsZipperProps {
    parts: DownloadPart[];
    // Where the joining is (never 'joined': the one bar is drawn by whoever shows the bars, in the look of its state).
    phase: Exclude<ZipPhase, 'joined'>;
    t: Translator;
    barClassName?: string;
    flowDuration?: string;
    drawn?: boolean;
}

// What the joining starts from, taken when it starts: the height of the bars apart (the box shrinks from it to one bar) and the width of the
// columns of the names and of the percentages and of the gap between the columns (they shrink to nothing so the bars take the whole width).
interface ZipStart {
    height: number;
    nameColumn: number;
    percentColumn: number;
    gap: number;
}

function measure(box: HTMLDivElement): ZipStart {
    const name = box.querySelector<HTMLElement>('.job-part__name');
    const percent = box.querySelector<HTMLElement>('.job-part__percent');
    const grid = box.querySelector<HTMLElement>('.job-parts');
    return {
        height: box.offsetHeight,
        nameColumn: name?.offsetWidth ?? 0,
        percentColumn: percent?.offsetWidth ?? 0,
        gap: grid === null ? 0 : Number.parseFloat(getComputedStyle(grid).columnGap) || 0
    };
}

const TIMES = {
    '--zip-split-ms': `${String(ZIP_SPLIT_MS)}ms`,
    '--zip-close-ms': `${String(ZIP_CLOSE_MS)}ms`,
    '--zip-settle-ms': `${String(ZIP_SETTLE_MS)}ms`
} as CSSProperties;

const MEASURED = ['--zip-name-column', '--zip-percent-column', '--zip-gap', 'height'] as const;

// The box takes what the joining starts from as it starts (in its style, read by the CSS of the zipper), shrinks to one bar at the end, and
// forgets it all when the bars are apart again.
function applyStart(box: HTMLDivElement, phase: PartsZipperProps['phase']): void {
    if (phase === 'parts') {
        MEASURED.forEach((property) => {
            box.style.removeProperty(property);
        });
        delete box.dataset.measured;
        return;
    }
    if (phase === 'split') {
        const start = measure(box);
        box.style.setProperty('--zip-name-column', `${String(start.nameColumn)}px`);
        box.style.setProperty('--zip-percent-column', `${String(start.percentColumn)}px`);
        box.style.setProperty('--zip-gap', `${String(start.gap)}px`);
        box.style.setProperty('height', `${String(start.height)}px`);
        box.dataset.measured = 'true';
        return;
    }
    if (phase === 'settle') {
        box.style.setProperty('height', `${String(ONE_BAR_HEIGHT)}px`);
    }
}

// The bars of a download that came in parts, and their joining into one: they stretch to the whole width while their names and percentages
// go, then a zipper closes them from the start to the end (behind it the bar that is already one, its head on the zipper; ahead of it the two
// bars, each going into the zipper by a line of light), and the box shrinks to the one bar. The bars are the bars of the app: nothing of
// their look changes, they only grow and shrink.
export function PartsZipper({ parts, phase, t, barClassName = '', flowDuration = '', drawn = false }: PartsZipperProps) {
    const box = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
        if (box.current !== null) {
            applyStart(box.current, phase);
        }
    }, [phase]);

    const joining = phase !== 'parts';
    return (
        <div className="zipper" data-zip={phase} ref={box} style={TIMES} data-testid="parts-zipper">
            <PartBars parts={parts} t={t} barClassName={barClassName} flowDuration={flowDuration} drawn={drawn} />
            {joining && (
                <>
                    <div className={barClassName.length > 0 ? `zipper__joined progress ${barClassName}` : 'zipper__joined progress'} aria-hidden="true">
                        <div className="progress__bar" style={{ width: '100%' }} />
                    </div>
                    <svg className="zipper__pull" viewBox="0 0 32 34" preserveAspectRatio="none" aria-hidden="true">
                        <path d="M30 7 C 16 7, 10 17, 2 17" />
                        <path d="M30 27 C 16 27, 10 17, 2 17" />
                    </svg>
                </>
            )}
        </div>
    );
}
