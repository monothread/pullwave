export interface MinimizableWindow {
    isMinimized(): boolean;
    on(event: 'minimize' | 'restore' | 'show' | 'maximize' | 'focus', listener: () => void): unknown;
}

export const MINIMIZE_EVENTS = ['minimize', 'restore', 'show', 'maximize', 'focus'] as const;

export interface MinimizedWatch {
    resend: () => void;
}

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
