// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { REVEAL_MILLISECONDS, useRevealProgress } from '@renderer/hooks/useRevealProgress';
import { useAppStore } from '@renderer/store/appStore';

describe('useRevealProgress', () => {
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
    });

    afterEach(() => {
        cleanup();
        useAppStore.setState({ settings: DEFAULT_SETTINGS });
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

    it('stays at zero while inactive and eases to one when active', () => {
        const { result, rerender } = renderHook(
            ({ active }) => {
                return useRevealProgress(active);
            },
            { initialProps: { active: false } }
        );
        expect(result.current).toBe(0);
        expect(frames).toHaveLength(0);
        rerender({ active: true });
        expect(frames).toHaveLength(1);
        run(100);
        expect(result.current).toBe(0);
        run(100 + REVEAL_MILLISECONDS / 2);
        expect(result.current).toBeGreaterThan(0.5);
        expect(result.current).toBeLessThan(1);
        run(100 + REVEAL_MILLISECONDS);
        expect(result.current).toBe(1);
        expect(frames).toHaveLength(0);
    });

    it('jumps immediately to one without animation frames in performance mode and does not replay when toggled off', () => {
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, performanceMode: true } });
        const { result, rerender } = renderHook(
            ({ active }) => {
                return useRevealProgress(active);
            },
            { initialProps: { active: false } }
        );
        expect(result.current).toBe(0);
        rerender({ active: true });
        expect(result.current).toBe(1);
        expect(frames).toHaveLength(0);
        act(() => {
            useAppStore.setState({ settings: DEFAULT_SETTINGS });
        });
        expect(result.current).toBe(1);
        expect(frames).toHaveLength(0);
        rerender({ active: false });
        expect(result.current).toBe(0);
    });
});
