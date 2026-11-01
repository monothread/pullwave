// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { FULLSCREEN_ESCAPE_GRACE_MS, useReaderFullscreen } from '@renderer/hooks/useReaderFullscreen';
import { installFakeFullscreen, type FakeFullscreen } from '../../helpers/fakeFullscreen';

let fake: FakeFullscreen;
let area: HTMLElement;

beforeEach(() => {
    fake = installFakeFullscreen();
    area = document.createElement('div');
    document.body.appendChild(area);
});

afterEach(() => {
    fake.restore();
    area.remove();
    vi.useRealTimers();
});

function setup(enabled = true) {
    const getArea = (): HTMLElement => {
        return area;
    };
    return renderHook(
        ({ on }: { on: boolean }) => {
            return useReaderFullscreen(getArea, on);
        },
        { initialProps: { on: enabled } }
    );
}

describe('useReaderFullscreen', () => {
    it('lets an Escape that comes half a second after the fullscreen ended belong to it', () => {
        expect(FULLSCREEN_ESCAPE_GRACE_MS).toBe(500);
    });

    it('starts out of fullscreen, and Escape is not its own', () => {
        const { result } = setup();
        expect(result.current.active).toBe(false);
        expect(result.current.takesEscape()).toBe(false);
    });

    it('puts the area in fullscreen and takes it out again', () => {
        const { result } = setup();
        act(() => {
            result.current.toggle();
        });
        expect(fake.requests).toEqual([area]);
        expect(result.current.active).toBe(true);
        expect(result.current.takesEscape()).toBe(true);
        act(() => {
            result.current.toggle();
        });
        expect(fake.exits()).toBe(1);
        expect(result.current.active).toBe(false);
    });

    it('takes the area out with exit, and does nothing when it is not in fullscreen', () => {
        const { result } = setup();
        act(() => {
            result.current.exit();
        });
        expect(fake.exits()).toBe(0);
        act(() => {
            result.current.toggle();
        });
        act(() => {
            result.current.exit();
        });
        expect(fake.exits()).toBe(1);
        expect(result.current.active).toBe(false);
    });

    it('does not count another element in fullscreen (the player) as its own, nor take it out', () => {
        const other = document.createElement('div');
        const { result } = setup();
        act(() => {
            void other.requestFullscreen();
        });
        expect(result.current.active).toBe(false);
        expect(result.current.takesEscape()).toBe(false);
        act(() => {
            result.current.exit();
        });
        expect(fake.exits()).toBe(0);
        act(() => {
            result.current.toggle();
        });
        expect(fake.requests).toEqual([other, area]);
    });

    it('follows a fullscreen that ends by itself, and still takes the Escape that came with it for half a second', () => {
        vi.useFakeTimers();
        const { result } = setup();
        act(() => {
            result.current.toggle();
        });
        act(() => {
            fake.end();
        });
        expect(result.current.active).toBe(false);
        expect(result.current.takesEscape()).toBe(true);
        vi.advanceTimersByTime(FULLSCREEN_ESCAPE_GRACE_MS - 1);
        expect(result.current.takesEscape()).toBe(true);
        vi.advanceTimersByTime(1);
        expect(result.current.takesEscape()).toBe(false);
    });

    it('takes the area out of fullscreen when it is turned off', () => {
        const { result, rerender } = setup();
        act(() => {
            result.current.toggle();
        });
        rerender({ on: false });
        expect(fake.exits()).toBe(1);
        expect(result.current.active).toBe(false);
    });

    it('takes the area out of fullscreen when it goes away (the reader closes)', () => {
        const { result, unmount } = setup();
        act(() => {
            result.current.toggle();
        });
        unmount();
        expect(fake.exits()).toBe(1);
        expect(fake.current()).toBeNull();
    });

    it('does not fail when the window refuses a request', async () => {
        Object.defineProperty(Element.prototype, 'requestFullscreen', {
            configurable: true,
            value: () => {
                return Promise.reject(new Error('refused'));
            }
        });
        const { result } = setup();
        act(() => {
            result.current.toggle();
        });
        await Promise.resolve();
        expect(result.current.active).toBe(false);
    });

    it('stops listening to the changes of the fullscreen when it goes away', () => {
        const removed = vi.spyOn(document, 'removeEventListener');
        const { unmount } = setup();
        unmount();
        expect(removed).toHaveBeenCalledWith('fullscreenchange', expect.any(Function));
        removed.mockRestore();
    });
});
