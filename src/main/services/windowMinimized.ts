// The part of a window this needs: whether it is minimized, and the events that change it.
export interface MinimizableWindow {
    isMinimized(): boolean;
    on(event: 'minimize' | 'restore' | 'show' | 'maximize' | 'focus', listener: () => void): unknown;
}

// A window manager that brings the window back with none of the others still gives it the focus: it is read then too, so the animations
// cannot stay paused on a window that is on the screen.
export const MINIMIZE_EVENTS = ['minimize', 'restore', 'show', 'maximize', 'focus'] as const;

export interface MinimizedWatch {
    // Tells the page the state as it is now, whatever was told before: a page that was loaded (again) did not hear it.
    resend: () => void;
}

// Tells the page whether its window is minimized, each time that changes. Chromium stops drawing a minimized window but, on Linux, does
// not tell the page: its animations kept running and costing the processor and the graphics card as much as on the screen. The window can
// come back by any of these events, depending on the window manager, so each of them reads the state instead of assuming one.
export function watchMinimized(window: MinimizableWindow, tell: (minimized: boolean) => void): MinimizedWatch {
    let told = false;
    const send = (minimized: boolean): void => {
        told = minimized;
        tell(minimized);
    };
    const update = (): void => {
        const minimized = window.isMinimized();
        if (minimized !== told) {
            send(minimized);
        }
    };
    MINIMIZE_EVENTS.forEach((event) => {
        window.on(event, update);
    });
    return {
        resend: () => {
            send(window.isMinimized());
        }
    };
}
