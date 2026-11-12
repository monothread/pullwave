// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { INCREMENTAL_STEP, useIncrementalList } from '@renderer/hooks/useIncrementalList';
import { liveObservers, seeEnd, stubIntersectionObserver, type ObservedEnd } from '../../helpers/intersectionObserver';

let observers: ObservedEnd[] = [];

beforeEach(() => {
    observers = stubIntersectionObserver();
});

afterEach(() => {
    vi.unstubAllGlobals();
});

function numbers(length: number): number[] {
    return Array.from({ length }, (_unused, index) => {
        return index + 1;
    });
}

function Probe({ items, listKey, step }: { items: readonly number[]; listKey: string; step?: number }) {
    const { shown, hasMore, endRef } = useIncrementalList(items, listKey, step);
    return (
        <>
            <ul>
                {shown.map((item) => {
                    return <li key={item}>{item}</li>;
                })}
            </ul>
            <span data-testid="has-more">{String(hasMore)}</span>
            {hasMore && <div ref={endRef} data-testid="end" />}
        </>
    );
}

function drawnItems(): string[] {
    return screen.queryAllByRole('listitem').map((item) => {
        return item.textContent ?? '';
    });
}

describe('useIncrementalList', () => {
    it('draws 60 items at a time by default', () => {
        expect(INCREMENTAL_STEP).toBe(60);
        render(<Probe items={numbers(150)} listKey="chapters" />);
        expect(drawnItems()).toEqual(numbers(60).map(String));
        expect(screen.getByTestId('has-more')).toHaveTextContent('true');
    });

    it('draws the whole list, and asks for nothing, when it is not longer than a step', () => {
        render(<Probe items={numbers(5)} listKey="chapters" step={5} />);
        expect(drawnItems()).toEqual(['1', '2', '3', '4', '5']);
        expect(screen.getByTestId('has-more')).toHaveTextContent('false');
        expect(screen.queryByTestId('end')).toBeNull();
        expect(observers).toHaveLength(0);
    });

    it('draws nothing for an empty list', () => {
        render(<Probe items={[]} listKey="chapters" step={3} />);
        expect(drawnItems()).toEqual([]);
        expect(screen.getByTestId('has-more')).toHaveTextContent('false');
    });

    it('watches the end of what is drawn while some items are not drawn', () => {
        render(<Probe items={numbers(7)} listKey="chapters" step={3} />);
        expect(liveObservers(observers)).toHaveLength(1);
        expect(liveObservers(observers)[0]!.target).toBe(screen.getByTestId('end'));
    });

    it('draws one more step each time the end comes into view, until the whole list is drawn', () => {
        render(<Probe items={numbers(7)} listKey="chapters" step={3} />);
        expect(drawnItems()).toEqual(['1', '2', '3']);
        seeEnd(observers);
        expect(drawnItems()).toEqual(['1', '2', '3', '4', '5', '6']);
        expect(screen.getByTestId('has-more')).toHaveTextContent('true');
        seeEnd(observers);
        expect(drawnItems()).toEqual(['1', '2', '3', '4', '5', '6', '7']);
        expect(screen.getByTestId('has-more')).toHaveTextContent('false');
        expect(liveObservers(observers)).toHaveLength(0);
    });

    it('watches the end again after each step, since it can still be in view', () => {
        render(<Probe items={numbers(10)} listKey="chapters" step={3} />);
        const before = observers.length;
        seeEnd(observers);
        expect(observers.length).toBe(before + 1);
        expect(observers[before - 1]!.disconnected).toBe(true);
        expect(liveObservers(observers)).toHaveLength(1);
    });

    it('comes back as long as it was for the same key', () => {
        const first = render(<Probe items={numbers(10)} listKey="chapters" step={3} />);
        seeEnd(observers);
        seeEnd(observers);
        expect(drawnItems()).toHaveLength(9);
        first.unmount();
        render(<Probe items={numbers(10)} listKey="chapters" step={3} />);
        expect(drawnItems()).toEqual(numbers(9).map(String));
    });

    it('starts from one step for another key, and goes back to what the first key had when it is shown again', () => {
        const { rerender } = render(<Probe items={numbers(10)} listKey="manga-1" step={3} />);
        seeEnd(observers);
        expect(drawnItems()).toHaveLength(6);
        rerender(<Probe items={numbers(10)} listKey="manga-2" step={3} />);
        expect(drawnItems()).toEqual(['1', '2', '3']);
        rerender(<Probe items={numbers(10)} listKey="manga-1" step={3} />);
        expect(drawnItems()).toEqual(numbers(6).map(String));
    });

    it('draws the items that are there now when the list changes, keeping how many it draws', () => {
        const { rerender } = render(<Probe items={numbers(10)} listKey="chapters" step={3} />);
        seeEnd(observers);
        rerender(<Probe items={numbers(10).reverse()} listKey="chapters" step={3} />);
        expect(drawnItems()).toEqual(['10', '9', '8', '7', '6', '5']);
        rerender(<Probe items={[42, 43]} listKey="chapters" step={3} />);
        expect(drawnItems()).toEqual(['42', '43']);
        expect(screen.getByTestId('has-more')).toHaveTextContent('false');
    });
});
