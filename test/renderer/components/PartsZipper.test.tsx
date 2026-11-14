// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { createTranslator } from '@shared/i18n';
import type { DownloadPart } from '@shared/types';
import { PartsZipper } from '@renderer/components/PartsZipper';

const t = createTranslator('en');
const PARTS: DownloadPart[] = [
    { kind: 'video', percent: 100 },
    { kind: 'audio', percent: 100 }
];

// The sizes the browser would give: jsdom lays nothing out, so the sizes the zipper measures are set by hand.
function giveSizes(container: HTMLElement, sizes: { height: number; name: number; percent: number; gap: string }): void {
    const box = container.querySelector<HTMLElement>('.zipper') as HTMLElement;
    Object.defineProperty(box, 'offsetHeight', { configurable: true, value: sizes.height });
    container.querySelectorAll<HTMLElement>('.job-part__name').forEach((name) => {
        Object.defineProperty(name, 'offsetWidth', { configurable: true, value: sizes.name });
    });
    container.querySelectorAll<HTMLElement>('.job-part__percent').forEach((percent) => {
        Object.defineProperty(percent, 'offsetWidth', { configurable: true, value: sizes.percent });
    });
    (container.querySelector('.job-parts') as HTMLElement).style.columnGap = sizes.gap;
}

function zipperOf(container: HTMLElement): HTMLElement {
    return container.querySelector<HTMLElement>('.zipper') as HTMLElement;
}

function measuredOf(box: HTMLElement): Record<string, string | undefined> {
    return {
        name: box.style.getPropertyValue('--zip-name-column'),
        percent: box.style.getPropertyValue('--zip-percent-column'),
        gap: box.style.getPropertyValue('--zip-gap'),
        height: box.style.height,
        measured: box.dataset.measured
    };
}

