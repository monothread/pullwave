import { MINIMIZE_EVENTS, watchMinimized, type MinimizableWindow } from '@main/services/windowMinimized';

type WindowEvent = (typeof MINIMIZE_EVENTS)[number];

function fakeWindow() {
    const listeners = new Map<WindowEvent, Array<() => void>>();
    const state = { minimized: false };
    const window: MinimizableWindow = {
        isMinimized: () => {
            return state.minimized;
        },
        on: (event, listener) => {
            listeners.set(event, [...(listeners.get(event) ?? []), listener]);
            return window;
        }
    };
    const fire = (event: WindowEvent, minimized: boolean): void => {
        state.minimized = minimized;
        (listeners.get(event) ?? []).forEach((listener) => {
            listener();
        });
    };
    return { window, fire, listeners };
}

describe('watchMinimized', () => {
    it('listens to the minimize, restore, show, maximize and focus of the window, once each', () => {
        const { window, listeners } = fakeWindow();
        watchMinimized(window, vi.fn());
        expect(MINIMIZE_EVENTS).toEqual(['minimize', 'restore', 'show', 'maximize', 'focus']);
        expect([...listeners.keys()]).toEqual(['minimize', 'restore', 'show', 'maximize', 'focus']);
        listeners.forEach((list) => {
            expect(list).toHaveLength(1);
        });
    });

    it('tells nothing at the start: the page starts as not minimized', () => {
        const { window } = fakeWindow();
        const tell = vi.fn();
        watchMinimized(window, tell);
        expect(tell).not.toHaveBeenCalled();
    });

    it('tells when the window is minimized and when it comes back by restore', () => {
        const { window, fire } = fakeWindow();
        const tell = vi.fn();
        watchMinimized(window, tell);
        fire('minimize', true);
        fire('restore', false);
        expect(tell.mock.calls).toEqual([[true], [false]]);
    });

    it('tells it came back whichever event brings it back (show or maximize, depending on the window manager)', () => {
        const { window, fire } = fakeWindow();
        const tell = vi.fn();
        watchMinimized(window, tell);
        fire('minimize', true);
        fire('show', false);
        fire('minimize', true);
        fire('maximize', false);
        expect(tell.mock.calls).toEqual([[true], [false], [true], [false]]);
    });

    it('tells it came back when a window manager only gives the window the focus', () => {
        const { window, fire } = fakeWindow();
        const tell = vi.fn();
        watchMinimized(window, tell);
        fire('minimize', true);
        fire('focus', false);
        expect(tell.mock.calls).toEqual([[true], [false]]);
    });

    it('tells only changes: events that leave the state as it was say nothing', () => {
        const { window, fire } = fakeWindow();
        const tell = vi.fn();
        watchMinimized(window, tell);
        fire('show', false);
        fire('maximize', false);
        fire('minimize', true);
        fire('minimize', true);
        fire('restore', false);
        fire('restore', false);
        expect(tell.mock.calls).toEqual([[true], [false]]);
    });

    it('reads the state of the window instead of trusting the event: a show while still minimized tells nothing', () => {
        const { window, fire } = fakeWindow();
        const tell = vi.fn();
        watchMinimized(window, tell);
        fire('minimize', true);
        fire('show', true);
        expect(tell.mock.calls).toEqual([[true]]);
    });
});

describe('watchMinimized resend', () => {
    it('tells the state as it is now, even when it was told already, for a page loaded again', () => {
        const { window, fire } = fakeWindow();
        const tell = vi.fn();
        const watch = watchMinimized(window, tell);
        fire('minimize', true);
        watch.resend();
        expect(tell.mock.calls).toEqual([[true], [true]]);
    });

    it('tells a page loaded while the window is shown that it is not minimized', () => {
        const { window } = fakeWindow();
        const tell = vi.fn();
        watchMinimized(window, tell).resend();
        expect(tell.mock.calls).toEqual([[false]]);
    });

    it('takes what it resent as what was told: a change after it is told once, the same state again is not', () => {
        const { window, fire } = fakeWindow();
        const tell = vi.fn();
        const watch = watchMinimized(window, tell);
        fire('minimize', true);
        watch.resend();
        fire('minimize', true);
        fire('restore', false);
        expect(tell.mock.calls).toEqual([[true], [true], [false]]);
    });
});
