import { useCallback, useEffect, useRef, useState } from 'react';

// How long after the fullscreen ended an Escape still belongs to it: the window can leave the fullscreen with the key before the page hears it.
export const FULLSCREEN_ESCAPE_GRACE_MS = 500;

// A request the window refuses (a fullscreen asked for twice, or that ended in between) changes nothing.
function ignore(): undefined {
    return undefined;
}

export interface ReaderFullscreen {
    // Whether the area of the reader is in fullscreen.
    active: boolean;
    toggle: () => void;
    exit: () => void;
    // Whether an Escape is the one that leaves (or just left) the fullscreen, and must not close the reader.
    takesEscape: () => boolean;
}

// The area that scrolls the pages of the reader in fullscreen (with its bar on top), turned on and off by a double click on the pages. It is
// only there while `enabled` (the scroll modes, with the chapter on the screen): it ends when that stops, and when the reader closes.
export function useReaderFullscreen(area: () => HTMLElement, enabled: boolean): ReaderFullscreen {
    const [active, setActive] = useState(false);
    const endedAt = useRef(0);
    // The element this put in fullscreen: the reader that closes is no longer on the page to find it from.
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

    // Out of the scroll modes (or with no chapter) there is no fullscreen, and the reader that closes leaves it.
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
