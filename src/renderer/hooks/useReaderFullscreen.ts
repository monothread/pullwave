import { useCallback, useEffect, useRef, useState } from 'react';

export const FULLSCREEN_ESCAPE_GRACE_MS = 500;

function ignore(): undefined {
    return undefined;
}

export interface ReaderFullscreen {
    active: boolean;
    toggle: () => void;
    exit: () => void;
    takesEscape: () => boolean;
}

export function useReaderFullscreen(area: () => HTMLElement, enabled: boolean): ReaderFullscreen {
    const [active, setActive] = useState(false);
    const endedAt = useRef(0);
    const shown = useRef<Element | null>(null);

    const isOn = useCallback((): boolean => {
        return document.fullscreenElement !== null && document.fullscreenElement !== undefined && document.fullscreenElement === shown.current;
    }, []);

    useEffect(() => {
        const onChange = (): void => {
            const now = isOn();
            setActive((before) => {
                if (before && !now) {
                    endedAt.current = Date.now();
                }
                return now;
            });
        };
        document.addEventListener('fullscreenchange', onChange);
        return () => {
            document.removeEventListener('fullscreenchange', onChange);
        };
    }, [isOn]);

    const exit = useCallback(() => {
        if (isOn()) {
            document.exitFullscreen().catch(ignore);
        }
    }, [isOn]);

    const toggle = useCallback(() => {
        if (isOn()) {
            document.exitFullscreen().catch(ignore);
            return;
        }
        const element = area();
        shown.current = element;
        element.requestFullscreen().catch(ignore);
    }, [area, isOn]);

    useEffect(() => {
        if (!enabled) {
            exit();
            return undefined;
        }
        return exit;
    }, [enabled, exit]);

    const takesEscape = useCallback((): boolean => {
        return isOn() || Date.now() - endedAt.current < FULLSCREEN_ESCAPE_GRACE_MS;
    }, [isOn]);

    return { active, toggle, exit, takesEscape };
}
