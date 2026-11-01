// @vitest-environment jsdom
import { fireEvent, render } from '@testing-library/react';
import { useSpatialNavigation } from '@renderer/hooks/useSpatialNavigation';

const scrollIntoView = vi.fn();

interface Spot {
    label: string;
    left: number;
    top: number;
}

function placeAll(spots: readonly Spot[]): void {
    spots.forEach((spot) => {
        const element = document.querySelector<HTMLElement>(`[data-spot="${spot.label}"]`) as HTMLElement;
        vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
            x: spot.left,
            y: spot.top,
            left: spot.left,
            top: spot.top,
            width: 80,
            height: 30,
            right: spot.left + 80,
            bottom: spot.top + 30,
            toJSON: () => {
                return {};
            }
        });
    });
}

// A small grid of buttons in the app: A B on the first row, C under A, and a field under C.
const SPOTS: readonly Spot[] = [
    { label: 'A', left: 0, top: 0 },
    { label: 'B', left: 100, top: 0 },
    { label: 'C', left: 0, top: 50 },
    { label: 'FIELD', left: 0, top: 100 }
];

function Screen({ player = false }: { player?: boolean }) {
    useSpatialNavigation();
    return (
        <div className="app">
            <button type="button" data-spot="A">
                A
            </button>
            <button type="button" data-spot="B">
                B
            </button>
            <button type="button" data-spot="C">
                C
            </button>
            <input aria-label="field" data-spot="FIELD" />
            {player && <div className="player" />}
        </div>
    );
}

function spot(label: string): HTMLElement {
    return document.querySelector<HTMLElement>(`[data-spot="${label}"]`) as HTMLElement;
}

beforeEach(() => {
    scrollIntoView.mockClear();
    Element.prototype.scrollIntoView = scrollIntoView;
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('useSpatialNavigation', () => {
    it('moves the focus with the arrows and takes the key from the page', () => {
        render(<Screen />);
        placeAll(SPOTS);
        spot('A').focus();

        const right = fireEvent.keyDown(spot('A'), { key: 'ArrowRight' });
        expect(right).toBe(false);
        expect(document.activeElement).toBe(spot('B'));

        fireEvent.keyDown(spot('B'), { key: 'ArrowLeft' });
        expect(document.activeElement).toBe(spot('A'));

        fireEvent.keyDown(spot('A'), { key: 'ArrowDown' });
        expect(document.activeElement).toBe(spot('C'));

        fireEvent.keyDown(spot('C'), { key: 'ArrowUp' });
        expect(document.activeElement).toBe(spot('A'));
        expect(scrollIntoView).toHaveBeenCalledTimes(4);
    });

    it('leaves the key to the page when nothing is in the direction', () => {
        render(<Screen />);
        placeAll(SPOTS);
        spot('A').focus();
        const notTaken = fireEvent.keyDown(spot('A'), { key: 'ArrowUp' });
        expect(notTaken).toBe(true);
        expect(document.activeElement).toBe(spot('A'));
    });

    it('never moves the focus into a field', () => {
        render(<Screen />);
        placeAll(SPOTS);
        spot('C').focus();
        fireEvent.keyDown(spot('C'), { key: 'ArrowDown' });
        expect(document.activeElement).toBe(spot('C'));
    });

    it('leaves the arrows to a field that has the focus', () => {
        render(<Screen />);
        placeAll(SPOTS);
        spot('FIELD').focus();
        const notTaken = fireEvent.keyDown(spot('FIELD'), { key: 'ArrowUp' });
        expect(notTaken).toBe(true);
        expect(document.activeElement).toBe(spot('FIELD'));
    });

    it('leaves the arrows to the player while it is open', () => {
        render(<Screen player />);
        placeAll(SPOTS);
        spot('A').focus();
        const notTaken = fireEvent.keyDown(spot('A'), { key: 'ArrowRight' });
        expect(notTaken).toBe(true);
        expect(document.activeElement).toBe(spot('A'));
    });

    it('ignores an arrow with a modifier and the other keys', () => {
        render(<Screen />);
        placeAll(SPOTS);
        spot('A').focus();
        fireEvent.keyDown(spot('A'), { key: 'ArrowRight', shiftKey: true });
        fireEvent.keyDown(spot('A'), { key: 'Enter' });
        expect(document.activeElement).toBe(spot('A'));
    });

    it('stops listening with the same handler when the app goes away', () => {
        const addSpy = vi.spyOn(window, 'addEventListener');
        const removeSpy = vi.spyOn(window, 'removeEventListener');
        const { unmount } = render(<Screen />);
        const added = addSpy.mock.calls.filter(([type]) => {
            return type === 'keydown';
        });
        expect(added).toHaveLength(1);
        unmount();
        const removed = removeSpy.mock.calls.filter(([type]) => {
            return type === 'keydown';
        });
        expect(removed).toEqual([['keydown', added[0]?.[1]]]);
    });
});
