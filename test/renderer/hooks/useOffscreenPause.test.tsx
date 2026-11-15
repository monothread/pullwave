// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { OFFSCREEN_ATTRIBUTE, OFFSCREEN_MARGIN, useOffscreenPause } from '@renderer/hooks/useOffscreenPause';

const loopPause = vi.hoisted(() => {
    return { settled: [] as Array<Element | Document> };
});

vi.mock('@renderer/fx/loopPause', () => {
    return {
        OFFSCREEN_ATTRIBUTE: 'data-offscreen',
        settleLoops: (root: Element | Document) => {
            loopPause.settled.push(root);
        }
    };
});

interface ObserverRecord {
    callback: (entries: Array<{ target: Element; isIntersecting: boolean }>) => void;
    options: { rootMargin?: string; scrollMargin?: string };
    watched: Element[];
}

const observers = vi.hoisted(() => {
    return { created: [] as ObserverRecord[] };
});

function fakeObserverClass() {
    return class {
        private readonly record: ObserverRecord;

        constructor(callback: ObserverRecord['callback'], options: ObserverRecord['options']) {
            this.record = { callback, options, watched: [] };
            observers.created.push(this.record);
        }

        observe(element: Element): void {
            this.record.watched.push(element);
        }

        unobserve(element: Element): void {
            this.record.watched = this.record.watched.filter((watched) => {
                return watched !== element;
            });
        }

        disconnect(): void {
            this.record.watched = [];
        }
    };
}

function Card({ id }: { id: string }) {
    const ref = useOffscreenPause<HTMLElement>();
    return <article ref={ref} data-testid={id} />;
}

function Detached() {
    useOffscreenPause<HTMLElement>();
    return <p>nothing to watch</p>;
}

function card(id: string): HTMLElement {
    return document.querySelector(`[data-testid="${id}"]`) as HTMLElement;
}

function report(entries: Array<{ target: Element; isIntersecting: boolean }>): void {
    observers.created.at(-1)?.callback(entries);
}

beforeEach(() => {
    observers.created.length = 0;
    loopPause.settled.length = 0;
});

describe('useOffscreenPause', () => {
    describe('with IntersectionObserver', () => {
        beforeEach(() => {
            vi.stubGlobal('IntersectionObserver', fakeObserverClass());
        });

        afterEach(() => {
            vi.unstubAllGlobals();
        });

        it('gives back the attribute of the cards out of sight, and a margin so a card animates again before it is seen', () => {
            expect(OFFSCREEN_ATTRIBUTE).toBe('data-offscreen');
            expect(OFFSCREEN_MARGIN).toBe('200px');
        });

        it('watches every card with one observer, the margin given both to the window and to the scrolling list, the cards unmarked at first', () => {
            render(
                <>
                    <Card id="a" />
                    <Card id="b" />
                </>
            );
            expect(observers.created).toHaveLength(1);
            expect(observers.created[0]?.options).toEqual({ rootMargin: '200px', scrollMargin: '200px' });
            expect(observers.created[0]?.watched).toEqual([card('a'), card('b')]);
            expect(card('a').hasAttribute(OFFSCREEN_ATTRIBUTE)).toBe(false);
            expect(card('b').hasAttribute(OFFSCREEN_ATTRIBUTE)).toBe(false);
            expect(loopPause.settled).toEqual([]);
        });

        it('marks a card that goes out of sight and unmarks it when it comes near again, settling the animations of that card each time', () => {
            render(
                <>
                    <Card id="a" />
                    <Card id="b" />
                </>
            );
            report([
                { target: card('a'), isIntersecting: false },
                { target: card('b'), isIntersecting: true }
            ]);
            expect(card('a').getAttribute(OFFSCREEN_ATTRIBUTE)).toBe('');
            expect(card('b').hasAttribute(OFFSCREEN_ATTRIBUTE)).toBe(false);
            expect(loopPause.settled).toEqual([card('a'), card('b')]);
            report([{ target: card('a'), isIntersecting: true }]);
            expect(card('a').hasAttribute(OFFSCREEN_ATTRIBUTE)).toBe(false);
            expect(loopPause.settled).toEqual([card('a'), card('b'), card('a')]);
        });

        it('stops watching a card that goes away and leaves it unmarked', () => {
            const { rerender } = render(
                <>
                    <Card id="a" />
                    <Card id="b" />
                </>
            );
            const gone = card('b');
            report([{ target: gone, isIntersecting: false }]);
            rerender(<Card id="a" />);
            expect(observers.created.at(-1)?.watched).toEqual([card('a')]);
            expect(gone.hasAttribute(OFFSCREEN_ATTRIBUTE)).toBe(false);
        });

        it('watches nothing for a component that never gives its element', () => {
            render(<Detached />);
            expect(observers.created.at(-1)?.watched ?? []).toEqual([]);
        });

        it('makes its observer again when the kind of observer of the page changes, with the same margins', () => {
            render(<Card id="a" />);
            const first = observers.created.at(-1);
            vi.stubGlobal('IntersectionObserver', fakeObserverClass());
            render(<Card id="c" />);
            const second = observers.created.at(-1);
            expect(second).not.toBe(first);
            expect(second?.options).toEqual({ rootMargin: '200px', scrollMargin: '200px' });
            expect(second?.watched).toEqual([card('c')]);
        });
    });

    describe('without IntersectionObserver', () => {
        it('leaves the card as it is: its animations always run', () => {
            vi.stubGlobal('IntersectionObserver', undefined);
            render(<Card id="d" />);
            expect(card('d').hasAttribute(OFFSCREEN_ATTRIBUTE)).toBe(false);
            expect(observers.created).toEqual([]);
            vi.unstubAllGlobals();
        });
    });
});