describe('PartsZipper', () => {
    it('shows the bars of the parts as they are while they are apart, with nothing of the joining', () => {
        const { container } = render(<PartsZipper parts={[{ kind: 'video', percent: 100 }, { kind: 'audio', percent: 40 }]} phase="parts" t={t} />);
        const box = zipperOf(container);
        expect(box.getAttribute('data-zip')).toBe('parts');
        expect(box.getAttribute('data-testid')).toBe('parts-zipper');
        expect(box.querySelectorAll('.job-part')).toHaveLength(2);
        expect(Array.from(box.querySelectorAll('.job-part [role="progressbar"]')).map((bar) => {
            return [bar.getAttribute('aria-label'), bar.getAttribute('aria-valuenow')];
        })).toEqual([['Download progress: VIDEO', '100'], ['Download progress: AUDIO', '40']]);
        expect(box.querySelector('.zipper__joined')).toBeNull();
        expect(box.querySelector('.zipper__pull')).toBeNull();
        expect(measuredOf(box)).toEqual({ name: '', percent: '', gap: '', height: '', measured: undefined });
    });

    it('gives the times of the joining to the CSS', () => {
        const { container } = render(<PartsZipper parts={PARTS} phase="parts" t={t} />);
        const box = zipperOf(container);
        expect([box.style.getPropertyValue('--zip-split-ms'), box.style.getPropertyValue('--zip-close-ms'), box.style.getPropertyValue('--zip-settle-ms')]).toEqual(['420ms', '1000ms', '350ms']);
    });

    it('takes the height of the bars apart and the widths of the columns as the joining starts, so the CSS stretches the bars from them', () => {
        const { container, rerender } = render(<PartsZipper parts={PARTS} phase="parts" t={t} />);
        giveSizes(container, { height: 40, name: 48, percent: 52, gap: '10px' });
        rerender(<PartsZipper parts={PARTS} phase="split" t={t} />);
        expect(measuredOf(zipperOf(container))).toEqual({ name: '48px', percent: '52px', gap: '10px', height: '40px', measured: 'true' });
    });

    it('keeps the height it took while the zipper closes, and shrinks to one bar at the end', () => {
        const { container, rerender } = render(<PartsZipper parts={PARTS} phase="parts" t={t} />);
        giveSizes(container, { height: 40, name: 48, percent: 52, gap: '10px' });
        rerender(<PartsZipper parts={PARTS} phase="split" t={t} />);
        rerender(<PartsZipper parts={PARTS} phase="zip" t={t} />);
        expect(zipperOf(container).style.height).toBe('40px');
        rerender(<PartsZipper parts={PARTS} phase="settle" t={t} />);
        expect(measuredOf(zipperOf(container))).toEqual({ name: '48px', percent: '52px', gap: '10px', height: '14px', measured: 'true' });
    });

    it('forgets what it took when the bars are apart again', () => {
        const { container, rerender } = render(<PartsZipper parts={PARTS} phase="parts" t={t} />);
        giveSizes(container, { height: 40, name: 48, percent: 52, gap: '10px' });
        rerender(<PartsZipper parts={PARTS} phase="split" t={t} />);
        rerender(<PartsZipper parts={PARTS} phase="parts" t={t} />);
        expect(measuredOf(zipperOf(container))).toEqual({ name: '', percent: '', gap: '', height: '', measured: undefined });
        expect(zipperOf(container).style.getPropertyValue('--zip-close-ms')).toBe('1000ms');
    });

    it('takes no gap when the grid says none it can read', () => {
        const { container, rerender } = render(<PartsZipper parts={PARTS} phase="parts" t={t} />);
        giveSizes(container, { height: 40, name: 48, percent: 52, gap: 'normal' });
        rerender(<PartsZipper parts={PARTS} phase="split" t={t} />);
        expect(zipperOf(container).style.getPropertyValue('--zip-gap')).toBe('0px');
    });

    it.each(['split', 'zip', 'settle'] as const)('draws the joined bar and the pull of the zipper, for the eye only, while it is %s', (phase) => {
        const { container } = render(<PartsZipper parts={PARTS} phase={phase} t={t} />);
        const joined = container.querySelector<HTMLElement>('.zipper__joined') as HTMLElement;
        expect(joined.className).toBe('zipper__joined progress');
        expect(joined.getAttribute('aria-hidden')).toBe('true');
        expect(joined.getAttribute('role')).toBeNull();
        expect((joined.firstElementChild as HTMLElement).className).toBe('progress__bar');
        expect((joined.firstElementChild as HTMLElement).style.width).toBe('100%');
        const pull = container.querySelector('.zipper__pull') as SVGElement;
        expect(pull.getAttribute('aria-hidden')).toBe('true');
        expect(pull.getAttribute('viewBox')).toBe('0 0 32 34');
        expect(pull.getAttribute('preserveAspectRatio')).toBe('none');
        expect(Array.from(pull.querySelectorAll('path')).map((path) => {
            return path.getAttribute('d');
        })).toEqual(['M30 7 C 16 7, 10 17, 2 17', 'M30 27 C 16 27, 10 17, 2 17']);
        expect(zipperOf(container).getAttribute('data-zip')).toBe(phase);
        expect(container.querySelectorAll('.job-part')).toHaveLength(2);
    });

    it('draws the bars of the banner in its own look, with its flow, and their words drawn', () => {
        const { container } = render(<PartsZipper parts={PARTS} phase="zip" t={t} barClassName="download-hero__bar" flowDuration="0.8s" drawn />);
        expect((container.querySelector('.zipper__joined') as HTMLElement).className).toBe('zipper__joined progress download-hero__bar');
        expect(Array.from(container.querySelectorAll<HTMLElement>('.job-part [role="progressbar"]')).map((bar) => {
            return [bar.className, (bar.firstElementChild as HTMLElement).style.animationDuration];
        })).toEqual([['progress download-hero__bar', '0.8s'], ['progress download-hero__bar', '0.8s']]);
        expect(Array.from(container.querySelectorAll('.job-part__name')).map((name) => {
            return name.getAttribute('data-text');
        })).toEqual(['VIDEO', 'AUDIO']);
    });
});
