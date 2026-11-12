// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { IncrementalItems } from '@renderer/components/IncrementalItems';
import { INCREMENTAL_STEP } from '@renderer/hooks/useIncrementalList';
import { liveObservers, seeEnd, stubIntersectionObserver, type ObservedEnd } from '../../helpers/intersectionObserver';

let observers: ObservedEnd[] = [];

beforeEach(() => {
    observers = stubIntersectionObserver();
});

afterEach(() => {
    vi.unstubAllGlobals();
});

function words(length: number): string[] {
    return Array.from({ length }, (_unused, index) => {
        return `item ${String(index + 1)}`;
    });
}

function renderItem(item: string) {
    return <li key={item}>{item}</li>;
}

function drawn(): string[] {
    return screen
        .getAllByRole('listitem')
        .filter((item) => {
            return !item.classList.contains('list-more');
        })
        .map((item) => {
            return item.textContent ?? '';
        });
}

describe('IncrementalItems', () => {
    it('draws the first 60 items by default, followed by the end of the list', () => {
        render(
            <ul>
                <IncrementalItems items={words(100)} listKey="list" end="li" renderItem={renderItem} />
            </ul>
        );
        expect(drawn()).toEqual(words(INCREMENTAL_STEP));
        const end = screen.getByTestId('list-more');
        expect(end.tagName).toBe('LI');
        expect(liveObservers(observers)[0]!.target).toBe(end);
    });

    it('draws a step more when the end comes into view, and no end once all of the list is drawn', () => {
        render(
            <ul>
                <IncrementalItems items={words(5)} listKey="list" end="li" step={2} renderItem={renderItem} />
            </ul>
        );
        expect(drawn()).toEqual(['item 1', 'item 2']);
        seeEnd(observers);
        expect(drawn()).toEqual(['item 1', 'item 2', 'item 3', 'item 4']);
        seeEnd(observers);
        expect(drawn()).toEqual(words(5));
        expect(screen.queryByTestId('list-more')).toBeNull();
    });

    it('ends with a box when the list is not a list of items', () => {
        render(
            <div>
                <IncrementalItems
                    items={words(3)}
                    listKey="boxes"
                    end="div"
                    step={2}
                    renderItem={(item) => {
                        return <article key={item}>{item}</article>;
                    }}
                />
            </div>
        );
        expect(screen.getAllByRole('article').map((item) => {
            return item.textContent;
        })).toEqual(['item 1', 'item 2']);
        expect(screen.getByTestId('list-more').tagName).toBe('DIV');
    });

    it('draws a short list whole, without an end', () => {
        render(
            <ul>
                <IncrementalItems items={words(3)} listKey="list" end="li" renderItem={renderItem} />
            </ul>
        );
        expect(drawn()).toEqual(words(3));
        expect(screen.queryByTestId('list-more')).toBeNull();
        expect(observers).toHaveLength(0);
    });
});
