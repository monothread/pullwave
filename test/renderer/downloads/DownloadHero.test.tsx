// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import { DownloadHero, type DownloadHeroProps } from '@renderer/downloads/DownloadHero';
import { ZIP_CLOSE_MS, ZIP_SETTLE_MS, ZIP_SPLIT_MS } from '@renderer/hooks/useZipPhase';
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

    it('has a box of a poster for its cover unless it is told the cover is wide', () => {
        const { rerender } = render(<DownloadHero {...BASE} />);
        expect(heroElement()).toHaveAttribute('class', 'download-hero');
        rerender(<DownloadHero {...BASE} coverShape="poster" />);
        expect(heroElement()).toHaveAttribute('class', 'download-hero');
        rerender(<DownloadHero {...BASE} cover={<img data-testid="thumb" alt="" src="pullwave-thumb://job/job-1?v=1" />} coverShape="wide" />);
        expect(heroElement()).toHaveAttribute('class', 'download-hero download-hero--wide');
        expect(heroElement().querySelector('.download-hero__art [data-testid="thumb"]')).toHaveAttribute('src', 'pullwave-thumb://job/job-1?v=1');
    });

    it('keeps a bar below zero at the start', () => {
        render(<DownloadHero {...BASE} percent={-5} />);
        expect(drawn(heroElement(), '.download-hero__percent')).toEqual(['0%']);
    });

    it('shows a bar for each part, drawn with its name and percentage, in place of the one bar and the big percent, when the video and the audio come apart', () => {
        render(<DownloadHero {...BASE} parts={[{ kind: 'video', percent: 100 }, { kind: 'audio', percent: 42.4 }]} />);
        const hero = heroElement();
        expect(hero.querySelectorAll('.job-parts')).toHaveLength(1);
        expect(
            Array.from(hero.querySelectorAll<HTMLElement>('.job-part .progress__bar')).map((bar) => {
                return [bar.parentElement?.className, bar.style.width, bar.style.animationDuration];
            })
        ).toEqual([
            ['progress download-hero__bar', '100%', '2.21s'],
            ['progress download-hero__bar', '42.4%', '2.21s']
        ]);
        expect(drawn(hero, '.job-part__name')).toEqual(['VIDEO', 'AUDIO']);
        expect(drawn(hero, '.job-part__percent')).toEqual(['100.0%', '42.4%']);
        expect(hero.querySelector('.download-hero__percent')).toBeNull();
        expect(hero.querySelectorAll('.download-hero__bar')).toHaveLength(2);
        expect(drawn(hero, '.download-hero__value')).toEqual(['2.00MiB/s', '00:30']);
    });

    it('makes the flow of the bars of the parts follow the speed too', () => {
        const parts = [
            { kind: 'video', percent: 30 },
            { kind: 'audio', percent: 0 }
        ] as const;
        render(<DownloadHero {...BASE} parts={[...parts]} speed="20.00MiB/s" />);
        expect(
            Array.from(document.querySelectorAll<HTMLElement>('.job-part .progress__bar')).map((bar) => {
                return bar.style.animationDuration;
            })
        ).toEqual(['0.5s', '0.5s']);
    });

    it.each([
        ['no parts', null],
        ['a single part', [{ kind: 'video' as const, percent: 42.4 }]]
    ])('keeps the one bar and the big percent with %s', (_name, parts) => {
        render(<DownloadHero {...BASE} parts={parts} />);
        const hero = heroElement();
        expect(hero.querySelector('.job-parts')).toBeNull();
        expect(hero.querySelector('.download-hero__bar .progress__bar')).toHaveStyle({ width: '42.4%' });
        expect(drawn(hero, '.download-hero__percent')).toEqual(['42%']);
    });
});

describe('DownloadHero joining the bars, the steps after the download and the end (D-196)', () => {
    const DOWNLOADED = [
        { kind: 'video' as const, percent: 100 },
        { kind: 'audio' as const, percent: 100 }
    ];

    function advance(ms: number): void {
        act(() => {
            vi.advanceTimersByTime(ms);
        });
    }

    function heroBar(): HTMLElement {
        return heroElement().querySelector<HTMLElement>(':scope .download-hero__body > .download-hero__bar') as HTMLElement;
    }

    it('zips the bars of the parts into one, in the look of the banner, as the first step starts, and then shows the bar of the step going on', () => {
        const { rerender } = render(<DownloadHero {...BASE} percent={100} parts={DOWNLOADED} />);
        rerender(<DownloadHero {...BASE} percent={100} parts={DOWNLOADED} postProcess="Merger" steps={['Merger']} speed="" eta="" />);
        const hero = heroElement();
        expect(hero.querySelector('.zipper')?.getAttribute('data-zip')).toBe('split');
        expect(hero.querySelector('.zipper__joined')?.className).toBe('zipper__joined progress download-hero__bar');
        advance(ZIP_SPLIT_MS);
        advance(ZIP_CLOSE_MS);
        advance(ZIP_SETTLE_MS);
        expect(hero.querySelector('.zipper')).toBeNull();
        expect(heroBar().className).toBe('download-hero__bar progress progress--processing');
        expect((heroBar().firstElementChild as HTMLElement).style.width).toBe('100%');
    });

    it('shows the steps after the download under the bar, drawn, the last one going on', () => {
        render(<DownloadHero {...BASE} percent={100} postProcess="MoveFiles" steps={['Merger', 'MoveFiles']} speed="" eta="" />);
        const hero = heroElement();
        expect(drawn(hero, '.steps__name')).toEqual(['Download', 'Join', 'Move']);
        expect(Array.from(hero.querySelectorAll('.steps__item')).map((item) => {
            return item.getAttribute('data-state');
        })).toEqual(['done', 'done', 'now']);
        expect(heroBar().className).toBe('download-hero__bar progress progress--processing');
    });

    it('shows no steps while the file downloads', () => {
        render(<DownloadHero {...BASE} />);
        expect(heroElement().querySelector('.steps')).toBeNull();
        expect(heroBar().className).toBe('download-hero__bar progress');
    });

    it('shows the download that just ended green, with its bar full and still and every step ticked', () => {
        render(<DownloadHero {...BASE} percent={100} steps={['Merger', 'MoveFiles']} done speed="" eta="" />);
        const hero = heroElement();
        expect(hero.className).toBe('download-hero download-hero--done');
        expect(hero.querySelector('.hero__eyebrow')).toHaveTextContent('DOWNLOAD COMPLETE');
        expect(heroBar().className).toBe('download-hero__bar progress');
        expect(Array.from(hero.querySelectorAll('.steps__item')).map((item) => {
            return item.getAttribute('data-state');
        })).toEqual(['done', 'done', 'done']);
    });

    it('zips the bars of a download in parts that ends with no step after it, and shows it green', () => {
        const { rerender } = render(<DownloadHero {...BASE} percent={100} parts={DOWNLOADED} />);
        rerender(<DownloadHero {...BASE} percent={100} parts={DOWNLOADED} done />);
        expect(heroElement().querySelector('.zipper')?.getAttribute('data-zip')).toBe('split');
        advance(ZIP_SPLIT_MS);
        advance(ZIP_CLOSE_MS);
        advance(ZIP_SETTLE_MS);
        expect(heroElement().className).toBe('download-hero download-hero--done');
        expect(heroBar().className).toBe('download-hero__bar progress');
    });

    it('keeps its wide box when it ends', () => {
        render(<DownloadHero {...BASE} coverShape="wide" done />);
        expect(heroElement().className).toBe('download-hero download-hero--wide download-hero--done');
    });
});

