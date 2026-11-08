// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { RIPPLE_CLASS, RIPPLE_MS, RIPPLE_SELECTOR, startRipple, useButtonRipple } from '@renderer/fx/useButtonRipple';

function Screen() {
    useButtonRipple();
    return (
        <div>
            <button type="button" className="btn">
                PRESS
            </button>
            <button type="button" className="btn" disabled>
                OFF
            </button>
            <button type="button" className="plain">
                PLAIN
            </button>
            <span className="btn" data-testid="span">
                SPAN
            </span>
        </div>
    );
}

function press(target: Element, clientX: number, clientY: number): void {
    target.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX, clientY }));
}

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('the ripple of a press', () => {
    it('is for the buttons of the app', () => {
        expect(RIPPLE_SELECTOR).toBe('.btn, .topbar__button, .player__button, .spotlight__arrow');
        expect(RIPPLE_CLASS).toBe('is-rippling');
        expect(RIPPLE_MS).toBe(650);
    });

    it('starts at the point of the press, in the coordinates of the button, and ends by itself', () => {
        const { getByText } = render(<Screen />);
        const button = getByText('PRESS');
        button.getBoundingClientRect = () => { return { left: 10, top: 5 } as DOMRect; };
        press(button, 42, 25);
        expect(button.classList.contains(RIPPLE_CLASS)).toBe(true);
        expect(button.style.getPropertyValue('--rx')).toBe('32px');
        expect(button.style.getPropertyValue('--ry')).toBe('20px');
        vi.advanceTimersByTime(RIPPLE_MS);
        expect(button.classList.contains(RIPPLE_CLASS)).toBe(false);
    });

    it('starts again at a new point when pressed again before it ends', () => {
        const { getByText } = render(<Screen />);
        const button = getByText('PRESS');
        press(button, 5, 6);
        press(button, 7, 9);
        expect(button.classList.contains(RIPPLE_CLASS)).toBe(true);
        expect(button.style.getPropertyValue('--rx')).toBe('7px');
        expect(button.style.getPropertyValue('--ry')).toBe('9px');
    });

    it('is also started by a press on something inside the button', () => {
        const { getByText } = render(<Screen />);
        const label = document.createElement('i');
        getByText('PRESS').appendChild(label);
        press(label, 1, 1);
        expect(getByText('PRESS', { selector: 'button' }).classList.contains(RIPPLE_CLASS)).toBe(true);
    });

    it('does not start for a disabled button, a plain control or a press outside the buttons', () => {
        const { getByText, container } = render(<Screen />);
        press(getByText('OFF'), 1, 1);
        press(getByText('PLAIN'), 1, 1);
        press(container, 1, 1);
        expect(document.querySelectorAll(`.${RIPPLE_CLASS}`)).toHaveLength(0);
    });

    it('starts for a control that is not a button but is one of the selector', () => {
        const { getByTestId } = render(<Screen />);
        press(getByTestId('span'), 3, 4);
        expect(getByTestId('span').classList.contains(RIPPLE_CLASS)).toBe(true);
    });

    it('ignores a press whose target is not an element', () => {
        render(<Screen />);
        document.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
        expect(document.querySelectorAll(`.${RIPPLE_CLASS}`)).toHaveLength(0);
    });

    it('stops listening when the screen goes away', () => {
        const { getByText, unmount } = render(<Screen />);
        const button = getByText('PRESS');
        unmount();
        document.body.appendChild(button);
        press(button, 1, 1);
        expect(button.classList.contains(RIPPLE_CLASS)).toBe(false);
    });

    it('startRipple sets the point and the class on any control', () => {
        const control = document.createElement('button');
        control.getBoundingClientRect = () => { return { left: 0, top: 0 } as DOMRect; };
        startRipple(control, 11.4, 12.6);
        expect(control.style.getPropertyValue('--rx')).toBe('11px');
        expect(control.style.getPropertyValue('--ry')).toBe('13px');
        expect(control.classList.contains(RIPPLE_CLASS)).toBe(true);
    });
});
