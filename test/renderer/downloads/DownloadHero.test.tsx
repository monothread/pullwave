// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import { DownloadHero, type DownloadHeroProps } from '@renderer/downloads/DownloadHero';
import { GRAPH_HEIGHT, GRAPH_WIDTH, SpeedGraph } from '@renderer/downloads/SpeedGraph';

const BASE: DownloadHeroProps = { id: 'job-1', title: 'A video', detail: null, percent: 42.4, speed: '2.00MiB/s', eta: '00:30', kind: 'downloads', cover: null, waiting: 2 };

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('SpeedGraph', () => {
    it('is drawn in its box, named for the screen readers', () => {
        render(<SpeedGraph samples={[0, 10]} label="Speed of the last minute" />);
        const graph = screen.getByRole('img', { name: 'Speed of the last minute' });
        expect(graph).toHaveAttribute('viewBox', `0 0 ${String(GRAPH_WIDTH)} ${String(GRAPH_HEIGHT)}`);
        expect(graph).toHaveAttribute('preserveAspectRatio', 'none');
        expect(graph.querySelector('.speed-graph__line')).toHaveAttribute('points', '0.0,80.0 300.0,0.0');
        expect(graph.querySelector('.speed-graph__area')).toHaveAttribute('points', '0,80 0.0,80.0 300.0,0.0 300,80');
        expect(graph.querySelectorAll('stop')).toHaveLength(2);
        const fill = graph.querySelector('.speed-graph__area')?.getAttribute('fill') ?? '';
        expect(fill).toBe(`url(#${graph.querySelector('linearGradient')?.id ?? ''})`);
    });

    it('draws no line with no reading', () => {
        render(<SpeedGraph samples={[]} label="Speed" />);
        expect(document.querySelector('.speed-graph__line')).toBeNull();
        expect(document.querySelector('.speed-graph__area')).toBeNull();
    });

    it('is 300 by 80', () => {
        expect([GRAPH_WIDTH, GRAPH_HEIGHT]).toEqual([300, 80]);
    });
});

function drawn(hero: HTMLElement, selector: string): Array<string | null> {
    return Array.from(hero.querySelectorAll(selector)).map((element) => {
        return element.getAttribute('data-text');
    });
}

function heroElement(): HTMLElement {
    return screen.getByTestId('download-hero');
}

describe('DownloadHero', () => {
    it('is for the eye only: the card of the download says the same in words', () => {
        render(<DownloadHero {...BASE} />);
        const hero = heroElement();
        expect(hero).toHaveAttribute('aria-hidden', 'true');
        expect(screen.queryByText('A video')).not.toBeInTheDocument();
        expect(screen.queryByText('2.00MiB/s')).not.toBeInTheDocument();
    });

    it('shows the download going on: the picture of its section, the title, the bar, the speed, the time left, the percent and what comes next', () => {
        render(<DownloadHero {...BASE} />);
        const hero = heroElement();
        expect(hero.querySelector('.download-hero__art .tile__generated svg')).toHaveClass('section-icon--downloads');
        expect(hero.querySelector('.hero__eyebrow')).toHaveTextContent('NOW DOWNLOADING');
        expect(drawn(hero, '.download-hero__title')).toEqual(['A video']);
        expect(hero.querySelector('.download-hero__detail')).toBeNull();
        expect(hero.querySelector('.download-hero__bar .progress__bar')).toHaveStyle({ width: '42.4%' });
        expect(
            Array.from(hero.querySelectorAll('.download-hero__stat dt')).map((term) => {
                return term.textContent;
            })
        ).toEqual(['SPEED', 'TIME LEFT']);
        expect(drawn(hero, '.download-hero__value')).toEqual(['2.00MiB/s', '00:30']);
        expect(drawn(hero, '.download-hero__percent')).toEqual(['42%']);
        expect(hero.querySelector('.speed-graph')).toHaveAttribute('aria-label', 'Speed of the last minute');
        expect(hero.querySelector('.download-hero__peak')).toBeNull();
        expect(hero.querySelector('.download-hero__next')).toHaveTextContent('UP NEXT: 2');
    });

    it('makes the wave of the bar flow faster the faster the download goes', () => {
        const { rerender } = render(<DownloadHero {...BASE} />);
        expect(document.querySelector('.download-hero__bar .progress__bar')).toHaveStyle({ animationDuration: '2.21s' });
        rerender(<DownloadHero {...BASE} speed="20.00MiB/s" />);
        expect(document.querySelector('.download-hero__bar .progress__bar')).toHaveStyle({ animationDuration: '0.5s' });
        rerender(<DownloadHero {...BASE} speed="" />);
        expect(document.querySelector('.download-hero__bar .progress__bar')).toHaveStyle({ animationDuration: '1.4s' });
    });

    it('shows the peak of the last minute once the speed was read', async () => {
        render(<DownloadHero {...BASE} />);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(2000);
        });
        expect(document.querySelector('.download-hero__peak')).toHaveTextContent('PEAK 2.0 MiB/s');
        expect(document.querySelector('.speed-graph__line')).toHaveAttribute('points', '0.0,0.0 300.0,0.0');
    });

    it('shows the cover, the detail and dashes for what is not known, with no graph and nothing next', () => {
        render(<DownloadHero {...BASE} kind="manga" detail="Chapter 3 · 5 of 20 pages" speed="" eta="" cover={<img data-testid="cover" alt="" src="https://img/c.jpg" />} waiting={0} percent={140} />);
        const hero = heroElement();
        expect(hero.querySelector('[data-testid="cover"]')).not.toBeNull();
        expect(drawn(hero, '.download-hero__detail')).toEqual(['Chapter 3 · 5 of 20 pages']);
        expect(drawn(hero, '.download-hero__value')).toEqual(['—', '—']);
        expect(hero.querySelector('.speed-graph')).toBeNull();
        expect(hero.querySelector('.download-hero__next')).toBeNull();
        expect(drawn(hero, '.download-hero__percent')).toEqual(['100%']);
        expect(hero.querySelector('.progress__bar')).toHaveStyle({ width: '100%' });
    });

    it('keeps a bar below zero at the start', () => {
        render(<DownloadHero {...BASE} percent={-5} />);
        expect(drawn(heroElement(), '.download-hero__percent')).toEqual(['0%']);
    });
});
