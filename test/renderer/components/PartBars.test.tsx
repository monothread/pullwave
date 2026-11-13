// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { createTranslator } from '@shared/i18n';
import type { DownloadPart } from '@shared/types';
import { hasParts, partName, PartBars } from '@renderer/components/PartBars';

const t = createTranslator('en');
const VIDEO: DownloadPart = { kind: 'video', percent: 100 };
const AUDIO: DownloadPart = { kind: 'audio', percent: 34.25 };

// What a row of a part shows: its classes, its name and percentage, and the classes, the accessible values and the fill of its bar.
interface PartRow {
    className: string;
    name: string;
    percent: string;
    bar: string;
    label: string | null;
    now: string | null;
    min: string | null;
    max: string | null;
    width: string;
    duration: string;
}

function rowsOf(container: HTMLElement): PartRow[] {
    return Array.from(container.querySelectorAll<HTMLElement>('.job-part')).map((row) => {
        const bar = row.querySelector<HTMLElement>('[role="progressbar"]');
        const fill = bar?.firstElementChild as HTMLElement | null;
        const name = row.querySelector<HTMLElement>('.job-part__name');
        const percent = row.querySelector<HTMLElement>('.job-part__percent');
        return {
            className: row.className,
            name: name?.textContent || name?.getAttribute('data-text') || '',
            percent: percent?.textContent || percent?.getAttribute('data-text') || '',
            bar: bar?.className ?? '',
            label: bar?.getAttribute('aria-label') ?? null,
            now: bar?.getAttribute('aria-valuenow') ?? null,
            min: bar?.getAttribute('aria-valuemin') ?? null,
            max: bar?.getAttribute('aria-valuemax') ?? null,
            width: fill?.style.width ?? '',
            duration: fill?.style.animationDuration ?? ''
        };
    });
}

describe('hasParts', () => {
    it('is true for two parts or more', () => {
        expect(hasParts([VIDEO, AUDIO])).toBe(true);
        expect(hasParts([VIDEO, AUDIO, { kind: 'other', percent: 0 }])).toBe(true);
    });

    it('is false for no parts, an empty list or a single part', () => {
        expect(hasParts(null)).toBe(false);
        expect(hasParts([])).toBe(false);
        expect(hasParts([VIDEO])).toBe(false);
    });
});

describe('partName', () => {
    it('names the part after what it holds', () => {
        expect(partName(VIDEO, 0, t)).toBe('VIDEO');
        expect(partName(AUDIO, 1, t)).toBe('AUDIO');
    });

    it('names a part whose contents are not known after its place, from 1', () => {
        expect(partName({ kind: 'other', percent: 0 }, 0, t)).toBe('PART 1');
        expect(partName({ kind: 'other', percent: 0 }, 2, t)).toBe('PART 3');
    });

    it('speaks the language of the interface', () => {
        const pt = createTranslator('pt');
        expect([partName(VIDEO, 0, pt), partName(AUDIO, 1, pt), partName({ kind: 'other', percent: 0 }, 1, pt)]).toEqual(['VÍDEO', 'ÁUDIO', 'PARTE 2']);
    });
});

describe('PartBars', () => {
    it('draws a row for each part, in order, with its name, its bar and its percentage', () => {
        const { container } = render(<PartBars parts={[VIDEO, AUDIO, { kind: 'other', percent: 0 }]} t={t} />);
        expect(screen.getByTestId('job-parts')).toHaveClass('job-parts');
        expect(rowsOf(container)).toEqual([
            { className: 'job-part job-part--video', name: 'VIDEO', percent: '100.0%', bar: 'progress', label: 'Download progress: VIDEO', now: '100', min: '0', max: '100', width: '100%', duration: '' },
            { className: 'job-part job-part--audio', name: 'AUDIO', percent: '34.3%', bar: 'progress', label: 'Download progress: AUDIO', now: '34', min: '0', max: '100', width: '34.25%', duration: '' },
            { className: 'job-part job-part--other', name: 'PART 3', percent: '0.0%', bar: 'progress', label: 'Download progress: PART 3', now: '0', min: '0', max: '100', width: '0%', duration: '' }
        ]);
    });

    it('names each bar for the screen readers', () => {
        render(<PartBars parts={[VIDEO, AUDIO]} t={t} />);
        expect(screen.getByRole('progressbar', { name: 'Download progress: VIDEO' })).toHaveAttribute('aria-valuenow', '100');
        expect(screen.getByRole('progressbar', { name: 'Download progress: AUDIO' })).toHaveAttribute('aria-valuenow', '34');
    });

    it('writes the names and the percentages as text by default', () => {
        render(<PartBars parts={[VIDEO, AUDIO]} t={t} />);
        expect(screen.getByText('VIDEO')).toHaveClass('job-part__name');
        expect(screen.getByText('34.3%')).toHaveClass('job-part__percent');
    });

    it('draws the names and the percentages from their data-text when they repeat a card, so the page holds them once', () => {
        const { container } = render(<PartBars parts={[VIDEO, AUDIO]} t={t} drawn />);
        expect(screen.queryByText('VIDEO')).not.toBeInTheDocument();
        expect(Array.from(container.querySelectorAll('.drawn')).map((element) => {
            return [element.className, element.getAttribute('data-text'), element.textContent];
        })).toEqual([
            ['drawn job-part__name', 'VIDEO', ''],
            ['drawn job-part__percent', '100.0%', ''],
            ['drawn job-part__name', 'AUDIO', ''],
            ['drawn job-part__percent', '34.3%', '']
        ]);
    });

    it('adds the class it is given to every bar and gives their flow the duration it is given', () => {
        const { container } = render(<PartBars parts={[VIDEO, AUDIO]} t={t} barClassName="download-hero__bar" flowDuration="0.8s" />);
        expect(rowsOf(container).map((row) => {
            return [row.bar, row.width, row.duration];
        })).toEqual([
            ['progress download-hero__bar', '100%', '0.8s'],
            ['progress download-hero__bar', '34.25%', '0.8s']
        ]);
    });
});
