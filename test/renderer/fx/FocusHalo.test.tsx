// @vitest-environment jsdom
import { act, render } from '@testing-library/react';
import { FocusHalo, HALO_PADDING, haloBox } from '@renderer/fx/FocusHalo';

describe('haloBox', () => {
    it('is the box of the control with a margin all round', () => {
        expect(haloBox({ left: 100, top: 50, width: 80, height: 30 })).toEqual({
            x: 100 - HALO_PADDING,
            y: 50 - HALO_PADDING,
            width: 80 + HALO_PADDING * 2,
            height: 30 + HALO_PADDING * 2
        });
    });
});

describe('FocusHalo', () => {
    let frames: FrameRequestCallback[] = [];

    beforeEach(() => {
        frames = [];
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
            frames.push(callback);
            return frames.length;
        });
        vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => { return undefined; });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        document.body.innerHTML = '';
    });

    function flush(): void {
        act(() => {
            frames.splice(0).forEach((callback) => {
                callback(0);
            });
        });
    }

    it('is hidden from the screen readers and starts out of sight', () => {
        const { container } = render(<FocusHalo />);
        const halo = container.querySelector('.focus-halo') as HTMLElement;
        expect(halo.getAttribute('aria-hidden')).toBe('true');
        expect(halo.dataset.visible).toBe('false');
    });

    it('shows itself over the control that gets the focus with the keyboard and hides when it is lost', () => {
        const { container } = render(
            <div>
                <button type="button">ONE</button>
                <FocusHalo />
            </div>
        );
        const button = container.querySelector('button') as HTMLButtonElement;
        button.getBoundingClientRect = () => { return { left: 20, top: 30, width: 100, height: 40 } as DOMRect; };
        vi.spyOn(button, 'matches').mockReturnValue(true);
        act(() => {
            button.focus();
        });
        flush();
        const halo = container.querySelector('.focus-halo') as HTMLElement;
        expect(halo.dataset.visible).toBe('true');
        act(() => {
            button.blur();
        });
        flush();
        expect(halo.dataset.visible).toBe('false');
    });

    it('stays hidden when the focus is on a field, which is not a control of the navigation', () => {
        const { container } = render(
            <div>
                <input aria-label="field" />
                <FocusHalo />
            </div>
        );
        act(() => {
            (container.querySelector('input') as HTMLInputElement).focus();
        });
        flush();
        expect((container.querySelector('.focus-halo') as HTMLElement).dataset.visible).toBe('false');
    });

    it('follows the keys, the scroll and the resize, and stops when it goes away', () => {
        const { container, unmount } = render(
            <div>
                <button type="button">ONE</button>
                <FocusHalo />
            </div>
        );
        const button = container.querySelector('button') as HTMLButtonElement;
        vi.spyOn(button, 'matches').mockReturnValue(true);
        act(() => {
            button.focus();
        });
        flush();
        const requested = (window.requestAnimationFrame as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
        window.dispatchEvent(new Event('scroll'));
        window.dispatchEvent(new Event('resize'));
        document.dispatchEvent(new MouseEvent('pointerdown'));
        expect((window.requestAnimationFrame as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(requested + 4);
        unmount();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
        expect((window.requestAnimationFrame as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(requested + 4);
    });
});
