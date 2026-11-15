// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { MINIMIZED_ATTRIBUTE, useWindowMinimized } from '@renderer/hooks/useWindowMinimized';
import { installMockApi, type MockApiHandle } from '../../helpers/mockApi';

const loopPause = vi.hoisted(() => {
    return { calls: [] as boolean[], watching: 0, stopped: 0 };
});

vi.mock('@renderer/fx/loopPause', () => {
    return {
        setWindowMinimized: (minimized: boolean) => {
            loopPause.calls.push(minimized);
        },
        watchNewAnimations: () => {
            loopPause.watching += 1;
            return () => {
                loopPause.stopped += 1;
            };
        }
    };
});

let mock: MockApiHandle;

beforeEach(() => {
    mock = installMockApi();
    loopPause.calls.length = 0;
    loopPause.watching = 0;
    loopPause.stopped = 0;
    document.documentElement.removeAttribute(MINIMIZED_ATTRIBUTE);
});

describe('useWindowMinimized', () => {
    it('marks the page with the attribute the end to end test reads', () => {
        expect(MINIMIZED_ATTRIBUTE).toBe('data-window-minimized');
    });

    it('listens to the window once and leaves the page unmarked at the start', () => {
        renderHook(() => {
            useWindowMinimized();
        });
        expect(mock.api.onWindowMinimized).toHaveBeenCalledTimes(1);
        expect(document.documentElement.hasAttribute(MINIMIZED_ATTRIBUTE)).toBe(false);
        expect(loopPause.calls).toEqual([]);
        // The animations that start in the page are watched from the start, once.
        expect(loopPause.watching).toBe(1);
        expect(loopPause.stopped).toBe(0);
    });

    it('marks the page and makes its looping animations wait while the window is minimized, and undoes both when it comes back', () => {
        renderHook(() => {
            useWindowMinimized();
        });
        act(() => {
            mock.emitWindowMinimized(true);
        });
        expect(document.documentElement.getAttribute(MINIMIZED_ATTRIBUTE)).toBe('');
        expect(loopPause.calls).toEqual([true]);
        act(() => {
            mock.emitWindowMinimized(false);
        });
        expect(document.documentElement.hasAttribute(MINIMIZED_ATTRIBUTE)).toBe(false);
        expect(loopPause.calls).toEqual([true, false]);
    });

    it('stops listening, unmarks the page and lets the animations run again when it goes away', () => {
        const { unmount } = renderHook(() => {
            useWindowMinimized();
        });
        act(() => {
            mock.emitWindowMinimized(true);
        });
        const unsubscribe = mock.unsubscribers.at(-1);
        expect(unsubscribe).not.toHaveBeenCalled();
        unmount();
        expect(unsubscribe).toHaveBeenCalledTimes(1);
        expect(document.documentElement.hasAttribute(MINIMIZED_ATTRIBUTE)).toBe(false);
        expect(loopPause.calls).toEqual([true, false]);
        expect(loopPause.stopped).toBe(1);
    });
});
