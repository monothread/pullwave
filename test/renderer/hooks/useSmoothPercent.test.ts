// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { SMOOTH_MS, useSmoothPercent } from '@renderer/hooks/useSmoothPercent';
import { useAppStore } from '@renderer/store/appStore';

describe('useSmoothPercent', () => {
    let frames: Array<(time: number) => void>;

    beforeEach(() => {
        frames = [];
        useAppStore.setState({ settings: DEFAULT_SETTINGS });
        vi.stubGlobal('requestAnimationFrame', (callback: (time: number) => void) => {
            frames.push(callback);
            return frames.length;
        });
        vi.stubGlobal('cancelAnimationFrame', (id: number) => {
            frames[id - 1] = () => {
                return undefined;
            };
        });
        vi.stubGlobal('matchMedia', () => {
            return { matches: false };
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    function run(time: number): void {
        const pending = frames.splice(0);
        act(() => {
            pending.forEach((frame) => {
                frame(time);
            });
        });
    }

    it('starts at the value it first gets', () => {
        const { result } = renderHook(() => {
            return useSmoothPercent(40);
        });
        expect(result.current).toBe(40);
        expect(frames).toHaveLength(0);
    });

    it('glides to a higher value, frame by frame, without passing it', () => {
        const { result, rerender } = renderHook(
            ({ value }) => {
                return useSmoothPercent(value);
            },
            { initialProps: { value: 0 } }
        );
        rerender({ value: 50 });
        run(1000);
        const first = result.current;
        expect(first).toBeGreaterThan(0);
        expect(first).toBeLessThan(50);
        run(1016);
        const second = result.current;
        expect(second).toBeGreaterThan(first);
        expect(second).toBeLessThan(50);
        run(1016 + SMOOTH_MS * 20);
        expect(result.current).toBe(50);
        expect(frames).toHaveLength(0);
    });

    it('covers about two thirds of the way in the time it is said to take', () => {
        const { result, rerender } = renderHook(
            ({ value }) => {
                return useSmoothPercent(value);
            },
            { initialProps: { value: 0 } }
        );
        rerender({ value: 100 });
        run(0);
        run(SMOOTH_MS + 16);
        expect(result.current).toBeGreaterThan(55);
        expect(result.current).toBeLessThan(70);
    });

    it('goes straight down when the value goes down', () => {
        const { result, rerender } = renderHook(
            ({ value }) => {
                return useSmoothPercent(value);
            },
            { initialProps: { value: 80 } }
        );
        rerender({ value: 10 });
        expect(result.current).toBe(10);
        expect(frames).toHaveLength(0);
    });

    it('goes on from where it is when the target moves again', () => {
        const { result, rerender } = renderHook(
            ({ value }) => {
                return useSmoothPercent(value);
            },
            { initialProps: { value: 0 } }
        );
        rerender({ value: 40 });
        run(0);
        run(100);
        const midway = result.current;
        rerender({ value: 90 });
        run(200);
        run(300);
        expect(result.current).toBeGreaterThan(midway);
        expect(result.current).toBeLessThan(90);
        run(300 + SMOOTH_MS * 20);
        expect(result.current).toBe(90);
    });

    it('glides also when the system asks for less motion (D-130)', () => {
        vi.stubGlobal('matchMedia', () => {
            return { matches: true };
        });
        const { result, rerender } = renderHook(
            ({ value }) => {
                return useSmoothPercent(value);
            },
            { initialProps: { value: 0 } }
        );
        rerender({ value: 70 });
        expect(result.current).toBe(0);
        expect(frames).toHaveLength(1);
    });

    it('stops its frames when it is removed', () => {
        const { rerender, unmount } = renderHook(
            ({ value }) => {
                return useSmoothPercent(value);
            },
            { initialProps: { value: 0 } }
        );
        rerender({ value: 70 });
        expect(frames).toHaveLength(1);
        unmount();
        run(100);
        expect(frames).toHaveLength(0);
    });

    it('jumps straight to higher values in a single render without scheduling frames in performance mode', () => {
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, performanceMode: true } });
        let renders = 0;
        const { result, rerender } = renderHook(
            ({ value }) => {
                renders += 1;
                return useSmoothPercent(value);
            },
            { initialProps: { value: 10 } }
        );
        expect(renders).toBe(1);
        rerender({ value: 85 });
        expect(result.current).toBe(85);
        expect(renders).toBe(2);
        expect(frames).toHaveLength(0);
        act(() => {
            useAppStore.setState({ settings: DEFAULT_SETTINGS });
        });
        expect(result.current).toBe(85);
        expect(frames).toHaveLength(0);
    });
});
