// @vitest-environment jsdom
import { act, render } from '@testing-library/react';
import { useInfiniteScroll } from '@renderer/hooks/useInfiniteScroll';

interface Observed {
    callback: IntersectionObserverCallback;
    target: Element | null;
    disconnected: boolean;
}

let observers: Observed[] = [];

beforeEach(() => {
    observers = [];
    vi.stubGlobal(
        'IntersectionObserver',
        class {
            private readonly record: Observed;
            constructor(callback: IntersectionObserverCallback) {
                this.record = { callback, target: null, disconnected: false };
                observers.push(this.record);
            }
            observe(target: Element): void {
                this.record.target = target;
            }
            disconnect(): void {
                this.record.disconnected = true;
            }
        }
    );
});

afterEach(() => {
    vi.unstubAllGlobals();
});

function Probe({ onReach, enabled, version }: { onReach: () => void; enabled: boolean; version: number }) {
    const ref = useInfiniteScroll(onReach, enabled, version);
    return <div ref={ref} data-testid="end" />;
}

// A list whose end can be taken away and put back, as when the page of a manga covers the list and the user comes back: the end that comes
// back is another element, with the same `enabled` and `version`. `identity` changes the key, so React makes a new element.
function Replaceable({ onReach, shown, identity }: { onReach: () => void; shown: boolean; identity: string }) {
    const ref = useInfiniteScroll(onReach, true, 1);
    return shown ? <div key={identity} ref={ref} data-testid="end" /> : null;
}

function see(visible: boolean): void {
    const live = observers.filter((observer) => {
        return !observer.disconnected;
    });
    act(() => {
        live.at(-1)!.callback([{ isIntersecting: visible } as IntersectionObserverEntry], {} as IntersectionObserver);
    });
}

describe('useInfiniteScroll', () => {
    it('watches the element and asks for more when it comes into view', () => {
        const onReach = vi.fn();
        const { getByTestId } = render(<Probe onReach={onReach} enabled version={1} />);
        expect(observers).toHaveLength(1);
        expect(observers[0]!.target).toBe(getByTestId('end'));
        see(true);
        expect(onReach).toHaveBeenCalledTimes(1);
    });

    it('does not ask while the element is out of view', () => {
        const onReach = vi.fn();
        render(<Probe onReach={onReach} enabled version={1} />);
        see(false);
        expect(onReach).not.toHaveBeenCalled();
    });

    it('watches nothing while it is not enabled', () => {
        render(<Probe onReach={vi.fn()} enabled={false} version={1} />);
        expect(observers).toHaveLength(0);
    });

    it('stops watching when it is disabled, and when it is removed', () => {
        const { rerender, unmount } = render(<Probe onReach={vi.fn()} enabled version={1} />);
        rerender(<Probe onReach={vi.fn()} enabled={false} version={1} />);
        expect(observers[0]!.disconnected).toBe(true);
        rerender(<Probe onReach={vi.fn()} enabled version={1} />);
        expect(observers).toHaveLength(2);
        unmount();
        expect(observers[1]!.disconnected).toBe(true);
    });

    it('looks again when the list grows, since an element still in view must ask for more', () => {
        const onReach = vi.fn();
        const { rerender } = render(<Probe onReach={onReach} enabled version={1} />);
        rerender(<Probe onReach={onReach} enabled version={2} />);
        expect(observers).toHaveLength(2);
        expect(observers[0]!.disconnected).toBe(true);
        see(true);
        expect(onReach).toHaveBeenCalledTimes(1);
    });

    it('calls the latest function it was given, not the first', () => {
        const first = vi.fn();
        const second = vi.fn();
        const { rerender } = render(<Probe onReach={first} enabled version={1} />);
        rerender(<Probe onReach={second} enabled version={1} />);
        see(true);
        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledTimes(1);
    });

    it('does nothing where the browser has no IntersectionObserver', () => {
        vi.unstubAllGlobals();
        vi.stubGlobal('IntersectionObserver', undefined);
        expect(() => {
            render(<Probe onReach={vi.fn()} enabled version={1} />);
        }).not.toThrow();
    });

    it('watches the new element when the end of the list is replaced by another one, with nothing else changed', () => {
        const onReach = vi.fn();
        const { rerender, getByTestId } = render(<Replaceable onReach={onReach} shown identity="a" />);
        expect(observers).toHaveLength(1);
        const first = getByTestId('end');
        rerender(<Replaceable onReach={onReach} shown identity="b" />);
        const second = getByTestId('end');
        expect(second).not.toBe(first);
        expect(observers).toHaveLength(2);
        expect(observers[0]!.disconnected).toBe(true);
        expect(observers[1]!.target).toBe(second);
        see(true);
        expect(onReach).toHaveBeenCalledTimes(1);
    });

    it('stops watching when the end of the list goes away, and watches the one that comes back', () => {
        const onReach = vi.fn();
        const { rerender, getByTestId, queryByTestId } = render(<Replaceable onReach={onReach} shown identity="a" />);
        rerender(<Replaceable onReach={onReach} shown={false} identity="a" />);
        expect(queryByTestId('end')).toBeNull();
        expect(observers).toHaveLength(1);
        expect(observers[0]!.disconnected).toBe(true);
        rerender(<Replaceable onReach={onReach} shown identity="a" />);
        expect(observers).toHaveLength(2);
        expect(observers[1]!.disconnected).toBe(false);
        expect(observers[1]!.target).toBe(getByTestId('end'));
        see(true);
        expect(onReach).toHaveBeenCalledTimes(1);
    });
});
