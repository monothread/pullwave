// @vitest-environment jsdom
import { act, render } from '@testing-library/react';

const { animateMock } = vi.hoisted(() => {
    return { animateMock: vi.fn() };
});
vi.mock('motion', () => {
    return { animate: animateMock };
});

import { CountUp } from '@renderer/fx/CountUp';

interface Options {
    duration: number;
    ease: string;
    onUpdate: (latest: number) => void;
}

let stop = vi.fn();

beforeEach(() => {
    stop = vi.fn();
    animateMock.mockReset();
    animateMock.mockReturnValue({ stop });
});

describe('CountUp', () => {
    it('counts from zero to the value, rounding what it shows, and says so to the animation', () => {
        const { container } = render(<CountUp value={12} />);
        expect(animateMock).toHaveBeenCalledTimes(1);
        const [from, to, options] = animateMock.mock.calls[0] as [number, number, Options];
        expect([from, to, options.duration, options.ease]).toEqual([0, 12, 0.9, 'easeOut']);
        expect(container.textContent).toBe('0');
        act(() => {
            options.onUpdate(5.4);
        });
        expect(container.textContent).toBe('5');
        act(() => {
            options.onUpdate(12);
        });
        expect(container.textContent).toBe('12');
    });

    it('goes on from where it was when the value changes, and stops the count it replaces', () => {
        const { container, rerender } = render(<CountUp value={10} seconds={2} />);
        const first = animateMock.mock.calls[0] as [number, number, Options];
        act(() => {
            first[2].onUpdate(10);
        });
        rerender(<CountUp value={20} seconds={2} />);
        expect(stop).toHaveBeenCalledTimes(1);
        const second = animateMock.mock.calls[1] as [number, number, Options];
        expect([second[0], second[1], second[2].duration]).toEqual([10, 20, 2]);
        act(() => {
            second[2].onUpdate(20);
        });
        expect(container.textContent).toBe('20');
    });

    it('stops the count when it goes away', () => {
        const { unmount } = render(<CountUp value={3} />);
        unmount();
        expect(stop).toHaveBeenCalledTimes(1);
    });
});
